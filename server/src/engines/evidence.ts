import type { RunContext } from "./context.js";

export type EvidenceSection = { label: string; body: string; tone?: "neutral" | "good" | "bad" };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * Renders request/response or input/output evidence as an image, so API and
 * AI-eval bugs get a "screenshot" just like UI bugs.
 */
export async function renderEvidence(ctx: RunContext, title: string, sections: EvidenceSection[]): Promise<string> {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;background:#0f1115;font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#e6e8eb;padding:24px;width:1052px}
    h1{font:600 18px/1.3 -apple-system,Segoe UI,Arial,sans-serif;margin:0 0 16px;color:#fff}
    .s{border:1px solid #2a2f3a;border-radius:10px;margin:0 0 12px;overflow:hidden}
    .l{font:600 11px -apple-system,Segoe UI,Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;padding:8px 12px;background:#181c23;color:#9aa4b2}
    .bad .l{background:#3a1820;color:#ff8fa3}.good .l{background:#143024;color:#7ee2a8}
    pre{margin:0;padding:12px;white-space:pre-wrap;word-break:break-word;max-height:420px;overflow:hidden}
    .brand{font:600 11px -apple-system,Arial;color:#5b6472;margin-top:8px}
  </style></head><body><h1>${esc(title)}</h1>${sections
    .map((s) => `<div class="s ${s.tone ?? "neutral"}"><div class="l">${esc(s.label)}</div><pre>${esc(s.body.slice(0, 4000))}</pre></div>`)
    .join("")}<div class="brand">QA Pilot evidence · ${new Date().toISOString()}</div></body></html>`;
  const page = await ctx.browser.newPage({ viewport: { width: 1100, height: 600 } });
  try {
    await page.setContent(html, { waitUntil: "load" });
    const buf = await page.screenshot({ fullPage: true, type: "jpeg", quality: 85 });
    return ctx.saveImage(buf, title);
  } finally {
    await page.close();
  }
}
