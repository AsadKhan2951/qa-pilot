import { Router } from "express";
import { z } from "zod";
import { col, deleteProjectCascade } from "../db/index.js";
import { assertMember, HttpError, loadProjectFor } from "../lib/auth.js";
import { decrypt, encrypt, type ApiAuth, type Credentials } from "../lib/crypto.js";
import { createId } from "../lib/id.js";
import { syncSchedule } from "../lib/queue.js";
import { createRun } from "../services/runs.js";
import type { Project } from "../db/schema.js";

export const projectsRouter = Router();

export const SUITES = ["ui", "visual", "api", "ai"] as const;

/** Never send secrets to the browser — only whether they are set. */
export function publicProject(p: Project) {
  const creds = decrypt<Credentials>(p.credentialsEnc);
  const apiAuth = decrypt<ApiAuth>(p.apiAuthEnc);
  const { credentialsEnc, figmaTokenEnc, apiAuthEnc, ...rest } = p;
  return {
    ...rest,
    credentials: { username: creds?.username ?? "", hasPassword: Boolean(creds?.password), notes: creds?.notes ?? "" },
    hasFigmaToken: Boolean(figmaTokenEnc),
    apiAuth: { headerName: apiAuth?.headerName ?? "", hasValue: Boolean(apiAuth?.headerValue) },
  };
}

const url = z.string().url().or(z.literal(""));
const projectInput = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(5000).optional(),
  techStack: z.string().max(500).optional(),
  baseUrl: z.string().url(),
  loginUrl: url.optional(),
  credentials: z
    .object({ username: z.string().optional(), password: z.string().optional(), notes: z.string().optional() })
    .optional(),
  figmaFileKey: z.string().optional(),
  figmaToken: z.string().optional(),
  openApiUrl: url.optional(),
  apiBaseUrl: url.optional(),
  apiAuth: z.object({ headerName: z.string().optional(), headerValue: z.string().optional() }).optional(),
  apiTestMode: z.enum(["safe", "full"]).optional(),
  scheduleCron: z
    .string()
    .regex(/^$|^(\S+\s+){4}\S+$/, "Cron must have 5 fields, e.g. 0 2 * * *")
    .optional(),
  scheduleSuites: z.array(z.enum(SUITES)).optional(),
});

/** Accepts a full Figma URL or a bare file key. */
function figmaKey(v?: string) {
  if (!v) return v;
  const m = v.match(/figma\.com\/(?:design|file|proto)\/([A-Za-z0-9]+)/);
  return m ? m[1] : v.trim();
}

function toColumns(body: Partial<z.infer<typeof projectInput>>, existing?: Project) {
  const cols: Partial<Project> = {};
  for (const k of ["name", "description", "techStack", "baseUrl", "loginUrl", "openApiUrl", "apiBaseUrl", "apiTestMode", "scheduleCron", "scheduleSuites"] as const) {
    if (body[k] !== undefined) (cols as Record<string, unknown>)[k] = body[k];
  }
  if (body.figmaFileKey !== undefined) cols.figmaFileKey = figmaKey(body.figmaFileKey);
  if (body.credentials) {
    const old = existing ? decrypt<Credentials>(existing.credentialsEnc) ?? {} : {};
    const merged: Credentials = {
      username: body.credentials.username ?? old.username,
      // Empty/undefined password keeps the stored one
      password: body.credentials.password ? body.credentials.password : old.password,
      notes: body.credentials.notes ?? old.notes,
    };
    cols.credentialsEnc = merged.username || merged.password ? encrypt(merged) : "";
  }
  if (body.figmaToken) cols.figmaTokenEnc = encrypt(body.figmaToken);
  if (body.apiAuth) {
    const old = existing ? decrypt<ApiAuth>(existing.apiAuthEnc) ?? {} : {};
    const merged: ApiAuth = {
      headerName: body.apiAuth.headerName ?? old.headerName,
      headerValue: body.apiAuth.headerValue ? body.apiAuth.headerValue : old.headerValue,
    };
    cols.apiAuthEnc = merged.headerName && merged.headerValue ? encrypt(merged) : "";
  }
  return cols;
}

// ---- Workspace-scoped ----
projectsRouter.get("/workspaces/:wid/projects", async (req, res) => {
  await assertMember(req.user!.id, req.params.wid);
  const rows = await col.projects.find({ workspaceId: req.params.wid }, { sort: { createdAt: -1 } });
  // Latest run per project for the list (one indexed lookup each)
  const latest = await Promise.all(rows.map((p) => col.runs.find({ projectId: p.id }, { sort: { createdAt: -1 }, limit: 1 }).then((r) => r[0])));
  res.json(
    rows.map((p) => {
      const l = latest.find((x) => x?.projectId === p.id);
      return { ...publicProject(p), lastRun: l ? { status: l.status, healthScore: l.healthScore, createdAt: l.createdAt } : null };
    }),
  );
});

