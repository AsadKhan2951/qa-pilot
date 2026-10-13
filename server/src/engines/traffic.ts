/**
 * API testing WITHOUT an OpenAPI spec.
 * While QA Pilot uses the app (page checks, AI tester, login), every XHR/fetch call
 * is recorded. Each distinct endpoint is then tested on its own:
 *   - replay with the same session  → 5xx, slow, stack-trace leaks
 *   - replay WITHOUT the session    → must be 401/403 if it returned user data
 *   - bad input (wrong id / types / injection, AI-generated when available) → must be 4xx, never 5xx
 *   - response shape stays stable between calls
 */
import type { BrowserContext, Request } from "playwright";
import type { Module } from "../db/schema.js";
import { aiEnabled, askJson, textBlock } from "../lib/claude.js";
import type { RunContext, Severity } from "./context.js";
import { renderEvidence } from "./evidence.js";

export type Recorded = {
  key: string; // METHOD + normalised path
  method: string;
  url: string;
  path: string; // normalised: /api/funnels/:id
  headers: Record<string, string>;
  body?: string;
  status: number;
  ms: number;
  responseText: string;
  contentType: string;
  pageUrl: string;
  moduleId: string | null;
  count: number;
};

const STATIC = /\.(js|mjs|css|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|map|mp4|webm)(\?|$)/i;
const NOISE = /google-analytics|googletagmanager|doubleclick|facebook|hotjar|clarity\.ms|sentry|segment|mixpanel|intercom|crisp|posthog|vercel-insights|_vercel\/insights|\/_next\/(static|image|data)|__nextjs|hot-update|webpack|sockjs|\/socket\.io\//i;
const SAFE = new Set(["GET", "HEAD"]);
const SECRET_HEADERS = /^(authorization|cookie|x-api-key|x-auth-token|x-access-token)$/i;

/** /api/funnels/65f1c2.../steps/12 → /api/funnels/:id/steps/:id */
export function normalisePath(p: string) {
  return p
    .split("/")
    .map((seg) => (/^\d+$|^[0-9a-f]{12,}$|^[0-9a-f-]{32,36}$|^[A-Za-z0-9_-]{20,}$/i.test(seg) ? ":id" : seg))
    .join("/");
}

/** Hosts we treat as "the product's backend": the app's own origin, the API base, and any host it calls with JSON. */
function isProductCall(ctx: RunContext, req: Request) {
  const type = req.resourceType();
  if (type !== "xhr" && type !== "fetch") return false;
  const u = req.url();
  if (STATIC.test(u) || NOISE.test(u)) return false;
  if (!/^https?:/i.test(u)) return false;
  return true;
}

/** Attach to a browser context so every API call the app makes is recorded on the run. */
export function recordTraffic(ctx: RunContext, context: BrowserContext) {
  context.on("requestfinished", async (req) => {
    try {
      if (!isProductCall(ctx, req)) return;
      const res = await req.response();
      if (!res) return;
      const url = new URL(req.url());
      const path = normalisePath(url.pathname);
      const key = `${req.method()} ${url.host}${path}`;
      const existing = ctx.traffic.get(key);
      if (existing) {
        existing.count++;
        return;
      }
      const contentType = res.headers()["content-type"] ?? "";
      let responseText = "";
      if (/json|text/i.test(contentType)) responseText = (await res.text().catch(() => "")).slice(0, 6000);
      const timing = req.timing();
      ctx.traffic.set(key, {
        key,
        method: req.method(),
        url: req.url(),
        path,
        headers: await req.allHeaders().catch(() => req.headers()),
        body: req.postData() ?? undefined,
        status: res.status(),
        ms: timing.responseEnd > 0 ? Math.round(timing.responseEnd) : 0,
        responseText,
        contentType,
        pageUrl: req.frame()?.url?.() ?? "",
        moduleId: ctx.currentModuleId,
        count: 1,
      });
    } catch {
      /* page closed mid-request */
    }
  });
}

type Result = { status: number; ms: number; text: string; json: unknown; error?: string };

