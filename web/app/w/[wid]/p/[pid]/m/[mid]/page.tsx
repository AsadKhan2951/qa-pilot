"use client";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Bot, PenTool, Globe, Play, Plus, Save, Server, Sparkles, Trash2, X } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { RunDialog } from "@/components/RunDialog";
import { RunsTable } from "@/components/RunsTable";
import { Button, ErrorNote, Field, Input, Modal, PageHeader, Panel, SectionTitle, Select, Spinner, Textarea, cx } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import type { EvalCase, FigmaFrame, Module, Project, RunRow } from "@/lib/types";

function Block({ id, icon, title, desc, ready, children }: { id: string; icon: ReactNode; title: string; desc: string; ready?: boolean; children: ReactNode }) {
  return (
    <Panel className="scroll-mt-6">
      <section id={id}>
        <div className="flex items-start gap-3.5 border-b border-line px-6 py-5">
          <span className={cx("grid size-9 shrink-0 place-items-center rounded-[12px]", id === "ai" ? "bg-ai-wash text-ai" : "bg-signal-wash text-signal-ink")}>{icon}</span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[19px] font-bold tracking-[-0.02em]">{title}</h2>
            <p className="mt-0.5 max-w-[72ch] text-[13px] text-mute">{desc}</p>
          </div>
          {ready !== undefined && (
            <span className={cx("mt-0.5 shrink-0 text-[12.5px] font-medium", ready ? "text-clear" : "text-faint")}>{ready ? "Ready" : "Not set up"}</span>
          )}
        </div>
        <div className="px-6 py-5">{children}</div>
      </section>
    </Panel>
  );
}

/** Accepts a node id ("12:34" / "12-34") or a full Figma link with ?node-id= */
function parseNode(v: string) {
  const m = v.match(/node-id=([0-9]+[-:][0-9]+)/);
  return (m ? m[1] : v.trim()).replace("-", ":");
}

