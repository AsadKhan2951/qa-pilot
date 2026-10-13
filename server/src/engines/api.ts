/**
 * Backend/API QA from an OpenAPI (Swagger) spec:
 * - baseline call per endpoint, response-schema (contract) validation
 * - auth enforcement (request without credentials must be rejected)
 * - AI-generated negative & edge cases (invalid types, missing fields, injection strings…)
 * - 5xx detection, stack-trace leaks, latency
 * Each bug gets an evidence image with the exact request & response.
 */
import $RefParser from "@apidevtools/json-schema-ref-parser";
import YAML from "yaml";
import { Ajv, type ValidateFunction } from "ajv";
import addFormatsImport from "ajv-formats";
import type { Module } from "../db/schema.js";
import { aiEnabled, askJson, textBlock } from "../lib/claude.js";
import type { RunContext, Severity } from "./context.js";
import { renderEvidence } from "./evidence.js";

const addFormats = addFormatsImport as unknown as (a: Ajv) => Ajv;
const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: true });
addFormats(ajv);

type Op = {
  method: string;
  path: string;
  operationId?: string;
  summary?: string;
  tags: string[];
  parameters: any[];
  requestBody?: any;
  responses: Record<string, any>;
  secured: boolean;
};

type Case = {
  name: string;
  path: string; // concrete path, params filled
  query?: Record<string, string>;
  body?: unknown;
  useAuth: boolean;
  expectStatus: number[];
  why?: string;
};

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);
const LATENCY_MS = Number(process.env.API_LATENCY_MS ?? 2000);
const specCache = new Map<string, { ops: Op[]; base: string }>();

export async function loadSpec(ctx: RunContext): Promise<{ ops: Op[]; base: string }> {
  const src = ctx.project.openApiUrl;
  if (specCache.has(src + ctx.run.id)) return specCache.get(src + ctx.run.id)!;
  const r = await fetch(src, { headers: authHeaders(ctx) });
  if (!r.ok) throw new Error(`Could not download OpenAPI spec (${r.status})`);
  const raw = await r.text();
  const parsed = raw.trim().startsWith("{") ? JSON.parse(raw) : YAML.parse(raw);
  const spec: any = await $RefParser.dereference(parsed, { dereference: { circular: "ignore" } });
  const globalSecured = Array.isArray(spec.security) && spec.security.length > 0;
  const ops: Op[] = [];
  for (const [path, item] of Object.entries<any>(spec.paths ?? {})) {
    for (const method of ["get", "post", "put", "patch", "delete", "head"]) {
      const op = item?.[method];
      if (!op) continue;
      ops.push({
        method: method.toUpperCase(),
        path,
        operationId: op.operationId,
        summary: op.summary ?? op.description,
        tags: op.tags ?? [],
        parameters: [...(item.parameters ?? []), ...(op.parameters ?? [])],
        requestBody: op.requestBody,
        responses: op.responses ?? {},
        secured: op.security ? op.security.length > 0 : globalSecured,
      });
    }
  }
  let base = ctx.project.apiBaseUrl;
  if (!base) {
    const server = spec.servers?.[0]?.url ?? (spec.host ? `${spec.schemes?.[0] ?? "https"}://${spec.host}${spec.basePath ?? ""}` : "");
    base = server ? new URL(server, src).toString() : ctx.project.baseUrl;
  }
  const out = { ops, base: base.replace(/\/$/, "") };
  specCache.set(src + ctx.run.id, out);
  return out;
}

function authHeaders(ctx: RunContext): Record<string, string> {
  const a = ctx.secrets.apiAuth;
  return a?.headerName && a.headerValue ? { [a.headerName]: a.headerValue } : {};
}

export function opInScope(op: Op, scopes: string[]) {
  return scopes.some((s) => {
    const x = s.trim().toLowerCase();
    if (!x) return false;
    return x.startsWith("/") ? op.path.toLowerCase().startsWith(x) : op.tags.some((t) => t.toLowerCase() === x);
  });
}

