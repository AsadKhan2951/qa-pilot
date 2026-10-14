import { createHash } from "node:crypto";
import type { Browser, Page } from "playwright";
import { col } from "../db/index.js";
import { logEvent } from "../services/events.js";
import type { Module, Project, Run, RunStats } from "../db/schema.js";
import type { ApiAuth, Credentials } from "../lib/crypto.js";
import { saveArtifact } from "../lib/storage.js";
import { createId } from "../lib/id.js";

export type Severity = "critical" | "high" | "medium" | "low";
export type Suite = "ui" | "visual" | "api" | "ai";

export type BugInput = {
  suite: Suite;
  category: string;
  severity: Severity;
  title: string;
  description?: string;
  steps?: string;
  expected?: string;
  actual?: string;
  url?: string;
  screenshot?: string;
  meta?: Record<string, unknown>;
  /** Same fingerprint in one run = same bug (deduped). Defaults to suite+category+title+url path. */
  fingerprint?: string;
};

export class Cancelled extends Error {}

export class RunContext {
  stats: RunStats = { checks: 0, pagesTested: 0, apiCalls: 0, evalsRun: 0, evalsPassed: 0 };
  private fingerprints = new Set<string>();
  bugCount = 0;
  /** API calls recorded while using the app (for API testing without a spec). */
  traffic = new Map<string, import("./traffic.js").Recorded>();
  trafficTested = new Set<string>();
  currentModuleId: string | null = null;
  /** Screens found by auto-explore, per module (see engines/explore.ts). */
  moduleMaps = new Map<string, import("./explore.js").MappedPage[]>();
  /** What each live-view browser is doing right now (shown under the frame). */
  liveCaption: Record<string, string> = {};
  storageState: Awaited<ReturnType<import("playwright").BrowserContext["storageState"]>> | undefined;

  constructor(
    public run: Run,
    public project: Project,
    public modules: Module[],
    public secrets: { creds: Credentials | null; apiAuth: ApiAuth | null; figmaToken: string | null; refPasscode: string | null },
    public browser: Browser,
  ) {}

  async log(message: string, level: "info" | "warn" | "error" | "success" = "info") {
    if (level === "info") this.liveCaption.app = message;
    console.log(`[run ${this.run.id}] ${level}: ${message}`);
    await logEvent(this.run.id, message, level);
  }

  /** Throws Cancelled if a user cancelled the run from the dashboard. */
  async checkCancelled() {
    const r = await col.runs.get(this.run.id);
    if (r?.status === "cancelled") throw new Cancelled("Run cancelled");
  }

  async addBug(moduleIdIn: string | null, bug: BugInput): Promise<boolean> {
    const moduleId = moduleIdIn || null; // "" = virtual "whole app" module
    let urlKey = "";
    try {
      urlKey = bug.url ? new URL(bug.url).pathname : "";
    } catch {
      urlKey = bug.url ?? "";
    }
    const fp = createHash("sha1")
      .update(bug.fingerprint ?? `${moduleId}|${bug.suite}|${bug.category}|${bug.title.toLowerCase()}|${urlKey}`)
      .digest("hex");
    if (this.fingerprints.has(fp)) return false;
    this.fingerprints.add(fp);
    this.bugCount++;
    await col.bugs.insert({
      runId: this.run.id,
      projectId: this.run.projectId,
      moduleId,
      suite: bug.suite,
      category: bug.category,
      severity: bug.severity,
      title: bug.title.slice(0, 300),
      description: bug.description ?? "",
      steps: bug.steps ?? "",
      expected: bug.expected ?? "",
      actual: (bug.actual ?? "").slice(0, 20000),
      url: bug.url ?? "",
      screenshot: bug.screenshot ?? "",
      fingerprint: fp,
      meta: bug.meta ?? {},
    });
    await this.log(`🐞 [${bug.severity}] ${bug.title}`, bug.severity === "critical" || bug.severity === "high" ? "error" : "warn");
    return true;
  }

  /** Saves a viewport screenshot as evidence and returns its artifact path. */
  async screenshot(page: Page, label: string, opts: { fullPage?: boolean; highlight?: string } = {}): Promise<string> {
    try {
      if (opts.highlight) {
        await page
          .evaluate((sel) => {
            const el = document.querySelector(sel) as HTMLElement | null;
            if (el) {
              el.scrollIntoView({ block: "center" });
              el.style.outline = "3px solid #ff2d55";
              el.style.outlineOffset = "2px";
            }
          }, opts.highlight)
          .catch(() => {});
      }
      const buf = await page.screenshot({ type: "jpeg", quality: 80, fullPage: opts.fullPage ?? false, timeout: 15000 });
      if (opts.highlight) {
        await page
          .evaluate((sel) => {
            const el = document.querySelector(sel) as HTMLElement | null;
            if (el) {
              el.style.outline = "";
              el.style.outlineOffset = "";
            }
          }, opts.highlight)
          .catch(() => {});
      }
      return await this.saveImage(buf, label, "jpg");
    } catch {
      return "";
    }
  }

  async saveImage(buf: Buffer, label: string, ext: "jpg" | "png" = "jpg"): Promise<string> {
    const safe = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
    return saveArtifact(`runs/${this.run.id}/shots/${safe}-${createId()}.${ext}`, buf);
  }

  /** Absolute URL for a module path. */
  url(path: string): string {
    return new URL(path || "/", this.project.baseUrl).toString();
  }
}
