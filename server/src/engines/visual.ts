/**
 * Reference QA: compares the live page with its Figma frame.
 * 1) Pixel diff (pixelmatch)  2) Exact spec diff (texts, fonts, sizes, colours)
 * 3) Claude vision reviews both and lists each real mismatch with a region,
 *    and every mismatch becomes a bug with an annotated side-by-side screenshot.
 */
import sharp from "sharp";
import pixelmatch from "pixelmatch";
import type { Module, FigmaFrame } from "../db/schema.js";
import { aiEnabled, askJson, imageBlock, textBlock } from "../lib/claude.js";
import { env } from "../lib/env.js";
import type { RunContext, Severity } from "./context.js";
import { newContext } from "./ui.js";

type Box = { x: number; y: number; w: number; h: number };
type SpecText = { text: string; font?: string; size?: number; weight?: number; color?: string; box: Box };

const FIGMA = "https://api.figma.com/v1";

async function figmaGet<T>(path: string, token: string): Promise<T> {
  const r = await fetch(`${FIGMA}${path}`, { headers: { "X-Figma-Token": token } });
  if (!r.ok) throw new Error(`Figma API ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json() as Promise<T>;
}

function hex(c?: { r: number; g: number; b: number; a?: number }) {
  if (!c) return undefined;
  const h = (n: number) => Math.round(n * 255).toString(16).padStart(2, "0");
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

/** Pulls text nodes (with exact typography & colour) out of a Figma frame. */
function collectFigmaTexts(node: any, origin: { x: number; y: number }, out: SpecText[] = []): SpecText[] {
  if (out.length >= 250 || node.visible === false) return out;
  if (node.type === "TEXT" && node.characters?.trim()) {
    const b = node.absoluteBoundingBox ?? { x: 0, y: 0, width: 0, height: 0 };
    const fill = (node.fills ?? []).find((f: any) => f.type === "SOLID" && f.visible !== false);
    out.push({
      text: node.characters.trim().slice(0, 200),
      font: node.style?.fontFamily,
      size: node.style?.fontSize,
      weight: node.style?.fontWeight,
      color: hex(fill?.color),
      box: { x: Math.round(b.x - origin.x), y: Math.round(b.y - origin.y), w: Math.round(b.width), h: Math.round(b.height) },
    });
  }
  for (const c of node.children ?? []) collectFigmaTexts(c, origin, out);
  return out;
}

const DOM_TEXTS_JS = () => {
  const out: { text: string; font: string; size: number; weight: number; color: string; box: { x: number; y: number; w: number; h: number } }[] = [];
  const rgbToHex = (s: string) => {
    const m = s.match(/\d+(\.\d+)?/g);
    if (!m) return s;
    return "#" + m.slice(0, 3).map((n) => Math.round(Number(n)).toString(16).padStart(2, "0")).join("");
  };
  document.querySelectorAll<HTMLElement>("body *").forEach((el) => {
    if (out.length >= 300) return;
    const textNodes = Array.from(el.childNodes).filter((n) => n.nodeType === 3 && n.textContent?.trim());
    const direct = textNodes.map((n) => n.textContent!.trim()).join(" ");
    if (!direct) return;
    // Measure the text itself, not the (often full-width) block element
    const range = document.createRange();
    range.setStartBefore(textNodes[0]);
    range.setEndAfter(textNodes[textNodes.length - 1]);
    const r = range.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    const st = getComputedStyle(el);
    if (st.visibility === "hidden" || st.display === "none") return;
    out.push({
      text: direct.slice(0, 200),
      font: st.fontFamily.split(",")[0].replace(/["']/g, "").trim(),
      size: parseFloat(st.fontSize),
      weight: Number(st.fontWeight),
      color: rgbToHex(st.color),
      box: { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) },
    });
  });
  return out;
};

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Exact, deterministic comparison of text content & typography (position-aware matching). */
function diffSpecs(figma: SpecText[], dom: SpecText[]) {
  const issues: { text: string; problem: string; box: Box }[] = [];
  const center = (b: Box) => [b.x + b.w / 2, b.y + b.h / 2];
  const dist = (a: Box, b: Box) => {
    const [ax, ay] = center(a), [bx, by] = center(b);
    return Math.hypot(ax - bx, ay - by);
  };
  const tokens = (s: string) => new Set(norm(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  const overlap = (a: string, b: string) => {
    const A = tokens(a), B = tokens(b);
    if (!A.size || !B.size) return 0;
    let n = 0;
    A.forEach((x) => B.has(x) && n++);
    return n / Math.max(A.size, B.size);
  };
  const nearest = (list: SpecText[], f: SpecText) => list.sort((a, b) => dist(a.box, f.box) - dist(b.box, f.box))[0];

  for (const f of figma) {
    const exact = dom.filter((d) => norm(d.text) === norm(f.text));
    let match = exact.length ? nearest(exact, f) : undefined;
    const probs: string[] = [];
    if (!match) {
      const similar = dom.filter((d) => overlap(d.text, f.text) >= 0.5 && dist(d.box, f.box) < 400);
      match = similar.length ? nearest(similar, f) : undefined;
      if (!match) {
        issues.push({ text: f.text, problem: "Text from the design is missing on the live page", box: f.box });
        continue;
      }
      probs.push(`text is "${match.text.slice(0, 80)}" (design "${f.text.slice(0, 80)}")`);
    }
    if (f.size && match.size && Math.abs(f.size - match.size) >= 1) probs.push(`font-size ${match.size}px (design ${f.size}px)`);
    if (f.weight && match.weight && Math.abs(f.weight - match.weight) >= 100) probs.push(`font-weight ${match.weight} (design ${f.weight})`);
    if (f.font && match.font && norm(f.font) !== norm(match.font)) probs.push(`font-family "${match.font}" (design "${f.font}")`);
    if (f.color && match.color && colorDistance(f.color, match.color) > 18) probs.push(`color ${match.color} (design ${f.color})`);
    const shift = dist(match.box, f.box);
    if (shift > 12) probs.push(`position off by ~${Math.round(shift)}px`);
    if (probs.length) issues.push({ text: f.text, problem: probs.join(", "), box: f.box });
  }
  return issues;
}

function colorDistance(a: string, b: string) {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  if (x.some(isNaN) || y.some(isNaN)) return 0;
  return Math.sqrt(x.reduce((s, v, i) => s + (v - y[i]) ** 2, 0));
}

/** Pads/crops an image to exactly w×h on white. */
async function fit(buf: Buffer, w: number, h: number) {
  const meta = await sharp(buf).metadata();
  const cw = Math.min(w, meta.width ?? w), ch = Math.min(h, meta.height ?? h);
  const cropped = await sharp(buf).extract({ left: 0, top: 0, width: cw, height: ch }).png().toBuffer();
  return sharp({ create: { width: w, height: h, channels: 4, background: "#ffffff" } })
    .composite([{ input: cropped, left: 0, top: 0 }])
    .png()
    .toBuffer();
}

function boxesSvg(w: number, h: number, boxes: Box[]) {
  const rects = boxes
    .map((b) => `<rect x="${b.x}" y="${b.y}" width="${Math.max(b.w, 8)}" height="${Math.max(b.h, 8)}" fill="none" stroke="#ff2d55" stroke-width="4"/>`)
    .join("");
  return Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">${rects}</svg>`);
}

