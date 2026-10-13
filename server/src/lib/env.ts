import path from "node:path";

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") throw new Error(`Missing env var ${name}`);
  return v;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  mongoUrl: req("MONGODB_URI", "mongodb://localhost:27017/qapilot"),
  mongoDbName: process.env.MONGODB_DB || undefined, // defaults to the database in MONGODB_URI
  redisUrl: req("REDIS_URL", "redis://localhost:6379"),
  jwtSecret: req("JWT_SECRET", process.env.NODE_ENV === "production" ? undefined : "dev-jwt-secret"),
  // 32-byte key, base64. Generate: openssl rand -base64 32
  encryptionKey: req(
    "ENCRYPTION_KEY",
    process.env.NODE_ENV === "production" ? undefined : "ZGV2LWVuY3J5cHRpb24ta2V5LTMyLWJ5dGVzLWxvbmc=",
  ),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  claudeModel: process.env.CLAUDE_MODEL ?? "claude-sonnet-5-5",
  // Bigger model for vision comparisons & final report (optional)
  claudeModelStrong: process.env.CLAUDE_MODEL_STRONG ?? process.env.CLAUDE_MODEL ?? "claude-sonnet-5-5",
  artifactsDir: path.resolve(process.env.ARTIFACTS_DIR ?? "./data/artifacts"),
  chromiumPath: process.env.CHROMIUM_PATH || undefined,
  workerConcurrency: Number(process.env.WORKER_CONCURRENCY ?? 2),
  agentMaxSteps: Number(process.env.AGENT_MAX_STEPS ?? 25),
  visualDiffThreshold: Number(process.env.VISUAL_DIFF_THRESHOLD ?? 0.5), // % of pixels
  allowRegistration: (process.env.ALLOW_REGISTRATION ?? "true") === "true",
  publicAppUrl: process.env.PUBLIC_APP_URL ?? "http://localhost:3000",
};
