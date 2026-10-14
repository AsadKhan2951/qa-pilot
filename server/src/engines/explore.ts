import type { BrowserContext, Page } from "playwright";
import type { Module } from "../db/schema.js";
import { aiEnabled, askJson, textBlock } from "../lib/claude.js";
import { env } from "../lib/env.js";
import type { RunContext } from "./context.js";
import { newContext } from "./ui.js";
import { watchContext } from "./live.js";

/**
 * Auto-explore: from just the module's main page, QA Pilot maps every screen of
 * the module (links, tabs, rows that open detail pages), then Claude plans the
 * full set of user flows to test. Nobody has to list pages or flows by hand.
 */

export type MappedPage = {
  path: string; // pathname + search, relative to the origin it was found on
  url: string;
  title: string;
  headings: string[];
  actions: string[]; // button / tab / menu labels
  text: string; // short visible-text excerpt
};

export type PlannedFlow = { title: string; startPath: string; steps: string };

const MAX_PAGES = 14;
const MAX_CHILDREN_PER_PARENT = 6;

const COLLECT_JS = () => {
  const vis = (e: Element) => {
    const r = (e as HTMLElement).getBoundingClientRect();
    const s = getComputedStyle(e as HTMLElement);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
  };
  const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
  const root = document.querySelector("main") ?? document.body;
  const headings = [...root.querySelectorAll("h1,h2,h3")].filter(vis).map((h) => clean(h.textContent)).filter(Boolean).slice(0, 25);
  const actions = [
    ...new Set(
      [...document.querySelectorAll('button, [role=button], [role=tab], [role=menuitem], summary, input[type=submit]')]
        .filter(vis)
        .map((b) => clean(b.textContent || b.getAttribute("aria-label") || (b as HTMLInputElement).value))
        .filter((t) => t && t.length < 60),
    ),
  ].slice(0, 60);
  const links = [...document.querySelectorAll("a[href]")].map((a) => (a as HTMLAnchorElement).href);
  const text = clean((root as HTMLElement).innerText).slice(0, 1500);
  return { title: document.title, headings, actions, links, text };
};

function pathOf(u: URL) {
  return (u.pathname.replace(/\/+$/, "") || "/") + u.search;
}

function parentOf(p: string) {
  const path = p.split("?")[0];
  return path.slice(0, path.lastIndexOf("/")) || "/";
}

/** Opens the reference website (unlocking its passcode gate) in its own browser context. */
export async function openReference(ctx: RunContext, url: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await ctx.browser.newContext({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true });
  await context.addInitScript("globalThis.__name = globalThis.__name || ((f) => f);");
  watchContext(ctx, context, "reference");
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  const passcode = ctx.secrets.refPasscode;
  if (passcode) {
    const gate = page
      .locator('input[type="password"]:visible, input[name*="pass" i]:visible, input[name*="code" i]:visible, input[placeholder*="pass" i]:visible, input[placeholder*="code" i]:visible')
      .first();
    const fallback = page.locator("input:visible");
    const field = (await gate.count()) ? gate : (await fallback.count()) === 1 ? fallback.first() : null;
    if (field) {
      await field.fill(passcode);
      const submit = page.locator('button[type="submit"]:visible, input[type="submit"]:visible, button:visible').first();
      if (await submit.count()) await submit.click().catch(() => field.press("Enter"));
      else await field.press("Enter");
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(1200);
      if (new URL(page.url()).pathname !== new URL(url).pathname) {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
        await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
      }
    }
  }
  return { context, page };
}

/**
 * Breadth-first map of a module, starting at its main page and staying under
 * that page's path. Also clicks the first table row / card to discover detail
 * screens that are opened by JavaScript rather than real links.
 */