projectsRouter.post("/workspaces/:wid/projects", async (req, res) => {
  await assertMember(req.user!.id, req.params.wid);
  const body = projectInput.parse(req.body);
  const p = await col.projects.insert({ ...toColumns(body), workspaceId: req.params.wid, name: body.name, baseUrl: body.baseUrl, triggerToken: createId() + createId() });
  if (p.scheduleCron) await syncSchedule(p.id, p.scheduleCron);
  res.status(201).json(publicProject(p));
});

// ---- Project ----
projectsRouter.get("/projects/:id", async (req, res) => {
  const p = await loadProjectFor(req.user!.id, req.params.id);
  res.json(publicProject(p));
});

projectsRouter.patch("/projects/:id", async (req, res) => {
  const p = await loadProjectFor(req.user!.id, req.params.id);
  const body = projectInput.partial().parse(req.body);
  const updated = (await col.projects.update(p.id, toColumns(body, p)))!;
  if (body.scheduleCron !== undefined) await syncSchedule(p.id, updated.scheduleCron);
  res.json(publicProject(updated));
});

projectsRouter.delete("/projects/:id", async (req, res) => {
  const p = await loadProjectFor(req.user!.id, req.params.id);
  await syncSchedule(p.id, "");
  await deleteProjectCascade(p.id);
  res.json({ ok: true });
});

projectsRouter.post("/projects/:id/rotate-token", async (req, res) => {
  const p = await loadProjectFor(req.user!.id, req.params.id);
  const u = (await col.projects.update(p.id, { triggerToken: createId() + createId() }))!;
  res.json(publicProject(u));
});

// ---- Modules under project ----
projectsRouter.get("/projects/:id/modules", async (req, res) => {
  const p = await loadProjectFor(req.user!.id, req.params.id);
  res.json(await col.modules.find({ projectId: p.id }, { sort: { position: 1, createdAt: 1 } }));
});

export const moduleInput = z.object({
  name: z.string().min(1).max(100),
  mvp: z.string().max(50).optional(),
  description: z.string().max(5000).optional(),
  position: z.number().int().optional(),
  paths: z.array(z.string()).optional(),
  userFlows: z.string().max(10000).optional(),
  figmaFrames: z.array(z.object({ path: z.string(), nodeId: z.string(), label: z.string().optional() })).optional(),
  apiScopes: z.array(z.string()).optional(),
  aiEvalTarget: z
    .object({
      url: z.string().optional(),
      method: z.string().optional(),
      headers: z.record(z.string(), z.string()).optional(),
      bodyTemplate: z.string().optional(),
      responsePath: z.string().optional(),
    })
    .optional(),
});

projectsRouter.post("/projects/:id/modules", async (req, res) => {
  const p = await loadProjectFor(req.user!.id, req.params.id);
  const body = moduleInput.parse(req.body);
  const m = await col.modules.insert({ ...body, projectId: p.id });
  res.status(201).json(m);
});

// ---- Runs under project ----
projectsRouter.get("/projects/:id/runs", async (req, res) => {
  const p = await loadProjectFor(req.user!.id, req.params.id);
  const [rows, modules] = await Promise.all([
    col.runs.find({ projectId: p.id }, { sort: { createdAt: -1 }, limit: 100 }),
    col.modules.find({ projectId: p.id }, { projection: { _id: 1, name: 1 } }),
  ]);
  res.json(
    rows.map((r) => ({
      id: r.id,
      status: r.status,
      suites: r.suites,
      trigger: r.trigger,
      healthScore: r.healthScore,
      stats: r.stats,
      createdAt: r.createdAt,
      finishedAt: r.finishedAt,
      moduleId: r.moduleId,
      moduleName: modules.find((m) => m.id === r.moduleId)?.name ?? null,
    })),
  );
});

projectsRouter.post("/projects/:id/runs", async (req, res) => {
  const p = await loadProjectFor(req.user!.id, req.params.id);
  const body = z
    .object({ suites: z.array(z.enum(SUITES)).min(1), moduleId: z.string().nullable().optional() })
    .parse(req.body);
  if (body.moduleId) {
    const m = await col.modules.get(body.moduleId);
    if (!m || m.projectId !== p.id) throw new HttpError(400, "Module does not belong to this project");
  }
  const run = await createRun({ projectId: p.id, moduleId: body.moduleId ?? null, suites: body.suites, trigger: "manual", userId: req.user!.id });
  res.status(201).json(run);
});