async function replay(rec: Recorded, opts: { withAuth: boolean; url?: string; body?: string; method?: string }): Promise<Result> {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec.headers)) {
    if (/^(host|content-length|connection|accept-encoding|:)/i.test(k)) continue;
    if (!opts.withAuth && SECRET_HEADERS.test(k)) continue;
    headers[k] = v;
  }
  const started = Date.now();
  try {
    const r = await fetch(opts.url ?? rec.url, {
      method: opts.method ?? rec.method,
      headers,
      body: SAFE.has(opts.method ?? rec.method) ? undefined : (opts.body ?? rec.body),
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
    });
    const text = await r.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      /* not json */
    }
    return { status: r.status, ms: Date.now() - started, text, json };
  } catch (e) {
    return { status: 0, ms: Date.now() - started, text: "", json: undefined, error: (e as Error).message };
  }
}

function hasUserData(json: unknown): boolean {
  if (json == null) return false;
  if (Array.isArray(json)) return json.length > 0;
  if (typeof json === "object") {
    const o = json as Record<string, unknown>;
    const data = o.data ?? o.items ?? o.results ?? o.user ?? o;
    return Array.isArray(data) ? data.length > 0 : typeof data === "object" && Object.keys(data as object).length > 1;
  }
  return false;
}

function shape(v: unknown, depth = 0): string {
  if (depth > 2) return "…";
  if (Array.isArray(v)) return `[${v.length ? shape(v[0], depth + 1) : ""}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).sort().map((k) => `${k}:${shape((v as Record<string, unknown>)[k], depth + 1)}`).join(",")}}`;
  return v === null ? "null" : typeof v;
}

const LEAK = /\bat\s+\S+\s+\(?\S+\.(js|ts):\d+|Traceback \(most recent call last\)|SQLSTATE|ORA-\d{5}|MongoServerError|PrismaClient|"stack"\s*:/i;

function redact(h: Record<string, string>) {
  return Object.entries(h)
    .filter(([k]) => !/^(sec-|user-agent|accept|referer|origin|priority)/i.test(k))
    .map(([k, v]) => `${k}: ${SECRET_HEADERS.test(k) ? "••••••" : v}`)
    .join("\n");
}

function reqText(rec: Recorded, url: string, withAuth: boolean, body?: string, method?: string) {
  const h = withAuth ? redact(rec.headers) : "(session and auth headers removed)";
  const b = body ?? rec.body;
  return `${method ?? rec.method} ${url}\n${h}${b && !SAFE.has(method ?? rec.method) ? `\n\n${b.slice(0, 1500)}` : ""}`;
}

function resText(r: Result) {
  if (r.error) return `NETWORK ERROR: ${r.error} (${r.ms}ms)`;
  const body = r.json !== undefined ? JSON.stringify(r.json, null, 2) : r.text;
  return `HTTP ${r.status} · ${r.ms}ms\n\n${body.slice(0, 3000)}`;
}

function curl(rec: Recorded, url: string, withAuth: boolean, body?: string, method?: string) {
  const m = method ?? rec.method;
  const b = body ?? rec.body;
  return `curl -X ${m} '${url}'${withAuth ? " -H '<your session cookie / auth header>'" : ""}${b && !SAFE.has(m) ? ` -H 'Content-Type: application/json' -d '${b.slice(0, 800).replace(/'/g, "'\\''")}'` : ""}`;
}

type BadCase = { name: string; url?: string; body?: string; why: string };

/** Simple, deterministic bad-input cases; Claude adds smarter ones when available. */
function basicBadCases(rec: Recorded): BadCase[] {
  const out: BadCase[] = [];
  const u = new URL(rec.url);
  const segs = u.pathname.split("/");
  const idIdx = segs.findIndex((s) => normalisePath("/" + s) === "/:id");
  if (idIdx > 0) {
    const s1 = [...segs];
    s1[idIdx] = "not-a-real-id";
    out.push({ name: "invalid id", url: `${u.origin}${s1.join("/")}${u.search}`, why: "An unknown or malformed id must return 400/404, not crash" });
    const s2 = [...segs];
    s2[idIdx] = "000000000000000000000000";
    out.push({ name: "missing record", url: `${u.origin}${s2.join("/")}${u.search}`, why: "A record that doesn't exist must return 404" });
  }
  if (rec.body && !SAFE.has(rec.method)) {
    out.push({ name: "empty body", body: "{}", why: "Missing required fields must return 400 with a message" });
    out.push({ name: "malformed JSON", body: '{"broken": ', why: "Malformed JSON must return 400" });
  }
  return out;
}

