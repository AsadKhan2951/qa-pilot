/**
 * Live view: while a run is going, the page each browser is on is captured
 * every ~1.5 s to runs/<id>/live/<channel>.jpg, and its URL + time saved on the
 * run, so the dashboard can show "your app" and "reference" side by side, live.
 */
import type { BrowserContext, Page } from "playwright";
import { col } from "../db/index.js";
import { saveArtifact } from "../lib/storage.js";
import type { RunContext } from "./context.js";

export type LiveChannel = "app" | "reference";
export type LiveFrame = { path: string; url: string; caption: string; at: string };

const INTERVAL_MS = Number(process.env.LIVE_VIEW_INTERVAL_MS ?? 1500);

export function watchContext(ctx: RunContext, context: BrowserContext, channel: LiveChannel) {
  if (INTERVAL_MS <= 0) return;
  let active: Page | null = null;
  let busy = false;
  const track = (p: Page) => {
    active = p;
    p.on("close", () => {
      if (active === p) active = context.pages().filter((x) => !x.isClosed()).at(-1) ?? null;
    });
  };
  context.pages().forEach(track);
  context.on("page", track);
  const timer = setInterval(async () => {
    const page = active;
    if (busy || !page || page.isClosed()) return;
    busy = true;
    try {
      const url = page.url();
      if (!url || url === "about:blank") return;
      const buf = await page.screenshot({ type: "jpeg", quality: 55, timeout: 4000, animations: "disabled", caret: "initial" });
      const path = await saveArtifact(`runs/${ctx.run.id}/live/${channel}.jpg`, buf);
      const frame: LiveFrame = { path, url, caption: ctx.liveCaption[channel] ?? "", at: new Date().toISOString() };
      await col.runs.update(ctx.run.id, { [`live.${channel}`]: frame } as never);
    } catch {
      /* navigation in progress or page closed */
    } finally {
      busy = false;
    }
  }, INTERVAL_MS);
  timer.unref?.();
  context.on("close", () => clearInterval(timer));
}
