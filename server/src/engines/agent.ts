/**
 * AI exploratory tester: Claude sees a screenshot + an indexed list of
 * interactive elements, decides the next action, and files bugs (with
 * screenshots) as it finds them.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { Page } from "playwright";
import { claude, imageBlock } from "../lib/claude.js";
import { env } from "../lib/env.js";
import type { RunContext, Severity } from "./context.js";
import { PageMonitor, describeSignal } from "./monitor.js";
import { signalToBug } from "./checks.js";

type Tool = Anthropic.Messages.Tool;
type Msg = Anthropic.Messages.MessageParam;

const TOOLS: Tool[] = [
  {
    name: "click",
    description: "Click the element with the given index.",
    input_schema: { type: "object", properties: { index: { type: "integer" } }, required: ["index"] },
  },
  {
    name: "type",
    description:
      "Clear the input with the given index and type text. Use {{USERNAME}} / {{PASSWORD}} placeholders for login credentials — never invent them. Set submit=true to press Enter afterwards.",
    input_schema: {
      type: "object",
      properties: { index: { type: "integer" }, text: { type: "string" }, submit: { type: "boolean" } },
      required: ["index", "text"],
    },
  },
  {
    name: "select_option",
    description: "Pick an option (by visible label or value) in a <select>.",
    input_schema: { type: "object", properties: { index: { type: "integer" }, option: { type: "string" } }, required: ["index", "option"] },
  },
  {
    name: "press_key",
    description: "Press a keyboard key, e.g. Enter, Escape, Tab, ArrowDown.",
    input_schema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] },
  },
  {
    name: "scroll",
    description: "Scroll the page.",
    input_schema: { type: "object", properties: { direction: { type: "string", enum: ["up", "down"] } }, required: ["direction"] },
  },
  {
    name: "go_to",
    description: "Navigate to a path on the app under test (same origin only), e.g. /settings.",
    input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
  { name: "go_back", description: "Browser back button.", input_schema: { type: "object", properties: {} } },
  {
    name: "wait",
    description: "Wait for async work (e.g. an AI response streaming in).",
    input_schema: { type: "object", properties: { seconds: { type: "number" } }, required: ["seconds"] },
  },
  {
    name: "report_bug",
    description:
      "File a bug you observed. A screenshot of the current screen is attached automatically (the element is highlighted if element_index is given). Only report real, reproducible problems — not opinions.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short, specific title" },
        severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
        category: {
          type: "string",
          enum: ["functional", "validation", "ui-layout", "content", "ux", "ai-quality", "performance", "security", "data"],
        },
        description: { type: "string" },
        steps: { type: "string", description: "Numbered steps to reproduce" },
        expected: { type: "string" },
        actual: { type: "string" },
        element_index: { type: "integer" },
      },
      required: ["title", "severity", "category", "description", "steps", "expected", "actual"],
    },
  },
  {
    name: "finish",
    description: "Call when the goal is covered (or impossible). Summarise what was tested and the outcome.",
    input_schema: {
      type: "object",
      properties: { summary: { type: "string" }, success: { type: "boolean" } },
      required: ["summary", "success"],
    },
  },
];

const SYSTEM = `You are a meticulous senior QA engineer testing a web application through a real browser.
You receive a screenshot, the current URL, and a numbered list of interactive elements. Act ONLY through the tools.

How to test:
- Follow the goal. Exercise every relevant flow: happy path first, then edge cases (empty fields, invalid formats, very long text, special characters, Roman Urdu/Unicode, double-clicks, back navigation).
- For AI features: send realistic prompts, wait for the full response, and judge correctness, relevance, hallucinations, formatting and latency.
- After each action, verify the result on screen. Things to catch: errors, broken layouts, overlapping/cut-off text, wrong data, actions with no feedback, missing validation, raw "undefined"/"NaN"/"[object Object]", infinite spinners, inconsistent states.
- Report each distinct problem once with report_bug, with precise steps. Do not report style opinions.
- Never perform irreversible real-world actions: real payments, deleting accounts, emailing real customers. Use obviously fake test data (e.g. "QA Test 123", qa+test@example.com).
- Be efficient. Call finish when done.`;

const ELEMENTS_JS = () => {
  const sel =
    'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=tab], [role=menuitem], [role=checkbox], [role=switch], [role=option], [role=combobox], [contenteditable=""], [contenteditable=true], [onclick]';
  document.querySelectorAll("[data-qa-idx]").forEach((e) => e.removeAttribute("data-qa-idx"));
  const out: string[] = [];
  let i = 0;
  const vh = window.innerHeight;
  const nodes = Array.from(document.querySelectorAll<HTMLElement>(sel));
  // In-viewport elements first
  nodes.sort((a, b) => {
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    const ia = ra.bottom > 0 && ra.top < vh ? 0 : 1, ib = rb.bottom > 0 && rb.top < vh ? 0 : 1;
    return ia - ib;
  });
  for (const el of nodes) {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    if (r.width < 2 || r.height < 2 || st.visibility === "hidden" || st.display === "none" || Number(st.opacity) === 0) continue;
    if (i >= 150) break;
    el.setAttribute("data-qa-idx", String(i));
    const tag = el.tagName.toLowerCase();
    const inp = el as HTMLInputElement;
    const parts = [`[${i}] <${tag}${inp.type && tag === "input" ? ` type=${inp.type}` : ""}>`];
    const role = el.getAttribute("role");
    if (role) parts.push(`role=${role}`);
    const label =
      el.getAttribute("aria-label") ||
      (el.innerText || "").trim().replace(/\s+/g, " ").slice(0, 80) ||
      inp.placeholder ||
      el.getAttribute("title") ||
      el.getAttribute("name") ||
      "";
    if (label) parts.push(JSON.stringify(label));
    if (tag === "input" || tag === "textarea") {
      if (inp.placeholder) parts.push(`placeholder=${JSON.stringify(inp.placeholder)}`);
      if (inp.value) parts.push(`value=${JSON.stringify(inp.type === "password" ? "•••" : inp.value.slice(0, 40))}`);
      if (inp.required) parts.push("required");
    }
    if (tag === "a") parts.push(`href=${el.getAttribute("href")}`);
    if ((el as HTMLButtonElement).disabled) parts.push("disabled");
    if (r.bottom < 0 || r.top > vh) parts.push("(offscreen)");
    out.push(parts.join(" "));
    i++;
  }
  return out.join("\n");
};

export type AgentOptions = {
  moduleId: string | null;
  goal: string;
  context?: string;
  maxSteps?: number;
  monitor?: PageMonitor;
  /** "task" = just accomplish (e.g. login) without bug hunting */
  mode?: "test" | "task";
};

