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
import { useEscapeToClose } from "@/hooks/use-escape-to-close";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  Copy, Trash2, UserPlus, Shield, Check, X, LayoutDashboard, Target, CheckSquare, Package, Wallet,
  Database, Layers, Bell, StickyNote, ShoppingBag, Truck, Plug, Store, FolderKanban, Workflow,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

export const Route = createFileRoute("/settings/members")({
  beforeLoad: async () => {
    // Sessão local, igual às outras rotas — ver settings.tsx.
    const { data } = await supabase.auth.getSession();
    if (!data.session?.user) throw redirect({ to: "/login" });
  },
  component: MembersPage,
});

type Permission = { section: Section; resource_id: string | null };

const SECTION_LABELS: Record<Section, string> = {
  shops: "Lojas que pode ver",
  projects: "Projetos",
  journal: "Diário",
  sops: "SOPs & Processos",
  dashboard: "Dashboard",
  metas: "Metas",
  tarefas: "Tarefas",
  produtos: "Produtos",
  caixa: "Caixa",
  banco_lojas: "Banco de Lojas",
  lojas_grupos: "Lojas e Grupos",
  notificacoes: "Notificações (sino)",
  lg_dashboard: "Dashboard",
  lg_diario: "Diário",
  lg_caixa: "Caixa",
  lg_pedidos: "Pedidos",
  lg_rastreamento: "Rastreamento",
  lg_integracoes: "Integrações",
};

// Subabas de Lojas e Grupos (aparecem quando a aba Lojas e Grupos está marcada).
const LG_SUBTABS: Section[] = ["lg_dashboard", "lg_diario", "lg_caixa", "lg_pedidos", "lg_rastreamento", "lg_integracoes"];

// Abas do menu (liga/desliga a aba inteira), na ordem do menu lateral.
const TAB_SECTIONS: Section[] = ["dashboard", "metas", "tarefas", "produtos", "caixa", "banco_lojas", "lojas_grupos", "notificacoes"];

// Permissões que ainda podem ser limitadas a itens (lojas, projetos, SOPs).
const VISIBLE_SECTIONS = SECTIONS.filter((s): s is "shops" | "projects" | "sops" =>
  s === "shops" || s === "projects" || s === "sops"
);

