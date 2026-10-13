"use client";
import { X } from "lucide-react";
import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "signal";
export function Button({
  variant = "secondary",
  size = "md",
  className,
  loading,
  children,
  ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: "sm" | "md"; loading?: boolean }) {
  return (
    <button
      {...p}
      disabled={p.disabled || loading}
      className={cx(
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full font-semibold whitespace-nowrap transition-[filter,background-color,border-color,color] disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-8 px-3.5 text-[13px]" : "h-10 px-5 text-[14px]",
        variant === "primary" && "grad text-ink hover:brightness-105 active:brightness-95",
        variant === "signal" && "bg-ink text-white hover:bg-deck-2",
        variant === "secondary" && "border border-line bg-panel text-ink hover:border-[#cbcfc4] hover:bg-soft",
        variant === "ghost" && "text-mute hover:bg-ink/5 hover:text-ink",
        variant === "danger" && "border border-[#f3c4cb] bg-panel text-fault hover:bg-fault-wash",
        className,
      )}
    >
      {loading && <span className="size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" />}
      {children}
    </button>
  );
}

const field =
  "w-full rounded-[14px] border border-line bg-panel px-3.5 py-2.5 text-[14px] text-ink outline-none transition-[border,box-shadow] placeholder:text-faint hover:border-[#cbcfc4] focus:border-signal focus:shadow-[0_0_0_4px_rgba(255,75,31,.14)]";

export function Input(p: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={cx(field, "h-11", p.className)} />;
}

export function Textarea(p: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...p} className={cx(field, "min-h-24 leading-relaxed", p.className)} />;
}

export function Select(p: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} className={cx(field, "h-11 py-0 pr-8", p.className)} />;
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1.5 block text-[13px] font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-[12.5px] leading-snug text-mute">{hint}</span>}
    </label>
  );
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("rounded-[18px] border border-line bg-panel", className)}>{children}</div>;
}
/** @deprecated use Panel */
export const Card = Panel;

