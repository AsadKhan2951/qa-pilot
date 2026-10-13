import express, { type NextFunction, type Request, type Response } from "express";
import cookieParser from "cookie-parser";
import { ZodError } from "zod";
import { env } from "./lib/env.js";
import { requireAuth, HttpError } from "./lib/auth.js";
import { connectDb } from "./db/index.js";
import { authRouter } from "./routes/auth.js";
import { workspacesRouter } from "./routes/workspaces.js";
import { projectsRouter } from "./routes/projects.js";
import { modulesRouter } from "./routes/modules.js";
import { runsRouter } from "./routes/runs.js";
import { hooksRouter } from "./routes/hooks.js";

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api/auth", authRouter);
app.use("/api/hooks", hooksRouter);
app.use("/api/workspaces", requireAuth, workspacesRouter);
app.use("/api", requireAuth, projectsRouter, modulesRouter, runsRouter);

app.use((_req, res) => res.status(404).json({ error: "Not found" }));
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) return res.status(400).json({ error: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if ((err as { status?: number })?.status === 404) return res.status(404).json({ error: "Not found" });
  console.error(err);
  const msg = err instanceof Error ? err.message : String(err);
  res.status(500).json({ error: `Server error: ${msg.slice(0, 200)}` });
});

await connectDb();
app.listen(env.port, () => console.log(`QA Pilot API on :${env.port}`));