/** Make a plausible value from a JSON schema. */
function sample(schema: any, depth = 0): unknown {
  if (!schema || depth > 5) return null;
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (schema.enum?.length) return schema.enum[0];
  if (schema.allOf) return Object.assign({}, ...schema.allOf.map((s: any) => sample(s, depth + 1)));
  if (schema.oneOf || schema.anyOf) return sample((schema.oneOf ?? schema.anyOf)[0], depth + 1);
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  switch (type ?? (schema.properties ? "object" : "string")) {
    case "object": {
      const o: Record<string, unknown> = {};
      for (const [k, v] of Object.entries<any>(schema.properties ?? {})) o[k] = sample(v, depth + 1);
      return o;
    }
    case "array":
      return [sample(schema.items, depth + 1)];
    case "integer":
    case "number":
      return schema.minimum ?? 1;
    case "boolean":
      return true;
    default:
      if (schema.format === "email") return "qa+test@example.com";
      if (schema.format === "uuid") return "00000000-0000-4000-8000-000000000001";
      if (schema.format === "date-time") return new Date().toISOString();
      if (schema.format === "date") return new Date().toISOString().slice(0, 10);
      if (schema.format === "uri" || schema.format === "url") return "https://example.com";
      return "QA test";
  }
}

/** OpenAPI 3.0 → JSON Schema tweaks (nullable). */
function toJsonSchema(s: any): any {
  if (!s || typeof s !== "object") return s;
  if (Array.isArray(s)) return s.map(toJsonSchema);
  const out: any = {};
  for (const [k, v] of Object.entries(s)) out[k] = toJsonSchema(v);
  if (out.nullable === true && out.type && !Array.isArray(out.type)) out.type = [out.type, "null"];
  return out;
}

const validators = new WeakMap<object, ValidateFunction>();
function validatorFor(schema: any) {
  if (!validators.has(schema)) validators.set(schema, ajv.compile(toJsonSchema(schema)));
  return validators.get(schema)!;
}

function jsonSchemaFor(op: Op, status: number) {
  const r = op.responses[String(status)] ?? op.responses[`${String(status)[0]}XX`] ?? op.responses.default;
  return r?.content?.["application/json"]?.schema ?? r?.schema; // OAS3 / Swagger2
}

function documented2xx(op: Op): number[] {
  const codes = Object.keys(op.responses)
    .filter((c) => /^2\d\d$/.test(c))
    .map(Number);
  return codes.length ? codes : [200, 201, 204];
}

/** Fill path params from ids harvested from earlier list calls, else from schema samples. */
function fillPath(op: Op, idPool: Map<string, unknown[]>) {
  let path = op.path;
  for (const p of op.parameters.filter((p) => p.in === "path")) {
    const collection = op.path.split(`{${p.name}}`)[0].replace(/\/$/, "");
    const harvested = idPool.get(collection)?.[0];
    path = path.replace(`{${p.name}}`, encodeURIComponent(String(harvested ?? sample(p.schema ?? { type: p.type }) ?? "1")));
  }
  return path;
}

function harvestIds(path: string, body: unknown, idPool: Map<string, unknown[]>) {
  const list = Array.isArray(body) ? body : (body as any)?.data ?? (body as any)?.items ?? (body as any)?.results;
  if (!Array.isArray(list)) return;
  const ids = list.map((x: any) => x?.id ?? x?._id ?? x?.uuid).filter((x) => x !== undefined);
  if (ids.length) idPool.set(path.replace(/\/$/, ""), ids.slice(0, 5));
}

type Result = { status: number; ms: number; text: string; json: unknown; headers: Record<string, string>; error?: string };

async function send(ctx: RunContext, base: string, op: Op, c: Case): Promise<Result> {
  const url = new URL(base + c.path);
  for (const [k, v] of Object.entries(c.query ?? {})) url.searchParams.set(k, v);
  const headers: Record<string, string> = { Accept: "application/json", ...(c.useAuth ? authHeaders(ctx) : {}) };
  let body: string | undefined;
  if (c.body !== undefined && !SAFE.has(op.method)) {
    headers["Content-Type"] = "application/json";
    body = typeof c.body === "string" ? c.body : JSON.stringify(c.body);
  }
  const started = Date.now();
  ctx.stats.apiCalls = (ctx.stats.apiCalls ?? 0) + 1;
  try {
    const r = await fetch(url, { method: op.method, headers, body, signal: AbortSignal.timeout(30000), redirect: "manual" });
    const text = await r.text();
    let json: unknown = undefined;
    try {
      json = JSON.parse(text);
    } catch {
      /* not json */
    }
    return { status: r.status, ms: Date.now() - started, text, json, headers: Object.fromEntries(r.headers) };
  } catch (e) {
    return { status: 0, ms: Date.now() - started, text: "", json: undefined, headers: {}, error: (e as Error).message };
  }
}

function reqText(base: string, op: Op, c: Case, ctx: RunContext) {
  const auth = c.useAuth && ctx.secrets.apiAuth?.headerName ? `${ctx.secrets.apiAuth.headerName}: ••••••` : "(no auth header)";
  const q = c.query && Object.keys(c.query).length ? "?" + new URLSearchParams(c.query).toString() : "";
  return `${op.method} ${base}${c.path}${q}\n${auth}${c.body !== undefined ? `\n\n${JSON.stringify(c.body, null, 2)}` : ""}`;
}

