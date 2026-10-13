"use client";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Bug as BugIcon, Download, ExternalLink, Globe, MonitorPlay, PenTool, Server, Square, X } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button, Empty, ErrorNote, Gauge, PageHeader, Panel, SEV_LABEL, SeverityBadge, Spinner, StatusBadge, Tag, cx, sevBg, timeAgo } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import type { Bug, Run, RunEvent } from "@/lib/types";
import { SUITES } from "@/lib/types";

const SUITE_ICON = { ui: Globe, visual: PenTool, api: Server, ai: Bot } as const;
const SEVS = ["critical", "high", "medium", "low"] as const;
const LEVEL: Record<string, string> = { info: "text-[#c9cfc3]", warn: "text-[#ffb08f]", error: "text-[#ff8f72]", success: "text-[#7ddbb2]" };
const BUG_STATUS: Record<Bug["status"], string> = { open: "Open", fixed: "Fixed", wontfix: "Won't fix", duplicate: "Duplicate" };

function shortUrl(u: string) {
  try {
    const x = new URL(u);
    return x.pathname + x.search;
  } catch {
    return u;
  }
}

export default function RunPage() {
  const { rid } = useParams<{ rid: string }>();
  const [live, setLive] = useState(true);
  const run = useApi<Run>(`/runs/${rid}`, live ? 3000 : undefined);
  const bugs = useApi<Bug[]>(`/runs/${rid}/bugs`, live ? 4000 : undefined);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [sev, setSev] = useState<string>("all");
  const [suite, setSuite] = useState<string>("all");
  const [selected, setSelected] = useState<Bug | null>(null);
  const [view, setView] = useState<"live" | "bugs" | "log">("bugs");
  const [watchedRunning, setWatchedRunning] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  const running = run.data ? ["queued", "running"].includes(run.data.status) : false;
  useEffect(() => {
    if (run.data && !running) {
      bugs.reload();
      setLive(false);
    }
  }, [running, run.data]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let stop = false;
    let after = 0;
    async function tick() {
      try {
        const rows = await api<RunEvent[]>(`/runs/${rid}/events?after=${after}`);
        if (rows.length && !stop) {
          after = rows[rows.length - 1].seq;
          setEvents((prev) => [...prev, ...rows.filter((r) => !prev.some((p) => p.id === r.id))]);
        }
      } catch {
        /* ignore */
      }
    }
    tick();
    const id = setInterval(() => live && tick(), 2000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [rid, live]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [events.length, view]);

  useEffect(() => {
    // Open the live view automatically while a run is in progress
    if (running && !watchedRunning) {
      setView("live");
      setWatchedRunning(true);
    }
  }, [running, bugs.data]);

  useEffect(() => {
    if (!selected) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && setSelected(null);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [selected]);

  const filtered = useMemo(
    () => (bugs.data ?? []).filter((b) => (sev === "all" || b.severity === sev) && (suite === "all" || b.suite === suite)),
    [bugs.data, sev, suite],
  );

  if (!run.data) {
    return <AppShell>{run.error ? <ErrorNote error={run.error} /> : <Spinner />}</AppShell>;
  }
  const r = run.data;
  const all = bugs.data ?? [];
  const counts = Object.fromEntries(SEVS.map((s) => [s, all.filter((b) => b.severity === s).length])) as Record<string, number>;
  const duration = r.startedAt ? Math.round(((r.finishedAt ? new Date(r.finishedAt) : new Date()).getTime() - new Date(r.startedAt).getTime()) / 1000) : 0;
  const blocking = counts.critical + counts.high;
  const suitesInRun = SUITES.filter((s) => r.suites.includes(s.id));

  const verdict = running
    ? { title: "Testing in progress", sub: "Bugs appear below as soon as they're found.", tone: "running" as const }
    : r.status === "error"
      ? { title: "Run didn't finish", sub: r.error || "The worker stopped before the end. Results so far are below.", tone: "hold" as const }
      : r.status === "cancelled"
        ? { title: "Run stopped", sub: "Stopped before all checks finished. Results so far are below.", tone: "neutral" as const }
        : blocking
          ? {
              title: "Hold release",
              sub: `${[counts.critical && `${counts.critical} critical`, counts.high && `${counts.high} high`].filter(Boolean).join(" and ")} ${blocking === 1 ? "issue needs" : "issues need"} fixing first.`,
              tone: "hold" as const,
            }
          : { title: "Cleared for release", sub: all.length ? `No blocking issues. ${all.length} smaller ${all.length === 1 ? "issue" : "issues"} to look at.` : "Every check passed.", tone: "clear" as const };

  async function setBugStatus(b: Bug, status: Bug["status"]) {
    await api(`/bugs/${b.id}`, { method: "PATCH", body: { status } });
    setSelected({ ...b, status });
    bugs.reload();
  }

  const minutes = Math.floor(duration / 60);
  const durationLabel = minutes ? `${minutes} min ${duration % 60} s` : `${duration} s`;

  return (
    <AppShell
      workspaceId={r.project.workspaceId}
      projectId={r.project.id}
      crumbs={[
        { label: "Products", href: `/w/${r.project.workspaceId}` },
        { label: r.project.name, href: `/w/${r.project.workspaceId}/p/${r.project.id}?tab=runs` },
        { label: "Run" },
      ]}
    >
      <PageHeader
        meta={
          <>
            <StatusBadge s={r.status} />
            <span>
              Started {timeAgo(r.startedAt ?? r.createdAt)}
              {r.trigger === "webhook" ? " from CI" : r.trigger === "schedule" ? " on schedule" : ""}, took {durationLabel}
            </span>
          </>
        }
        title={r.module ? `${r.module.name}` : `${r.project.name}, whole product`}
        subtitle={suitesInRun.map((s) => s.label).join(", ")}
        actions={
          <>
            {running && (
              <Button
                variant="danger"
                onClick={async () => {
                  await api(`/runs/${rid}/cancel`, { method: "POST" });
                  run.reload();
                }}
              >
                <Square size={13} /> Stop run
              </Button>
            )}
            {r.report && (
              <>
                <a href={r.report.html} target="_blank" rel="noreferrer">
                  <Button>
                    <ExternalLink size={15} /> View report
                  </Button>
                </a>
                {r.report.pdf && (
                  <a href={r.report.pdf}>
                    <Button variant="primary">
                      <Download size={15} /> Download PDF
                    </Button>
                  </a>
                )}
              </>
            )}
          </>
        }
      />

      {/* Verdict band — the one loud element on the page */}
      <section
        className={cx("relative mb-8 overflow-hidden rounded-[24px] bg-deck text-white", verdict.tone === "running" && "running-sweep")}
        aria-live="polite"
      >
        <div className="pointer-events-none absolute -top-32 -right-20 size-[420px] rounded-full bg-signal/15 blur-[110px]" aria-hidden />
        <div className="relative grid gap-6 p-7 md:grid-cols-[minmax(0,1.3fr)_auto] md:items-center md:p-9">
          <div className="flex items-start gap-4">
            <span
              className={cx(
                "mt-4 size-3.5 shrink-0 rounded-full",
                verdict.tone === "clear" && "bg-[#4cc796] shadow-[0_0_0_6px_rgba(76,199,150,.18)]",
                verdict.tone === "hold" && "grad shadow-[0_0_0_6px_rgba(255,75,31,.2)]",
                verdict.tone === "running" && "animate-pulse bg-signal",
                verdict.tone === "neutral" && "bg-[#8a9186]",
              )}
            />
            <div>
              <h2 className={cx("text-[44px] leading-[1.02] font-bold tracking-[-0.04em]", verdict.tone === "hold" && "grad-text")}>{verdict.title}</h2>
              <p className="mt-2 max-w-[56ch] text-[15px] text-deck-text">{verdict.sub}</p>
            </div>
          </div>
          <div className="md:justify-self-end md:text-right">
            <div className="label mb-2 text-[#7b8377]">Health score</div>
            {r.healthScore == null && running ? <span className="text-[14px] text-signal">Calculating…</span> : <Gauge score={r.healthScore} size="lg" tone="dark" />}
          </div>
        </div>
        <div className="relative grid grid-cols-2 border-t border-deck-line sm:grid-cols-4">
          {SEVS.map((s, i) => (
            <button
              key={s}
              onClick={() => {
                setSev(sev === s ? "all" : s);
                setView("bugs");
              }}
              aria-pressed={sev === s}
              className={cx(
                "group flex items-center justify-between gap-3 px-7 py-5 text-left transition-colors hover:bg-deck-2",
                i > 0 && "sm:border-l sm:border-deck-line",
                i % 2 === 1 && "border-l border-deck-line",
                i > 1 && "border-t border-deck-line sm:border-t-0",
                sev === s && "bg-deck-2",
              )}
            >
              <span className="flex items-center gap-2 text-[14.5px] text-deck-text group-hover:text-white">
                <span className={cx("size-2.5 rounded-full", sevBg(s))} />
                {SEV_LABEL[s]}
              </span>
              <span className={cx("display tnum text-[30px] font-bold", counts[s] ? "text-white" : "text-[#4a5346]")}>{counts[s]}</span>
            </button>
          ))}
        </div>
      </section>

      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex rounded-full border border-line bg-panel p-1" role="tablist">
          {(["live", "bugs", "log"] as const).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={cx("rounded-full px-3.5 py-1.5 text-[14px] font-semibold transition-colors", view === v ? "bg-ink text-white" : "text-mute hover:text-ink")}
            >
              {v === "live" ? (
                <span className="inline-flex items-center gap-1.5">
                  {running && <span className="size-1.5 animate-pulse rounded-full bg-signal" />}
                  Live view
                </span>
              ) : v === "bugs" ? (
                `Issues (${all.length})`
              ) : (
                "Log"
              )}
            </button>
          ))}
        </div>
        {view === "bugs" && (
          <div className="flex flex-wrap items-center gap-1.5">
            {[{ id: "all", label: "All checks" }, ...suitesInRun].map((s) => (
              <button
                key={s.id}
                onClick={() => setSuite(s.id)}
                aria-pressed={suite === s.id}
                className={cx(
                  "rounded-full border px-3 py-1 text-[14px] transition-colors",
                  suite === s.id ? "border-ink bg-ink text-white" : "border-line bg-panel text-mute hover:text-ink",
                )}
              >
                {s.label}
              </button>
            ))}
            {sev !== "all" && (
              <button onClick={() => setSev("all")} className="ml-1 inline-flex items-center gap-1 rounded-full bg-signal-wash px-2.5 py-1 text-[14px] text-signal-ink">
                {SEV_LABEL[sev]} only <X size={12} />
              </button>
            )}
          </div>
        )}
        <div className="ml-auto text-[14.5px] text-mute">
          <span className="tnum">{r.stats.pagesTested ?? 0}</span> pages, <span className="tnum">{r.stats.apiCalls ?? 0}</span> API calls,{" "}
          <span className="tnum">
            {r.stats.evalsPassed ?? 0} of {r.stats.evalsRun ?? 0}
          </span>{" "}
          AI evals passed
        </div>
      </div>

      {view === "live" ? (
        <LiveView runId={rid} running={running} />
      ) : view === "log" ? (
        <div ref={logRef} className="deck scroll-thin h-[58vh] overflow-y-auto rounded-[20px] bg-deck p-6 font-mono text-[14.5px] leading-[1.75]">
          {events.map((e) => (
            <div key={e.id} className={cx("grid grid-cols-[76px_1fr] gap-3", LEVEL[e.level])}>
              <span className="tnum text-[#5f675b]">{new Date(e.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
              <span className="break-words">{e.message}</span>
            </div>
          ))}
          {running && <div className="mt-1 animate-pulse text-signal">▍</div>}
        </div>
      ) : !filtered.length ? (
        running ? (
          <Empty icon={<span className="block size-5 animate-spin rounded-full border-2 border-signal border-r-transparent" />} title="Testing…" desc="Issues show up here the moment they're found." />
        ) : (
          <Empty icon={<BugIcon size={20} />} title={all.length ? "Nothing matches these filters" : r.status === "cancelled" ? "Run stopped before finding anything" : r.status === "error" ? "Run didn't finish" : "No issues found"}
            desc={all.length ? "Clear the filters to see every issue." : r.status === "cancelled" ? "Start a new run to test this module." : r.status === "error" ? "Open the Log tab to see what went wrong." : "Every check in this run passed."}
          />
        )
      ) : (
        <Panel className="divide-y divide-line overflow-hidden">
          {filtered.map((b) => {
            const Icon = SUITE_ICON[b.suite] ?? Globe;
            return (
              <button
                key={b.id}
                onClick={() => setSelected(b)}
                className={cx(
                  "group relative grid w-full grid-cols-[112px_minmax(0,1fr)] items-center gap-4 py-3.5 pr-6 pl-6 text-left transition-colors hover:bg-soft sm:grid-cols-[112px_minmax(0,1fr)_110px]",
                  selected?.id === b.id && "bg-soft",
                  b.status !== "open" && "opacity-55",
                )}
              >
                <span className={cx("absolute top-3 bottom-3 left-2 w-[3px] rounded-full", sevBg(b.severity))} aria-hidden />
                <span className="h-[70px] w-[112px] overflow-hidden rounded-[10px] border border-line bg-soft">
                  {b.screenshotUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={b.screenshotUrl} alt="" className="h-full w-full object-cover object-top" loading="lazy" />
                  ) : (
                    <span className="grid h-full place-items-center text-faint">
                      <Icon size={18} />
                    </span>
                  )}
                </span>
                <span className="min-w-0">
                  <span className="line-clamp-2 text-[14px] leading-snug font-medium text-ink">{b.title}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[14.5px] text-mute">
                    <SeverityBadge s={b.severity} />
                    <span className="inline-flex items-center gap-1">
                      <Icon size={12} /> {b.category}
                    </span>
                    <span>{b.moduleName ?? "General"}</span>
                    {b.url && <span className="max-w-[260px] truncate font-mono text-[11.5px] text-faint">{shortUrl(b.url)}</span>}
                  </span>
                </span>
                <span className="hidden justify-self-end text-[14.5px] text-mute sm:block">{BUG_STATUS[b.status]}</span>
              </button>
            );
          })}
        </Panel>
      )}

      {/* Bug drawer */}
      {selected && (
        <div className="fixed inset-0 z-40" role="dialog" aria-modal aria-label="Issue details">
          <div className="absolute inset-0 bg-deck/40" onClick={() => setSelected(null)} />
          <aside className="absolute top-2 right-2 bottom-2 flex w-[calc(100%-16px)] max-w-[640px] flex-col overflow-hidden rounded-[22px] bg-panel shadow-[-24px_0_80px_-30px_rgba(16,20,15,.55)]">
            <div className="flex items-start gap-3 border-b border-line px-6 py-5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityBadge s={selected.severity} />
                  <Tag>{SUITES.find((s) => s.id === selected.suite)?.label}</Tag>
                  <Tag>{selected.category}</Tag>
                  <Tag>{selected.moduleName ?? "General"}</Tag>
                </div>
                <h3 className="mt-3 text-[22px] leading-[1.15] font-bold tracking-[-0.025em]">{selected.title}</h3>
                {selected.url && (
                  <a href={selected.url} target="_blank" rel="noreferrer" className="mt-1 block truncate font-mono text-[12px] text-mute hover:text-ink">
                    {selected.url}
                  </a>
                )}
              </div>
              <button onClick={() => setSelected(null)} className="rounded-md p-1.5 text-mute hover:bg-soft hover:text-ink" aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <div className="scroll-thin flex-1 space-y-5 overflow-y-auto px-6 py-5">
              {selected.screenshotUrl && (
                <a href={selected.screenshotUrl} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-[14px] border border-line bg-soft">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={selected.screenshotUrl} alt="Screenshot of the issue" className="w-full" />
                </a>
              )}
              {selected.description && <p className="text-[14px] leading-relaxed whitespace-pre-wrap">{selected.description}</p>}
              {(
                [
                  ["How to reproduce", selected.steps, ""],
                  ["Expected", selected.expected, "border-l-clear"],
                  ["What happened", selected.actual, "border-l-fault"],
                ] as const
              )
                .filter(([, v]) => v)
                .map(([k, v, accent]) => (
                  <div key={k}>
                    <div className="mb-1.5 text-[14px] font-semibold">{k}</div>
                    <pre className={cx("scroll-thin max-h-64 overflow-auto rounded-[12px] border-l-[3px] bg-soft p-3.5 font-mono text-[12px] leading-relaxed break-words whitespace-pre-wrap", accent || "border-l-line")}>{v}</pre>
                  </div>
                ))}
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-line bg-soft px-6 py-4">
              <span className="mr-1 text-[14px] text-mute">Status</span>
              {(["open", "fixed", "wontfix", "duplicate"] as const).map((s) => (
                <Button key={s} size="sm" variant={selected.status === s ? "primary" : "secondary"} onClick={() => setBugStatus(selected, s)}>
                  {BUG_STATUS[s]}
                </Button>
              ))}
            </div>
          </aside>
        </div>
      )}
    </AppShell>
  );
}


type Frame = { src: string; url: string; caption: string; at: string };

/** Side-by-side live screens: the product being tested and the reference it is compared with. */
function LiveView({ runId, running }: { runId: string; running: boolean }) {
  const [frames, setFrames] = useState<Partial<Record<"app" | "reference", Frame>>>({});
  useEffect(() => {
    let stop = false;
    async function tick() {
      try {
        const f = await api<Partial<Record<"app" | "reference", Frame>>>(`/runs/${runId}/live`);
        if (!stop) setFrames(f);
      } catch {
        /* ignore */
      }
    }
    tick();
    if (!running) return () => void (stop = true);
    const id = setInterval(tick, 1500);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [runId, running]);

  const panels: { key: "app" | "reference"; title: string; empty: string }[] = [
    { key: "app", title: "Your app", empty: running ? "Starting the browser…" : "No live frames were recorded for this run." },
    { key: "reference", title: "Reference", empty: "Shows here when the run compares a page with your reference site or Figma." },
  ];
  const showRef = Boolean(frames.reference);
  return (
    <div className={cx("grid gap-4", showRef && "xl:grid-cols-2")}>
      {panels
        .filter((p) => p.key === "app" || showRef)
        .map((p) => {
          const f = frames[p.key];
          const stale = f ? Date.now() - new Date(f.at).getTime() > 8000 : true;
          return (
            <div key={p.key} className="overflow-hidden rounded-[20px] border border-line bg-panel">
              <div className="flex items-center gap-3 border-b border-line px-4 py-3">
                <span className={cx("size-2 shrink-0 rounded-full", running && !stale ? "animate-pulse bg-signal" : "bg-[#cfd3c9]")} />
                <span className="display text-[16px] font-bold">{p.title}</span>
                {f?.url && (
                  <a href={f.url} target="_blank" rel="noreferrer" className="ml-auto min-w-0 truncate rounded-full bg-soft px-3 py-1 font-mono text-[12px] text-mute hover:text-ink">
                    {f.url}
                  </a>
                )}
              </div>
              <div className="relative aspect-[16/10] bg-soft">
                {f ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.src} alt={`${p.title} live screen`} className="absolute inset-0 h-full w-full object-contain object-top" />
                ) : (
                  <div className="absolute inset-0 grid place-items-center px-8 text-center text-[14.5px] text-mute">
                    <span className="flex items-center gap-2">
                      <MonitorPlay size={18} /> {p.empty}
                    </span>
                  </div>
                )}
              </div>
              {f?.caption && <div className="truncate border-t border-line px-4 py-2.5 text-[14px] text-mute">{f.caption}</div>}
            </div>
          );
        })}
    </div>
  );
}
