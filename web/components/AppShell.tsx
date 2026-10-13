"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, LogOut, Menu, Plus, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { api, useApi } from "@/lib/api";
import type { Project, Workspace } from "@/lib/types";
import { cx } from "./ui";

export type Crumb = { label: string; href?: string };

/** Mark: an attitude indicator whose horizon line is a check. */
export function Mark({ size = 28, tone = "dark" }: { size?: number; tone?: "dark" | "light" }) {
  const ring = "#ff4b1f";
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <circle cx="16" cy="16" r="13.5" stroke={ring} strokeWidth="2.5" />
      <path d="M3.5 17.5h5.5l4 4.5 9-11h6.5" stroke={tone === "dark" ? "#ffffff" : "#10140f"} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ tone = "dark" }: { tone?: "dark" | "light" }) {
  return (
    <span className="flex items-center gap-2.5">
      <Mark tone={tone} />
      <span className={cx("display text-[19px] font-extrabold tracking-[-0.04em]", tone === "dark" ? "text-white" : "text-ink")}>QA Pilot</span>
    </span>
  );
}

function initials(name?: string) {
  return (name ?? "")
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function AppShell({ workspaceId, projectId, crumbs, children }: { workspaceId?: string; projectId?: string; crumbs?: Crumb[]; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => setNavOpen(false), [pathname]);
  const me = useApi<{ name: string; email: string }>("/auth/me");
  const workspaces = useApi<Workspace[]>("/workspaces");
  const projects = useApi<Project[]>(workspaceId ? `/workspaces/${workspaceId}/projects` : null);

  async function logout() {
    await api("/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <div className="flex min-h-screen">
      {navOpen && <div className="fixed inset-0 z-40 bg-deck/50 md:hidden" onClick={() => setNavOpen(false)} aria-hidden />}
      <aside
        className={cx(
          "deck fixed inset-y-0 left-0 z-50 flex h-screen w-[272px] shrink-0 flex-col bg-deck text-deck-text transition-transform md:sticky md:top-0 md:z-auto md:w-[248px] md:translate-x-0",
          navOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <button onClick={() => setNavOpen(false)} className="absolute top-5 right-4 rounded-full p-1.5 text-deck-text hover:bg-deck-2 md:hidden" aria-label="Close menu">
          <X size={18} />
        </button>
        <div className="px-5 pt-5 pb-6">
          <Link href="/workspaces" className="inline-block rounded-md">
            <Logo />
          </Link>
        </div>

        <nav className="scroll-thin flex-1 overflow-y-auto px-3 pb-4" aria-label="Workspaces">
          <div className="label mb-2 px-2 text-[#7b8377]">Workspaces</div>
          {workspaces.data?.map((w) => {
            const open = w.id === workspaceId;
            return (
              <div key={w.id} className="mb-0.5">
                <Link
                  href={`/w/${w.id}`}
                  className={cx(
                    "group flex items-center gap-2.5 rounded-[12px] px-2 py-2 text-[14px] transition-colors",
                    open ? "text-white" : "hover:bg-deck-2 hover:text-white",
                    open && !projectId && "bg-deck-2",
                  )}
                >
                  <span
                    className={cx(
                      "grid size-7 shrink-0 place-items-center rounded-[9px] text-[11px] font-bold",
                      open ? "grad text-ink" : "bg-deck-2 text-deck-text group-hover:bg-deck-line",
                    )}
                  >
                    {initials(w.name) || "W"}
                  </span>
                  <span className="truncate">{w.name}</span>
                </Link>
                {open && (
                  <div className="mt-1 mb-2 ml-[21px] border-l border-deck-line pl-2">
                    {projects.data?.map((p) => {
                      const active = p.id === projectId;
                      return (
                        <Link
                          key={p.id}
                          href={`/w/${w.id}/p/${p.id}`}
                          className={cx(
                            "relative flex items-center justify-between gap-2 rounded-[10px] px-2.5 py-1.5 text-[13.5px] transition-colors",
                            active ? "bg-deck-2 text-white" : "hover:bg-deck-2/70 hover:text-white",
                          )}
                        >
                          {active && <span className="absolute top-1.5 bottom-1.5 -left-[9px] w-[2px] rounded-full bg-signal" />}
                          <span className="truncate">{p.name}</span>
                          {p.lastRun?.healthScore != null && (
                            <span
                              className={cx(
                                "tnum text-[11.5px]",
                                p.lastRun.healthScore >= 85 ? "text-[#7ddbb2]" : p.lastRun.healthScore >= 60 ? "text-signal" : "text-[#ff8f72]",
                              )}
                            >
                              {p.lastRun.healthScore}
                            </span>
                          )}
                        </Link>
                      );
                    })}
                    <Link href={`/w/${w.id}?new=1`} className="flex items-center gap-1.5 rounded-[6px] px-2 py-1.5 text-[13px] text-[#8a9186] hover:bg-deck-2/70 hover:text-white">
                      <Plus size={13} /> Add project
                    </Link>
                  </div>
                )}
              </div>
            );
          })}
          <Link href="/workspaces?new=1" className="mt-2 flex items-center gap-2.5 rounded-[7px] px-2 py-1.5 text-[13.5px] text-[#8a9186] hover:bg-deck-2 hover:text-white">
            <span className="grid size-7 place-items-center rounded-[9px] border border-dashed border-deck-line">
              <Plus size={13} />
            </span>
            New workspace
          </Link>
        </nav>

        <div className="m-3 flex items-center gap-2.5 rounded-[16px] bg-deck-2 px-3 py-3">
          <div className="grid size-8 shrink-0 place-items-center rounded-full bg-[#2b3328] text-[12px] font-semibold text-white">{initials(me.data?.name) || "·"}</div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium text-white">{me.data?.name}</div>
            <div className="truncate text-[12px] text-[#8a9186]">{me.data?.email}</div>
          </div>
          <button onClick={logout} className="rounded-md p-1.5 text-[#8a9186] hover:bg-deck-line hover:text-white" title="Sign out" aria-label="Sign out">
            <LogOut size={15} />
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <header className="flex h-14 items-center gap-3 px-6 md:px-10">
          <button onClick={() => setNavOpen(true)} className="-ml-2 rounded-full p-2 text-ink hover:bg-soft md:hidden" aria-label="Open menu">
            <Menu size={20} />
          </button>
          <Link href="/workspaces" className="md:hidden">
            <Mark tone="light" size={24} />
          </Link>
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[13px] text-mute">
            {crumbs?.map((c, i) => (
              <span key={i} className="flex min-w-0 items-center gap-1.5">
                {i > 0 && <ChevronRight size={13} className="shrink-0 text-faint" />}
                {c.href ? (
                  <Link href={c.href} className="truncate hover:text-ink">
                    {c.label}
                  </Link>
                ) : (
                  <span className="truncate font-medium text-ink">{c.label}</span>
                )}
              </span>
            ))}
          </nav>
        </header>
        <div className="mx-auto max-w-[1180px] px-6 pt-4 pb-16 md:px-10">{children}</div>
      </main>
    </div>
  );
}