export function SectionTitle({ title, desc, action }: { title: string; desc?: string; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4">
      <div>
        <h2 className="text-[18px] font-bold tracking-[-0.02em]">{title}</h2>
        {desc && <p className="mt-0.5 max-w-[68ch] text-[13px] text-mute">{desc}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, meta }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; meta?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        {meta && <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px] text-mute">{meta}</div>}
        <h1 className="text-[34px] leading-[1.05] font-extrabold tracking-[-0.035em] text-ink">{title}</h1>
        {subtitle && <div className="mt-1.5 max-w-[70ch] text-[14px] text-mute">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export const SEV_LABEL: Record<string, string> = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };
const SEV_COLOR: Record<string, string> = {
  critical: "text-sev-critical",
  high: "text-sev-high",
  medium: "text-sev-medium",
  low: "text-sev-low",
};
const SEV_BG: Record<string, string> = {
  critical: "bg-sev-critical",
  high: "bg-sev-high",
  medium: "bg-sev-medium",
  low: "bg-sev-low",
};
export const sevBg = (s: string) => SEV_BG[s] ?? "bg-faint";

export function SeverityBadge({ s }: { s: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 text-[12.5px] font-semibold", SEV_COLOR[s])}>
      <span className={cx("size-2 rounded-[2px]", SEV_BG[s])} />
      {SEV_LABEL[s] ?? s}
    </span>
  );
}

const STATUS: Record<string, [string, string]> = {
  queued: ["Queued", "bg-soft text-mute border-line"],
  running: ["Running", "bg-signal-wash text-signal-ink border-[#ffd0bf]"],
  passed: ["Passed", "bg-clear-wash text-clear border-[#bfe3cf]"],
  failed: ["Issues found", "bg-fault-wash text-fault border-[#f3c4cb]"],
  error: ["Error", "bg-fault-wash text-fault border-[#f3c4cb]"],
  cancelled: ["Stopped", "bg-soft text-mute border-line"],
};
export function StatusBadge({ s }: { s: string }) {
  const [label, cls] = STATUS[s] ?? [s, "bg-soft text-mute border-line"];
  return (
    <span className={cx("inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-semibold", cls)}>
      {s === "running" && <span className="size-1.5 animate-pulse rounded-full bg-signal" />}
      {label}
    </span>
  );
}

export function Tag({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx("inline-flex items-center gap-1 rounded-full border border-line bg-soft px-2 py-0.5 text-[12px] text-mute", className)}>{children}</span>;
}

/** Instrument-style health gauge: tabular number + 10 tick segments. */
export function Gauge({ score, size = "md", tone = "light" }: { score: number | null | undefined; size?: "sm" | "md" | "lg"; tone?: "light" | "dark" }) {
  if (score === null || score === undefined) return <span className={cx("text-[13px]", tone === "dark" ? "text-[#8a9186]" : "text-faint")}>Not run</span>;
  const band = score >= 85 ? 0 : score >= 60 ? 1 : 2;
  const fill = tone === "dark" ? ["bg-[#4cc796]", "bg-signal-2", "bg-signal"][band] : ["bg-clear", "bg-signal-2", "bg-signal"][band];
  const text = tone === "dark" ? ["text-[#7ddbb2]", "text-signal-2", "text-signal"][band] : ["text-clear", "text-signal-ink", "text-signal-ink"][band];
  const empty = tone === "dark" ? "bg-deck-line" : "bg-[#e2e4dc]";
  const filled = Math.max(score > 0 ? 1 : 0, Math.round(score / 10));
  const dims = {
    sm: { num: "text-[14px] min-w-[1.6em]", tick: "h-3 w-[3px]", gap: "gap-[2px]" },
    md: { num: "text-[18px] min-w-[1.6em]", tick: "h-4 w-1", gap: "gap-[3px]" },
    lg: { num: "text-[56px] leading-none", tick: "h-9 w-[6px]", gap: "gap-[5px]" },
  }[size];
  return (
    <div className={cx("flex items-center", size === "lg" ? "gap-4" : "gap-2")} title={`Health ${score} out of 100`}>
      <span className={cx("display tnum font-extrabold tracking-[-0.03em]", dims.num, text)}>{score}</span>
      <span className={cx("flex items-end", dims.gap)} aria-hidden>
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i} className={cx("rounded-[1.5px]", dims.tick, i < filled ? fill : empty)} />
        ))}
      </span>
    </div>
  );
}
/** @deprecated use Gauge */
export function HealthScore({ score }: { score: number | null | undefined; size?: number }) {
  return <Gauge score={score} size="sm" />;
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", h);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-deck/45 p-4 pt-[7vh]" onMouseDown={onClose} role="dialog" aria-modal>
      <div
        className={cx("w-full rounded-[22px] border border-line bg-panel shadow-[0_30px_80px_-24px_rgba(16,20,15,.45)]", wide ? "max-w-3xl" : "max-w-lg")}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-7 pt-6 pb-1">
          <h3 className="text-[20px] font-bold tracking-[-0.02em]">{title}</h3>
          <button onClick={onClose} className="rounded-md p-1 text-mute hover:bg-soft hover:text-ink" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="px-7 pt-3 pb-7">{children}</div>
      </div>
    </div>
  );
}

export function Empty({ icon, title, desc, action }: { icon?: ReactNode; title: string; desc?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start gap-4 rounded-[18px] border border-dashed border-[#cdd1c6] bg-panel/70 px-7 py-9">
      {icon && <div className="grid size-11 shrink-0 place-items-center rounded-[14px] bg-signal-wash text-signal-ink">{icon}</div>}
      <div className="min-w-0">
        <div className="display text-[18px] font-bold tracking-[-0.02em]">{title}</div>
        {desc && <p className="mt-1 max-w-[60ch] text-[13.5px] text-mute">{desc}</p>}
        {action && <div className="mt-4">{action}</div>}
      </div>
    </div>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="rounded-[12px] border border-[#f3c4cb] bg-fault-wash px-3.5 py-2.5 text-[13px] text-fault">{error}</div>;
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode; count?: number }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="mb-6 flex gap-6 border-b border-line" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cx(
            "relative -mb-px flex items-center gap-2 pb-2.5 text-[14px] font-medium transition-colors",
            value === t.id ? "text-ink" : "text-mute hover:text-ink",
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="tnum rounded-full bg-[#e7e9e2] px-1.5 text-[11.5px] text-mute">{t.count}</span>}
          {value === t.id && <span className="grad absolute inset-x-0 -bottom-px h-[3px] rounded-full" />}
        </button>
      ))}
    </div>
  );
}

export function Spinner() {
  return (
    <div className="flex justify-center py-16">
      <span className="size-6 animate-spin rounded-full border-2 border-signal border-r-transparent" />
    </div>
  );
}

export function timeAgo(iso: string | null | undefined) {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
