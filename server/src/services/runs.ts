import { col } from "../db/index.js";
import { enqueueRun } from "../lib/queue.js";
import { logEvent } from "./events.js";

export async function createRun(opts: {
  projectId: string;
  moduleId: string | null;
  suites: string[];
  trigger: "manual" | "schedule" | "webhook";
  userId?: string;
}) {
  const run = await col.runs.insert({
    projectId: opts.projectId,
    moduleId: opts.moduleId,
    suites: opts.suites,
    trigger: opts.trigger,
    triggeredById: opts.userId ?? null,
  });
  await logEvent(run.id, `Run queued (${opts.suites.join(", ")})`);
  await enqueueRun(run.id);
  return run;
}