async function aiBadCases(ctx: RunContext, rec: Recorded): Promise<BadCase[]> {
  if (!aiEnabled() || SAFE.has(rec.method) || !rec.body) return [];
  try {
    const out = await askJson<{ cases: BadCase[] }>({
      system:
        "You are an API QA engineer. Given a real request the app made, write bad-input variants of its JSON body that a correct backend must reject with 4xx (never 5xx): " +
        "wrong types, missing required fields, negative/huge numbers, very long strings, Roman Urdu/unicode, NoSQL/SQL injection, someone else's id. Keep the same endpoint.",
      content: [textBlock(`Request: ${rec.method} ${rec.path}\nBody:\n${rec.body.slice(0, 3000)}\nResponse (${rec.status}):\n${rec.responseText.slice(0, 1500)}\n\nReturn up to 4 cases.`)],
      schema: {
        type: "object",
        properties: {
          cases: {
            type: "array",
            items: { type: "object", properties: { name: { type: "string" }, body: { type: "string", description: "Full JSON body to send" }, why: { type: "string" } }, required: ["name", "body", "why"] },
          },
        },
        required: ["cases"],
      },
    });
    return out.cases.slice(0, 4);
  } catch {
    return [];
  }
}

/** Visits the module's pages (or discovered pages) only to record API traffic, when no UI suite ran. */
export async function collectTraffic(ctx: RunContext, mod: Module | null, paths: string[]) {
  const { newContext } = await import("./ui.js");
  const context = await newContext(ctx);
  const page = await context.newPage();
  try {
    for (const p of paths.slice(0, 15)) {
      await ctx.checkCancelled();
      await page.goto(ctx.url(p), { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
      await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
      await page.waitForTimeout(800);
    }
  } finally {
    await context.close();
  }
  void mod;
}

/** Tests every endpoint recorded for this module (or all, when mod = null). */
export async function runTrafficApiSuite(ctx: RunContext, mod: Module | null) {
  const moduleId = mod?.id || null;
  const all = [...ctx.traffic.values()];
  const recs = all.filter((r) => !ctx.trafficTested.has(r.key) && (moduleId ? r.moduleId === moduleId : true));
  if (!recs.length) {
    await ctx.log(`No API calls seen while using "${mod?.name ?? "the app"}" — nothing to test on the backend`, "warn");
    return;
  }
  const full = ctx.project.apiTestMode === "full";
  await ctx.log(
    `API tests from real app traffic: ${recs.length} endpoint(s)` + (full ? "" : " (write endpoints are checked from recorded results only — switch API mode to Full on staging to replay them)"),
  );
  const LATENCY = Number(process.env.API_LATENCY_MS ?? 2000);

  for (const rec of recs.slice(0, 60)) {
    await ctx.checkCancelled();
    ctx.trafficTested.add(rec.key);
    const name = `${rec.method} ${rec.path}`;
    // Never replay calls that end the session or destroy data
    const risky = /logout|log-out|signout|sign-out|revoke|delete|remove|destroy|payment|checkout|charge/i.test(rec.path) || rec.method === "DELETE";
    const canReplay = !risky && (SAFE.has(rec.method) || full);
    type Problem = { title: string; severity: Severity; category: string; expected: string; result: Result; url: string; withAuth: boolean; body?: string; method?: string; why?: string };
    const problems: Problem[] = [];
    const recorded: Result = { status: rec.status, ms: rec.ms, text: rec.responseText, json: (() => { try { return JSON.parse(rec.responseText); } catch { return undefined; } })() };

    // 1) What actually happened in the app
    if (rec.status >= 500) problems.push({ title: `${name} returned ${rec.status} while using the app`, severity: "critical", category: "api-error", expected: "2xx", result: recorded, url: rec.url, withAuth: true });
    if (LEAK.test(rec.responseText)) problems.push({ title: `${name} leaks a stack trace / internals`, severity: "high", category: "security", expected: "Generic error message", result: recorded, url: rec.url, withAuth: true });

    // 2) Replay with session
    let base: Result = recorded;
    if (canReplay) {
      base = await replay(rec, { withAuth: true });
      ctx.stats.apiCalls = (ctx.stats.apiCalls ?? 0) + 1;
      ctx.stats.checks = (ctx.stats.checks ?? 0) + 1;
      if (base.error) problems.push({ title: `${name} — request failed: ${base.error}`, severity: "high", category: "api-error", expected: "A response", result: base, url: rec.url, withAuth: true });
      else if (base.status >= 500 && rec.status < 500) problems.push({ title: `${name} returns ${base.status} on a repeat call`, severity: "high", category: "api-error", expected: `HTTP ${rec.status} like the first call`, result: base, url: rec.url, withAuth: true });
      if (base.ms > LATENCY) problems.push({ title: `${name} is slow (${base.ms}ms)`, severity: base.ms > LATENCY * 3 ? "medium" : "low", category: "performance", expected: `< ${LATENCY}ms`, result: base, url: rec.url, withAuth: true });
      if (recorded.json !== undefined && base.json !== undefined && rec.status < 300 && base.status < 300 && shape(recorded.json) !== shape(base.json) && SAFE.has(rec.method)) {
        problems.push({ title: `${name} returns a different response shape on a repeat call`, severity: "low", category: "api-contract", expected: shape(recorded.json).slice(0, 400), result: base, url: rec.url, withAuth: true });
      }
    }

    // 3) Without session: protected data must not be public
    const hadAuth = Object.keys(rec.headers).some((k) => SECRET_HEADERS.test(k));
    if (!risky && hadAuth && SAFE.has(rec.method) && rec.status < 300 && hasUserData(recorded.json)) {
      const anon = await replay(rec, { withAuth: false });
      ctx.stats.apiCalls = (ctx.stats.apiCalls ?? 0) + 1;
      if (!anon.error && anon.status < 300 && hasUserData(anon.json)) {
        problems.push({ title: `${name} returns data WITHOUT login`, severity: "critical", category: "security", expected: "HTTP 401/403 when the session is missing", result: anon, url: rec.url, withAuth: false });
      }
    }

    // 4) Bad input
    if (canReplay) {
      const cases = [...basicBadCases(rec), ...(await aiBadCases(ctx, rec))];
      for (const c of cases) {
        const r = await replay(rec, { withAuth: true, url: c.url, body: c.body });
        ctx.stats.apiCalls = (ctx.stats.apiCalls ?? 0) + 1;
        if (r.status >= 500) problems.push({ title: `${name} crashes on ${c.name} (${r.status})`, severity: "high", category: "api-validation", expected: `4xx — ${c.why}`, result: r, url: c.url ?? rec.url, withAuth: true, body: c.body, why: c.why });
        else if (r.status >= 200 && r.status < 300 && c.body !== undefined && (c.name === "malformed JSON" || c.name === "empty body"))
          problems.push({ title: `${name} accepts ${c.name}`, severity: "medium", category: "api-validation", expected: `4xx — ${c.why}`, result: r, url: c.url ?? rec.url, withAuth: true, body: c.body, why: c.why });
        if (LEAK.test(r.text)) problems.push({ title: `${name} leaks internals on ${c.name}`, severity: "high", category: "security", expected: "Generic error message", result: r, url: c.url ?? rec.url, withAuth: true, body: c.body });
      }
    }

    for (const p of problems) {
      const evidence = await renderEvidence(ctx, p.title, [
        { label: p.withAuth ? "Request (same session as the app)" : "Request (no login)", body: reqText(rec, p.url, p.withAuth, p.body, p.method) },
        { label: "Expected", body: p.expected, tone: "good" },
        { label: "Actual response", body: resText(p.result), tone: "bad" },
      ]);
      await ctx.addBug(rec.moduleId ?? moduleId, {
        suite: "api",
        category: p.category,
        severity: p.severity,
        title: p.title,
        description: `Found from real app traffic on ${rec.pageUrl || "the app"}.${p.why ? `\n${p.why}` : ""}`,
        steps: curl(rec, p.url, p.withAuth, p.body, p.method),
        expected: p.expected,
        actual: resText(p.result),
        url: p.url,
        screenshot: evidence,
        meta: { method: rec.method, path: rec.path, source: "traffic", status: p.result.status },
        fingerprint: `traffic|${p.category}|${rec.method}|${rec.path}|${p.title.replace(/\d+ms/, "")}`,
      });
    }
  }
}
