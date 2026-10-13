import { col, nextEventSeq } from "../db/index.js";

export type Level = "info" | "warn" | "error" | "success";

/** Appends a line to a run's live log. */
export async function logEvent(runId: string, message: string, level: Level = "info") {
  const seq = await nextEventSeq(runId);
  await col.runEvents.insert({ runId, seq, level, message: message.slice(0, 2000) });
}
