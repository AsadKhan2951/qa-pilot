import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env.js";

let client: Anthropic | null = null;
export function claude(): Anthropic {
  if (!env.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY is not set — AI testing is disabled");
  client ??= new Anthropic({ apiKey: env.anthropicApiKey, maxRetries: 4 });
  return client;
}

export const aiEnabled = () => Boolean(env.anthropicApiKey);

export type ContentBlock = Anthropic.Messages.ContentBlockParam;

export function imageBlock(buf: Buffer, mediaType: "image/png" | "image/jpeg" = "image/jpeg"): ContentBlock {
  return { type: "image", source: { type: "base64", media_type: mediaType, data: buf.toString("base64") } };
}

export function textBlock(text: string): ContentBlock {
  return { type: "text", text };
}

/**
 * Asks Claude for structured output by forcing a single tool call whose
 * input matches `schema`. Returns the parsed tool input.
 */
export async function askJson<T>(opts: {
  system: string;
  content: ContentBlock[];
  schema: Record<string, unknown>;
  name?: string;
  model?: string;
  maxTokens?: number;
}): Promise<T> {
  const name = opts.name ?? "submit_result";
  const call = (forced: boolean) =>
    claude().messages.create({
      model: opts.model ?? env.claudeModel,
      max_tokens: opts.maxTokens ?? 4096,
      system: forced ? opts.system : `${opts.system}\n\nAlways answer by calling the ${name} tool exactly once.`,
      tools: [{ name, description: "Submit the result.", input_schema: opts.schema as Anthropic.Messages.Tool.InputSchema }],
      tool_choice: forced ? { type: "tool", name } : { type: "auto" },
      messages: [{ role: "user", content: opts.content }],
    });
  let res: Anthropic.Messages.Message;
  try {
    res = await call(true);
  } catch (e) {
    // Some models (e.g. with extended thinking) reject a forced tool_choice
    if (!/tool_choice/i.test((e as Error).message)) throw e;
    res = await call(false);
  }
  const block = res.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") throw new Error("Claude did not return structured output");
  return block.input as T;
}

/** Plain text completion. */
export async function askText(system: string, content: ContentBlock[], maxTokens = 2048, model = env.claudeModel) {
  const res = await claude().messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content }],
  });
  return res.content
    .filter((b) => b.type === "text")
    .map((b) => (b as Anthropic.Messages.TextBlock).text)
    .join("\n");
}