export default function ModulePage() {
  const { wid, pid, mid } = useParams<{ wid: string; pid: string; mid: string }>();
  const router = useRouter();
  const mod = useApi<Module>(`/modules/${mid}`);
  const project = useApi<Project>(`/projects/${pid}`);
  const allModules = useApi<Module[]>(`/projects/${pid}/modules`);
  const runs = useApi<RunRow[]>(`/projects/${pid}/runs`);
  const [m, setM] = useState<Module | null>(null);
  const [paths, setPaths] = useState("");
  const [scopes, setScopes] = useState("");
  const [headers, setHeaders] = useState("{}");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runOpen, setRunOpen] = useState(false);
  const [caseEdit, setCaseEdit] = useState<Partial<EvalCase> | null>(null);
  const [generated, setGenerated] = useState<(Omit<EvalCase, "id"> & { keep: boolean })[] | null>(null);
  const [genBusy, setGenBusy] = useState(false);

  useEffect(() => {
    if (!mod.data) return;
    setM(mod.data);
    setPaths(mod.data.paths.join("\n"));
    setScopes(mod.data.apiScopes.join(", "));
    setHeaders(JSON.stringify(mod.data.aiEvalTarget?.headers ?? {}, null, 2));
  }, [mod.data]);

  if (!m || !project.data) {
    return (
      <AppShell workspaceId={wid} projectId={pid}>
        {mod.error ? <ErrorNote error={mod.error} /> : <Spinner />}
      </AppShell>
    );
  }

  const set = <K extends keyof Module>(k: K, v: Module[K]) => setM({ ...m, [k]: v });
  const target = m.aiEvalTarget ?? {};
  const setTarget = (patch: Partial<typeof target>) => set("aiEvalTarget", { ...target, ...patch });
  const frames = m.figmaFrames ?? [];
  const setFrame = (i: number, patch: Partial<FigmaFrame>) => set("figmaFrames", frames.map((f, j) => (j === i ? { ...f, ...patch } : f)));

  async function save() {
    if (!m) return;
    setSaving(true);
    setError(null);
    try {
      let parsedHeaders: Record<string, string> = {};
      try {
        parsedHeaders = headers.trim() ? JSON.parse(headers) : {};
      } catch {
        throw new Error("AI endpoint headers must be valid JSON");
      }
      const body = {
        name: m.name,
        mvp: m.mvp,
        description: m.description,
        paths: paths.split("\n").map((p) => p.trim()).filter(Boolean).map((p) => (p.startsWith("/") || p.startsWith("http") ? p : `/${p}`)),
        userFlows: m.userFlows,
        figmaFrames: frames.filter((f) => f.path && f.nodeId).map((f) => ({ ...f, nodeId: parseNode(f.nodeId) })),
        apiScopes: scopes.split(/[,\n]/).map((s) => s.trim()).filter(Boolean),
        aiEvalTarget: { ...target, headers: parsedHeaders },
      };
      const u = await api<Module>(`/modules/${m.id}`, { method: "PATCH", body });
      setM({ ...m, ...u });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function saveCase() {
    if (!caseEdit) return;
    if (caseEdit.id) await api(`/eval-cases/${caseEdit.id}`, { method: "PATCH", body: caseEdit });
    else await api(`/modules/${mid}/eval-cases`, { body: caseEdit });
    setCaseEdit(null);
    mod.reload();
  }

  async function generate() {
    setGenBusy(true);
    setError(null);
    try {
      await save();
      const cases = await api<Omit<EvalCase, "id">[]>(`/modules/${mid}/eval-cases/generate`, { body: { count: 12 } });
      setGenerated(cases.map((c) => ({ ...c, keep: true })));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenBusy(false);
    }
  }

  const evalCases = mod.data?.evalCases ?? [];
  const outline = [
    { id: "overview", label: "Overview" },
    { id: "frontend", label: "Frontend", ready: true },
    { id: "figma", label: "Figma match", ready: frames.some((f) => f.path && f.nodeId) },
    { id: "api", label: "API", ready: Boolean(scopes.trim()) },
    { id: "ai", label: "AI answers", ready: Boolean(target.url) && evalCases.length > 0 },
  ];
  const moduleRuns = runs.data?.filter((r) => r.moduleId === m.id) ?? [];

  return (
    <AppShell
      workspaceId={wid}
      projectId={pid}
      crumbs={[
        { label: "Products", href: `/w/${wid}` },
        { label: project.data.name, href: `/w/${wid}/p/${pid}` },
        { label: m.name },
      ]}
    >
      <PageHeader
        meta={<span>{m.mvp || "No phase"}</span>}
        title={m.name}
        subtitle="Tell QA Pilot what to check in this module. Anything left empty is skipped."
        actions={
          <>
            <Button onClick={save} loading={saving}>
              <Save size={15} /> {saved ? "Saved ✓" : "Save"}
            </Button>
            <Button
              variant="primary"
              onClick={async () => {
                await save();
                setRunOpen(true);
              }}
            >
              <Play size={15} /> Run this module
            </Button>
          </>
        }
      />
      <div className="mb-4">
        <ErrorNote error={error} />
      </div>

      <div className="grid gap-8 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav className="hidden lg:block" aria-label="Module sections">
          <ol className="sticky top-6 space-y-0.5 border-l border-line">
            {outline.map((o) => (
              <li key={o.id}>
                <a href={`#${o.id}`} className="-ml-px flex items-center justify-between gap-2 border-l-2 border-transparent py-1.5 pr-2 pl-3.5 text-[13.5px] text-mute hover:border-signal hover:text-ink">
                  {o.label}
                  {o.ready !== undefined && <span className={cx("size-1.5 rounded-full", o.ready ? "bg-clear" : "bg-[#d3d7cc]")} />}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      <div className="min-w-0 space-y-5">
        <Panel className="grid scroll-mt-6 gap-4 p-6 sm:grid-cols-3">
        <span id="overview" className="sr-only">Overview</span>
          <Field label="Module name" className="sm:col-span-2">
            <Input value={m.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="Phase">
            <Input value={m.mvp} onChange={(e) => set("mvp", e.target.value)} />
          </Field>
          <Field label="Description" hint="Spell out the business rules. The AI uses them to decide what counts as a bug." className="sm:col-span-3">
            <Textarea value={m.description} onChange={(e) => set("description", e.target.value)} />
          </Field>
        </Panel>

        <Block id="frontend" ready={true} icon={<Globe size={17} />} title="Frontend" desc="Each page is checked for errors, broken data, dead links, accessibility, mobile layout and speed. Then the AI tester walks through your flows.">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Pages to test" hint={`One path per line, relative to ${project.data.baseUrl}. Leave empty to auto-discover.`}>
              <Textarea className="font-mono text-[13px]" rows={7} value={paths} onChange={(e) => setPaths(e.target.value)} placeholder={"/dashboard\n/leave/apply\n/leave/history"} />
            </Field>
            <Field label="User flows for the AI agent" hint="One flow per line, in plain English or Roman Urdu.">
              <Textarea
                rows={7}
                value={m.userFlows}
                onChange={(e) => set("userFlows", e.target.value)}
                placeholder={"Apply for 2 days annual leave and check the balance drops by 2\nTry applying with an end date before the start date — must show an error\nManager approves the request from the approvals tab"}
              />
            </Field>
          </div>
        </Block>

        <Block id="figma" ready={frames.some((f) => f.path && f.nodeId)} icon={<PenTool size={17} />} title="Figma match" desc="Link each page to its Figma frame. Every difference in text, font, colour, spacing or position comes back marked on a side-by-side screenshot.">
          {!project.data.figmaFileKey && <p className="mb-4 rounded-[7px] border border-[#ffd0bf] bg-signal-wash px-3 py-2 text-[13px] text-signal-ink">Connect the Figma file and token in the product settings first.</p>}
          <div className="space-y-2">
            {frames.map((f, i) => (
              <div key={i} className="grid grid-cols-[1fr_1.4fr_1fr_auto] gap-2">
                <Input placeholder="/dashboard" value={f.path} onChange={(e) => setFrame(i, { path: e.target.value })} />
                <Input placeholder="Figma frame link or node id (12:34)" value={f.nodeId} onChange={(e) => setFrame(i, { nodeId: e.target.value })} />
                <Input placeholder="Label (optional)" value={f.label ?? ""} onChange={(e) => setFrame(i, { label: e.target.value })} />
                <Button variant="ghost" onClick={() => set("figmaFrames", frames.filter((_, j) => j !== i))}>
                  <X size={15} />
                </Button>
              </div>
            ))}
          </div>
          <Button size="sm" className="mt-3" onClick={() => set("figmaFrames", [...frames, { path: "", nodeId: "" }])}>
            <Plus size={14} /> Add frame
          </Button>
          <p className="mt-2 text-xs text-mute">Tip: in Figma, right-click the frame → Copy link to selection, and paste it here.</p>
        </Block>

        <Block id="api" ready={Boolean(scopes.trim())} icon={<Server size={17} />} title="API" desc="Pick the endpoints from your OpenAPI spec that belong to this module. Each one is tested for its contract, auth, bad input, server errors and speed.">
          <Field label="API scopes" hint="OpenAPI tags (e.g. leave) or path prefixes (e.g. /api/leave), comma-separated.">
            <Input value={scopes} onChange={(e) => setScopes(e.target.value)} placeholder="leave, /api/approvals" />
          </Field>
        </Block>

        <Block id="ai" ready={Boolean(target.url) && evalCases.length > 0} icon={<Bot size={17} />} title="AI answers" desc="For AI features. Your test questions go to the AI endpoint and Claude grades each answer for accuracy, made-up facts, language, safety and format.">
          <div className="grid gap-4 md:grid-cols-[110px_1fr]">
            <Field label="Method">
              <Select value={target.method ?? "POST"} onChange={(e) => setTarget({ method: e.target.value })}>
                <option>POST</option>
                <option>GET</option>
                <option>PUT</option>
              </Select>
            </Field>
            <Field label="AI endpoint URL">
              <Input value={target.url ?? ""} onChange={(e) => setTarget({ url: e.target.value })} placeholder="https://staging-api.myapp.com/api/wingman/chat" />
            </Field>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <Field label="Request body template" hint="{{input}} is replaced by each test case" className="md:col-span-1">
              <Textarea className="font-mono text-xs" rows={4} value={target.bodyTemplate ?? ""} onChange={(e) => setTarget({ bodyTemplate: e.target.value })} placeholder={'{"message": "{{input}}"}'} />
            </Field>
            <Field label="Extra headers (JSON)" hint="Project API auth header is added automatically">
              <Textarea className="font-mono text-xs" rows={4} value={headers} onChange={(e) => setHeaders(e.target.value)} />
            </Field>
            <Field label="Answer path in response" hint="Dot path, e.g. data.reply or choices.0.message.content">
              <Input className="font-mono text-xs" value={target.responsePath ?? ""} onChange={(e) => setTarget({ responsePath: e.target.value })} placeholder="reply" />
            </Field>
          </div>

          <div className="mt-6 flex items-center justify-between">
            <div className="text-[14px] font-semibold">Test questions <span className="tnum font-normal text-mute">({evalCases.length})</span></div>
            <div className="flex gap-2">
              <Button size="sm" onClick={generate} loading={genBusy} className="!border-[#d8d4ff] !bg-ai-wash !text-ai hover:!bg-[#e4e1ff]">
                <Sparkles size={14} /> Draft with AI
              </Button>
              <Button size="sm" onClick={() => setCaseEdit({ name: "", input: "", criteria: "" })}>
                <Plus size={14} /> Add question
              </Button>
            </div>
          </div>
          <div className="mt-3 divide-y divide-line rounded-[16px] border border-line">
            {!evalCases.length && <div className="p-4 text-center text-[13px] text-mute">No test questions yet. Add a few, or let AI draft them from the module description.</div>}
            {evalCases.map((c) => (
              <div key={c.id} className="flex items-start gap-3 p-3">
                <button className="min-w-0 flex-1 text-left" onClick={() => setCaseEdit(c)}>
                  <div className="text-[14px] font-medium">{c.name}</div>
                  <div className="truncate text-[12.5px] text-mute">Asks: {c.input}</div>
                  <div className="truncate text-[12.5px] text-mute">Passes if: {c.criteria}</div>
                </button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    await api(`/eval-cases/${c.id}`, { method: "DELETE" });
                    mod.reload();
                  }}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            ))}
          </div>
        </Block>

        {moduleRuns.length > 0 && (
          <div id="runs" className="scroll-mt-6 pt-2">
            <SectionTitle title="Recent runs" />
            <RunsTable runs={moduleRuns.slice(0, 10)} />
          </div>
        )}

        <div className="flex justify-between border-t border-line pt-5">
          <Button
            variant="danger"
            onClick={async () => {
              if (!confirm(`Delete module "${m.name}"?`)) return;
              await api(`/modules/${m.id}`, { method: "DELETE" });
              router.push(`/w/${wid}/p/${pid}`);
            }}
          >
            <Trash2 size={15} /> Delete module
          </Button>
          <Button variant="primary" onClick={save} loading={saving}>
            <Save size={15} /> {saved ? "Saved ✓" : "Save module"}
          </Button>
        </div>
      </div>

      </div>
      {runOpen && <RunDialog open onClose={() => setRunOpen(false)} project={project.data} modules={allModules.data ?? []} moduleId={m.id} />}

      <Modal open={Boolean(caseEdit)} onClose={() => setCaseEdit(null)} title={caseEdit?.id ? "Edit test question" : "New test question"}>
        {caseEdit && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              saveCase();
            }}
          >
            <Field label="Name">
              <Input required value={caseEdit.name} onChange={(e) => setCaseEdit({ ...caseEdit, name: e.target.value })} placeholder="Leave policy question in Roman Urdu" />
            </Field>
            <Field label="Question sent to the AI">
              <Textarea required value={caseEdit.input} onChange={(e) => setCaseEdit({ ...caseEdit, input: e.target.value })} placeholder="Mujhe kitni annual leaves milti hain?" />
            </Field>
            <Field label="Passes if" hint="What a correct answer must do, and must not do.">
              <Textarea
                required
                value={caseEdit.criteria}
                onChange={(e) => setCaseEdit({ ...caseEdit, criteria: e.target.value })}
                placeholder="Replies in Roman Urdu. States 14 days annual leave from the policy. Does not invent other leave types."
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" onClick={() => setCaseEdit(null)}>
                Cancel
              </Button>
              <Button variant="primary">Save question</Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={Boolean(generated)} onClose={() => setGenerated(null)} title="Drafted test questions" wide>
        {generated && (
          <>
            <p className="mb-3 text-[13px] text-mute">Untick anything that doesn't fit, then save the rest.</p>
            <div className="scroll-thin max-h-[55vh] space-y-2 overflow-y-auto pr-1">
              {generated.map((c, i) => (
                <label key={i} className="flex cursor-pointer gap-3 rounded-[8px] border border-line p-3 hover:bg-soft">
                  <input
                    type="checkbox"
                    className="mt-1 size-4 accent-[#10140f]"
                    checked={c.keep}
                    onChange={() => setGenerated(generated.map((g, j) => (j === i ? { ...g, keep: !g.keep } : g)))}
                  />
                  <div className="min-w-0 text-[13px]">
                    <div className="font-medium">{c.name}</div>
                    <div className="text-mute">
                      <b className="font-medium text-ink">Input:</b> {c.input}
                    </div>
                    <div className="text-mute">
                      <b className="font-medium text-ink">Criteria:</b> {c.criteria}
                    </div>
                  </div>
                </label>
              ))}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button onClick={() => setGenerated(null)}>Discard</Button>
              <Button
                variant="primary"
                onClick={async () => {
                  const keep = generated.filter((g) => g.keep).map(({ name, input, criteria }) => ({ name, input, criteria }));
                  if (keep.length) await api(`/modules/${mid}/eval-cases`, { body: keep });
                  setGenerated(null);
                  mod.reload();
                }}
              >
                Save {generated.filter((g) => g.keep).length} questions
              </Button>
            </div>
          </>
        )}
      </Modal>
    </AppShell>
  );
}
