import { Router } from "express";
import { z } from "zod";
import { col, deleteModuleCascade } from "../db/index.js";
import { HttpError, loadModuleFor } from "../lib/auth.js";
import { moduleInput } from "./projects.js";
import { aiEnabled, askJson, textBlock } from "../lib/claude.js";

export const modulesRouter = Router();

modulesRouter.get("/modules/:id", async (req, res) => {
  const { module, project } = await loadModuleFor(req.user!.id, req.params.id);
  const cases = await col.evalCases.find({ moduleId: module.id }, { sort: { createdAt: 1 } });
  res.json({ ...module, evalCases: cases, project: { id: project.id, name: project.name, workspaceId: project.workspaceId, baseUrl: project.baseUrl } });
});

modulesRouter.patch("/modules/:id", async (req, res) => {
  const { module } = await loadModuleFor(req.user!.id, req.params.id);
  const body = moduleInput.partial().parse(req.body);
  res.json(await col.modules.update(module.id, body));
});

modulesRouter.delete("/modules/:id", async (req, res) => {
  const { module } = await loadModuleFor(req.user!.id, req.params.id);
  await deleteModuleCascade(module.id);
  res.json({ ok: true });
});

const caseInput = z.object({ name: z.string().min(1), input: z.string().min(1), criteria: z.string().min(1) });

modulesRouter.post("/modules/:id/eval-cases", async (req, res) => {
  const { module } = await loadModuleFor(req.user!.id, req.params.id);
  const items = z.array(caseInput).parse(Array.isArray(req.body) ? req.body : [req.body]);
  const rows = await col.evalCases.insertMany(items.map((c) => ({ ...c, moduleId: module.id })));
  res.status(201).json(rows);
});

modulesRouter.patch("/eval-cases/:id", async (req, res) => {
  const c = await col.evalCases.get(req.params.id);
  if (!c) throw new HttpError(404, "Not found");
  await loadModuleFor(req.user!.id, c.moduleId);
  res.json(await col.evalCases.update(c.id, caseInput.partial().parse(req.body)));
});

modulesRouter.delete("/eval-cases/:id", async (req, res) => {
  const c = await col.evalCases.get(req.params.id);
  if (!c) throw new HttpError(404, "Not found");
  await loadModuleFor(req.user!.id, c.moduleId);
  await col.evalCases.delete(c.id);
  res.json({ ok: true });
});

/** Claude drafts eval cases from the module description (user reviews before saving). */
modulesRouter.post("/modules/:id/eval-cases/generate", async (req, res) => {
  const { module, project } = await loadModuleFor(req.user!.id, req.params.id);
  if (!aiEnabled()) throw new HttpError(400, "ANTHROPIC_API_KEY is not configured");
  const { count } = z.object({ count: z.number().int().min(1).max(40).default(12) }).parse(req.body ?? {});
  const out = await askJson<{ cases: { name: string; input: string; criteria: string }[] }>({
    system:
      "You are a senior QA engineer specialised in evaluating AI features. Write evaluation cases that catch real failures: " +
      "hallucination, ignoring instructions, wrong format, unsafe output, edge cases, multilingual input (English + Roman Urdu), " +
      "empty/very long input, and prompt-injection attempts. Criteria must be concrete and checkable.",
    content: [
      textBlock(
        `Product: ${project.name}\nProduct description: ${project.description}\n\nModule: ${module.name} (${module.mvp})\nModule description: ${module.description}\n` +
          `AI endpoint: ${JSON.stringify(module.aiEvalTarget)}\n\nWrite ${count} eval cases.`,
      ),
    ],
    schema: {
      type: "object",
      properties: {
        cases: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              input: { type: "string", description: "Exact user input sent to the AI feature" },
              criteria: { type: "string", description: "What a correct response must and must not do" },
            },
            required: ["name", "input", "criteria"],
          },
        },
      },
      required: ["cases"],
    },
  });
  res.json(out.cases);
});
