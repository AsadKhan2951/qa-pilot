"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Bot, Globe, PenTool, Server } from "lucide-react";
import { api } from "@/lib/api";
import { Logo } from "./AppShell";
import { Button, ErrorNote, Field, Input, cx } from "./ui";

/** Lines the ticker cycles through — what a real run reports, one check at a time. */
const TICKER: { ok: boolean; text: string }[] = [
  { ok: true, text: "/checkout loaded in 1.2 s" },
  { ok: false, text: "POST /api/orders returned 500" },
  { ok: true, text: "48 of 48 endpoints reject requests without a token" },
  { ok: false, text: "Revenue card shows “Rs NaN”" },
  { ok: true, text: "Login flow passed on mobile" },
  { ok: false, text: "Heading is 32px, Figma says 40px" },
  { ok: true, text: "AI reply stayed in Roman Urdu" },
  { ok: false, text: "Pay button hidden behind cookie bar at 390px" },
];

const CHECKS = [
  { icon: Globe, label: "Frontend" },
  { icon: PenTool, label: "Design match" },
  { icon: Server, label: "API" },
  { icon: Bot, label: "AI answers" },
];

/** A browser window being inspected: a scan line passes over a page and pins two issues. */
function InspectionWindow() {
  return (
    <div className="relative overflow-hidden rounded-[18px] bg-[#fbfbf8] shadow-[0_30px_80px_-30px_rgba(0,0,0,.7)]" aria-hidden>
      <div className="flex items-center gap-2 border-b border-[#e8e9e3] px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-[#e4e6df]" />
        <span className="size-2.5 rounded-full bg-[#e4e6df]" />
        <span className="size-2.5 rounded-full bg-[#e4e6df]" />
        <span className="ml-3 flex-1 truncate rounded-full bg-[#f0f1ec] px-3 py-1 font-mono text-[11px] text-[#8a9186]">staging.yourapp.com/dashboard</span>
      </div>
      <div className="relative grid grid-cols-[88px_1fr] gap-4 p-4">
        <div className="space-y-2.5 pt-1">
          {[70, 54, 62, 48, 58].map((w, i) => (
            <div key={i} className="h-2 rounded-full bg-[#e7e9e2]" style={{ width: `${w}px` }} />
          ))}
        </div>
        <div>
          <div className="h-3 w-40 rounded-full bg-[#10140f]/85" />
          <div className="mt-4 grid grid-cols-3 gap-2.5">
            <div className="relative rounded-[10px] border border-[#ecede7] bg-white p-2.5">
              <div className="h-1.5 w-12 rounded-full bg-[#dfe1d9]" />
              <div className="mt-2 font-[family-name:var(--font-display)] text-[15px] font-bold text-[#10140f]">Rs NaN</div>
              <span className="absolute -inset-1 rounded-[12px] border-2 border-dashed border-signal" />
              <span className="absolute -top-3 left-2 rounded-full bg-signal px-2 py-0.5 text-[10px] font-semibold text-white">High</span>
            </div>
            <div className="rounded-[10px] border border-[#ecede7] bg-white p-2.5">
              <div className="h-1.5 w-10 rounded-full bg-[#dfe1d9]" />
              <div className="mt-2 font-[family-name:var(--font-display)] text-[15px] font-bold text-[#10140f]">1,284</div>
            </div>
            <div className="rounded-[10px] border border-[#ecede7] bg-white p-2.5">
              <div className="h-1.5 w-14 rounded-full bg-[#dfe1d9]" />
              <div className="mt-2 font-[family-name:var(--font-display)] text-[15px] font-bold text-[#10140f]">92%</div>
            </div>
          </div>
          <div className="mt-3 space-y-2 rounded-[10px] border border-[#ecede7] bg-white p-3">
            {[100, 86, 92, 70].map((w, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="size-4 rounded-full bg-[#eceee7]" />
                <div className="h-1.5 rounded-full bg-[#e7e9e2]" style={{ width: `${w}%` }} />
              </div>
            ))}
          </div>
          <div className="relative mt-3 flex justify-end">
            <div className="h-7 w-24 rounded-full bg-[#10140f]" />
            <span className="absolute -inset-y-1 right-[-4px] w-[104px] rounded-full border-2 border-dashed border-signal-2" />
            <span className="absolute -top-3 right-2 rounded-full bg-signal-2 px-2 py-0.5 text-[10px] font-semibold text-[#10140f]">Medium</span>
          </div>
        </div>
        {/* the scan line — the page's single moving element */}
        <div className="qa-scan pointer-events-none absolute inset-x-0 top-0 h-16" />
      </div>
    </div>
  );
}

