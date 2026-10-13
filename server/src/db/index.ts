import { MongoClient, type Db, type Filter, type Document, type Sort } from "mongodb";
import { env } from "../lib/env.js";
import { createId } from "../lib/id.js";
import type { Bug, EvalCase, Member, Module, Project, Report, Run, RunEvent, User, Workspace } from "./schema.js";

export const client = new MongoClient(env.mongoUrl, { maxPoolSize: 20 });
let database: Db | null = null;

export function mdb(): Db {
  if (!database) throw new Error("Database not connected — call connectDb() first");
  return database;
}

/** Connects once and makes sure every index exists (safe to call on each boot). */
export async function connectDb() {
  if (database) return database;
  // Retry so the API/worker can start before MongoDB is ready (e.g. docker compose)
  for (let attempt = 1; ; attempt++) {
    try {
      await client.connect();
      break;
    } catch (e) {
      if (attempt >= 30) throw e;
      console.warn(`MongoDB not reachable yet (attempt ${attempt}/30): ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  database = client.db(env.mongoDbName);
  await Promise.all([
    col.users.c().createIndex({ email: 1 }, { unique: true }),
    col.members.c().createIndex({ userId: 1, workspaceId: 1 }, { unique: true }),
    col.members.c().createIndex({ workspaceId: 1 }),
    col.projects.c().createIndex({ workspaceId: 1, createdAt: -1 }),
    col.projects.c().createIndex({ triggerToken: 1 }, { unique: true }),
    col.modules.c().createIndex({ projectId: 1, position: 1 }),
    col.evalCases.c().createIndex({ moduleId: 1, createdAt: 1 }),
    col.runs.c().createIndex({ projectId: 1, createdAt: -1 }),
    col.runs.c().createIndex({ status: 1 }),
    col.runEvents.c().createIndex({ runId: 1, seq: 1 }),
    col.bugs.c().createIndex({ runId: 1, createdAt: 1 }),
    col.bugs.c().createIndex({ projectId: 1 }),
    col.reports.c().createIndex({ runId: 1 }, { unique: true }),
  ]);
  return database;
}

type WithId = { id: string };
type Doc<T extends WithId> = Omit<T, "id"> & { _id: string };
export type Where<T extends WithId> = Filter<Doc<T>> & Record<string, unknown>;

function out<T extends WithId>(d: Document | null): T | null {
  if (!d) return null;
  const { _id, ...rest } = d;
  return { id: _id, ...rest } as T;
}

/** Small typed repository over one collection. Ids are strings; `id` in, `_id` stored. */
function repo<T extends WithId & { createdAt: Date }>(name: string, defaults: Partial<Omit<T, "id" | "createdAt">> = {}) {
  const c = () => mdb().collection<Doc<T>>(name);
  return {
    c,
    async insert(data: Partial<Omit<T, "id" | "createdAt">>): Promise<T> {
      const doc = { _id: createId(), createdAt: new Date(), ...defaults, ...data } as unknown as Doc<T>;
      await c().insertOne(doc as never);
      return out<T>(doc)!;
    },
    async insertMany(list: Partial<Omit<T, "id" | "createdAt">>[]): Promise<T[]> {
      if (!list.length) return [];
      const now = Date.now();
      const docs = list.map((data, i) => ({ _id: createId(), createdAt: new Date(now + i), ...defaults, ...data }) as unknown as Doc<T>);
      await c().insertMany(docs as never);
      return docs.map((d) => out<T>(d)!);
    },
    async get(id: string | null | undefined): Promise<T | null> {
      if (!id) return null;
      return out<T>(await c().findOne({ _id: id } as never));
    },
    async findOne(where: Where<T>): Promise<T | null> {
      return out<T>(await c().findOne(where as never));
    },
    async find(where: Where<T> = {} as Where<T>, opts: { sort?: Sort; limit?: number; projection?: Document } = {}): Promise<T[]> {
      let cur = c().find(where as never, opts.projection ? { projection: opts.projection } : undefined);
      if (opts.sort) cur = cur.sort(opts.sort);
      if (opts.limit) cur = cur.limit(opts.limit);
      return (await cur.toArray()).map((d) => out<T>(d)!);
    },
    async count(where: Where<T> = {} as Where<T>) {
      return c().countDocuments(where as never);
    },
    async update(id: string, set: Partial<Omit<T, "id">>): Promise<T | null> {
      const clean = Object.fromEntries(Object.entries(set).filter(([, v]) => v !== undefined));
      if (!Object.keys(clean).length) return this.get(id);
      return out<T>(await c().findOneAndUpdate({ _id: id } as never, { $set: clean } as never, { returnDocument: "after" }));
    },
    async updateMany(where: Where<T>, set: Partial<Omit<T, "id">>) {
      await c().updateMany(where as never, { $set: set } as never);
    },
    async delete(id: string) {
      await c().deleteOne({ _id: id } as never);
    },
    async deleteMany(where: Where<T>) {
      await c().deleteMany(where as never);
    },
  };
}

export const col = {
  users: repo<User>("users"),
  workspaces: repo<Workspace>("workspaces"),
  members: repo<Member>("members", { role: "member" }),
  projects: repo<Project>("projects", {
    description: "",
    techStack: "",
    loginUrl: "",
    credentialsEnc: "",
    figmaFileKey: "",
    figmaTokenEnc: "",
    referenceUrl: "",
    referencePasscodeEnc: "",
    referenceNotes: "",
    openApiUrl: "",
    apiBaseUrl: "",
    apiAuthEnc: "",
    apiTestMode: "safe",
    scheduleCron: "",
    scheduleSuites: ["ui", "visual", "api", "ai"],
  }),
  modules: repo<Module>("modules", {
    mvp: "MVP 1",
    description: "",
    position: 0,
    paths: [],
    userFlows: "",
    figmaFrames: [],
    apiScopes: [],
    aiEvalTarget: {},
  }),
  evalCases: repo<EvalCase>("eval_cases"),
  runs: repo<Run>("runs", {
    moduleId: null,
    status: "queued",
    trigger: "manual",
    triggeredById: null,
    summary: "",
    healthScore: null,
    stats: {},
    error: "",
    startedAt: null,
    finishedAt: null,
  }),
  runEvents: repo<RunEvent>("run_events", { level: "info", seq: 0 }),
  bugs: repo<Bug>("bugs", { description: "", steps: "", expected: "", actual: "", url: "", screenshot: "", fingerprint: "", meta: {}, status: "open" }),
  reports: repo<Report>("reports", { pdfPath: "" }),
};

/** Removes a project and everything under it. */
export async function deleteProjectCascade(projectId: string) {
  const modules = await col.modules.find({ projectId }, { projection: { _id: 1 } });
  const runs = await col.runs.find({ projectId }, { projection: { _id: 1 } });
  const runIds = runs.map((r) => r.id);
  await Promise.all([
    col.evalCases.deleteMany({ moduleId: { $in: modules.map((m) => m.id) } }),
    col.runEvents.deleteMany({ runId: { $in: runIds } }),
    col.bugs.deleteMany({ runId: { $in: runIds } }),
    col.reports.deleteMany({ runId: { $in: runIds } }),
  ]);
  await Promise.all([col.modules.deleteMany({ projectId }), col.runs.deleteMany({ projectId })]);
  await col.projects.delete(projectId);
}

export async function deleteModuleCascade(moduleId: string) {
  await col.evalCases.deleteMany({ moduleId });
  await col.runs.updateMany({ moduleId }, { moduleId: null });
  await col.bugs.updateMany({ moduleId }, { moduleId: null });
  await col.modules.delete(moduleId);
}

/** Next sequence number for a run's live log (monotonic, so the UI can poll "after seq N"). */
export async function nextEventSeq(runId: string): Promise<number> {
  const r = await mdb()
    .collection<{ _id: string; seq: number }>("counters")
    .findOneAndUpdate({ _id: `run:${runId}` }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after" });
  return r?.seq ?? 1;
}
