import { Queue } from "bullmq";
import { env } from "./env.js";

export const QUEUE_NAME = "qa-runs";

export function redisConnection() {
  const u = new URL(env.redisUrl);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    tls: u.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null as null,
  };
}

export const runQueue = new Queue(QUEUE_NAME, { connection: redisConnection() });

export type RunJob = { runId: string } | { scheduledProjectId: string };

export async function enqueueRun(runId: string) {
  await runQueue.add("run", { runId }, { jobId: runId, removeOnComplete: 500, removeOnFail: 500 });
}

/** Keeps the BullMQ repeatable job in sync with the project's cron. */
export async function syncSchedule(projectId: string, cron: string) {
  const schedulerId = `schedule:${projectId}`;
  if (!cron) {
    await runQueue.removeJobScheduler(schedulerId);
    return;
  }
  await runQueue.upsertJobScheduler(
    schedulerId,
    { pattern: cron, tz: process.env.SCHEDULE_TZ ?? "Asia/Karachi" },
    { name: "scheduled", data: { scheduledProjectId: projectId } },
  );
}
