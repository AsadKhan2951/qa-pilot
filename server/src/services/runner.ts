import type { Browser } from "playwright";
import { col } from "../db/index.js";
import type { Module, Run } from "../db/schema.js";
import { decrypt, type ApiAuth, type Credentials } from "../lib/crypto.js";
import { Cancelled, RunContext } from "../engines/context.js";
import { ensureLogin, runUiSuite } from "../engines/ui.js";
import { runVisualSuite } from "../engines/visual.js";
import { runApiSuite } from "../engines/api.js";
import { runAiSuite } from "../engines/ai.js";
import { generateReport, healthScore } from "../report/generate.js";

/** Executes a queued run end-to-end: login → suites per module → report. */
export async function executeRun(runId: string, browser: Browser) {
  const run = await col.runs.get(runId);
  if (!run || run.status === "cancelled") return;
  const project = await col.projects.get(run.projectId);
  if (!project) return;

  const startedAt = new Date();
  await col.runs.update(run.id, { status: "running", startedAt });

  const allModules = await col.modules.find({ projectId: project.id }, { sort: { position: 1, createdAt: 1 } });
  let modules: Module[] = run.moduleId ? allModules.filter((m) => m.id === run.moduleId) : allModules;
  if (!modules.length) {
    // No modules defined yet: test the whole app as one virtual module
    modules = [
      {
        id: "",
        projectId: project.id,
        name: "Whole app",
        mvp: "",
        description: project.description,
        position: 0,
        paths: [],
        userFlows: "",
        figmaFrames: [],
        apiScopes: [],
        aiEvalTarget: {},
        createdAt: new Date(),
      },
    ];
  }

  const ctx = new RunContext(
    run,
    project,
    modules,
    {
      creds: decrypt<Credentials>(project.credentialsEnc),
      apiAuth: decrypt<ApiAuth>(project.apiAuthEnc),
      figmaToken: decrypt<string>(project.figmaTokenEnc),
      refPasscode: decrypt<string>(project.referencePasscodeEnc ?? ""),
    },
    browser,
  );

  let status: Run["status"] = "passed";
  let error = "";
  try {
    await ctx.log(`Started QA for ${project.name} — ${modules.length} module(s), suites: ${run.suites.join(", ")}`);
    if (run.suites.includes("ui") || run.suites.includes("visual")) await ensureLogin(ctx);

    for (const mod of modules) {
      await ctx.checkCancelled();
      await ctx.log(`━━ Module: ${mod.name}${mod.mvp ? ` (${mod.mvp})` : ""}`);
      const suites: [string, () => Promise<unknown>][] = [
        ["ui", () => runUiSuite(ctx, mod)],
        ["visual", () => runVisualSuite(ctx, mod)],
        ["api", () => (mod.apiScopes.length || !mod.id ? runApiSuite(ctx, mod.id ? mod : null) : ctx.log(`No API scopes on "${mod.name}"`))],
        ["ai", () => (mod.id ? runAiSuite(ctx, mod) : Promise.resolve())],
      ];
      for (const [suite, fn] of suites) {
        if (!run.suites.includes(suite)) continue;
        try {
          await fn();
        } catch (e) {
          if (e instanceof Cancelled) throw e;
          await ctx.log(`${suite} suite error in "${mod.name}": ${(e as Error).message}`, "error");
        }
      }
    }

    // Whole-project run: also test endpoints that no module claims
    if (!run.moduleId && run.suites.includes("api") && modules.some((m) => m.id && m.apiScopes.length)) {
      try {
        await runApiSuite(ctx, null, modules.flatMap((m) => m.apiScopes));
      } catch (e) {
        await ctx.log(`General API suite error: ${(e as Error).message}`, "error");
      }
    }
  } catch (e) {
    if (e instanceof Cancelled) status = "cancelled";
    else {
      status = "error";
      error = (e as Error).message;
      await ctx.log(`Run failed: ${error}`, "error");
    }
  }

  const bugs = await col.bugs.find({ runId: run.id }, { projection: { severity: 1, suite: 1 } });
  const bySeverity: Record<string, number> = {};
  const bySuite: Record<string, number> = {};
  for (const b of bugs) {
    bySeverity[b.severity] = (bySeverity[b.severity] ?? 0) + 1;
    bySuite[b.suite] = (bySuite[b.suite] ?? 0) + 1;
  }
  if (status === "passed" && bugs.some((b) => b.severity === "critical" || b.severity === "high")) status = "failed";
  const finishedAt = new Date();
  await col.runs.update(run.id, {
      status,
      error,
      finishedAt,
      healthScore: healthScore(bugs),
      stats: { ...ctx.stats, bySeverity, bySuite, durationMs: finishedAt.getTime() - startedAt.getTime() },
    });

  try {
    await ctx.log("Generating report…");
    const { summary } = await generateReport(browser, run.id);
    await col.runs.update(run.id, { summary: summary.headline });
    await ctx.log(`Report saved ✔ — ${bugs.length} issue(s), health ${healthScore(bugs)}/100`, "success");
  } catch (e) {
    await ctx.log(`Report generation failed: ${(e as Error).message}`, "error");
  }
}
