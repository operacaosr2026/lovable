import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  listWorkspace,
  listOwnerResources,
  inviteMember,
  revokeMember,
  revokeInvitation,
  updateMemberPermissions,
  SECTIONS,
  type Section,
} from "@/lib/members.functions";
import { useMyAccess } from "@/hooks/useMyAccess";
import { Copy, Trash2, UserPlus, Shield, Check, X } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/settings/members")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/login" });
  },
  component: MembersPage,
});

type Permission = { section: Section; resource_id: string | null };

const SECTION_LABELS: Record<Section, string> = {
  shops: "Lojas / Ecommerce",
  projects: "Projetos",
  finance: "Financeiro",
  journal: "Diário",
  sops: "SOPs & Processos",
  tasks: "Tarefas",
  whiteboard: "Quadro Branco",
  habits: "Hábitos",
  calendar: "Calendário",
};

const VISIBLE_SECTIONS = SECTIONS.filter((s) => s !== "journal");

const RESOURCE_BY_SECTION: Partial<Record<Section, "shops" | "projects" | "tasks" | "sops">> = {
  shops: "shops",
  projects: "projects",
  tasks: "tasks",
  sops: "sops",
};

function MembersPage() {
  const { role, isLoading } = useMyAccess();
  const qc = useQueryClient();
  const listWs = useServerFn(listWorkspace);
  const listRes = useServerFn(listOwnerResources);

  const wsQ = useQuery({ queryKey: ["workspace"], queryFn: () => listWs() });
  const resQ = useQuery({ queryKey: ["owner-resources"], queryFn: () => listRes() });

  const [editing, setEditing] = useState<{ memberId: string; permissions: Permission[] } | null>(null);
  const [inviting, setInviting] = useState(false);

  if (isLoading) return <div className="p-8 text-sm text-muted-foreground">Carregando...</div>;
  if (role !== "admin") {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold">Acesso restrito</h1>
        <p className="text-sm text-muted-foreground mt-2">Apenas administradores podem gerenciar membros.</p>
      </div>
    );
  }

  const refresh = () => qc.invalidateQueries({ queryKey: ["workspace"] });

  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Membros & Permissões</h1>
          <p className="text-sm text-muted-foreground mt-1">Convide pessoas e controle o que cada uma pode acessar.</p>
        </div>
        <button
          onClick={() => setInviting(true)}
          className="h-10 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-medium flex items-center gap-2 hover:opacity-90"
        >
          <UserPlus className="size-4" /> Convidar membro
        </button>
      </div>

      <section className="mb-10">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Membros ativos</h2>
        <div className="rounded-2xl border border-border bg-surface divide-y divide-border">
          {wsQ.data?.members.length === 0 && (
            <div className="p-6 text-sm text-muted-foreground text-center">Nenhum membro ainda.</div>
          )}
          {wsQ.data?.members.map((m) => (
            <div key={m.id} className="p-4 flex items-center gap-4">
              {m.avatar_url ? (
                <img src={m.avatar_url} className="size-10 rounded-full object-cover" />
              ) : (
                <div className="size-10 rounded-full gradient-primary" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{m.full_name || m.email || "Membro"}</div>
                <div className="text-xs text-muted-foreground truncate">{m.email}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  {m.permissions.length} permissões
                </div>
              </div>
              <button
                onClick={() =>
                  setEditing({
                    memberId: m.member_id,
                    permissions: m.permissions.map((p) => ({
                      section: p.section as Section,
                      resource_id: p.resource_id,
                    })),
                  })
                }
                className="h-9 px-3 rounded-lg border border-border text-xs hover:bg-surface-hover flex items-center gap-1.5"
              >
                <Shield className="size-3.5" /> Permissões
              </button>
              <button
                onClick={async () => {
                  if (!confirm(`Remover ${m.email}?`)) return;
                  await revokeMember({ data: { member_id: m.member_id } });
                  refresh();
                  toast.success("Membro removido");
                }}
                className="h-9 w-9 rounded-lg text-destructive hover:bg-destructive/10 grid place-items-center"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Convites pendentes</h2>
        <div className="rounded-2xl border border-border bg-surface divide-y divide-border">
          {wsQ.data?.invitations.filter((i: any) => i.status === "pending").length === 0 && (
            <div className="p-6 text-sm text-muted-foreground text-center">Sem convites pendentes.</div>
          )}
          {wsQ.data?.invitations
            .filter((i: any) => i.status === "pending")
            .map((inv: any) => {
              const link = `${typeof window !== "undefined" ? window.location.origin : ""}/invite/${inv.token}`;
              return (
                <div key={inv.id} className="p-4 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{inv.email}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      Expira em {new Date(inv.expires_at).toLocaleDateString("pt-BR")} · {inv.permissions.length} permissões
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(link);
                      toast.success("Link copiado!");
                    }}
                    className="h-9 px-3 rounded-lg border border-border text-xs hover:bg-surface-hover flex items-center gap-1.5"
                  >
                    <Copy className="size-3.5" /> Copiar link
                  </button>
                  <button
                    onClick={async () => {
                      await revokeInvitation({ data: { id: inv.id } });
                      refresh();
                      toast.success("Convite removido");
                    }}
                    className="h-9 w-9 rounded-lg text-destructive hover:bg-destructive/10 grid place-items-center"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              );
            })}
        </div>
      </section>

      {inviting && (
        <InviteDialog
          resources={resQ.data}
          onClose={() => setInviting(false)}
          onCreated={() => {
            setInviting(false);
            refresh();
          }}
        />
      )}
      {editing && (
        <PermissionsDialog
          memberId={editing.memberId}
          initial={editing.permissions}
          resources={resQ.data}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function PermissionsForm({
  value,
  onChange,
  resources,
}: {
  value: Permission[];
  onChange: (p: Permission[]) => void;
  resources: any;
}) {
  const has = (section: Section, resourceId: string | null) =>
    value.some((p) => p.section === section && (p.resource_id ?? null) === resourceId);

  const toggle = (section: Section, resourceId: string | null) => {
    if (has(section, resourceId)) {
      onChange(value.filter((p) => !(p.section === section && (p.resource_id ?? null) === resourceId)));
    } else {
      onChange([...value, { section, resource_id: resourceId }]);
    }
  };

  return (
    <div className="space-y-4 max-h-[60vh] overflow-y-auto">
      {VISIBLE_SECTIONS.map((section) => {
        const resKey = RESOURCE_BY_SECTION[section];
        const items: { id: string; name: string }[] = resKey ? resources?.[resKey] ?? [] : [];
        const sectionAll = has(section, null);
        return (
          <div key={section} className="rounded-xl border border-border p-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={sectionAll}
                onChange={() => toggle(section, null)}
                className="size-4 accent-primary"
              />
              <span className="text-sm font-medium">{SECTION_LABELS[section]}</span>
              {sectionAll && <span className="text-[10px] text-primary ml-auto">Acesso total</span>}
            </label>
            {!sectionAll && items.length > 0 && (
              <div className="mt-2 ml-6 grid grid-cols-2 gap-1.5">
                {items.map((it) => (
                  <label key={it.id} className="flex items-center gap-2 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={has(section, it.id)}
                      onChange={() => toggle(section, it.id)}
                      className="size-3.5 accent-primary"
                    />
                    <span className="truncate">{it.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function InviteDialog({ resources, onClose, onCreated }: { resources: any; onClose: () => void; onCreated: () => void }) {
  const [email, setEmail] = useState("");
  const [perms, setPerms] = useState<Permission[]>([]);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email) return;
    setBusy(true);
    try {
      const { invitation } = await inviteMember({ data: { email, permissions: perms } });
      const link = `${window.location.origin}/invite/${invitation.token}`;
      await navigator.clipboard.writeText(link).catch(() => {});
      toast.success("Convite criado — link copiado!");
      onCreated();
    } catch (e: any) {
      toast.error(e?.message ?? "Erro");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 grid place-items-center z-50 p-4" onClick={onClose}>
      <div className="bg-surface rounded-2xl border border-border w-full max-w-2xl p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-1">Convidar membro</h2>
        <p className="text-xs text-muted-foreground mb-4">
          Crie um convite. Você receberá um link copiável para enviar ao membro.
        </p>
        <input
          type="email"
          placeholder="email@exemplo.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full h-11 px-3.5 rounded-xl bg-background border border-border text-sm outline-none focus:border-primary mb-4"
        />
        <div className="text-xs font-medium text-muted-foreground mb-2">Permissões</div>
        <PermissionsForm value={perms} onChange={setPerms} resources={resources} />
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="h-10 px-4 rounded-lg border border-border text-sm">
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={busy || !email}
            className="h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-60"
          >
            {busy ? "Criando..." : "Criar convite"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PermissionsDialog({
  memberId,
  initial,
  resources,
  onClose,
  onSaved,
}: {
  memberId: string;
  initial: Permission[];
  resources: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [perms, setPerms] = useState<Permission[]>(initial);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await updateMemberPermissions({ data: { member_id: memberId, permissions: perms } });
      toast.success("Permissões atualizadas");
      onSaved();
    } catch (e: any) {
      toast.error(e?.message ?? "Erro");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 grid place-items-center z-50 p-4" onClick={onClose}>
      <div className="bg-surface rounded-2xl border border-border w-full max-w-2xl p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-4">Editar permissões</h2>
        <PermissionsForm value={perms} onChange={setPerms} resources={resources} />
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="h-10 px-4 rounded-lg border border-border text-sm">
            Cancelar
          </button>
          <button
            onClick={save}
            disabled={busy}
            className="h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-60 flex items-center gap-2"
          >
            <Check className="size-4" /> {busy ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}
