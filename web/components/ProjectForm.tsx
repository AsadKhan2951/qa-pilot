"use client";
import { useState, type FormEvent, type ReactNode } from "react";
import { PenTool, Globe, Lock, Server, Timer } from "lucide-react";
import type { Project, Suite } from "@/lib/types";
import { SUITES } from "@/lib/types";
import { Button, ErrorNote, Field, Input, Textarea, cx } from "./ui";

export type ProjectPayload = {
  name: string;
  description: string;
  techStack: string;
  baseUrl: string;
  loginUrl: string;
  credentials: { username: string; password: string; notes: string };
  figmaFileKey: string;
  figmaToken: string;
  referenceUrl: string;
  referencePasscode: string;
  referenceNotes: string;
  openApiUrl: string;
  apiBaseUrl: string;
  apiAuth: { headerName: string; headerValue: string };
  apiTestMode: "safe" | "full";
  scheduleCron: string;
  scheduleSuites: Suite[];
};

function Section({ icon, title, desc, children }: { icon: ReactNode; title: string; desc: string; children: ReactNode }) {
  return (
    <section className="grid gap-5 border-b border-line py-7 first:pt-1 last:border-0 md:grid-cols-[240px_1fr] md:gap-10">
      <div>
        <div className="display flex items-center gap-2.5 text-[18px] font-bold tracking-[-0.02em]">
          <span className="grid size-8 place-items-center rounded-[10px] bg-signal-wash text-signal-ink">{icon}</span>
          {title}
        </div>
        <p className="mt-1.5 text-[14px] leading-relaxed text-mute">{desc}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

const SCHEDULES = [
  { label: "Off", cron: "" },
  { label: "Nightly at 2 am", cron: "0 2 * * *" },
  { label: "Every 6 hours", cron: "0 */6 * * *" },
  { label: "Weekdays at 9 am", cron: "0 9 * * 1-5" },
];

export function ProjectForm({
  initial,
  submitLabel,
  onSubmit,
  showAutomation,
}: {
  initial?: Project;
  submitLabel: string;
  onSubmit: (p: Partial<ProjectPayload>) => Promise<void>;
  showAutomation?: boolean;
}) {
  const [f, setF] = useState<ProjectPayload>({
    name: initial?.name ?? "",
    description: initial?.description ?? "",
    techStack: initial?.techStack ?? "",
    baseUrl: initial?.baseUrl ?? "",
    loginUrl: initial?.loginUrl ?? "",
    credentials: { username: initial?.credentials.username ?? "", password: "", notes: initial?.credentials.notes ?? "" },
    figmaFileKey: initial?.figmaFileKey ?? "",
    figmaToken: "",
    referenceUrl: initial?.referenceUrl ?? "",
    referencePasscode: "",
    referenceNotes: initial?.referenceNotes ?? "",
    openApiUrl: initial?.openApiUrl ?? "",
    apiBaseUrl: initial?.apiBaseUrl ?? "",
    apiAuth: { headerName: initial?.apiAuth.headerName || "Authorization", headerValue: "" },
    apiTestMode: initial?.apiTestMode ?? "safe",
    scheduleCron: initial?.scheduleCron ?? "",
    scheduleSuites: initial?.scheduleSuites ?? ["ui", "visual", "api", "ai"],
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof ProjectPayload>(k: K, v: ProjectPayload[K]) => setF((p) => ({ ...p, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload: Partial<ProjectPayload> = { ...f };
      if (!f.figmaToken) delete payload.figmaToken; // blank = keep saved token
      if (!f.referencePasscode) delete payload.referencePasscode; // blank = keep saved passcode
      if (!showAutomation) {
        delete payload.scheduleCron;
        delete payload.scheduleSuites;
      }
      await onSubmit(payload);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const saved = "Saved. Leave blank to keep it";

  return (
    <form onSubmit={submit}>
      <Section icon={<Globe size={17} />} title="Product" desc="QA Pilot opens this link in a real browser. Use staging if you have it.">
        <Field label="Product name">
          <Input required value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Now HRMS" />
        </Field>
        <Field label="App link">
          <Input required type="url" value={f.baseUrl} onChange={(e) => set("baseUrl", e.target.value)} placeholder="https://staging.myapp.com" />
        </Field>
        <Field label="Tech stack" className="sm:col-span-2">
          <Input value={f.techStack} onChange={(e) => set("techStack", e.target.value)} placeholder="Next.js, Node, Postgres, Claude API" />
        </Field>
        <Field label="What does it do?" hint="The AI tester reads this to judge what correct behaviour looks like." className="sm:col-span-2">
          <Textarea value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="An HR portal where employees apply for leave, managers approve it, and an AI Wingman answers policy questions…" />
        </Field>
      </Section>

      <Section icon={<Lock size={17} />} title="Test login" desc="A test account QA Pilot signs in with. Stored encrypted. The AI never sees the password, only a placeholder.">
        <Field label="Login page URL">
          <Input type="url" value={f.loginUrl} onChange={(e) => set("loginUrl", e.target.value)} placeholder="https://staging.myapp.com/login" />
        </Field>
        <Field label="Username / email">
          <Input value={f.credentials.username} onChange={(e) => set("credentials", { ...f.credentials, username: e.target.value })} autoComplete="off" />
        </Field>
        <Field label="Password">
          <Input
            type="password"
            value={f.credentials.password}
            onChange={(e) => set("credentials", { ...f.credentials, password: e.target.value })}
            placeholder={initial?.credentials.hasPassword ? saved : ""}
            autoComplete="new-password"
          />
        </Field>
        <Field label="Login notes (optional)">
          <Input value={f.credentials.notes} onChange={(e) => set("credentials", { ...f.credentials, notes: e.target.value })} placeholder="e.g. choose 'Acme Corp' tenant after login" />
        </Field>
      </Section>

      <Section
        icon={<PenTool size={17} />}
        title="Design reference"
        desc="What the product should look like. Use a Figma file, a live reference website (like an approved prototype), or both. You link pages to it inside each module."
      >
        <div className="sm:col-span-2 rounded-[16px] border border-line bg-soft/60 p-4">
          <div className="mb-3 text-[14px] font-semibold">Reference website</div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Website link" hint="The approved version to match against">
              <Input type="url" value={f.referenceUrl} onChange={(e) => set("referenceUrl", e.target.value)} placeholder="https://stack-opal.vercel.app" />
            </Field>
            <Field label="Passcode (if the site asks for one)" hint="Stored encrypted. Typed in automatically.">
              <Input
                type="password"
                value={f.referencePasscode}
                onChange={(e) => set("referencePasscode", e.target.value)}
                placeholder={initial?.hasReferencePasscode ? saved : "Leave empty if there's none"}
                autoComplete="off"
              />
            </Field>
          </div>
        </div>
        <div className="sm:col-span-2 rounded-[16px] border border-line bg-soft/60 p-4">
          <div className="mb-3 text-[14px] font-semibold">Figma</div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Figma file link or key">
              <Input value={f.figmaFileKey} onChange={(e) => set("figmaFileKey", e.target.value)} placeholder="https://www.figma.com/design/AbC123…" />
            </Field>
            <Field label="Figma access token" hint="Figma → Settings → Security → Personal access tokens (read-only)">
              <Input type="password" value={f.figmaToken} onChange={(e) => set("figmaToken", e.target.value)} placeholder={initial?.hasFigmaToken ? saved : "figd_…"} autoComplete="off" />
            </Field>
          </div>
        </div>
      </Section>

      <Section icon={<Server size={17} />} title="API" desc="Optional. Link your OpenAPI (Swagger) spec and every endpoint gets tested.">
        <Field label="OpenAPI spec URL">
          <Input type="url" value={f.openApiUrl} onChange={(e) => set("openApiUrl", e.target.value)} placeholder="https://api.myapp.com/openapi.json" />
        </Field>
        <Field label="API base URL" hint="Leave empty to use the spec's server URL">
          <Input type="url" value={f.apiBaseUrl} onChange={(e) => set("apiBaseUrl", e.target.value)} placeholder="https://staging-api.myapp.com" />
        </Field>
        <Field label="Auth header name">
          <Input value={f.apiAuth.headerName} onChange={(e) => set("apiAuth", { ...f.apiAuth, headerName: e.target.value })} />
        </Field>
        <Field label="Auth header value">
          <Input
            type="password"
            value={f.apiAuth.headerValue}
            onChange={(e) => set("apiAuth", { ...f.apiAuth, headerValue: e.target.value })}
            placeholder={initial?.apiAuth.hasValue ? saved : "Bearer eyJ…"}
            autoComplete="off"
          />
        </Field>
        <Field label="Test mode" className="sm:col-span-2">
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                ["safe", "Read-only", "Only GET requests. Safe to point at production."],
                ["full", "Full", "Also creates, edits and deletes with test data. Staging only."],
              ] as const
            ).map(([id, label, hint]) => (
              <button
                type="button"
                key={id}
                onClick={() => set("apiTestMode", id)}
                className={cx("rounded-[16px] border p-4 text-left transition-colors", f.apiTestMode === id ? "border-ink bg-panel shadow-[inset_0_0_0_1px_var(--color-ink)]" : "border-line bg-soft hover:border-[#cbcfc4]")}
              >
                <div className="text-[14px] font-semibold">{label}</div>
                <div className="mt-0.5 text-[14.5px] text-mute">{hint}</div>
              </button>
            ))}
          </div>
        </Field>
      </Section>

      {showAutomation && (
        <Section icon={<Timer size={17} />} title="Automatic runs" desc="Run QA on a schedule, in Pakistan time. To run after each deploy, use the CI link below.">
          <Field label="Schedule" className="sm:col-span-2">
            <div className="flex flex-wrap gap-2">
              {SCHEDULES.map((s) => (
                <button
                  type="button"
                  key={s.label}
                  onClick={() => set("scheduleCron", s.cron)}
                  className={cx("rounded-full border px-3 py-1.5 text-[14px] transition-colors", f.scheduleCron === s.cron ? "border-ink bg-ink text-white" : "border-line bg-panel text-mute hover:text-ink")}
                >
                  {s.label}
                </button>
              ))}
              <Input className="w-44 font-mono" value={f.scheduleCron} onChange={(e) => set("scheduleCron", e.target.value)} placeholder="custom cron" />
            </div>
          </Field>
          <Field label="Checks on automatic runs" className="sm:col-span-2">
            <div className="flex flex-wrap gap-2">
              {SUITES.map((s) => {
                const on = f.scheduleSuites.includes(s.id);
                return (
                  <button
                    type="button"
                    key={s.id}
                    onClick={() => set("scheduleSuites", on ? f.scheduleSuites.filter((x) => x !== s.id) : [...f.scheduleSuites, s.id])}
                    className={cx("rounded-full border px-3 py-1.5 text-[14px] transition-colors", on ? "border-ink bg-ink text-white" : "border-line bg-panel text-mute hover:text-ink")}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
          </Field>
        </Section>
      )}

      <div className="sticky bottom-0 -mx-6 flex items-center justify-end gap-3 rounded-b-[18px] border-t border-line bg-panel/95 px-6 py-4 backdrop-blur">
        <ErrorNote error={error} />
        <Button variant="primary" loading={busy}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
