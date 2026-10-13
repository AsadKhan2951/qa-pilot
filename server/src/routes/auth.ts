import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { col } from "../db/index.js";
import { COOKIE, HttpError, requireAuth, signSession } from "../lib/auth.js";
import { env } from "../lib/env.js";

export const authRouter = Router();

const registerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
});

authRouter.post("/register", async (req, res) => {
  const body = registerSchema.parse(req.body);
  const anyUser = await col.users.count();
  // The first user can always register; after that only if ALLOW_REGISTRATION=true
  if (anyUser && !env.allowRegistration) throw new HttpError(403, "Sign-ups are closed. Ask a workspace owner to add you.");
  const email = body.email.toLowerCase();
  if (await col.users.findOne({ email })) throw new HttpError(409, "That email already has an account");
  const user = await col.users.insert({ name: body.name, email, passwordHash: await bcrypt.hash(body.password, 12) });
  signSession(res, { id: user.id, email: user.email, name: user.name });
  res.json({ id: user.id, email: user.email, name: user.name });
});

authRouter.post("/login", async (req, res) => {
  const body = z.object({ email: z.string(), password: z.string() }).parse(req.body);
  const user = await col.users.findOne({ email: body.email.toLowerCase() });
  if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) throw new HttpError(401, "Wrong email or password");
  signSession(res, { id: user.id, email: user.email, name: user.name });
  res.json({ id: user.id, email: user.email, name: user.name });
});

authRouter.post("/logout", (_req, res) => {
  res.clearCookie(COOKIE, { path: "/" });
  res.json({ ok: true });
});

authRouter.get("/me", requireAuth, (req, res) => res.json(req.user));
