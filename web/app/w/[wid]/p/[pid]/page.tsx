"use client";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { Bot, Check, Copy, ExternalLink, Globe, ListChecks, PenTool, Play, Plus, RefreshCw, Server, Trash2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ProjectForm } from "@/components/ProjectForm";
import { RunDialog } from "@/components/RunDialog";
import { RunsTable } from "@/components/RunsTable";
import { Button, Empty, ErrorNote, Field, Gauge, Input, Modal, PageHeader, Panel, SectionTitle, Spinner, StatusBadge, Tabs, Textarea, cx, timeAgo } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import type { Module, Project, RunRow } from "@/lib/types";

type Tab = "modules" | "runs" | "settings";

/** What QA Pilot will be able to check in a module — filled = configured. */
function Coverage({ m, autoPages }: { m: Module; autoPages: boolean }) {
  const items = [
    { on: m.paths.length > 0 || autoPages, icon: Globe, label: m.paths.length ? "AI explores" : autoPages ? "Auto pages" : "No main page" },
    { on: true, icon: ListChecks, label: m.userFlows.trim() ? `AI flows + ${m.userFlows.trim().split("\n").length}` : "AI plans flows" },
    { on: m.figmaFrames.length > 0, icon: PenTool, label: m.figmaFrames.length ? `${m.figmaFrames.length} design ref${m.figmaFrames.length === 1 ? "" : "s"}` : "No design ref" },
    { on: true, icon: Server, label: m.apiScopes.length ? `API: ${m.apiScopes.join(", ")}` : "API auto" },
    { on: Boolean(m.aiEvalTarget?.url), icon: Bot, label: m.aiEvalTarget?.url ? "AI evals" : "No AI evals" },
  ];
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map(({ on, icon: Icon, label }) => (
        <span
          key={label}
          className={cx(
            "inline-flex max-w-[220px] items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium",
            on ? (Icon === Bot ? "bg-ai-wash text-ai" : "bg-[#ebede6] text-ink") : "border border-dashed border-[#d3d7cc] text-faint",
          )}
        >
          <Icon size={12} className="shrink-0" />
          <span className="truncate">{label}</span>
        </span>
      ))}
    </div>
  );
}

