"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ChevronRight, Plus } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button, Empty, ErrorNote, Field, Input, Modal, PageHeader, Panel, Spinner } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import type { Workspace } from "@/lib/types";

function Workspaces() {
  const router = useRouter();
  const params = useSearchParams();
  const { data, loading } = useApi<Workspace[]>("/workspaces");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (params.get("new")) setOpen(true);
  }, [params]);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const w = await api<Workspace>("/workspaces", { body: { name } });
      router.push(`/w/${w.id}?new=1`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <AppShell crumbs={[{ label: "Workspaces" }]}>
      <PageHeader
        title="Workspaces"
        subtitle="A workspace holds a team's products. Inside each product you split the work into modules and test them one by one."
        actions={
          <Button variant="primary" onClick={() => setOpen(true)}>
            <Plus size={16} /> New workspace
          </Button>
        }
      />
      {loading ? (
        <Spinner />
      ) : !data?.length ? (
        <Empty
          title="Start with a workspace"
          desc="Name it after your company or team. You'll add your products to it next."
          action={
            <Button variant="primary" onClick={() => setOpen(true)}>
              <Plus size={16} /> New workspace
            </Button>
          }
        />
      ) : (
        <Panel className="divide-y divide-line">
          {data.map((w) => (
            <Link key={w.id} href={`/w/${w.id}`} className="group flex items-center gap-4 px-6 py-5 transition-colors hover:bg-soft">
              <span className="grad display grid size-12 shrink-0 place-items-center rounded-[14px] text-[16px] font-extrabold text-ink">
                {w.name.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="display truncate text-[18px] font-bold tracking-[-0.02em]">{w.name}</div>
                <div className="text-[13px] text-mute">
                  {w.projectCount ?? 0} {w.projectCount === 1 ? "product" : "products"}, you are {w.role === "owner" ? "the owner" : `a${w.role === "admin" ? "n" : ""} ${w.role}`}
                </div>
              </div>
              <ChevronRight size={18} className="text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-ink" />
            </Link>
          ))}
        </Panel>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="New workspace">
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <Field label="Workspace name" hint="Usually your company or team.">
            <Input autoFocus required placeholder="rad. Products" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <ErrorNote error={error} />
          <div className="flex justify-end gap-2">
            <Button type="button" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy}>
              Create workspace
            </Button>
          </div>
        </form>
      </Modal>
    </AppShell>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Workspaces />
    </Suspense>
  );
}
