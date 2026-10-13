"use client";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ChevronRight, Plus, Users, X } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ProjectForm } from "@/components/ProjectForm";
import { Button, Empty, ErrorNote, Field, Gauge, Input, Modal, PageHeader, Panel, Select, Spinner, StatusBadge, timeAgo } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import type { Project, Workspace } from "@/lib/types";

function WorkspacePage() {
  const { wid } = useParams<{ wid: string }>();
  const router = useRouter();
  const params = useSearchParams();
  const ws = useApi<Workspace>(`/workspaces/${wid}`);
  const projects = useApi<Project[]>(`/workspaces/${wid}/projects`);
  const [open, setOpen] = useState(false);
  const [team, setTeam] = useState(false);
  const [invite, setInvite] = useState({ email: "", role: "member" });
  const [inviteError, setInviteError] = useState<string | null>(null);

  useEffect(() => {
    if (params.get("new")) setOpen(true);
  }, [params]);

  async function addMember() {
    setInviteError(null);
    try {
      await api(`/workspaces/${wid}/members`, { body: invite });
      setInvite({ email: "", role: "member" });
      ws.reload();
    } catch (e) {
      setInviteError((e as Error).message);
    }
  }

  return (
    <AppShell workspaceId={wid} crumbs={[{ label: "Workspaces", href: "/workspaces" }, { label: ws.data?.name ?? "…" }]}>
      <PageHeader
        title={ws.data?.name ?? "…"}
        subtitle="Your products and how each one did on its latest QA run."
        actions={
          <>
            <Button onClick={() => setTeam(true)}>
              <Users size={15} /> Team
            </Button>
            <Button variant="primary" onClick={() => setOpen(true)}>
              <Plus size={16} /> Add product
            </Button>
          </>
        }
      />
      {projects.loading ? (
        <Spinner />
      ) : !projects.data?.length ? (
        <Empty
          title="Add the first product to test"
          desc="All QA Pilot needs to start is the app link and a test login. Figma, the API spec and AI evals can come later."
          action={
            <Button variant="primary" onClick={() => setOpen(true)}>
              <Plus size={16} /> Add product
            </Button>
          }
        />
      ) : (
        <Panel className="overflow-hidden">
          <div className="label hidden grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_170px_24px] gap-4 border-b border-line px-6 py-3 text-faint md:grid">
            <span>Product</span>
            <span>Latest run</span>
            <span>Health</span>
            <span />
          </div>
          <div className="divide-y divide-line">
            {projects.data.map((p) => (
              <Link
                key={p.id}
                href={`/w/${wid}/p/${p.id}`}
                className="group grid grid-cols-1 items-center gap-2 px-6 py-5 transition-colors hover:bg-soft md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_170px_24px] md:gap-4"
              >
                <div className="min-w-0">
                  <div className="display truncate text-[17px] font-bold tracking-[-0.02em]">{p.name}</div>
                  <div className="truncate font-mono text-[12px] text-mute">{p.baseUrl.replace(/^https?:\/\//, "")}</div>
                </div>
                <div className="flex items-center gap-2 text-[13px] text-mute">
                  {p.lastRun ? (
                    <>
                      <StatusBadge s={p.lastRun.status} />
                      <span>{timeAgo(p.lastRun.createdAt)}</span>
                    </>
                  ) : (
                    <span>Never tested</span>
                  )}
                </div>
                <Gauge score={p.lastRun?.healthScore} size="sm" />
                <ChevronRight size={18} className="hidden text-faint group-hover:text-ink md:block" />
              </Link>
            ))}
          </div>
        </Panel>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Add a product" wide>
        <ProjectForm
          submitLabel="Add product"
          onSubmit={async (body) => {
            const p = await api<Project>(`/workspaces/${wid}/projects`, { body });
            router.push(`/w/${wid}/p/${p.id}?setup=1`);
          }}
        />
      </Modal>

      <Modal open={team} onClose={() => setTeam(false)} title="Team members">
        <div className="space-y-2">
          {ws.data?.members?.map((m) => (
            <div key={m.id} className="flex items-center justify-between rounded-[8px] border border-line px-3 py-2.5">
              <div>
                <div className="text-[13px] font-medium">{m.name}</div>
                <div className="text-xs text-mute">{m.email}</div>
              </div>
              <div className="flex items-center gap-2 text-xs capitalize text-mute">
                {m.role}
                {m.role !== "owner" && ws.data?.role !== "member" && (
                  <button
                    className="rounded p-1 hover:bg-soft"
                    onClick={async () => {
                      await api(`/workspaces/${wid}/members/${m.id}`, { method: "DELETE" });
                      ws.reload();
                    }}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        {ws.data?.role !== "member" && (
          <form
            className="mt-4 flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              addMember();
            }}
          >
            <Field label="Add by email" className="flex-1">
              <Input type="email" required value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} placeholder="teammate@company.com" />
            </Field>
            <Select className="w-32" value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })}>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </Select>
            <Button variant="primary">Add</Button>
          </form>
        )}
        <div className="mt-2">
          <ErrorNote error={inviteError} />
        </div>
        <p className="mt-3 text-xs text-mute">Teammates sign up first, then you add them here by email.</p>
      </Modal>
    </AppShell>
  );
}

export default function Page() {
  return (
    <Suspense>
      <WorkspacePage />
    </Suspense>
  );
}
