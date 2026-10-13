/**
 * Deterministic page checks that run on every page without needing AI:
 * load status, console/JS errors, failed requests, broken images & links,
 * leaked "undefined/NaN" text, accessibility (axe), mobile overflow, speed.
 */
import type { Page } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";
import type { BugInput, RunContext, Severity } from "./context.js";
import type { PageMonitor, Signal } from "./monitor.js";

export function signalToBug(s: Signal): BugInput {
  switch (s.kind) {
    case "pageerror":
      return {
        suite: "ui",
        category: "console",
        severity: "high",
        title: `Uncaught JS error: ${s.text.slice(0, 120)}`,
        description: "The page threw an unhandled JavaScript exception.",
        actual: s.text,
        expected: "No uncaught exceptions",
        url: s.url,
        fingerprint: `pageerror|${s.text.slice(0, 200)}`,
      };
    case "console":
      return {
        suite: "ui",
        category: "console",
        severity: "medium",
        title: `Console error: ${s.text.slice(0, 120)}`,
        actual: s.text,
        expected: "No console errors",
        url: s.url,
        fingerprint: `console|${s.text.slice(0, 200)}`,
      };
    case "http": {
      const api = ["xhr", "fetch"].includes(s.resourceType);
      const sev: Severity = s.status >= 500 ? (api ? "critical" : "high") : api && s.status !== 404 ? "high" : "medium";
      const path = safePath(s.resourceUrl);
      return {
        suite: "ui",
        category: "network",
        severity: sev,
        title: `${s.method} ${path} returned ${s.status}`,
        description: `The page requested this ${s.resourceType === "xhr" || s.resourceType === "fetch" ? "API endpoint" : s.resourceType} and it failed.`,
        actual: `HTTP ${s.status}${s.body ? `\n\nResponse body:\n${s.body}` : ""}`,
        expected: "2xx/3xx response",
        url: s.url,
        meta: { resourceUrl: s.resourceUrl, status: s.status, resourceType: s.resourceType },
        fingerprint: `http|${s.method}|${path}|${s.status}`,
      };
    }
    case "requestfailed":
      return {
        suite: "ui",
        category: "network",
        severity: ["xhr", "fetch", "document"].includes(s.resourceType) ? "high" : "medium",
        title: `Request failed (${s.error}): ${safePath(s.resourceUrl)}`,
        actual: s.error,
        url: s.url,
        meta: { resourceUrl: s.resourceUrl },
        fingerprint: `reqfail|${safePath(s.resourceUrl)}|${s.error}`,
      };
  }
}

function safePath(u: string) {
  try {
    const x = new URL(u);
    return x.host + x.pathname;
  } catch {
    return u;
  }
}