export async function runAgent(ctx: RunContext, page: Page, opts: AgentOptions): Promise<{ summary: string; success: boolean; steps: number }> {
  const maxSteps = opts.maxSteps ?? env.agentMaxSteps;
  const origin = new URL(ctx.project.baseUrl).origin;
  const vars: Record<string, string> = {
    "{{USERNAME}}": ctx.secrets.creds?.username ?? "",
    "{{PASSWORD}}": ctx.secrets.creds?.password ?? "",
  };
  const history: string[] = []; // human-readable action log used for bug "steps"
  const messages: Msg[] = [];
  let pendingResults: Anthropic.Messages.ToolResultBlockParam[] = [];

  const system =
    (opts.mode === "task"
      ? "You are operating a web app through a browser to accomplish a setup task. Use the tools; do not report bugs unless the task is impossible because of one."
      : SYSTEM) +
    `\n\nApp under test: ${ctx.project.name} — ${ctx.project.description || "no description"}\nBase URL: ${ctx.project.baseUrl}` +
    (ctx.project.techStack ? `\nTech stack: ${ctx.project.techStack}` : "") +
    (opts.context ? `\n\n${opts.context}` : "") +
    (ctx.secrets.creds?.username ? "\n\nTest credentials are available via the {{USERNAME}} and {{PASSWORD}} placeholders." : "");

  for (let step = 1; step <= maxSteps; step++) {
    await ctx.checkCancelled();
    await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(600);

    const elements = await page.evaluate(ELEMENTS_JS).catch(() => "(could not read elements)");
    const shot = await page.screenshot({ type: "jpeg", quality: 60, timeout: 15000 }).catch(() => null);
    const signals = opts.monitor?.drain() ?? [];
    for (const s of signals) await ctx.addBug(opts.moduleId, { ...signalToBug(s), steps: history.join("\n") });

    const observation = [
      `Step ${step}/${maxSteps}. URL: ${page.url()}  Title: ${await page.title().catch(() => "")}`,
      signals.length ? `Errors captured since last step (already logged as bugs):\n${signals.map(describeSignal).join("\n")}` : "",
      `Interactive elements:\n${elements || "(none)"}`,
      step === 1 ? `GOAL:\n${opts.goal}` : "",
      step === maxSteps ? "This is your LAST step — call finish now." : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const content: Anthropic.Messages.ContentBlockParam[] = [...pendingResults];
    if (shot) content.push(imageBlock(shot));
    content.push({ type: "text", text: observation });
    messages.push({ role: "user", content });
    pendingResults = [];
    pruneImages(messages);

    const res = await claude().messages.create({
      model: env.claudeModel,
      max_tokens: 2048,
      system,
      tools: TOOLS,
      messages,
    });
    messages.push({ role: "assistant", content: res.content });

    const uses = res.content.filter((b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use");
    if (!uses.length) {
      // Model replied in text only — nudge it
      pendingResults = [];
      messages.push({ role: "user", content: [{ type: "text", text: "Use a tool to continue, or call finish." }] });
      messages.push({ role: "assistant", content: [{ type: "text", text: "Continuing." }] });
      continue;
    }

    for (const use of uses) {
      const input = use.input as Record<string, unknown>;
      let result = "ok";
      try {
        if (use.name === "finish") {
          history.push(`Finished: ${input.summary}`);
          return { summary: String(input.summary ?? ""), success: Boolean(input.success), steps: step };
        }
        if (use.name === "report_bug") {
          const idx = input.element_index as number | undefined;
          const screenshot = await ctx.screenshot(page, String(input.title), {
            highlight: idx !== undefined ? `[data-qa-idx="${idx}"]` : undefined,
          });
          const added = await ctx.addBug(opts.moduleId, {
            suite: "ui",
            category: String(input.category ?? "functional"),
            severity: (input.severity as Severity) ?? "medium",
            title: String(input.title),
            description: String(input.description ?? ""),
            steps: String(input.steps ?? history.join("\n")),
            expected: String(input.expected ?? ""),
            actual: String(input.actual ?? ""),
            url: page.url(),
            screenshot,
            meta: { foundBy: "ai-agent" },
          });
          result = added ? "Bug filed with screenshot." : "Duplicate — already filed.";
        } else {
          result = await act(page, use.name, input, vars, origin);
          history.push(`${history.length + 1}. ${describe(use.name, input)}`);
        }
      } catch (e) {
        result = `Action failed: ${(e as Error).message.split("\n")[0]}`;
      }
      pendingResults.push({ type: "tool_result", tool_use_id: use.id, content: result });
    }
  }
  return { summary: "Step budget exhausted", success: false, steps: maxSteps };
}

async function act(page: Page, name: string, input: Record<string, unknown>, vars: Record<string, string>, origin: string) {
  const el = (i: unknown) => page.locator(`[data-qa-idx="${Number(i)}"]`).first();
  const fill = (s: string) => Object.entries(vars).reduce((acc, [k, v]) => acc.split(k).join(v), s);
  switch (name) {
    case "click":
      await el(input.index).click({ timeout: 8000 });
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
      return "Clicked.";
    case "type": {
      const loc = el(input.index);
      await loc.fill(fill(String(input.text)), { timeout: 8000 });
      if (input.submit) {
        await loc.press("Enter");
        await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
      }
      return "Typed.";
    }
    case "select_option": {
      const opt = String(input.option);
      await el(input.index)
        .selectOption({ label: opt }, { timeout: 5000 })
        .catch(() => el(input.index).selectOption(opt, { timeout: 5000 }));
      return "Selected.";
    }
    case "press_key":
      await page.keyboard.press(String(input.key));
      return "Pressed.";
    case "scroll":
      await page.mouse.wheel(0, input.direction === "up" ? -700 : 700);
      return "Scrolled.";
    case "go_to": {
      const target = new URL(String(input.path), origin);
      if (target.origin !== origin) return "Refused: only the app under test may be visited.";
      await page.goto(target.toString(), { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
      return "Navigated.";
    }
    case "go_back":
      await page.goBack({ timeout: 15000 });
      return "Went back.";
    case "wait":
      await page.waitForTimeout(Math.min(Number(input.seconds) || 2, 30) * 1000);
      return "Waited.";
  }
  return `Unknown tool ${name}`;
}

function describe(name: string, input: Record<string, unknown>) {
  switch (name) {
    case "type":
      return `Type ${String(input.text).includes("{{PASSWORD}}") ? "the password" : JSON.stringify(input.text)} into element #${input.index}${input.submit ? " and press Enter" : ""}`;
    case "click":
      return `Click element #${input.index}`;
    case "go_to":
      return `Open ${input.path}`;
    case "select_option":
      return `Select "${input.option}" in #${input.index}`;
    case "press_key":
      return `Press ${input.key}`;
    default:
      return `${name} ${JSON.stringify(input)}`;
  }
}

/** Keep only the 2 most recent screenshots in the conversation to control cost. */
function pruneImages(messages: Msg[]) {
  let kept = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user" || !Array.isArray(m.content)) continue;
    const hasImage = m.content.some((b) => b.type === "image");
    if (!hasImage) continue;
    kept++;
    if (kept > 2) {
      m.content = m.content.map((b) => (b.type === "image" ? { type: "text" as const, text: "[older screenshot removed]" } : b));
    }
  }
}
