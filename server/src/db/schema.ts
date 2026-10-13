// QA Pilot data model (MongoDB)
// Hierarchy: Workspace -> Project -> Module (MVP-wise) -> Run -> Bug / Report
// Every document uses a string _id (see lib/id.ts); the API exposes it as `id`.

export type Role = "owner" | "admin" | "member";
export type RunStatus = "queued" | "running" | "passed" | "failed" | "error" | "cancelled";

export type User = { id: string; email: string; name: string; passwordHash: string; createdAt: Date };

export type Workspace = { id: string; name: string; createdAt: Date };

export type Member = { id: string; userId: string; workspaceId: string; role: Role; createdAt: Date };

export type Project = {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  techStack: string;

  // Frontend
  baseUrl: string;
  loginUrl: string;
  credentialsEnc: string; // encrypted { username, password, notes }

  // Figma reference
  figmaFileKey: string;
  figmaTokenEnc: string;

  // Live reference website (approved prototype) used instead of / alongside Figma
  referenceUrl: string;
  referencePasscodeEnc: string;
  referenceNotes: string;

  // Backend / API
  openApiUrl: string;
  apiBaseUrl: string;
  apiAuthEnc: string; // encrypted { headerName, headerValue }
  apiTestMode: "safe" | "full";

  // Automation
  scheduleCron: string;
  scheduleSuites: string[];
  triggerToken: string;

  createdAt: Date;
};

/** A page and its approved design: a Figma frame (nodeId) or a reference-site page (nodeId = path or full URL). */
export type FigmaFrame = { path: string; nodeId: string; label?: string; source?: "figma" | "site" };
export type AiEvalTarget = {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  bodyTemplate?: string; // JSON with {{input}} placeholder
  responsePath?: string; // dot path to the answer, e.g. "data.reply"
};

export type Module = {
  id: string;
  projectId: string;
  name: string;
  mvp: string;
  description: string;
  position: number;
  paths: string[];
  userFlows: string;
  figmaFrames: FigmaFrame[];
  apiScopes: string[];
  aiEvalTarget: AiEvalTarget;
  createdAt: Date;
};

export type EvalCase = { id: string; moduleId: string; name: string; input: string; criteria: string; createdAt: Date };

export type RunStats = {
  bySeverity?: Record<string, number>;
  bySuite?: Record<string, number>;
  checks?: number;
  pagesTested?: number;
  apiCalls?: number;
  evalsRun?: number;
  evalsPassed?: number;
  durationMs?: number;
};

export type Run = {
  id: string;
  projectId: string;
  moduleId: string | null;
  suites: string[];
  status: RunStatus;
  trigger: "manual" | "schedule" | "webhook";
  triggeredById: string | null;
  summary: string;
  healthScore: number | null;
  stats: RunStats;
  error: string;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
};

export type RunEvent = { id: string; runId: string; seq: number; level: "info" | "warn" | "error" | "success"; message: string; createdAt: Date };

export type Bug = {
  id: string;
  runId: string;
  projectId: string;
  moduleId: string | null;
  suite: string;
  category: string;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  description: string;
  steps: string;
  expected: string;
  actual: string;
  url: string;
  screenshot: string; // artifact path relative to ARTIFACTS_DIR
  fingerprint: string;
  meta: Record<string, unknown>;
  status: "open" | "fixed" | "wontfix" | "duplicate";
  createdAt: Date;
};

export type Report = { id: string; runId: string; htmlPath: string; pdfPath: string; createdAt: Date };