const RESOURCE_BY_SECTION: Partial<Record<Section, "shops" | "projects" | "sops">> = {
  shops: "shops",
  projects: "projects",
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
  const confirm = useConfirm();

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
                  if (!(await confirm(`Remover ${m.email}?`))) return;
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

const SECTION_ICONS: Partial<Record<Section, any>> = {
  dashboard: LayoutDashboard, metas: Target, tarefas: CheckSquare, produtos: Package, caixa: Wallet,
  banco_lojas: Database, lojas_grupos: Layers, notificacoes: Bell,
  lg_dashboard: LayoutDashboard, lg_diario: StickyNote, lg_caixa: Wallet, lg_pedidos: ShoppingBag,
  lg_rastreamento: Truck, lg_integracoes: Plug,
  shops: Store, projects: FolderKanban, sops: Workflow,
};

function PermGroup({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5 px-1">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
        {action}
      </div>
      <div className="rounded-xl border border-border divide-y divide-border overflow-hidden bg-card">{children}</div>
    </div>
  );
}

function PermRow({ section, checked, onChange, indent, hint }: {
  section: Section; checked: boolean; onChange: () => void; indent?: boolean; hint?: string;
}) {
  const Icon = SECTION_ICONS[section] ?? Shield;
  return (
    <label className={`flex items-center gap-3 px-3.5 py-2.5 cursor-pointer hover:bg-muted/40 transition-colors ${indent ? "pl-10 bg-muted/20" : ""}`}>
      <span className={`size-7 rounded-lg grid place-items-center shrink-0 ${checked ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
        <Icon className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block text-sm ${checked ? "text-foreground font-medium" : "text-muted-foreground"}`}>{SECTION_LABELS[section]}</span>
        {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
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

  const PAGE_TABS = TAB_SECTIONS.filter((t) => t !== "notificacoes");
  const ALL_TABS = [...TAB_SECTIONS, ...LG_SUBTABS];
  const allTabs = ALL_TABS.every((t) => has(t, null));
  const setAllTabs = (on: boolean) => {
    const rest = value.filter((p) => !ALL_TABS.includes(p.section));
    onChange(on ? [...rest, ...ALL_TABS.map((t) => ({ section: t, resource_id: null }))] : rest);
  };
  // Ligar Lojas e Grupos libera todas as subabas; desligar tira todas.
  const toggleTab = (t: Section) => {
    if (t !== "lojas_grupos") return toggle(t, null);
    const on = !has("lojas_grupos", null);
    const rest = value.filter((p) => p.section !== "lojas_grupos" && !LG_SUBTABS.includes(p.section));
    onChange(on ? [...rest, { section: "lojas_grupos", resource_id: null }, ...LG_SUBTABS.map((st) => ({ section: st, resource_id: null }))] : rest);
  };

  return (
    <div className="space-y-5 max-h-[62vh] overflow-y-auto pr-1 -mr-1">
      <PermGroup
        title="Páginas"
        action={
          <button type="button" onClick={() => setAllTabs(!allTabs)} className="text-[11px] font-medium text-primary hover:underline">
            {allTabs ? "Desligar todas" : "Ligar todas"}
          </button>
        }
      >
        {PAGE_TABS.map((t) => (
          <div key={t}>
            <PermRow section={t} checked={has(t, null)} onChange={() => toggleTab(t)} />
            {t === "lojas_grupos" && has("lojas_grupos", null) && (
              <div className="divide-y divide-border border-t border-border">
                {LG_SUBTABS.map((st) => (
                  <PermRow key={st} section={st} indent checked={has(st, null)} onChange={() => toggle(st, null)} />
                ))}
              </div>
            )}
          </div>
        ))}
      </PermGroup>

      <PermGroup title="Outros">
        <PermRow section="notificacoes" checked={has("notificacoes", null)} onChange={() => toggle("notificacoes", null)}
          hint="Avisos de disputas, integrações e tarefas" />
      </PermGroup>

      <PermGroup title="Acesso a dados">
        {VISIBLE_SECTIONS.map((section) => {
          const resKey = RESOURCE_BY_SECTION[section];
          const items: { id: string; name: string }[] = resKey ? resources?.[resKey] ?? [] : [];
          const sectionAll = has(section, null);
          const picked = items.filter((it) => has(section, it.id)).length;
          return (
            <div key={section}>
              <PermRow
                section={section}
                checked={sectionAll}
                onChange={() => toggle(section, null)}
                hint={sectionAll ? "Todos" : items.length ? (picked ? `${picked} de ${items.length} escolhidos` : "Escolha abaixo quais pode ver") : undefined}
              />
              {!sectionAll && items.length > 0 && (
                <div className="px-3.5 pb-3 pt-1 pl-10 grid grid-cols-2 gap-x-3 gap-y-1.5 bg-muted/20">
                  {items.map((it) => (
                    <label key={it.id} className="flex items-center gap-2 text-xs cursor-pointer min-w-0">
                      <input type="checkbox" checked={has(section, it.id)} onChange={() => toggle(section, it.id)} className="size-3.5 accent-primary shrink-0" />
                      <span className="truncate">{it.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </PermGroup>
    </div>
  );
}

function InviteDialog({ resources, onClose, onCreated }: { resources: any; onClose: () => void; onCreated: () => void }) {
  const [email, setEmail] = useState("");
  const [perms, setPerms] = useState<Permission[]>([]);
  const [busy, setBusy] = useState(false);

  useEscapeToClose(onClose);

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

  useEscapeToClose(onClose);

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
      <div className="bg-surface rounded-2xl border border-border w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4">
          <h2 className="text-lg font-bold">Editar permissões</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Ligue o que esse membro pode ver e usar.</p>
        </div>
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
