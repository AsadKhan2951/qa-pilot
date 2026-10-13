import { Router } from "express";
import { z } from "zod";
import { col } from "../db/index.js";
import { HttpError, loadRunFor } from "../lib/auth.js";
import { artifactPath } from "../lib/storage.js";
import { logEvent } from "../services/events.js";

export const runsRouter = Router();

runsRouter.get("/runs/:id", async (req, res) => {
  const { run, project } = await loadRunFor(req.user!.id, req.params.id);
  const [module, report] = await Promise.all([col.modules.get(run.moduleId), col.reports.findOne({ runId: run.id })]);
  res.json({
    ...run,
    project: { id: project.id, name: project.name, workspaceId: project.workspaceId },
    module: module ? { id: module.id, name: module.name, mvp: module.mvp } : null,
    report: report ? { html: `/api/runs/${run.id}/report.html`, pdf: report.pdfPath ? `/api/runs/${run.id}/report.pdf` : null } : null,
  });
});

/** Incremental live log: ?after=<seq> */
runsRouter.get("/runs/:id/events", async (req, res) => {
  const { run } = await loadRunFor(req.user!.id, req.params.id);
  const after = Number(req.query.after ?? 0) || 0;
  res.json(await col.runEvents.find({ runId: run.id, seq: { $gt: after } }, { sort: { seq: 1 }, limit: 500 }));
});

runsRouter.get("/runs/:id/bugs", async (req, res) => {
  const { run } = await loadRunFor(req.user!.id, req.params.id);
  const [bugs, modules] = await Promise.all([
    col.bugs.find({ runId: run.id }, { sort: { createdAt: 1 } }),
    col.modules.find({ projectId: run.projectId }, { projection: { _id: 1, name: 1 } }),
  ]);
  res.json(
    bugs.map((b) => ({
      ...b,
      moduleName: modules.find((m) => m.id === b.moduleId)?.name ?? null,
      screenshotUrl: b.screenshot ? `/api/artifacts/${b.screenshot}` : null,
    })),
  );
});

runsRouter.post("/runs/:id/cancel", async (req, res) => {
  const { run } = await loadRunFor(req.user!.id, req.params.id);
  if (!["queued", "running"].includes(run.status)) throw new HttpError(400, "This run has already finished");
  await col.runs.update(run.id, { status: "cancelled", finishedAt: new Date() });
  await logEvent(run.id, `Stopped by ${req.user!.name}`, "warn");
  res.json({ ok: true });
});

runsRouter.patch("/bugs/:id", async (req, res) => {
  const bug = await col.bugs.get(req.params.id);
  if (!bug) throw new HttpError(404, "Issue not found");
  await loadRunFor(req.user!.id, bug.runId);
  const body = z
    .object({
      status: z.enum(["open", "fixed", "wontfix", "duplicate"]).optional(),
      severity: z.enum(["critical", "high", "medium", "low"]).optional(),
    })
    .parse(req.body);
  res.json(await col.bugs.update(bug.id, body));
});

runsRouter.get("/runs/:id/report.:ext", async (req, res) => {
  const { run } = await loadRunFor(req.user!.id, req.params.id);
  const report = await col.reports.findOne({ runId: run.id });
  if (!report) throw new HttpError(404, "The report is still being generated");
  const ext = req.params.ext;
  const rel = ext === "pdf" ? report.pdfPath : ext === "html" ? report.htmlPath : "";
  if (!rel) throw new HttpError(404, "Not available");
  if (ext === "pdf" || req.query.download) {
    res.setHeader("Content-Disposition", `attachment; filename="qa-report-${run.id}.${ext}"`);
  }
  res.sendFile(artifactPath(rel), { dotfiles: "allow" });
});

/** Screenshots & other artifacts — authorised via the run id in the path. */
runsRouter.get("/artifacts/runs/:runId/*rest", async (req, res) => {
  await loadRunFor(req.user!.id, req.params.runId);
  const rest = (req.params as unknown as { rest: string[] }).rest.join("/");
  res.setHeader("Cache-Control", "private, max-age=86400");
  res.sendFile(artifactPath(`runs/${req.params.runId}/${rest}`), { dotfiles: "allow" });
});