export async function mapModule(ctx: RunContext, page: Page, startUrl: string, who: "app" | "reference"): Promise<MappedPage[]> {
  const start = new URL(startUrl);
  const origin = start.origin;
  const scope = start.pathname.replace(/\/+$/, "") || "/";
  const keepSearch = start.search; // e.g. "?loading" on prototypes — carried to every page
  const inScope = (u: URL) => u.origin === origin && (u.pathname === scope || u.pathname.startsWith(scope === "/" ? "/" : scope + "/"));
  const norm = (u: URL) => {
    const v = new URL(u.pathname + keepSearch, origin);
    return v;
  };

  const queue: URL[] = [norm(start)];
  const seen = new Set<string>([pathOf(norm(start))]);
  const perParent = new Map<string, number>();
  const pages: MappedPage[] = [];

  const enqueue = (u: URL) => {
    if (!inScope(u) || /logout|signout|sign-out|\.(pdf|zip|png|jpe?g|svg)$/i.test(u.pathname)) return;
    const n = norm(u);
    const key = pathOf(n);
    if (seen.has(key) || seen.size >= MAX_PAGES * 2) return;
    const parent = parentOf(key);
    const c = perParent.get(parent) ?? 0;
    if (c >= MAX_CHILDREN_PER_PARENT) return;
    perParent.set(parent, c + 1);
    seen.add(key);
    queue.push(n);
  };

  while (queue.length && pages.length < MAX_PAGES) {
    await ctx.checkCancelled();
    const u = queue.shift()!;
    if (who === "app") ctx.liveCaption.app = `Mapping ${u.pathname}`;
    else ctx.liveCaption.reference = `Mapping reference ${u.pathname}`;
    try {
      await page.goto(u.toString(), { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(800);
      const landed = new URL(page.url());
      if (!inScope(landed) && landed.origin === origin && pages.length) continue; // redirected away
      const info = await page.evaluate(COLLECT_JS);
      pages.push({ path: pathOf(norm(landed)), url: landed.toString(), title: info.title, headings: info.headings, actions: info.actions, text: info.text });
      for (const href of info.links) {
        try {
          enqueue(new URL(href));
        } catch {
          /* ignore */
        }
      }

      // Detail screens opened by clicking a row/card (no <a href>)
      const row = page.locator("main tbody tr:visible, main [role=row]:visible:not(:has([role=columnheader]))").first();
      if (await row.count()) {
        const before = page.url();
        await row.click({ timeout: 3000, position: { x: 40, y: 10 } }).catch(() => {});
        await page.waitForTimeout(1500);
        if (page.url() !== before) {
          try {
            enqueue(new URL(page.url()));
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      /* page failed to load — the UI checks report that separately */
    }
  }
  return pages;
}

function describe(pages: MappedPage[]) {
  return pages
    .map(
      (p, i) =>
        `#${i + 1} ${p.path}\nTitle: ${p.title}\nHeadings: ${p.headings.join(" | ")}\nButtons/tabs: ${p.actions.join(" | ")}\nText: ${p.text.slice(0, 700)}`,
    )
    .join("\n\n");
}

/** Claude turns the module map into a complete list of end-to-end test flows. */
export async function planFlows(ctx: RunContext, mod: Module, pages: MappedPage[]): Promise<PlannedFlow[]> {
  if (!aiEnabled() || !pages.length) return [];
  const res = await askJson<{ flows: PlannedFlow[] }>({
    model: env.claudeModelStrong,
    maxTokens: 6000,
    system:
      "You are a senior QA lead. From a map of a web-app module, write the complete set of end-to-end test flows a manual tester would run " +
      "so that EVERY feature is covered: list/search/filter/sort/pagination, every create wizard and each of its options/branches, every builder/editor action " +
      "(add, edit, reorder, connect, delete steps or items), every tab, every settings field, every toggle, empty/validation/error states, and AI features. " +
      "Each flow must be self-contained and start from one of the mapped pages. Write concrete steps. " +
      "Safety: never confirm deletes, never publish to real users, never take real payments or send real emails — stop at the confirmation dialog and verify it.",
    content: [
      textBlock(
        `Module: ${mod.name}${mod.mvp ? ` (${mod.mvp})` : ""}\n${mod.description ? `Description: ${mod.description}\n` : ""}` +
          (mod.userFlows.trim() ? `Flows the team asked for (include these too):\n${mod.userFlows}\n` : "") +
          `\nMapped screens:\n${describe(pages)}\n\nReturn 6–14 flows ordered from most to least important.`,
      ),
    ],
    schema: {
      type: "object",
      properties: {
        flows: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              startPath: { type: "string", description: "One of the mapped page paths, exactly as given" },
              steps: { type: "string", description: "Concrete steps and what to verify" },
            },
            required: ["title", "startPath", "steps"],
          },
        },
      },
      required: ["flows"],
    },
  });
  const known = new Set(pages.map((p) => p.path));
  return (res.flows ?? []).slice(0, 14).map((f) => ({ ...f, startPath: known.has(f.startPath) ? f.startPath : pages[0].path }));
}

/** Pairs app screens with reference-site screens (paths and slugs often differ). */
export async function pairWithReference(appPages: MappedPage[], refPages: MappedPage[]): Promise<{ appPath: string; refUrl: string; label: string }[]> {
  if (!aiEnabled() || !appPages.length || !refPages.length) return [];
  const res = await askJson<{ pairs: { app: number; ref: number; label: string }[] }>({
    system:
      "Match each screen of the app under test to the screen of the approved reference design that shows the same view " +
      "(same purpose, same headings/tabs — ids, slugs and data may differ). Skip screens with no clear match.",
    content: [textBlock(`APP SCREENS:\n${describe(appPages)}\n\nREFERENCE SCREENS:\n${describe(refPages)}`)],
    schema: {
      type: "object",
      properties: {
        pairs: {
          type: "array",
          items: {
            type: "object",
            properties: { app: { type: "integer" }, ref: { type: "integer" }, label: { type: "string" } },
            required: ["app", "ref", "label"],
          },
        },
      },
      required: ["pairs"],
    },
  });
  const out: { appPath: string; refUrl: string; label: string }[] = [];
  const used = new Set<number>();
  for (const p of res.pairs ?? []) {
    const a = appPages[p.app - 1];
    const r = refPages[p.ref - 1];
    if (!a || !r || used.has(p.app)) continue;
    used.add(p.app);
    out.push({ appPath: a.path, refUrl: r.url, label: p.label || a.title });
  }
  return out;
}

/** Maps the module once per run (shared by the UI and design-match suites). */
export async function getModuleMap(ctx: RunContext, mod: Module, startPath: string): Promise<MappedPage[]> {
  const key = mod.id || "_whole";
  const cached = ctx.moduleMaps.get(key);
  if (cached) return cached;
  await ctx.log(`Exploring "${mod.name}" from ${startPath} to find all its screens…`);
  const context = await newContext(ctx);
  const page = await context.newPage();
  try {
    const pages = await mapModule(ctx, page, ctx.url(startPath), "app");
    ctx.moduleMaps.set(key, pages);
    await ctx.log(`Found ${pages.length} screen(s): ${pages.map((p) => p.path.split("?")[0]).join(", ")}`, "success");
    return pages;
  } finally {
    await context.close();
  }
}
