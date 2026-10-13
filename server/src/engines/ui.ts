import type { BrowserContext, Page } from "playwright";
import type { Module } from "../db/schema.js";
import { col } from "../db/index.js";
import { aiEnabled } from "../lib/claude.js";
import type { RunContext } from "./context.js";
import { PageMonitor } from "./monitor.js";
import { checkPage } from "./checks.js";
import { runAgent } from "./agent.js";
import { recordTraffic } from "./traffic.js";
import { watchContext } from "./live.js";

export async function newContext(ctx: RunContext, viewport = { width: 1440, height: 900 }): Promise<BrowserContext> {
  const context = await ctx.browser.newContext({
    viewport,
    storageState: ctx.storageState,
    ignoreHTTPSErrors: true,
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 QAPilot/1.0",
  });
  // Dev builds (tsx/esbuild) wrap functions passed to page.evaluate with __name()
  await context.addInitScript("globalThis.__name = globalThis.__name || ((f) => f);");
  recordTraffic(ctx, context);
  watchContext(ctx, context, "app");
  return context;
}

/**
 * Logs in once per run and stores the session (cookies + localStorage) so every
 * module/page reuses it. Tries a fast heuristic first, then lets the AI agent do it.
 */
export async function ensureLogin(ctx: RunContext): Promise<void> {
  const { loginUrl } = ctx.project;
  const creds = ctx.secrets.creds;
  if (!loginUrl || !creds?.username || !creds?.password) return;

  await ctx.log("Logging in with project credentials…");
  const context = await newContext(ctx);
  const page = await context.newPage();
  try {
    await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});

    const pwd = page.locator('input[type="password"]:visible').first();
    if (await pwd.count()) {
      const user = page
        .locator(
          'input[type="email"]:visible, input[autocomplete="username"]:visible, input[name*="user" i]:visible, input[name*="email" i]:visible, input[id*="email" i]:visible, input[type="text"]:visible',
        )
        .first();
      if (await user.count()) await user.fill(creds.username);
      await pwd.fill(creds.password);
      const submit = page
        .locator('button[type="submit"]:visible, input[type="submit"]:visible, button:visible:has-text("Log in"), button:visible:has-text("Login"), button:visible:has-text("Sign in")')
        .first();
      if (await submit.count()) await submit.click();
      else await pwd.press("Enter");
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(1500);
    }

    let loggedIn = !(await page.locator('input[type="password"]:visible').count());

    if (!loggedIn && aiEnabled()) {
      await ctx.log("Standard login form not detected — AI agent is logging in", "warn");
      const r = await runAgent(ctx, page, {
        moduleId: null,
        mode: "task",
        maxSteps: 10,
        goal: `Log in to the app using username {{USERNAME}} and password {{PASSWORD}}. ${creds.notes ? `Notes: ${creds.notes}` : ""} Call finish with success=true once you are inside the app.`,
      });
      loggedIn = r.success;
    }

    if (!loggedIn) {
      await ctx.addBug(null, {
        suite: "ui",
        category: "auth",
        severity: "critical",
        title: "Login failed with the configured test credentials",
        description: "QA could not sign in. Either the credentials are wrong, there is a CAPTCHA/2FA, or login is broken.",
        url: page.url(),
        screenshot: await ctx.screenshot(page, "login-failed"),
        expected: "User is signed in",
        actual: "Still on the login screen",
      });
      return;
    }
    ctx.storageState = await context.storageState();
    await ctx.log("Logged in ✔", "success");
  } finally {
    await context.close();
  }
}

/** Finds same-origin pages when a module/project has no paths configured. */
export async function discoverPaths(ctx: RunContext, limit = 12): Promise<string[]> {
  const context = await newContext(ctx);
  const page = await context.newPage();
  const origin = new URL(ctx.project.baseUrl).origin;
  try {
    await page.goto(ctx.project.baseUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    const hrefs = await page.$$eval("a[href]", (as) => as.map((a) => (a as HTMLAnchorElement).href));
    const paths = new Set<string>([new URL(page.url()).pathname]);
    for (const h of hrefs) {
      try {
        const u = new URL(h);
        if (u.origin !== origin || /logout|signout|sign-out|\.(pdf|zip|png|jpg)$/i.test(u.pathname)) continue;
        paths.add(u.pathname);
      } catch {
        /* ignore */
      }
      if (paths.size >= limit) break;
    }
    return [...paths];
  } finally {
    await context.close();
  }
}

/** Runs the full UI suite for one module: automatic checks on every page + AI exploratory testing. */
export async function runUiSuite(ctx: RunContext, mod: Module): Promise<void> {
  // Auto-discovery is for "whole app" runs. A module without pages inside a project
  // whose other modules list theirs would only re-test those pages, so skip it.
  if (!mod.paths.length && mod.id) {
    const siblings = await col.modules.count({ projectId: mod.projectId, _id: { $ne: mod.id }, "paths.0": { $exists: true } });
    if (siblings) {
      await ctx.log(`No pages listed for "${mod.name}" — add pages to test its interface`, "warn");
      return;
    }
  }
  const paths = mod.paths.length ? mod.paths : await discoverPaths(ctx);
  const context = await newContext(ctx);
  const page: Page = await context.newPage();
  const monitor = new PageMonitor(page);
  try {
    for (const path of paths) {
      await ctx.checkCancelled();
      await checkPage(ctx, page, monitor, mod.id, path);
    }

    if (!aiEnabled()) {
      await ctx.log("ANTHROPIC_API_KEY not set — skipping AI exploratory testing", "warn");
      return;
    }

    const flows = mod.userFlows
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const startPath = paths[0] ?? "/";
    await page.goto(ctx.url(startPath), { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
    monitor.drain(); // already reported by checkPage

    const goal = flows.length
      ? `Test module "${mod.name}" (${mod.mvp}). Verify each of these user flows works end-to-end, including edge cases and validation:\n${flows.map((f, i) => `${i + 1}. ${f}`).join("\n")}`
      : `Explore and test module "${mod.name}" (${mod.mvp}) thoroughly. Pages in scope: ${paths.join(", ")}. ` +
        `Click every button, open every tab/modal, submit every form with valid and invalid data, and check all states.`;

    await ctx.log(`AI agent testing "${mod.name}"…`);
    const result = await runAgent(ctx, page, {
      moduleId: mod.id,
      goal,
      context: mod.description ? `Module description: ${mod.description}` : undefined,
      monitor,
    });
    await ctx.log(`AI agent finished "${mod.name}" in ${result.steps} steps: ${result.summary}`, result.success ? "success" : "warn");
  } finally {
    await context.close();
  }
}
