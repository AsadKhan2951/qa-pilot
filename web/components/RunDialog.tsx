"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Bot, Check, Globe, PenTool, Play, Server } from "lucide-react";
import { api } from "@/lib/api";
import type { Module, Project, Suite } from "@/lib/types";
import { SUITES } from "@/lib/types";
import { Button, ErrorNote, Field, Modal, Select, cx } from "./ui";

const ICON = { ui: Globe, visual: PenTool, api: Server, ai: Bot } as const;

/** Warns when a suite has nothing configured to test. */
function readiness(s: Suite, project: Project, mods: Module[]): string | null {
  if (s === "visual" && !project.referenceUrl && !(project.figmaFileKey && project.hasFigmaToken)) return "add a reference website or Figma file in Settings";
  if (s === "visual" && !mods.some((m) => m.figmaFrames.length)) return "link pages to the design in a module";
  if (s === "ai" && !mods.some((m) => m.aiEvalTarget?.url)) return "set up an AI endpoint and eval cases in a module";
  return null;
}

export function RunDialog({
  open,
  onClose,
  project,
  modules,
  moduleId,
}: {
  open: boolean;
  onClose: () => void;
  project: Project;
  modules: Module[];
  moduleId?: string | null;
}) {
  const router = useRouter();
  const [scope, setScope] = useState<string>(moduleId ?? "");
  const [suites, setSuites] = useState<Suite[]>(["ui", "visual", "api", "ai"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scoped = scope ? modules.filter((m) => m.id === scope) : modules;

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const run = await api<{ id: string }>(`/projects/${project.id}/runs`, { body: { suites, moduleId: scope || null } });
      router.push(`/runs/${run.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Run QA">
      <div className="space-y-6">
        <Field label="What to test">
          <Select value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="">Whole product{modules.length ? ` — all ${modules.length} module${modules.length === 1 ? "" : "s"}` : " — AI finds the pages"}</option>
            {modules.map((m) => (
              <option key={m.id} value={m.id}>
                {m.mvp ? `${m.mvp}: ` : ""}
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
        <div>
          <div className="mb-2 text-[14px] font-medium">Checks to run</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {SUITES.map((s) => {
              const on = suites.includes(s.id);
              const warn = readiness(s.id, project, scoped);
              const Icon = ICON[s.id];
              return (
                <button
                  type="button"
                  key={s.id}
                  aria-pressed={on}
                  onClick={() => setSuites(on ? suites.filter((x) => x !== s.id) : [...suites, s.id])}
                  className={cx(
                    "relative flex flex-col items-start rounded-[16px] border p-4 text-left transition-colors",
                    on ? "border-ink bg-panel shadow-[inset_0_0_0_1px_var(--color-ink)]" : "border-line bg-soft text-mute hover:border-[#cbcfc4]",
                  )}
                >
                  <span className={cx("absolute top-3 right-3 grid size-5 place-items-center rounded-full border", on ? "border-ink bg-ink text-white" : "border-[#cbcfc4]")}>
                    {on && <Check size={12} strokeWidth={3} />}
                  </span>
                  <span className={cx("grid size-8 place-items-center rounded-[10px]", !on ? "bg-soft text-faint" : s.id === "ai" ? "bg-ai-wash text-ai" : "bg-signal-wash text-signal-ink")}><Icon size={17} /></span>
                  <span className={cx("display mt-3 text-[16px] font-bold tracking-[-0.01em]", on ? "text-ink" : "text-mute")}>{s.label}</span>
                  <span className="mt-0.5 text-[14.5px] leading-snug text-mute">{s.hint}</span>
                  {on && warn && <span className="mt-2 text-[13px] leading-snug text-faint">Optional: nothing to compare yet. To use it, {warn}.</span>}
                </button>
              );
            })}
          </div>
        </div>
        <ErrorNote error={error} />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[14.5px] text-mute">Results stream in live. The report saves when the run ends.</span>
          <div className="flex gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={start} loading={busy} disabled={!suites.length}>
              <Play size={15} /> Start run
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
