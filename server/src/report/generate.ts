/** Builds the saved QA report (self-contained HTML + PDF) for a finished run. */
import sharp from "sharp";
import type { Browser } from "playwright";
import { col } from "../db/index.js";
import type { Bug, Module, Project, Run } from "../db/schema.js";
import { aiEnabled, askJson, textBlock } from "../lib/claude.js";
import { env } from "../lib/env.js";
import { readArtifact, saveArtifact } from "../lib/storage.js";

const SEV_ORDER = ["critical", "high", "medium", "low"] as const;
const SEV_WEIGHT: Record<string, number> = { critical: 15, high: 7, medium: 3, low: 1 };
const SUITE_LABEL: Record<string, string> = { ui: "Frontend", visual: "Figma match", api: "API", ai: "AI answers" };

export function healthScore(bugs: Pick<Bug, "severity">[]) {
  const penalty = bugs.reduce((s, b) => s + (SEV_WEIGHT[b.severity] ?? 1), 0);
  return Math.max(0, Math.round(100 - penalty));
}

type Summary = { headline: string; executive_summary: string; top_risks: string[]; recommendations: string[]; release_ready: boolean };

async function summarise(project: Project, run: Run, bugs: Bug[], modules: Module[], score: number): Promise<Summary> {
  const fallback: Summary = {
    headline: bugs.length ? `${bugs.length} issue(s) found` : "No issues found",
    executive_summary: bugs.length
      ? `QA found ${bugs.length} issue(s): ${SEV_ORDER.map((s) => `${bugs.filter((b) => b.severity === s).length} ${s}`).join(", ")}.`
      : "All executed checks passed.",
    top_risks: bugs.filter((b) => b.severity === "critical" || b.severity === "high").slice(0, 5).map((b) => b.title),
    recommendations: [],
    release_ready: !bugs.some((b) => b.severity === "critical"),
  };
  if (!aiEnabled() || !bugs.length) return fallback;
  try {
    const list = bugs
      .slice(0, 150)
      .map((b) => `- [${b.severity}] [${b.suite}/${b.category}] [${modules.find((m) => m.id === b.moduleId)?.name ?? "General"}] ${b.title}`)
      .join("\n");
    return await askJson<Summary>({
      model: env.claudeModelStrong,
      system:
        "You are a QA lead writing the summary of an automated QA run for founders and developers. Be concrete and brief. " +
        "Group related bugs into root causes where possible. Recommendations must be actionable fixes in priority order.",
      content: [
        textBlock(
          `Product: ${project.name} (${project.techStack || "stack n/a"})\nSuites: ${run.suites.join(", ")}\nHealth score: ${score}/100\nStats: ${JSON.stringify(run.stats)}\n\nBugs:\n${list}`,
        ),
      ],
      schema: {
        type: "object",
        properties: {
          headline: { type: "string", description: "One line verdict" },
          executive_summary: { type: "string", description: "3-5 sentences" },
          top_risks: { type: "array", items: { type: "string" }, maxItems: 6 },
          recommendations: { type: "array", items: { type: "string" }, maxItems: 8 },
          release_ready: { type: "boolean" },
        },
        required: ["headline", "executive_summary", "top_risks", "recommendations", "release_ready"],
      },
    });
  } catch {
    return fallback;
  }
}

/** Embeds Instrument Sans so the saved report looks the same offline and in the PDF. */
let fontCss: string | null = null;
async function fontFace() {
  if (fontCss !== null) return fontCss;
  try {
    const { createRequire } = await import("node:module");
    const req = createRequire(import.meta.url);
    const fs = await import("node:fs/promises");
    const face = async (pkg: string, file: string, family: string, weights: string) => {
      const b64 = (await fs.readFile(req.resolve(`${pkg}/files/${file}`))).toString("base64");
      return `@font-face{font-family:"${family}";font-weight:${weights};font-display:swap;src:url(data:font/woff2;base64,${b64}) format("woff2")}`;
    };
    fontCss =
      (await face("@fontsource-variable/instrument-sans", "instrument-sans-latin-wght-normal.woff2", "Instrument Sans", "400 700")) +
      (await face("@fontsource-variable/bricolage-grotesque", "bricolage-grotesque-latin-wght-normal.woff2", "Bricolage Grotesque", "200 800"));
  } catch {
    fontCss = "";
  }
  return fontCss;
}