function Ticker() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((n) => n + 1), 1800);
    return () => clearInterval(id);
  }, []);
  const lines = [0, 1, 2].map((k) => TICKER[(i + k) % TICKER.length]);
  return (
    <div className="space-y-1.5 font-mono text-[14.5px]" aria-hidden>
      {lines.map((l, k) => (
        <div key={`${i}-${k}`} className={cx("flex items-center gap-2.5 transition-opacity", k === 2 ? "opacity-100" : k === 1 ? "opacity-70" : "opacity-40")}>
          <span className={cx("grid size-4 shrink-0 place-items-center rounded-full text-[9px] font-bold", l.ok ? "bg-[#17865f] text-white" : "grad text-[#10140f]")}>{l.ok ? "✓" : "!"}</span>
          <span className={l.ok ? "text-[#c9cfc3]" : "text-white"}>{l.text}</span>
        </div>
      ))}
    </div>
  );
}

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const params = useSearchParams();
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/auth/${mode}`, { body: mode === "login" ? { email: form.email, password: form.password } : form });
      router.push(params.get("next") || "/workspaces");
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
      <section className="relative hidden flex-col overflow-hidden bg-deck px-12 py-10 text-white lg:flex">
        <div className="pointer-events-none absolute top-1/3 -right-40 size-[560px] rounded-full bg-signal/20 blur-[140px]" aria-hidden />
        <Logo />
        <div className="relative mt-14 max-w-[560px]">
          <h1 className="text-[46px] leading-[1.02] font-bold tracking-[-0.04em]">Find the bug before your users do.</h1>
          <p className="mt-4 max-w-[46ch] text-[15.5px] leading-relaxed text-deck-text">
            QA Pilot opens your product like a real user, matches it against your approved design, probes every API and grades your AI answers. Every issue comes back with a screenshot.
          </p>
        </div>
        <div className="relative mt-10 max-w-[560px]">
          <InspectionWindow />
          <div className="mt-6 rounded-[16px] border border-deck-line bg-deck-2/70 px-4 py-3.5">
            <Ticker />
          </div>
        </div>
        <div className="relative mt-auto flex flex-wrap gap-2 pt-10">
          {CHECKS.map(({ icon: Icon, label }) => (
            <span key={label} className="inline-flex items-center gap-1.5 rounded-full border border-deck-line px-3 py-1.5 text-[14.5px] text-deck-text">
              <Icon size={13} className={label === "AI answers" ? "text-[#b4aeff]" : "text-signal-2"} /> {label}
            </span>
          ))}
        </div>
      </section>

      <section className="flex items-center justify-center bg-hangar px-6 py-12">
        <div className="w-full max-w-[380px]">
          <div className="mb-10 lg:hidden">
            <Logo tone="light" />
          </div>
          <h2 className="text-[34px] font-bold tracking-[-0.035em]">{mode === "login" ? "Sign in" : "Create your account"}</h2>
          <p className="mt-1.5 text-[14px] text-mute">
            {mode === "login" ? "Pick up where your last run left off." : "The first account becomes the workspace owner."}
          </p>
          <form onSubmit={submit} className="mt-8 space-y-4">
            {mode === "register" && (
              <Field label="Your name">
                <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus autoComplete="name" />
              </Field>
            )}
            <Field label="Work email">
              <Input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoFocus={mode === "login"} autoComplete="email" />
            </Field>
            <Field label="Password" hint={mode === "register" ? "At least 8 characters." : undefined}>
              <Input
                required
                type="password"
                minLength={mode === "register" ? 8 : undefined}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
              />
            </Field>
            <ErrorNote error={error} />
            <Button variant="primary" className="h-14 w-full text-[17px]" loading={busy}>
              {mode === "login" ? "Sign in" : "Create account"}
            </Button>
          </form>
          <p className="mt-6 text-[14.5px] text-mute">
            {mode === "login" ? (
              <>
                No account yet?{" "}
                <Link className="font-medium text-ink underline decoration-signal decoration-2 underline-offset-4" href="/register">
                  Create one
                </Link>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <Link className="font-medium text-ink underline decoration-signal decoration-2 underline-offset-4" href="/login">
                  Sign in
                </Link>
              </>
            )}
          </p>
        </div>
      </section>
    </div>
  );
}
