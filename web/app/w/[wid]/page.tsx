"use client";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ChevronRight, Plus, Settings, Trash2, Users, X } from "lucide-react";
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [wsName, setWsName] = useState("");
  const [confirmName, setConfirmName] = useState("");
  const [wsError, setWsError] = useState<string | null>(null);
  const [wsBusy, setWsBusy] = useState(false);

  async function renameWorkspace() {
    setWsError(null);
    setWsBusy(true);
    try {
      await api(`/workspaces/${wid}`, { method: "PATCH", body: { name: wsName } });
      ws.reload();
      setSettingsOpen(false);
    } catch (e) {
      setWsError((e as Error).message);
    } finally {
      setWsBusy(false);
    }
  }

  async function deleteWorkspace() {
    setWsError(null);
    setWsBusy(true);
    try {
      await api(`/workspaces/${wid}`, { method: "DELETE" });
      router.push("/workspaces");
    } catch (e) {
      setWsError((e as Error).message);
      setWsBusy(false);
    }
  }

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
            {ws.data?.role !== "member" && (
              <Button
                onClick={() => {
                  setWsName(ws.data?.name ?? "");
                  setConfirmName("");
                  setWsError(null);
                  setSettingsOpen(true);
                }}
              >
                <Settings size={15} /> Settings
              </Button>
            )}
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
                <div className="flex items-center gap-2 text-[14px] text-mute">
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

      <Modal open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Workspace settings">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            renameWorkspace();
          }}
        >
          <Field label="Workspace name">
            <Input required value={wsName} onChange={(e) => setWsName(e.target.value)} />
          </Field>
          <div className="flex justify-end">
            <Button variant="primary" loading={wsBusy} disabled={!wsName.trim() || wsName === ws.data?.name}>
              Save name
            </Button>
          </div>
        </form>
        {ws.data?.role === "owner" && (
          <div className="mt-7 rounded-[16px] border border-[#f3c4cb] bg-fault-wash/50 p-4">
            <div className="text-[15px] font-semibold text-fault">Delete workspace</div>
            <p className="mt-1 text-[14.5px] text-mute">
              Deletes {projects.data?.length ?? 0} product{projects.data?.length === 1 ? "" : "s"} with all their modules, runs, issues and reports. This can&apos;t be undone.
            </p>
            <Field label={`Type "${ws.data?.name}" to confirm`} className="mt-3">
              <Input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} autoComplete="off" />
            </Field>
            <Button variant="danger" className="mt-3" loading={wsBusy} disabled={confirmName !== ws.data?.name} onClick={deleteWorkspace}>
              <Trash2 size={15} /> Delete workspace
            </Button>
          </div>
        )}
        <div className="mt-3">
          <ErrorNote error={wsError} />
        </div>
      </Modal>

      <Modal open={team} onClose={() => setTeam(false)} title="Team members">
        <div className="space-y-2">
          {ws.data?.members?.map((m) => (
            <div key={m.id} className="flex items-center justify-between rounded-[8px] border border-line px-3 py-2.5">
              <div>
                <div className="text-[14px] font-medium">{m.name}</div>
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