const esc = (s: string) => (s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

async function inlineShot(rel: string): Promise<string> {
  if (!rel) return "";
  const buf = await readArtifact(rel);
  if (!buf) return "";
  const small = await sharp(buf).resize({ width: 1400, withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer();
  return `data:image/jpeg;base64,${small.toString("base64")}`;
}

export async function generateReport(browser: Browser, runId: string) {
  const run = (await col.runs.get(runId))!;
  const project = (await col.projects.get(run.projectId))!;
  const modules = await col.modules.find({ projectId: project.id });
  const bugs = (await col.bugs.find({ runId })).sort(
    (a, b) => SEV_ORDER.indexOf(a.severity as never) - SEV_ORDER.indexOf(b.severity as never),
  );
  const score = healthScore(bugs);
  const summary = await summarise(project, run, bugs, modules, score);
  const scopeModule = run.moduleId ? modules.find((m) => m.id === run.moduleId) : null;

  const groups = new Map<string, Bug[]>();
  for (const b of bugs) {
    const key = b.moduleId ?? "general";
    groups.set(key, [...(groups.get(key) ?? []), b]);
  }
  const counts = Object.fromEntries(SEV_ORDER.map((s) => [s, bugs.filter((b) => b.severity === s).length]));
  const durationMs = run.startedAt && run.finishedAt ? run.finishedAt.getTime() - run.startedAt.getTime() : run.stats.durationMs ?? 0;

  let n = 0;
  const sections: string[] = [];
  for (const [key, list] of groups) {
    const mod = modules.find((m) => m.id === key);
    const cards: string[] = [];
    for (const b of list) {
      n++;
      const img = await inlineShot(b.screenshot);
      cards.push(`<article class="bug" style="--sev:${({ critical: "#c8102e", high: "#f0721f", medium: "#c99a06", low: "#4f7cc4" } as Record<string, string>)[b.severity] ?? "#8b96a6"}">
        <div class="bug-meta"><span class="num">#${n}</span><span class="sev">${esc(b.severity[0].toUpperCase() + b.severity.slice(1))}</span><span>${esc(SUITE_LABEL[b.suite] ?? b.suite)}</span><span>${esc(b.category)}</span></div>
        <h4>${esc(b.title)}</h4>
        ${b.url ? `<div class="url">${esc(b.url)}</div>` : ""}
        ${b.description ? `<p class="desc">${esc(b.description)}</p>` : ""}
        <div class="grid">
          ${b.steps ? `<div><h5>How to reproduce</h5><pre>${esc(b.steps)}</pre></div>` : ""}
          ${b.expected ? `<div><h5>Expected</h5><pre class="ok">${esc(b.expected)}</pre></div>` : ""}
          ${b.actual ? `<div><h5>What happened</h5><pre class="bad">${esc(b.actual.slice(0, 3000))}</pre></div>` : ""}
        </div>
        ${img ? `<img src="${img}" alt="Screenshot for issue ${n}">` : ""}
      </article>`);
    }
    sections.push(`<section class="module"><div class="module-head"><h3>${esc(mod ? mod.name : "General")}</h3><small>${mod?.mvp ? `${esc(mod.mvp)}, ` : ""}${list.length} issue${list.length === 1 ? "" : "s"}</small></div>${cards.join("")}</section>`);
  }

  const blocking = counts.critical + counts.high;
  const verdict =
    run.status === "error"
      ? { title: "Run didn't finish", sub: run.error || "Results so far are below.", hold: true }
      : run.status === "cancelled"
        ? { title: "Run stopped", sub: "Stopped before all checks finished.", hold: false }
        : blocking
          ? { title: "Hold release", sub: `${[counts.critical && `${counts.critical} critical`, counts.high && `${counts.high} high`].filter(Boolean).join(" and ")} ${blocking === 1 ? "issue needs" : "issues need"} fixing first.`, hold: true }
          : { title: "Cleared for release", sub: bugs.length ? `No blocking issues. ${bugs.length} smaller ${bugs.length === 1 ? "issue" : "issues"} to look at.` : "Every check passed.", hold: false };
  const band = score >= 85 ? "#7ddbb2" : score >= 60 ? "#ff9068" : "#ff4b1f";
  const ticks = Array.from({ length: 10 }, (_, i) => `<i style="background:${i < Math.max(score > 0 ? 1 : 0, Math.round(score / 10)) ? band : "#2b3328"}"></i>`).join("");
  const sevColor: Record<string, string> = { critical: "#c8102e", high: "#f0721f", medium: "#c99a06", low: "#4f7cc4" };
  const sevLabel: Record<string, string> = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };
  const font = await fontFace();
  const durationLabel = durationMs >= 60000 ? `${Math.floor(durationMs / 60000)} min ${Math.round((durationMs % 60000) / 1000)} s` : `${Math.round(durationMs / 1000)} s`;

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>QA report: ${esc(project.name)}</title>
<style>
${font}
:root{--deck:#10140f;--deck2:#1c221a;--deckline:#2b3328;--decktext:#a3aa9c;--hangar:#f5f6f3;--ink:#10140f;--mute:#5b6258;--faint:#8a9186;--line:#e4e6df;--soft:#f1f2ed;--signal:#ff4b1f;--grad:linear-gradient(135deg,#ff4b1f,#ff9068)}
*{box-sizing:border-box}
body{margin:0;background:var(--hangar);color:var(--ink);font:14px/1.5 "Instrument Sans",-apple-system,"Segoe UI",Arial,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:1040px;margin:0 auto;padding:36px 24px 64px}
.brand{display:flex;align-items:center;gap:10px;font:800 18px "Bricolage Grotesque",sans-serif;letter-spacing:-.04em}
.meta{color:var(--mute);font-size:13px;margin-top:22px}
h1,h2,h3,h4,.d{font-family:"Bricolage Grotesque","Instrument Sans",sans-serif}
h1{font-size:38px;line-height:1.05;letter-spacing:-.035em;margin:6px 0 4px;font-weight:800}
.suites{color:var(--mute)}
.band{background:var(--deck);color:#fff;border-radius:24px;margin-top:26px;overflow:hidden}
.band-top{display:flex;justify-content:space-between;align-items:center;gap:24px;padding:26px 28px;flex-wrap:wrap}
.verdict{display:flex;gap:14px;align-items:flex-start}
.dot{width:12px;height:12px;border-radius:50%;margin-top:12px;flex:none}
.verdict h2{font-size:40px;letter-spacing:-.04em;margin:0;line-height:1.05;font-weight:800}
.hold{background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
.verdict p{margin:4px 0 0;color:var(--decktext);font-size:14.5px;max-width:56ch}
.gauge{text-align:right}.gauge small{display:block;color:var(--decktext);font-size:13px;margin-bottom:6px}
.gauge b{font-family:"Bricolage Grotesque",sans-serif;font-weight:800;font-size:52px;line-height:1;letter-spacing:-.02em;font-variant-numeric:tabular-nums;vertical-align:middle;color:${band}}
.gauge span{display:inline-flex;gap:5px;align-items:flex-end;margin-left:14px;vertical-align:middle}.gauge i{display:block;width:6px;height:30px;border-radius:2px}
.sevs{display:grid;grid-template-columns:repeat(4,1fr);border-top:1px solid var(--deckline)}
.sevs div{padding:14px 28px;display:flex;justify-content:space-between;align-items:center;color:var(--decktext);font-size:13.5px}
.sevs div+div{border-left:1px solid var(--deckline)}
.sevs b{font-family:"Bricolage Grotesque",sans-serif;font-weight:800;font-size:28px;color:#fff;font-variant-numeric:tabular-nums}.sevs b.zero{color:#4b5b75}
.sq{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:8px;vertical-align:-1px}
.stats{color:var(--mute);font-size:12.5px;margin:12px 2px 0}
.panel{background:#fff;border:1px solid var(--line);border-radius:18px;margin-top:22px;padding:22px 26px}
.panel h3{margin:0 0 6px;font-size:16px;letter-spacing:-.01em}
.panel p{margin:0 0 6px;max-width:75ch}
ol,ul{margin:6px 0 0;padding-left:20px}li{margin:3px 0}
h2.section{font-size:26px;letter-spacing:-.03em;margin:44px 0 4px;font-weight:800}
.module{margin-top:26px}.module-head{display:flex;align-items:baseline;gap:10px;margin-bottom:10px;page-break-after:avoid;break-after:avoid}
.module-head h3{margin:0;font-size:20px;letter-spacing:-.02em}.module-head small{color:var(--mute);font-size:13px}
.bug{position:relative;background:#fff;border:1px solid var(--line);border-radius:16px;padding:18px 22px 18px 26px;margin:0 0 12px;page-break-inside:avoid;overflow:hidden}
.bug:before{content:"";position:absolute;left:9px;top:16px;bottom:16px;width:3px;border-radius:3px;background:var(--sev)}
.bug-meta{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;font-size:12.5px;color:var(--mute)}
.sev{font-weight:600;color:var(--sev)}.sev:before{content:"";display:inline-block;width:8px;height:8px;border-radius:2px;background:var(--sev);margin-right:6px}
.num{color:var(--faint);font-variant-numeric:tabular-nums}
.bug h4{margin:8px 0 2px;font-size:15.5px;line-height:1.35;letter-spacing:-.01em}
.url{font:12px "SFMono-Regular",Menlo,Consolas,monospace;color:var(--mute);word-break:break-all}
.desc{margin:8px 0 0;max-width:78ch}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin-top:12px}
h5{margin:0 0 5px;font-size:12.5px;font-weight:600;color:var(--ink)}
pre{margin:0;background:var(--soft);border-left:3px solid var(--line);border-radius:6px;padding:10px 12px;white-space:pre-wrap;word-break:break-word;font:11.5px/1.55 "SFMono-Regular",Menlo,Consolas,monospace;max-height:320px;overflow:auto}
pre.ok{border-left-color:#17865f}pre.bad{border-left-color:#c8102e}
.bug img{width:100%;margin-top:14px;border:1px solid var(--line);border-radius:8px}
.clean{background:#fff;border:1px dashed #cdd1c6;border-radius:18px;padding:26px;color:#17865f;font-weight:600}
footer{margin-top:44px;color:var(--faint);font-size:12px}
@media print{body{background:#fff}.wrap{padding:0}pre{max-height:none}.band,.bug,.panel{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body><div class="wrap">
<div class="brand"><svg width="24" height="24" viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="13.5" stroke="#ff4b1f" stroke-width="2.5"/><path d="M3.5 17.5h5.5l4 4.5 9-11h6.5" stroke="#10140f" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>QA Pilot</div>
<div class="meta">QA report, ${esc(run.startedAt ? run.startedAt.toUTCString().replace(" GMT", " UTC") : "")}. Took ${durationLabel}${run.trigger === "webhook" ? ", started from CI" : run.trigger === "schedule" ? ", scheduled run" : ""}.</div>
<h1>${esc(project.name)}${scopeModule ? `: ${esc(scopeModule.name)}` : ""}</h1>
<div class="suites">${scopeModule ? `${esc(scopeModule.mvp)}, ` : "Whole product, "}${run.suites.map((s) => esc(SUITE_LABEL[s] ?? s)).join(", ")}</div>

<section class="band">
  <div class="band-top">
    <div class="verdict"><span class="dot" style="background:${verdict.hold ? "linear-gradient(135deg,#ff4b1f,#ff9068)" : "#4cc796"}"></span>
      <div><h2 class="${verdict.hold ? "hold" : ""}">${esc(verdict.title)}</h2><p>${esc(verdict.sub)}</p></div></div>
    <div class="gauge"><small>Health score</small><b>${score}</b><span>${ticks}</span></div>
  </div>
  <div class="sevs">${SEV_ORDER.map((s) => `<div><span><span class="sq" style="background:${sevColor[s]}"></span>${sevLabel[s]}</span><b class="${counts[s] ? "" : "zero"}">${counts[s]}</b></div>`).join("")}</div>
</section>
<div class="stats">${run.stats.pagesTested ?? 0} pages, ${run.stats.apiCalls ?? 0} API calls, ${run.stats.evalsPassed ?? 0} of ${run.stats.evalsRun ?? 0} AI evals passed.</div>

<div class="panel">
  <h3>${esc(summary.headline)}</h3>
  <p>${esc(summary.executive_summary)}</p>
  ${summary.top_risks.length ? `<h3 style="margin-top:16px">Biggest risks</h3><ul>${summary.top_risks.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}
  ${summary.recommendations.length ? `<h3 style="margin-top:16px">Fix in this order</h3><ol>${summary.recommendations.map((r) => `<li>${esc(r)}</li>`).join("")}</ol>` : ""}
</div>

<h2 class="section">Issues by module</h2>
${sections.join("") || `<div class="clean">No issues found in this run.</div>`}
<footer>Generated by QA Pilot. Run ${esc(run.id)}.</footer>
</div></body></html>`;

  const htmlPath = await saveArtifact(`runs/${runId}/report.html`, html);
  let pdfPath = "";
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load", timeout: 60000 });
    const pdf = await page.pdf({ format: "A4", printBackground: true, margin: { top: "14mm", bottom: "14mm", left: "10mm", right: "10mm" } });
    await page.close();
    pdfPath = await saveArtifact(`runs/${runId}/report.pdf`, pdf);
  } catch (e) {
    console.error("PDF generation failed", e);
  }

  const existing = await col.reports.findOne({ runId });
  if (existing) await col.reports.update(existing.id, { htmlPath, pdfPath, createdAt: new Date() });
  else await col.reports.insert({ runId, htmlPath, pdfPath });
  return { score, summary };
}
