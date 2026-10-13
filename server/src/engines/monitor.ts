import type { Page } from "playwright";

export type Signal =
  | { kind: "console"; text: string; url: string }
  | { kind: "pageerror"; text: string; url: string }
  | { kind: "http"; status: number; method: string; resourceUrl: string; resourceType: string; url: string; body?: string }
  | { kind: "requestfailed"; error: string; method: string; resourceUrl: string; resourceType: string; url: string };

const IGNORE = [
  /favicon\.ico/i,
  /google-analytics|googletagmanager|doubleclick|facebook\.net|hotjar|clarity\.ms|sentry\.io|segment\.io|mixpanel/i,
];

/** Captures console errors, JS exceptions and failed network calls for a page. */
export class PageMonitor {
  private buffer: Signal[] = [];

  constructor(private page: Page) {
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const text = msg.text();
      if (IGNORE.some((r) => r.test(text))) return;
      // Resource-load errors are reported more precisely by the response listener
      if (/Failed to load resource/i.test(text)) return;
      this.buffer.push({ kind: "console", text, url: page.url() });
    });
    page.on("pageerror", (err) => {
      this.buffer.push({ kind: "pageerror", text: `${err.name}: ${err.message}`, url: page.url() });
    });
    page.on("response", async (res) => {
      const status = res.status();
      if (status < 400) return;
      const req = res.request();
      const u = res.url();
      if (IGNORE.some((r) => r.test(u))) return;
      let body: string | undefined;
      if (["xhr", "fetch"].includes(req.resourceType())) {
        body = await res.text().then((b) => b.slice(0, 2000)).catch(() => undefined);
      }
      this.buffer.push({ kind: "http", status, method: req.method(), resourceUrl: u, resourceType: req.resourceType(), url: page.url(), body });
    });
    page.on("requestfailed", (req) => {
      const error = req.failure()?.errorText ?? "failed";
      if (/ERR_ABORTED|NS_BINDING_ABORTED|cancelled/i.test(error)) return;
      if (IGNORE.some((r) => r.test(req.url()))) return;
      this.buffer.push({ kind: "requestfailed", error, method: req.method(), resourceUrl: req.url(), resourceType: req.resourceType(), url: page.url() });
    });
  }

  /** Returns and clears the signals captured since the last drain. */
  drain(): Signal[] {
    const out = this.buffer;
    this.buffer = [];
    return out;
  }
}

export function describeSignal(s: Signal): string {
  switch (s.kind) {
    case "console":
      return `Console error: ${s.text}`;
    case "pageerror":
      return `Uncaught JS exception: ${s.text}`;
    case "http":
      return `HTTP ${s.status} on ${s.method} ${s.resourceUrl}`;
    case "requestfailed":
      return `Request failed (${s.error}): ${s.method} ${s.resourceUrl}`;
  }
}