function resText(r: Result) {
  if (r.error) return `NETWORK ERROR: ${r.error} (${r.ms}ms)`;
  const body = r.json !== undefined ? JSON.stringify(r.json, null, 2) : r.text;
  return `HTTP ${r.status} · ${r.ms}ms\n\n${body.slice(0, 3000)}`;
}

async function aiCases(ctx: RunContext, op: Op, baseline: Case): Promise<Case[]> {
  if (!aiEnabled()) return [];
  const opSpec = JSON.stringify(
    { method: op.method, path: op.path, summary: op.summary, parameters: op.parameters, requestBody: op.requestBody?.content?.["application/json"]?.schema, responses: Object.keys(op.responses) },
    null,
    0,
  ).slice(0, 8000);
  try {
    const out = await askJson<{ cases: Case[] }>({
      system:
        "You are an API QA engineer. Design negative and edge-case tests that should be REJECTED gracefully (4xx, never 5xx): " +
        "wrong types, missing required fields, out-of-range numbers, very long strings, unicode/Roman Urdu text, SQL/NoSQL injection strings, " +
        "invalid enum values, malformed ids. Use the concrete baseline path as a template. Keep auth on (useAuth=true).",
      content: [
        textBlock(
          `Operation:\n${opSpec}\n\nBaseline request that should succeed: ${JSON.stringify(baseline)}\n` +
            `${SAFE.has(op.method) ? "This is a read-only method: vary path params and query params only (no body)." : ""}\nReturn up to 5 cases.`,
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
                path: { type: "string" },
                query: { type: "object", additionalProperties: { type: "string" } },
                body: {},
                useAuth: { type: "boolean" },
                expectStatus: { type: "array", items: { type: "integer" } },
                why: { type: "string" },
              },
              required: ["name", "path", "useAuth", "expectStatus"],
            },
          },
        },
        required: ["cases"],
      },
    });
    return out.cases.slice(0, 5).filter((c) => c.path?.startsWith("/"));
  } catch (e) {
    await ctx.log(`AI case generation failed for ${op.method} ${op.path}: ${(e as Error).message}`, "warn");
    return [];
  }
}

