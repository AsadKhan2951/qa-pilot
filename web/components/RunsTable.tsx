"use client";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { RunRow } from "@/lib/types";
import { SUITES } from "@/lib/types";
import { Gauge, Panel, SEV_LABEL, StatusBadge, cx, sevBg, timeAgo } from "./ui";

const SEVS = ["critical", "high", "medium", "low"] as const;

/** Proportional severity strip + counts — reads like an instrument, not a list of chips. */
export function SeverityStrip({ counts, className }: { counts?: Record<string, number>; className?: string }) {
  const total = SEVS.reduce((s, k) => s + (counts?.[k] ?? 0), 0);
  if (!total) return <span className={cx("text-[13px] text-clear", className)}>No issues</span>;
  return (
    <div className={cx("min-w-0", className)}>
      <div className="flex h-2 w-full max-w-[180px] gap-[2px] overflow-hidden rounded-full bg-[#e7e9e2]">
        {SEVS.map((s) => (counts?.[s] ? <span key={s} className={sevBg(s)} style={{ width: `${((counts[s] ?? 0) / total) * 100}%` }} /> : null))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 text-[12.5px] text-mute">
        {SEVS.map((s) =>
          counts?.[s] ? (
            <span key={s} className="tnum">
              <b className="font-semibold text-ink">{counts[s]}</b> {SEV_LABEL[s].toLowerCase()}
            </span>
          ) : null,
        )}
      </div>
    </div>
  );
}

export function RunsTable({ runs }: { runs: RunRow[] }) {
  return (
    <Panel className="overflow-hidden">
      <div className="label hidden grid-cols-[150px_minmax(0,1fr)_minmax(0,1.1fr)_130px_110px_20px] gap-4 border-b border-line px-6 py-3 text-faint lg:grid">
        <span>Result</span>
        <span>What was tested</span>
        <span>Issues</span>
        <span>Health</span>
        <span>When</span>
        <span />
      </div>
      <div className="divide-y divide-line">
        {runs.map((r) => {
          const running = r.status === "running" || r.status === "queued";
          return (
            <Link
              key={r.id}
              href={`/runs/${r.id}`}
              className={cx(
                "group grid items-center gap-3 px-6 py-4 transition-colors hover:bg-soft lg:grid-cols-[150px_minmax(0,1fr)_minmax(0,1.1fr)_130px_110px_20px] lg:gap-4",
                running && "running-sweep",
              )}
            >
              <StatusBadge s={r.status} />
              <div className="min-w-0">
                <div className="truncate text-[14px] font-medium">{r.moduleName ?? "Whole product"}</div>
                <div className="truncate text-[12.5px] text-mute">{r.suites.map((s) => SUITES.find((x) => x.id === s)?.label).join(", ")}</div>
              </div>
              {running ? <span className="text-[13px] text-signal-ink">Testing…</span> : <SeverityStrip counts={r.stats.bySeverity} />}
              <Gauge score={r.healthScore} size="sm" />
              <div className="text-[13px] text-mute">
                <div>{timeAgo(r.createdAt)}</div>
                <div className="text-[12px] text-faint capitalize">{r.trigger === "webhook" ? "From CI" : r.trigger}</div>
              </div>
              <ChevronRight size={16} className="hidden text-faint group-hover:text-ink lg:block" />
            </Link>
          );
        })}
      </div>
    </Panel>
  );
}
