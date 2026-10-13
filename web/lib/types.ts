export type Suite = "ui" | "visual" | "api" | "ai";
export const SUITES: { id: Suite; label: string; hint: string }[] = [
  { id: "ui", label: "Frontend", hint: "Every page checked, then an AI tester walks your flows" },
  { id: "visual", label: "Design match", hint: "Pixels, text, fonts and colours against Figma or a reference site" },
  { id: "api", label: "API", hint: "Every API call the app makes: errors, auth, bad input, speed" },
  { id: "ai", label: "AI answers", hint: "Your test questions, each answer graded by Claude" },
];

export type Workspace = { id: string; name: string; role: string; projectCount?: number; members?: { id: string; name: string; email: string; role: string }[] };

export type Project = {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  techStack: string;
  baseUrl: string;
  loginUrl: string;
  credentials: { username: string; hasPassword: boolean; notes: string };
  figmaFileKey: string;
  hasFigmaToken: boolean;
  referenceUrl: string;
  referenceNotes: string;
  hasReferencePasscode: boolean;
  openApiUrl: string;
  apiBaseUrl: string;
  apiAuth: { headerName: string; hasValue: boolean };
  apiTestMode: "safe" | "full";
  scheduleCron: string;
  scheduleSuites: Suite[];
  triggerToken: string;
  lastRun?: { status: string; healthScore: number | null; createdAt: string } | null;
};

export type FigmaFrame = { path: string; nodeId: string; label?: string; source?: "figma" | "site" };
export type AiEvalTarget = { url?: string; method?: string; headers?: Record<string, string>; bodyTemplate?: string; responsePath?: string };
export type EvalCase = { id: string; name: string; input: string; criteria: string };

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
  evalCases?: EvalCase[];
  project?: { id: string; name: string; workspaceId: string; baseUrl: string };
};

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

export type RunRow = {
  id: string;
  status: string;
  suites: Suite[];
  trigger: string;
  healthScore: number | null;
  stats: RunStats;
  createdAt: string;
  finishedAt: string | null;
  moduleId: string | null;
  moduleName: string | null;
};

export type Run = RunRow & {
  summary: string;
  error: string;
  startedAt: string | null;
  project: { id: string; name: string; workspaceId: string };
  module: { id: string; name: string; mvp: string } | null;
  report: { html: string; pdf: string | null } | null;
};

export type RunEvent = { id: string; seq: number; level: "info" | "warn" | "error" | "success"; message: string; createdAt: string };

export type Bug = {
  id: string;
  suite: Suite;
  category: string;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  description: string;
  steps: string;
  expected: string;
  actual: string;
  url: string;
  screenshotUrl: string | null;
  status: "open" | "fixed" | "wontfix" | "duplicate";
  moduleName: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
};
