import { Worker } from "bullmq";
import { chromium, type Browser } from "playwright";
import { col, connectDb } from "./db/index.js";
import { env } from "./lib/env.js";
import { QUEUE_NAME, redisConnection, type RunJob } from "./lib/queue.js";
import { executeRun } from "./services/runner.js";
import { createRun } from "./services/runs.js";

let browser: Browser | null = null;
async function getBrowser() {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({
      headless: true,
      executablePath: env.chromiumPath,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"],
    });
  }
  return browser;
}

await connectDb();

// Crash recovery: anything left "running" from a previous process can't finish
const stale = await col.runs.count({ status: "running" });
if (stale) {
  await col.runs.updateMany({ status: "running" }, { status: "error", error: "The worker restarted during this run", finishedAt: new Date() });
  console.log(`Marked ${stale} interrupted run(s) as error`);
}

const worker = new Worker<RunJob>(
  QUEUE_NAME,
  async (job) => {
    const b = await getBrowser();
    if ("scheduledProjectId" in job.data) {
      const p = await col.projects.get(job.data.scheduledProjectId);
      if (!p || !p.scheduleCron) return;
      // createRun enqueues it; this job just spawns the run
      await createRun({ projectId: p.id, moduleId: null, suites: p.scheduleSuites, trigger: "schedule" });
      return;
    }
    await executeRun(job.data.runId, b);
  },
  { connection: redisConnection(), concurrency: env.workerConcurrency, lockDuration: 10 * 60 * 1000 },
);

worker.on("failed", async (job, err) => {
  console.error("Job failed", job?.id, err);
  if (job && "runId" in job.data) {
    await col.runs.update(job.data.runId, { status: "error", error: err.message, finishedAt: new Date() });
  }
});

console.log(`QA Pilot worker started (concurrency ${env.workerConcurrency})`);

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    await worker.close();
    await browser?.close();
    process.exit(0);
  });
}