/** Visit one page and run all automatic checks. */
export async function checkPage(ctx: RunContext, page: Page, monitor: PageMonitor, moduleId: string | null, path: string) {
  const url = ctx.url(path);
  await ctx.log(`Checking page ${path}`);
  ctx.stats.pagesTested = (ctx.stats.pagesTested ?? 0) + 1;
  const started = Date.now();
  let status = 0;
  try {
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    status = res?.status() ?? 0;
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  } catch (e) {
    await ctx.addBug(moduleId, {
      suite: "ui",
      category: "availability",
      severity: "critical",
      title: `Page did not load: ${path}`,
      actual: (e as Error).message.split("\n")[0],
      expected: "Page loads within 45s",
      url,
      screenshot: await ctx.screenshot(page, "load-fail"),
    });
    return;
  }
  const loadMs = Date.now() - started;
  ctx.stats.checks = (ctx.stats.checks ?? 0) + 1;

  // Redirected to login? Session may have expired or route is protected.
  if (ctx.project.loginUrl && page.url().startsWith(ctx.project.loginUrl) && !url.startsWith(ctx.project.loginUrl)) {
    await ctx.log(`${path} redirected to the login page — check credentials`, "warn");
  }

  if (status >= 400) {
    await ctx.addBug(moduleId, {
      suite: "ui",
      category: "availability",
      severity: status >= 500 ? "critical" : "high",
      title: `${path} returns HTTP ${status}`,
      expected: "HTTP 200",
      actual: `HTTP ${status}`,
      url,
      screenshot: await ctx.screenshot(page, `http-${status}`),
    });
  }

  // Console / network signals during load — one screenshot shared by all of them
  // The main document status is already reported above
  const signals = monitor.drain().filter((s) => !(s.kind === "http" && s.resourceType === "document" && status >= 400));
  if (signals.length) {
    const shot = await ctx.screenshot(page, "errors");
    for (const s of signals) await ctx.addBug(moduleId, { ...signalToBug(s), screenshot: shot, steps: `1. Open ${url}` });
  }

  // Leaked template / data bugs in visible text
  const leaks = await page
    .evaluate(() => {
      const found: { text: string; selector: string }[] = [];
      const re = /\b(undefined|NaN|null)\b|\[object Object\]|\{\{\s*[\w.]+\s*\}\}|Invalid Date/;
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n: Node | null;
      while ((n = walker.nextNode()) && found.length < 5) {
        const txt = (n.textContent || "").trim();
        if (!txt || !re.test(txt)) continue;
        const el = n.parentElement;
        if (!el || ["SCRIPT", "STYLE", "CODE", "PRE", "NOSCRIPT"].includes(el.tagName)) continue;
        if (!el.offsetParent && getComputedStyle(el).position !== "fixed") continue;
        el.setAttribute("data-qa-leak", String(found.length));
        found.push({ text: txt.slice(0, 160), selector: `[data-qa-leak="${found.length}"]` });
      }
      return found;
    })
    .catch(() => []);
  for (const l of leaks) {
    await ctx.addBug(moduleId, {
      suite: "ui",
      category: "content",
      severity: "high",
      title: `Broken value shown to user: "${l.text.slice(0, 60)}"`,
      description: "Raw undefined/NaN/null/[object Object]/template placeholder is visible on the page — usually missing data or a rendering bug.",
      actual: l.text,
      expected: "Real value or a proper empty state",
      url,
      steps: `1. Open ${url}`,
      screenshot: await ctx.screenshot(page, "leak", { highlight: l.selector }),
    });
  }

  // Broken images
  const broken = await page
    .evaluate(() =>
      Array.from(document.images)
        .filter((i) => i.complete && i.naturalWidth === 0 && i.getBoundingClientRect().width > 0)
        .map((i) => i.currentSrc || i.src)
        .slice(0, 10),
    )
    .catch(() => [] as string[]);
  if (broken.length) {
    await ctx.addBug(moduleId, {
      suite: "ui",
      category: "content",
      severity: "medium",
      title: `${broken.length === 1 ? "Broken image" : `${broken.length} broken images`} on ${path}`,
      actual: broken.join("\n"),
      expected: "All images load",
      url,
      screenshot: await ctx.screenshot(page, "broken-images"),
    });
  }

  // Broken internal links (GET, same origin, max 25)
  const origin = new URL(ctx.project.baseUrl).origin;
  const links = await page
    .evaluate(
      (o) =>
        Array.from(new Set(Array.from(document.querySelectorAll("a[href]")).map((a) => (a as HTMLAnchorElement).href)))
          .filter((h) => h.startsWith(o) && !/logout|signout|sign-out|delete|remove/i.test(h))
          .map((h) => h.split("#")[0])
          .slice(0, 25),
      origin,
    )
    .catch(() => [] as string[]);
  const deadLinks: string[] = [];
  await Promise.all(
    links.map(async (h) => {
      const r = await page.request.get(h, { timeout: 15000, maxRedirects: 5 }).catch(() => null);
      if (r && r.status() >= 400) deadLinks.push(`${r.status()} ${h}`);
    }),
  );
  if (deadLinks.length) {
    await ctx.addBug(moduleId, {
      suite: "ui",
      category: "navigation",
      severity: "medium",
      title: `${deadLinks.length === 1 ? "Broken link" : `${deadLinks.length} broken links`} on ${path}`,
      actual: deadLinks.join("\n"),
      expected: "All internal links resolve",
      url,
      steps: `1. Open ${url}\n2. Click the link(s) listed above`,
      screenshot: await ctx.screenshot(page, "broken-links", { highlight: `a[href="${new URL(deadLinks[0].split(" ")[1]).pathname}"]` }),
      fingerprint: `deadlinks|${deadLinks.sort().join(",")}`,
    });
  }

  // Accessibility (serious & critical only, to keep noise down)
  try {
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    for (const v of axe.violations.filter((v) => v.impact === "critical" || v.impact === "serious").slice(0, 8)) {
      const target = v.nodes[0]?.target?.[0];
      await ctx.addBug(moduleId, {
        suite: "ui",
        category: "accessibility",
        severity: v.impact === "critical" ? "medium" : "low",
        title: `A11y: ${v.help}`,
        description: `${v.description}\nAffected elements: ${v.nodes.length}\nMore: ${v.helpUrl}`,
        actual: v.nodes
          .slice(0, 5)
          .map((n) => `${n.target.join(" ")} — ${n.failureSummary ?? ""}`)
          .join("\n"),
        url,
        screenshot: await ctx.screenshot(page, "a11y", { highlight: typeof target === "string" ? target : undefined }),
        fingerprint: `a11y|${v.id}`,
        steps: `1. Open ${url}`,
      });
    }
  } catch (e) {
    await ctx.log(`Accessibility scan skipped on ${path}: ${(e as Error).message.split("\n")[0]}`, "warn");
  }

  // Performance
  const timing = await page
    .evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      return nav ? { dcl: Math.round(nav.domContentLoadedEventEnd), load: Math.round(nav.loadEventEnd), ttfb: Math.round(nav.responseStart) } : null;
    })
    .catch(() => null);
  const slowMs = Math.max(timing?.load ?? 0, loadMs);
  if (slowMs > 4000) {
    await ctx.addBug(moduleId, {
      suite: "ui",
      category: "performance",
      severity: slowMs > 8000 ? "high" : "medium",
      title: `Slow page load on ${path} (${(slowMs / 1000).toFixed(1)}s)`,
      actual: JSON.stringify(timing ?? { loadMs }),
      expected: "Under 4s",
      url,
    });
  }

  // Mobile responsiveness
  const desktop = page.viewportSize();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(800);
    const overflow = await page.evaluate(() => {
      const w = document.documentElement.clientWidth;
      if (document.documentElement.scrollWidth <= w + 2) return null;
      const culprits: string[] = [];
      document.querySelectorAll<HTMLElement>("body *").forEach((el) => {
        if (culprits.length >= 5) return;
        const r = el.getBoundingClientRect();
        if (r.right > w + 2 && r.width > 0 && getComputedStyle(el).position !== "fixed") {
          const id = el.id ? `#${el.id}` : "";
          const cls = el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
          culprits.push(`${el.tagName.toLowerCase()}${id}${cls} (right edge ${Math.round(r.right)}px)`);
        }
      });
      return { scrollWidth: document.documentElement.scrollWidth, width: w, culprits };
    });
    if (overflow) {
      await ctx.addBug(moduleId, {
        suite: "ui",
        category: "responsive",
        severity: "medium",
        title: `Horizontal scroll on mobile (390px) at ${path}`,
        description: `Content is ${overflow.scrollWidth}px wide on a ${overflow.width}px screen.`,
        actual: `Overflowing elements:\n${overflow.culprits.join("\n")}`,
        expected: "No horizontal scrolling on mobile",
        url,
        screenshot: await ctx.screenshot(page, "mobile-overflow"),
      });
    }
  } finally {
    if (desktop) await page.setViewportSize(desktop);
  }
}