function ProjectPage() {
  const { wid, pid } = useParams<{ wid: string; pid: string }>();
  const router = useRouter();
  const params = useSearchParams();
  const project = useApi<Project>(`/projects/${pid}`);
  const modules = useApi<Module[]>(`/projects/${pid}/modules`);
  const runs = useApi<RunRow[]>(`/projects/${pid}/runs`, 5000);
  const [tab, setTab] = useState<Tab>((params.get("tab") as Tab) ?? "modules");
  const [runOpen, setRunOpen] = useState<{ moduleId: string | null } | null>(null);
  const [newMod, setNewMod] = useState(false);
  const [form, setForm] = useState({ name: "", mvp: "MVP 1", description: "" });
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const groups = useMemo(() => {
    const g = new Map<string, Module[]>();
    for (const m of modules.data ?? []) g.set(m.mvp || "No phase", [...(g.get(m.mvp || "No phase") ?? []), m]);
    return [...g.entries()];
  }, [modules.data]);

  const lastByModule = useMemo(() => {
    const map = new Map<string, RunRow>();
    for (const r of runs.data ?? []) if (r.moduleId && !map.has(r.moduleId)) map.set(r.moduleId, r);
    return map;
  }, [runs.data]);

  async function createModule() {
    setError(null);
    try {
      const m = await api<Module>(`/projects/${pid}/modules`, { body: { ...form, position: modules.data?.length ?? 0 } });
      router.push(`/w/${wid}/p/${pid}/m/${m.id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!project.data) {
    return (
      <AppShell workspaceId={wid} projectId={pid}>
        {project.error ? <ErrorNote error={project.error} /> : <Spinner />}
      </AppShell>
    );
  }
  const p = project.data;
  const latest = runs.data?.[0];
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const hook = `${origin}/api/hooks/trigger/${p.triggerToken}`;

  return (
    <AppShell workspaceId={wid} projectId={pid} crumbs={[{ label: "Products", href: `/w/${wid}` }, { label: p.name }]}>
      <PageHeader
        title={p.name}
        subtitle={
          <a href={p.baseUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[14px] hover:text-ink">
            {p.baseUrl.replace(/^https?:\/\//, "")} <ExternalLink size={12} />
          </a>
        }
        actions={
          <Button variant="primary" onClick={() => setRunOpen({ moduleId: null })}>
            <Play size={15} /> Run QA
          </Button>
        }
      />

      <Panel className="mb-9 grid divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <div className="px-6 py-5">
          <div className="label text-faint">Health on last run</div>
          <div className="mt-2">
            <Gauge score={latest?.healthScore} />
          </div>
        </div>
        <div className="px-6 py-5">
          <div className="label text-faint">Last run</div>
          <div className="mt-1.5 flex items-center gap-2 text-[14px]">
            {latest ? (
              <Link href={`/runs/${latest.id}`} className="flex items-center gap-2 hover:underline">
                <StatusBadge s={latest.status} /> {timeAgo(latest.createdAt)}
              </Link>
            ) : (
              <span className="text-faint">No runs yet</span>
            )}
          </div>
        </div>
        <div className="px-6 py-5">
          <div className="label text-faint">Automatic runs</div>
          <div className="mt-1.5 text-[14px]">{p.scheduleCron ? <span className="font-mono text-[14px]">{p.scheduleCron}</span> : <span className="text-faint">Off — set up in Settings</span>}</div>
        </div>
      </Panel>

      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "modules", label: "Modules", count: modules.data?.length },
          { id: "runs", label: "Runs and reports", count: runs.data?.length },
          { id: "settings", label: "Settings" },
        ]}
      />

      {tab === "modules" && (
        <>
          <SectionTitle
            title="Modules by phase"
            desc="Each module is a slice of the product you can test on its own. The tags show what QA Pilot can check — dashed ones still need setup."
            action={
              <Button onClick={() => setNewMod(true)}>
                <Plus size={15} /> Add module
              </Button>
            }
          />
          {modules.loading ? (
            <Spinner />
          ) : !modules.data?.length ? (
            <Empty
              icon={<ListChecks size={20} />}
              title="No modules yet"
              desc="Split the product the way you ship it — for example MVP 1: Login, Dashboard; MVP 2: AI chat, Reports. Or run QA now and the AI explores the whole app on its own."
              action={
                <div className="flex gap-2">
                  <Button variant="primary" onClick={() => setNewMod(true)}>
                    <Plus size={15} /> Add module
                  </Button>
                  <Button onClick={() => setRunOpen({ moduleId: null })}>
                    <Play size={14} /> Run on whole app
                  </Button>
                </div>
              }
            />
          ) : (
            <ol className="relative mt-2 space-y-8 border-l-2 border-line pl-6">
              {groups.map(([mvp, list]) => (
                <li key={mvp} className="relative">
                  <span className="grad absolute top-1.5 -left-[34px] size-4 rounded-full border-[3px] border-hangar" aria-hidden />
                  <div className="mb-3 flex items-baseline gap-3">
                    <h3 className="text-[22px] font-bold tracking-[-0.03em]">{mvp}</h3>
                    <span className="text-[14px] text-mute">
                      {list.length} module{list.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <Panel className="divide-y divide-line">
                    {list.map((m) => {
                      const last = lastByModule.get(m.id);
                      return (
                        <div key={m.id} className="grid items-center gap-3 px-6 py-5 md:grid-cols-[minmax(0,1fr)_150px_auto] md:gap-6">
                          <div className="min-w-0">
                            <Link href={`/w/${wid}/p/${pid}/m/${m.id}`} className="display text-[17px] font-bold tracking-[-0.02em] hover:underline">
                              {m.name}
                            </Link>
                            <p className="mt-0.5 line-clamp-1 text-[14px] text-mute">{m.description || "Add a description so the AI knows what correct looks like."}</p>
                            <div className="mt-2.5">
                              <Coverage m={m} autoPages={!(modules.data ?? []).some((x) => x.id !== m.id && x.paths.length)} />
                            </div>
                          </div>
                          <div>{last ? <Gauge score={last.healthScore} size="sm" /> : <span className="text-[14px] text-faint">Not tested</span>}</div>
                          <div className="flex gap-2">
                            <Link href={`/w/${wid}/p/${pid}/m/${m.id}`}>
                              <Button size="sm" variant="ghost">
                                Configure
                              </Button>
                            </Link>
                            <Button size="sm" onClick={() => setRunOpen({ moduleId: m.id })}>
                              <Play size={13} /> Run
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </Panel>
                </li>
              ))}
            </ol>
          )}
        </>
      )}

      {tab === "runs" &&
        (runs.loading ? (
          <Spinner />
        ) : !runs.data?.length ? (
          <Empty icon={<Play size={20} />} title="No runs yet" desc="Every run keeps its bugs, screenshots and a downloadable report here." action={<Button variant="primary" onClick={() => setRunOpen({ moduleId: null })}><Play size={14} /> Run QA</Button>} />
        ) : (
          <RunsTable runs={runs.data} />
        ))}

      {tab === "settings" && (
        <div className="space-y-6">
          <Panel className="px-6 pt-6">
            <ProjectForm
              initial={p}
              showAutomation
              submitLabel={savedAt && Date.now() - savedAt < 2500 ? "Saved" : "Save settings"}
              onSubmit={async (body) => {
                const u = await api<Project>(`/projects/${pid}`, { method: "PATCH", body });
                project.setData(u);
                setSavedAt(Date.now());
              }}
            />
          </Panel>
          <Panel className="p-6">
            <SectionTitle title="Run QA after every deploy" desc="Call this URL from your CI pipeline (GitHub Actions, GitLab, Bitbucket). Anyone with the URL can start a run, so keep it secret." />
            <div className="flex gap-2">
              <Input readOnly value={hook} className="font-mono text-[14.5px]" onFocus={(e) => e.target.select()} />
              <Button
                onClick={() => {
                  navigator.clipboard.writeText(hook);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "Copied" : "Copy"}
              </Button>
              <Button
                title="Issue a new URL"
                onClick={async () => {
                  if (confirm("Issue a new URL? The current one stops working.")) project.setData(await api<Project>(`/projects/${pid}/rotate-token`, { method: "POST" }));
                }}
              >
                <RefreshCw size={15} />
              </Button>
            </div>
            <Textarea
              readOnly
              className="mt-3 rounded-[16px] border-deck bg-deck font-mono text-[14.5px] text-[#d9ddd3]"
              rows={4}
              value={`# Add after your deploy step\n- run: curl -fsS -X POST -H "Content-Type: application/json" \\\n    -d '{"suites":["ui","api","ai"]}' ${hook}`}
            />
          </Panel>
          <Panel className="flex flex-wrap items-center justify-between gap-4 border-[#f3c4cb] p-6">
            <div>
              <div className="font-semibold">Delete this product</div>
              <p className="text-[14px] text-mute">Removes its modules, runs, bugs, screenshots and reports. This can't be undone.</p>
            </div>
            <Button
              variant="danger"
              onClick={async () => {
                if (!confirm(`Delete "${p.name}" and all of its QA history?`)) return;
                await api(`/projects/${pid}`, { method: "DELETE" });
                router.push(`/w/${wid}`);
              }}
            >
              <Trash2 size={15} /> Delete product
            </Button>
          </Panel>
        </div>
      )}

      {runOpen && <RunDialog open onClose={() => setRunOpen(null)} project={p} modules={modules.data ?? []} moduleId={runOpen.moduleId} />}

      <Modal open={newMod} onClose={() => setNewMod(false)} title="Add module">
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            createModule();
          }}
        >
          <div className="grid grid-cols-3 gap-3">
            <Field label="Module name" className="col-span-2">
              <Input autoFocus required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Leave management" />
            </Field>
            <Field label="Phase">
              <Input value={form.mvp} onChange={(e) => setForm({ ...form, mvp: e.target.value })} list="mvps" />
              <datalist id="mvps">
                {[...new Set([...(modules.data ?? []).map((m) => m.mvp), "MVP 1", "MVP 2", "MVP 3"])].map((x) => (
                  <option key={x} value={x} />
                ))}
              </datalist>
            </Field>
          </div>
          <Field label="What does it do?" hint="Business rules help the AI decide what counts as a bug.">
            <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Employees apply for leave, managers approve or reject, and the balance updates right away." />
          </Field>
          <ErrorNote error={error} />
          <div className="flex justify-end gap-2">
            <Button type="button" onClick={() => setNewMod(false)}>
              Cancel
            </Button>
            <Button variant="primary">Add and configure</Button>
          </div>
        </form>
      </Modal>
    </AppShell>
  );
}

export default function Page() {
  return (
    <Suspense>
      <ProjectPage />
    </Suspense>
  );
}