/** Figma | Live (| Diff) side-by-side with labels and optional red boxes. */
async function sideBySide(panels: { label: string; img: Buffer }[], w: number, h: number, boxes: Box[] = [], crop?: Box) {
  const region = crop ?? { x: 0, y: 0, w, h };
  const gap = 24, header = 44;
  const prepared = await Promise.all(
    panels.map(async (p) => {
      let img = sharp(p.img);
      if (boxes.length) img = sharp(await img.composite([{ input: boxesSvg(w, h, boxes) }]).png().toBuffer());
      return img.extract({ left: region.x, top: region.y, width: region.w, height: region.h }).png().toBuffer();
    }),
  );
  const totalW = region.w * panels.length + gap * (panels.length - 1);
  const labels = Buffer.from(
    `<svg width="${totalW}" height="${header}" xmlns="http://www.w3.org/2000/svg">${panels
      .map((p, i) => `<text x="${i * (region.w + gap) + 8}" y="30" font-family="Arial" font-size="22" font-weight="bold" fill="#111">${p.label}</text>`)
      .join("")}</svg>`,
  );
  const out = await sharp({ create: { width: totalW, height: region.h + header, channels: 4, background: "#eef0f3" } })
    .composite([{ input: labels, left: 0, top: 0 }, ...prepared.map((input, i) => ({ input, left: i * (region.w + gap), top: header }))])
    .jpeg({ quality: 82 })
    .toBuffer();
  // keep evidence images reasonable in size
  return sharp(out).resize({ width: Math.min(totalW, 2400), withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
}

function padBox(b: Box, w: number, h: number, pad = 140): Box {
  const x = Math.max(0, b.x - pad), y = Math.max(0, b.y - pad);
  return { x, y, w: Math.min(w - x, b.w + pad * 2), h: Math.min(h - y, b.h + pad * 2) };
}

type Reference = { png: Buffer; texts: SpecText[]; name: string; where: string };

/** Figma frame → PNG + exact text/typography spec from the node tree. */
async function loadFigmaReference(ctx: RunContext, frame: FigmaFrame): Promise<Reference> {
  const token = ctx.secrets.figmaToken;
  const fileKey = ctx.project.figmaFileKey;
  if (!token || !fileKey) throw new Error("Figma file or token missing in product settings");
  const nodeId = frame.nodeId.replace("-", ":");
  const [imgRes, nodesRes] = await Promise.all([
    figmaGet<{ images: Record<string, string | null> }>(`/images/${fileKey}?ids=${encodeURIComponent(nodeId)}&format=png&scale=1`, token),
    figmaGet<{ nodes: Record<string, { document: any }> }>(`/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}`, token),
  ]);
  const imgUrl = imgRes.images[nodeId];
  const doc = nodesRes.nodes[nodeId]?.document;
  if (!imgUrl || !doc) throw new Error(`Figma node ${nodeId} not found`);
  const png = Buffer.from(await (await fetch(imgUrl)).arrayBuffer());
  const bb = doc.absoluteBoundingBox ?? { x: 0, y: 0 };
  return { png, texts: collectFigmaTexts(doc, { x: bb.x, y: bb.y }), name: "FIGMA", where: `Figma node ${nodeId}` };
}

/** Resolves a reference-site target: full URL, or a path on the product's reference website. */
function referenceUrl(ctx: RunContext, frame: FigmaFrame) {
  const target = (frame.nodeId || frame.path || "/").trim();
  if (/^https?:\/\//i.test(target)) return target;
  if (!ctx.project.referenceUrl) throw new Error("Add the reference website link in product settings");
  return new URL(target, ctx.project.referenceUrl).toString();
}

/**
 * Live reference website (e.g. an approved prototype on Vercel) → full-page screenshot
 * + computed text styles. Unlocks a passcode gate if the site shows one.
 */
async function loadSiteReference(ctx: RunContext, frame: FigmaFrame, width = 1440): Promise<Reference> {
  const url = referenceUrl(ctx, frame);
  const context = await ctx.browser.newContext({ viewport: { width, height: 1000 }, ignoreHTTPSErrors: true });
  await context.addInitScript("globalThis.__name = globalThis.__name || ((f) => f);");
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    const passcode = ctx.secrets.refPasscode;
    if (passcode) {
      const gate = page.locator('input[type="password"]:visible, input[name*="pass" i]:visible, input[name*="code" i]:visible, input[placeholder*="pass" i]:visible, input[placeholder*="code" i]:visible').first();
      const fallback = page.locator("input:visible");
      const field = (await gate.count()) ? gate : (await fallback.count()) === 1 ? fallback.first() : null;
      if (field) {
        await ctx.log(`Unlocking reference site with the passcode`);
        await field.fill(passcode);
        const submit = page.locator('button[type="submit"]:visible, input[type="submit"]:visible, button:visible').first();
        if (await submit.count()) await submit.click().catch(() => field.press("Enter"));
        else await field.press("Enter");
        await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(1200);
        if (await page.locator('input[type="password"]:visible').count()) throw new Error("Reference site passcode was not accepted");
        if (new URL(page.url()).pathname !== new URL(url).pathname) {
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
          await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
        }
      }
    }
    await page.evaluate(() => document.fonts?.ready).catch(() => {});
    await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}" });
    await page.waitForTimeout(800);
    const png = await page.screenshot({ fullPage: true, type: "png", timeout: 30000 });
    const texts = (await page.evaluate(DOM_TEXTS_JS)) as SpecText[];
    return { png, texts, name: "REFERENCE", where: url };
  } finally {
    await context.close();
  }
}

export async function runVisualSuite(ctx: RunContext, mod: Module) {
  const frames = (mod.figmaFrames ?? []) as FigmaFrame[];
  if (!frames.length) return ctx.log(`No design references linked for "${mod.name}" — skipping design match`, "warn");

  for (const frame of frames) {
    await ctx.checkCancelled();
    const label = frame.label || frame.path;
    const source = frame.source ?? "figma";
    try {
      await ctx.log(`Comparing ${label} with ${source === "site" ? "the reference website" : `Figma node ${frame.nodeId}`}`);
      const ref = source === "site" ? await loadSiteReference(ctx, frame) : await loadFigmaReference(ctx, frame);
      const fm = await sharp(ref.png).metadata();
      const W = fm.width!, H = Math.min(fm.height!, 6000);
      const figmaFit = await fit(ref.png, W, H);
      const figmaTexts = ref.texts;

      // Live page at the exact design width
      const context = await newContext(ctx, { width: W, height: Math.min(H, 1200) });
      const page = await context.newPage();
      let liveFit: Buffer, domTexts: SpecText[];
      try {
        await page.goto(ctx.url(frame.path), { waitUntil: "domcontentloaded", timeout: 45000 });
        await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
        await page.evaluate(() => document.fonts?.ready).catch(() => {});
        await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}" });
        await page.waitForTimeout(800);
        const live = await page.screenshot({ fullPage: true, type: "png", timeout: 30000 });
        liveFit = await fit(live, W, H);
        domTexts = (await page.evaluate(DOM_TEXTS_JS)) as SpecText[];
      } finally {
        await context.close();
      }
      ctx.stats.checks = (ctx.stats.checks ?? 0) + 1;

      // 1) Pixel diff
      const a = await sharp(figmaFit).ensureAlpha().raw().toBuffer();
      const b = await sharp(liveFit).ensureAlpha().raw().toBuffer();
      const diff = Buffer.alloc(W * H * 4);
      const mismatched = pixelmatch(a, b, diff, W, H, { threshold: 0.1, includeAA: false });
      const pct = (mismatched / (W * H)) * 100;
      const diffPng = await sharp(diff, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
      await ctx.log(`${label}: ${pct.toFixed(2)}% pixels differ from the reference`);

      // 2) Exact spec diff
      const specIssues = diffSpecs(figmaTexts, domTexts);
      const overview = await sideBySide(
        [
          { label: ref.name, img: figmaFit },
          { label: "LIVE", img: liveFit },
          { label: `DIFF ${pct.toFixed(1)}%`, img: diffPng },
        ],
        W,
        H,
      );
      const overviewPath = await ctx.saveImage(overview, `design-${label}`);

      if (pct < env.visualDiffThreshold && !specIssues.length) {
        await ctx.log(`${label} matches the reference ✔`, "success");
        continue;
      }

      // 3) Claude vision review
      if (aiEnabled()) {
        const small = (buf: Buffer) => sharp(buf).resize({ width: Math.min(W, 1400), withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
        const scale = Math.min(1, 1400 / W);
        const review = await askJson<{
          mismatches: {
            title: string;
            severity: Severity;
            element: string;
            expected: string;
            actual: string;
            box: Box;
          }[];
        }>({
          model: env.claudeModelStrong,
          maxTokens: 6000,
          system:
            "You are a pixel-perfect UI QA reviewer. Compare the approved DESIGN REFERENCE (image 1) with the LIVE implementation (image 2). " +
            "Image 3 highlights differing pixels in red. List every meaningful mismatch: missing/extra elements, wrong text, layout/position shifts, " +
            "spacing/padding, sizes, font family/size/weight, colours, borders/radius, shadows, icons, images, alignment. " +
            "Ignore anti-aliasing noise, dynamic data (names, dates, counts) and placeholder images. Be specific with measurements. " +
            `Give each mismatch a bounding box in DESIGN pixel coordinates of the full-size frame (${W}x${H}); images were scaled by ${scale.toFixed(3)}.`,
          content: [
            imageBlock(await small(figmaFit)),
            imageBlock(await small(liveFit)),
            imageBlock(await small(diffPng)),
            textBlock(
              `Page: ${frame.path}\nReference: ${ref.where}\nPixel mismatch: ${pct.toFixed(2)}%\n\nExact typography/text check (reference vs live, computed styles):\n` +
                (specIssues.length ? specIssues.slice(0, 60).map((i) => `- "${i.text.slice(0, 60)}": ${i.problem}`).join("\n") : "no text/typography differences"),
            ),
          ],
          schema: {
            type: "object",
            properties: {
              mismatches: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
                    element: { type: "string" },
                    expected: { type: "string", description: "What the reference shows" },
                    actual: { type: "string", description: "What the live page shows" },
                    box: {
                      type: "object",
                      properties: { x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } },
                      required: ["x", "y", "w", "h"],
                    },
                  },
                  required: ["title", "severity", "element", "expected", "actual", "box"],
                },
              },
            },
            required: ["mismatches"],
          },
        });

        for (const m of review.mismatches.slice(0, 30)) {
          const box = clampBox(m.box, W, H);
          const crop = padBox(box, W, H);
          const evidence = await sideBySide([{ label: ref.name, img: figmaFit }, { label: "LIVE", img: liveFit }], W, H, [box], crop);
          await ctx.addBug(mod.id, {
            suite: "visual",
            category: "visual",
            severity: m.severity,
            title: `${label}: ${m.title}`,
            description: `Element: ${m.element}\nReference: ${ref.where}\nPage pixel mismatch: ${pct.toFixed(2)}%`,
            expected: m.expected,
            actual: m.actual,
            url: ctx.url(frame.path),
            screenshot: await ctx.saveImage(evidence, "figma-mismatch"),
            meta: { box, figmaNodeId: frame.nodeId, overview: overviewPath, pixelMismatchPct: pct },
          });
        }
      } else {
        await ctx.addBug(mod.id, {
          suite: "visual",
          category: "visual",
          severity: pct > 10 ? "high" : "medium",
          title: `${label} differs from the ${source === "site" ? "reference site" : "Figma design"} (${pct.toFixed(1)}% pixels)`,
          description: specIssues.length ? `Text/typography differences:\n${specIssues.slice(0, 30).map((i) => `- "${i.text.slice(0, 60)}": ${i.problem}`).join("\n")}` : "",
          url: ctx.url(frame.path),
          screenshot: overviewPath,
          meta: { figmaNodeId: frame.nodeId, pixelMismatchPct: pct },
        });
      }
    } catch (e) {
      await ctx.log(`Design match failed for ${label}: ${(e as Error).message}`, "error");
    }
  }
}

function clampBox(b: Box, W: number, H: number): Box {
  const x = Math.max(0, Math.min(W - 1, Math.round(b.x)));
  const y = Math.max(0, Math.min(H - 1, Math.round(b.y)));
  return { x, y, w: Math.max(4, Math.min(W - x, Math.round(b.w))), h: Math.max(4, Math.min(H - y, Math.round(b.h))) };
}
