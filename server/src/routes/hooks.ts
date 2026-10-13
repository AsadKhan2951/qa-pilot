import { Router } from "express";
import { z } from "zod";
import { col } from "../db/index.js";
import { HttpError } from "../lib/auth.js";
import { createRun } from "../services/runs.js";
import { env } from "../lib/env.js";

/**
 * Public CI trigger: POST /api/hooks/trigger/:token
 * body: { "suites": ["ui","api"], "moduleId": "optional" }
 * Use it in GitHub Actions after deploy to staging.
 */
export const hooksRouter = Router();

hooksRouter.post("/trigger/:token", async (req, res) => {
  const project = await col.projects.findOne({ triggerToken: req.params.token });
  if (!project) throw new HttpError(404, "Invalid token");
  const body = z
    .object({ suites: z.array(z.enum(["ui", "visual", "api", "ai"])).optional(), moduleId: z.string().optional() })
    .parse(req.body ?? {});
  if (body.moduleId) {
    const m = await col.modules.get(body.moduleId);
    if (!m || m.projectId !== project.id) throw new HttpError(400, "Unknown module");
  }
  const run = await createRun({
    projectId: project.id,
    moduleId: body.moduleId ?? null,
    suites: body.suites ?? project.scheduleSuites,
    trigger: "webhook",
  });
  res.status(201).json({ runId: run.id, url: `${env.publicAppUrl}/runs/${run.id}` });
});

/** Lets CI poll until a run finishes: GET /api/hooks/status/:token/:runId */
hooksRouter.get("/status/:token/:runId", async (req, res) => {
  const project = await col.projects.findOne({ triggerToken: req.params.token });
  const run = await col.runs.get(req.params.runId);
  if (!project || !run || run.projectId !== project.id) throw new HttpError(404, "Not found");
  res.json({ status: run.status, healthScore: run.healthScore, stats: run.stats });
});
