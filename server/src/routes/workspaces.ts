import { Router } from "express";
import { z } from "zod";
import { col, deleteProjectCascade } from "../db/index.js";
import { assertMember, HttpError } from "../lib/auth.js";

export const workspacesRouter = Router();

workspacesRouter.get("/", async (req, res) => {
  const memberships = await col.members.find({ userId: req.user!.id });
  const ids = memberships.map((m) => m.workspaceId);
  const [workspaces, projects] = await Promise.all([
    col.workspaces.find({ _id: { $in: ids } }, { sort: { createdAt: -1 } }),
    col.projects.find({ workspaceId: { $in: ids } }, { projection: { _id: 1, workspaceId: 1 } }),
  ]);
  res.json(
    workspaces.map((w) => ({
      ...w,
      role: memberships.find((m) => m.workspaceId === w.id)?.role,
      projectCount: projects.filter((p) => p.workspaceId === w.id).length,
    })),
  );
});

workspacesRouter.post("/", async (req, res) => {
  const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(req.body);
  const ws = await col.workspaces.insert({ name });
  await col.members.insert({ workspaceId: ws.id, userId: req.user!.id, role: "owner" });
  res.status(201).json(ws);
});

workspacesRouter.get("/:id", async (req, res) => {
  const member = await assertMember(req.user!.id, req.params.id);
  const ws = await col.workspaces.get(req.params.id);
  const memberships = await col.members.find({ workspaceId: req.params.id });
  const users = await col.users.find({ _id: { $in: memberships.map((m) => m.userId) } });
  res.json({
    ...ws,
    role: member.role,
    members: memberships.map((m) => {
      const u = users.find((x) => x.id === m.userId);
      return { id: m.userId, name: u?.name ?? "", email: u?.email ?? "", role: m.role };
    }),
  });
});

workspacesRouter.patch("/:id", async (req, res) => {
  const m = await assertMember(req.user!.id, req.params.id);
  if (m.role === "member") throw new HttpError(403, "Only owners and admins can rename a workspace");
  const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(req.body);
  res.json(await col.workspaces.update(req.params.id, { name }));
});

workspacesRouter.delete("/:id", async (req, res) => {
  const m = await assertMember(req.user!.id, req.params.id);
  if (m.role !== "owner") throw new HttpError(403, "Only the owner can delete a workspace");
  for (const p of await col.projects.find({ workspaceId: req.params.id })) await deleteProjectCascade(p.id);
  await col.members.deleteMany({ workspaceId: req.params.id });
  await col.workspaces.delete(req.params.id);
  res.json({ ok: true });
});

/** Add an existing user (by email) to the workspace. */
workspacesRouter.post("/:id/members", async (req, res) => {
  const m = await assertMember(req.user!.id, req.params.id);
  if (m.role === "member") throw new HttpError(403, "Only owners and admins can add people");
  const body = z.object({ email: z.string().email(), role: z.enum(["admin", "member"]).default("member") }).parse(req.body);
  const user = await col.users.findOne({ email: body.email.toLowerCase() });
  if (!user) throw new HttpError(404, "No account with that email. Ask them to sign up first.");
  if (!(await col.members.findOne({ workspaceId: req.params.id, userId: user.id }))) {
    await col.members.insert({ workspaceId: req.params.id, userId: user.id, role: body.role });
  }
  res.status(201).json({ ok: true });
});

workspacesRouter.delete("/:id/members/:userId", async (req, res) => {
  const m = await assertMember(req.user!.id, req.params.id);
  if (m.role === "member") throw new HttpError(403, "Only owners and admins can remove people");
  await col.members.deleteMany({ workspaceId: req.params.id, userId: req.params.userId, role: { $ne: "owner" } });
  res.json({ ok: true });
});