/** Runs API tests for one module (by its scopes) or, with mod=null, for endpoints no module covers. */
export async function runApiSuite(ctx: RunContext, mod: Module | null, excludeScopes: string[] = []) {
  if (!ctx.project.openApiUrl) return ctx.log("No OpenAPI spec URL in project settings — skipping API tests", "warn");
  const { ops, base } = await loadSpec(ctx);
  let selected = mod ? ops.filter((o) => opInScope(o, mod.apiScopes)) : ops.filter((o) => !opInScope(o, excludeScopes));
  const skipped = ctx.project.apiTestMode === "safe" ? selected.filter((o) => !SAFE.has(o.method)).length : 0;
  if (ctx.project.apiTestMode === "safe") selected = selected.filter((o) => SAFE.has(o.method));
  selected = selected.sort((a, b) => a.path.length - b.path.length).slice(0, 80);
  const scopeName = mod?.name ?? "General API";
  await ctx.log(
    `API tests for ${scopeName}: ${selected.length} endpoint(s) on ${base}` +
      (skipped ? ` (${skipped} write endpoints skipped — safe mode; switch to full mode on staging)` : ""),
  );
  const idPool = new Map<string, unknown[]>();
  const moduleId = mod?.id ?? null;

  for (const op of selected) {
    await ctx.checkCancelled();
    const name = `${op.method} ${op.path}`;
    const query: Record<string, string> = {};
    for (const p of op.parameters.filter((p) => p.in === "query" && p.required)) query[p.name] = String(sample(p.schema ?? { type: p.type }));
    const bodySchema = op.requestBody?.content?.["application/json"]?.schema;
    const baseline: Case = {
      name: "baseline",
      path: fillPath(op, idPool),
      query,
      body: bodySchema ? sample(bodySchema) : undefined,
      useAuth: true,
      expectStatus: documented2xx(op),
    };
    const pathHasParams = op.path.includes("{");

    const cases: Case[] = [baseline];
    if (op.secured && ctx.secrets.apiAuth?.headerValue) {
      cases.push({ ...baseline, name: "no-auth", useAuth: false, expectStatus: [401, 403] });
    }
    cases.push(...(await aiCases(ctx, op, baseline)));

    for (const c of cases) {
      const r = await send(ctx, base, op, c);
      ctx.stats.checks = (ctx.stats.checks ?? 0) + 1;
      if (c.name === "baseline" && r.status >= 200 && r.status < 300 && op.method === "GET") harvestIds(op.path, r.json, idPool);

      const problems: { title: string; severity: Severity; category: string; expected: string }[] = [];
      if (r.error) problems.push({ title: `${name} — request failed: ${r.error}`, severity: "critical", category: "api-error", expected: `HTTP ${c.expectStatus.join("/")}` });
      else if (r.status >= 500) problems.push({ title: `${name} returns ${r.status} (${c.name})`, severity: c.name === "baseline" ? "critical" : "high", category: "api-error", expected: `HTTP ${c.expectStatus.join("/")}` });
      else if (c.name === "no-auth" && r.status < 300)
        problems.push({ title: `${name} is accessible WITHOUT authentication`, severity: "critical", category: "security", expected: "HTTP 401/403" });
      else if (!c.expectStatus.includes(r.status)) {
        // Unknown ids in path → 404 on baseline is expected-ish; don't flag
        const benign404 = c.name === "baseline" && pathHasParams && r.status === 404;
        if (!benign404)
          problems.push({
            title: `${name}: expected ${c.expectStatus.join("/")} but got ${r.status} (${c.name})`,
            severity: c.name === "baseline" ? "high" : "medium",
            category: c.name === "baseline" ? "api-error" : "api-validation",
            expected: `HTTP ${c.expectStatus.join("/")}${c.why ? ` — ${c.why}` : ""}`,
          });
      }

      // Contract: response must match documented schema
      if (!r.error && r.json !== undefined) {
        const schema = jsonSchemaFor(op, r.status);
        if (schema) {
          try {
            const v = validatorFor(schema);
            if (!v(r.json)) {
              problems.push({
                title: `${name}: response doesn't match OpenAPI schema (${r.status})`,
                severity: "medium",
                category: "api-contract",
                expected: (v.errors ?? []).slice(0, 8).map((e) => `${e.instancePath || "(root)"} ${e.message}`).join("\n"),
              });
            }
          } catch {
            /* invalid schema in spec — ignore */
          }
        }
      }
      if (/\bat\s+\S+\s+\(?\S+\.(js|ts):\d+|Traceback \(most recent call last\)|SQLSTATE|ORA-\d{5}|stack":/i.test(r.text)) {
        problems.push({ title: `${name}: error response leaks stack trace / internals`, severity: "high", category: "security", expected: "Generic error message without internals" });
      }
      if (r.ms > LATENCY_MS && c.name === "baseline") {
        problems.push({ title: `${name} is slow (${r.ms}ms)`, severity: r.ms > LATENCY_MS * 3 ? "medium" : "low", category: "performance", expected: `< ${LATENCY_MS}ms` });
      }

      for (const p of problems) {
        const evidence = await renderEvidence(ctx, p.title, [
          { label: `Request · ${c.name}`, body: reqText(base, op, c, ctx) },
          { label: "Expected", body: p.expected, tone: "good" },
          { label: "Actual response", body: resText(r), tone: "bad" },
        ]);
        await ctx.addBug(moduleId, {
          suite: "api",
          category: p.category,
          severity: p.severity,
          title: p.title,
          description: `${op.summary ?? ""}\nTest case: ${c.name}${c.why ? ` — ${c.why}` : ""}`.trim(),
          steps: `curl -X ${op.method} '${base}${c.path}${c.query && Object.keys(c.query).length ? "?" + new URLSearchParams(c.query) : ""}'${c.useAuth ? " -H '<auth header>'" : ""}${c.body !== undefined && !SAFE.has(op.method) ? ` -H 'Content-Type: application/json' -d '${JSON.stringify(c.body).replace(/'/g, "'\\''")}'` : ""}`,
          expected: p.expected,
          actual: resText(r),
          url: base + c.path,
          screenshot: evidence,
          meta: { method: op.method, path: op.path, case: c.name, status: r.status, ms: r.ms },
          // One bug per endpoint for 5xx / contract / leaks, one per case for validation issues
          fingerprint: ["api-error", "api-contract", "security", "performance"].includes(p.category) && !p.title.includes("WITHOUT")
            ? `api|${p.category}|${op.method}|${op.path}|${r.status >= 500 ? "5xx" : r.status}`
            : `api|${p.category}|${op.method}|${op.path}|${c.name}|${r.status}`,
        });
      }
    }
  }
}
