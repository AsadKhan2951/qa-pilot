import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "./env.js";
import { col } from "../db/index.js";

export type AuthUser = { id: string; email: string; name: string };
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const COOKIE = "qapilot_session";

export function signSession(res: Response, user: AuthUser) {
  const token = jwt.sign(user, env.jwtSecret, { expiresIn: "14d" });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    maxAge: 14 * 24 * 3600 * 1000,
    path: "/",
  });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE];
  if (!token) return res.status(401).json({ error: "Not signed in" });
  try {
    const p = jwt.verify(token, env.jwtSecret) as AuthUser;
    req.user = { id: p.id, email: p.email, name: p.name };
    next();
  } catch {
    res.status(401).json({ error: "Session expired" });
  }
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Throws 404 unless the user belongs to the workspace. */
export async function assertMember(userId: string, workspaceId: string) {
  const m = await col.members.findOne({ userId, workspaceId });
  if (!m) throw new HttpError(404, "Workspace not found");
  return m;
}

export async function loadProjectFor(userId: string, projectId: string) {
  const p = await col.projects.get(projectId);
  if (!p) throw new HttpError(404, "Project not found");
  await assertMember(userId, p.workspaceId);
  return p;
}

export async function loadModuleFor(userId: string, moduleId: string) {
  const m = await col.modules.get(moduleId);
  if (!m) throw new HttpError(404, "Module not found");
  const project = await loadProjectFor(userId, m.projectId);
  return { module: m, project };
}

export async function loadRunFor(userId: string, runId: string) {
  const r = await col.runs.get(runId);
  if (!r) throw new HttpError(404, "Run not found");
  const project = await loadProjectFor(userId, r.projectId);
  return { run: r, project };
}
