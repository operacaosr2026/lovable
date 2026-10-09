import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Copy, Eye, EyeOff, Hammer, KeyRound, Loader2, Pencil, Plus, RefreshCw, Settings, ShoppingCart, Trash2, X, Check } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { getStoreMissingScopes, reconnectShopifyStore, renameShopifyStore } from "@/lib/shop-orders.functions";
import { ProductionTab } from "@/components/shops/StoreProduction";
import { useMyAccess } from "@/hooks/useMyAccess";
import {
  getStoreDetails, listStoreCredentials, saveStoreCredential, deleteStoreCredential,
} from "@/lib/store-details.functions";

const fmtInt = (n: number) => n.toLocaleString("pt-BR");
const fmtDec = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtDay = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export function StoreDetailsDialog({ store, onClose, onConnect }: { store: any; onClose: () => void; onConnect: () => void }) {
  const domain = store.shop_domain ?? "";
  const showOrders = useMyAccess().canAccessSection("bl_indicadores");
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{store.name || domain || "Loja"}</DialogTitle>
          {domain && <p className="text-sm text-muted-foreground">{domain}</p>}
        </DialogHeader>
        <Tabs defaultValue={store.is_placeholder || !showOrders ? "producao" : "pedidos"}>
          <TabsList>
            {showOrders && <TabsTrigger value="pedidos" className="gap-1.5"><ShoppingCart className="size-3.5" /> Pedidos</TabsTrigger>}
            <TabsTrigger value="producao" className="gap-1.5"><Hammer className="size-3.5" /> Produção</TabsTrigger>
            <TabsTrigger value="acessos" className="gap-1.5"><KeyRound className="size-3.5" /> Acessos</TabsTrigger>
            <TabsTrigger value="config" className="gap-1.5"><Settings className="size-3.5" /> Configurações</TabsTrigger>
          </TabsList>
          {showOrders && <TabsContent value="pedidos" className="mt-4"><OrdersSection store={store} /></TabsContent>}
          <TabsContent value="producao" className="mt-4"><ProductionTab kind="store" targetId={store.id} /></TabsContent>
          <TabsContent value="acessos" className="mt-4"><CredentialsSection storeId={store.id} /></TabsContent>
          <TabsContent value="config" className="mt-4"><SettingsSection store={store} onConnect={onConnect} /></TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function OrdersSection({ store }: { store: any }) {
  const detailsFn = useServerFn(getStoreDetails);
  const connected = !store.is_placeholder;
  const { data, isLoading, error } = useQuery({
    queryKey: ["store-details", store.id],
    queryFn: () => detailsFn({ data: { shopify_store_id: store.id } }),
    enabled: connected,
    staleTime: 10 * 60_000,
  });

  return (
    <section className="space-y-3">
      {!connected ? (
        <p className="text-sm text-muted-foreground">Loja ainda não conectada à Shopify.</p>
      ) : isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
          <Loader2 className="size-4 animate-spin" /> Buscando pedidos na Shopify...
        </div>
      ) : error || !data ? (
        <p className="text-sm text-destructive">{(error as any)?.message ?? "Não foi possível carregar os pedidos."}</p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <Stat label="Total de pedidos" value={fmtInt(data.totalOrders)} hint="Desde a criação da loja" />
            <Stat label="Média por semana" value={fmtDec(data.avgPerWeek)} hint="Últimas 8 semanas" />
            <Stat
              label={`Taxa de estorno (${data.estorno?.windowDays ?? 90} dias)`}
              value={data.estorno ? `${(data.estorno.rate * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%` : "—"}
              hint={data.estorno ? `${fmtInt(data.estorno.estornos)} de ${fmtInt(data.estorno.pedidos)} pedidos` : "Sem dados"}
            />
          </div>
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="text-left font-medium px-3 py-2">Semana</th>
                  <th className="text-right font-medium px-3 py-2">Pedidos</th>
                  <th className="text-right font-medium px-3 py-2">Média por dia</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {data.weeks.map((w) => (
                  <tr key={w.from} className="border-t border-border">
                    <td className="px-3 py-2">{fmtDay(w.from)} – {fmtDay(w.to)}</td>
                    <td className="px-3 py-2 text-right font-medium">{fmtInt(w.orders)}</td>
                    <td className="px-3 py-2 text-right">{fmtDec(w.avgPerDay)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">Semanas de 7 dias contando até hoje. Pedidos pagos e parcialmente reembolsados.</p>
        </>
      )}
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2.5 min-w-0">
      <p className="text-xs text-muted-foreground truncate">{label}</p>
      <p className="text-xl font-bold tabular-nums leading-tight mt-0.5">{value}</p>
      <p className="text-[11px] text-muted-foreground truncate">{hint}</p>
    </div>
  );
}

function SettingsSection({ store, onConnect }: { store: any; onConnect: () => void }) {
  const qc = useQueryClient();
  const renameFn = useServerFn(renameShopifyStore);
  const [name, setName] = useState(store.name ?? "");
  const dirty = name.trim() !== (store.name ?? "") && !!name.trim();

  const rename = useMutation({
    mutationFn: () => renameFn({ data: { id: store.id, name: name.trim() } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shopify-stores"] });
      toast.success("Nome salvo");
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao salvar"),
  });

  return (
    <section className="space-y-5">
      <div>
        <label className="text-sm font-medium mb-1.5 block">Nome</label>
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && dirty) rename.mutate(); }}
            placeholder="Nome da loja"
            className="flex-1 min-w-0 px-3 h-10 rounded-lg bg-background border border-border text-sm outline-none focus:border-primary/50"
          />
          <button
            onClick={() => rename.mutate()}
            disabled={rename.isPending || !dirty}
            className="h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-1.5 disabled:opacity-50"
          >
            {rename.isPending && <Loader2 className="size-3.5 animate-spin" />} Salvar
          </button>
        </div>
      </div>
      <div>
        <label className="text-sm font-medium mb-1.5 block">Shopify</label>
        {store.is_placeholder ? (
          <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
            <p className="text-xs text-muted-foreground">
              Essa loja ainda não existe na Shopify. Quando criá-la lá, conecte aqui os dados (domínio, Client ID e Client Secret) para ela virar uma loja de verdade nesta mesma coluna.
            </p>
            <button onClick={onConnect} className="h-9 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium">
              Conectar na Shopify
            </button>
          </div>
        ) : (
          <ReconnectBox store={store} />
        )}
      </div>
    </section>
  );
}

type Credential = { id: string; label: string; value: string };

function CredentialsSection({ storeId }: { storeId: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listStoreCredentials);
  const saveFn = useServerFn(saveStoreCredential);
  const deleteFn = useServerFn(deleteStoreCredential);
  const confirm = useConfirm();
  const queryKey = ["store-credentials", storeId];
  const [adding, setAdding] = useState(false);

  const { data: rows = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => listFn({ data: { shopify_store_id: storeId } }),
  });

  const save = useMutation({
    mutationFn: (input: { id?: string; label: string; value: string }) =>
      saveFn({ data: { ...input, shopify_store_id: storeId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
    onError: (e: any) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-end">
        {!adding && (
          <button onClick={() => setAdding(true)} className="h-8 px-3 rounded-lg border border-border text-xs font-medium flex items-center gap-1.5 hover:bg-muted">
            <Plus className="size-3.5" /> Adicionar
          </button>
        )}
      </div>
      {isLoading ? (
        <div className="flex justify-center py-4"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="space-y-2">
          {(rows as Credential[]).map((c) => (
            <CredentialRow
              key={c.id}
              credential={c}
              onSave={(label, value) => save.mutateAsync({ id: c.id, label, value })}
              onDelete={() => confirm(`Excluir "${c.label}"?`).then((ok) => { if (ok) remove.mutate(c.id); })}
            />
          ))}
          {adding && (
            <CredentialForm
              onCancel={() => setAdding(false)}
              onSave={(label, value) => save.mutateAsync({ label, value }).then(() => setAdding(false))}
            />
          )}
          {rows.length === 0 && !adding && (
            <p className="text-sm text-muted-foreground">Nenhum acesso salvo. Guarde aqui logins, senhas e tokens da loja.</p>
          )}
        </div>
      )}
    </section>
  );
}

function CredentialRow({ credential, onSave, onDelete }: {
  credential: Credential; onSave: (label: string, value: string) => Promise<unknown>; onDelete: () => void;
}) {
  const [visible, setVisible] = useState(false);
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <CredentialForm
        initial={credential}
        onCancel={() => setEditing(false)}
        onSave={(label, value) => onSave(label, value).then(() => setEditing(false))}
      />
    );
  }

  const copy = () => {
    navigator.clipboard.writeText(credential.value).then(
      () => toast.success("Copiado"),
      () => toast.error("Não foi possível copiar"),
    );
  };

  return (
    <div className="group rounded-xl border border-border bg-card px-3 py-2 flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground truncate">{credential.label}</p>
        <p className="text-sm font-mono truncate">{visible ? credential.value || "—" : "••••••••••"}</p>
      </div>
      <div className="flex items-center gap-0.5 shrink-0">
        <IconBtn title={visible ? "Ocultar" : "Mostrar"} onClick={() => setVisible((v) => !v)}>
          {visible ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </IconBtn>
        <IconBtn title="Copiar" onClick={copy}><Copy className="size-3.5" /></IconBtn>
        <IconBtn title="Editar" onClick={() => setEditing(true)}><Pencil className="size-3.5" /></IconBtn>
        <IconBtn title="Excluir" onClick={onDelete} danger><Trash2 className="size-3.5" /></IconBtn>
      </div>
    </div>
  );
}

function CredentialForm({ initial, onSave, onCancel }: {
  initial?: Credential; onSave: (label: string, value: string) => Promise<unknown>; onCancel: () => void;
}) {
  const [label, setLabel] = useState(initial?.label ?? "");
  const [value, setValue] = useState(initial?.value ?? "");
  const [saving, setSaving] = useState(false);

  const submit = () => {
    if (!label.trim()) return;
    setSaving(true);
    onSave(label.trim(), value).catch(() => {}).finally(() => setSaving(false));
  };

  return (
    <div className="rounded-xl border border-primary/40 bg-card p-3 space-y-2">
      <input
        autoFocus
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Nome (ex.: Login Shopify, Token Meta)"
        className="h-9 w-full px-3 rounded-lg border border-border bg-background text-sm outline-none focus:border-primary/50"
      />
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Login, senha, token..."
        rows={2}
        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm font-mono outline-none focus:border-primary/50 resize-y"
      />
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="h-8 px-3 rounded-lg text-xs font-medium flex items-center gap-1.5 hover:bg-muted">
          <X className="size-3.5" /> Cancelar
        </button>
        <button
          onClick={submit}
          disabled={saving || !label.trim()}
          className="h-8 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
        >
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Salvar
        </button>
      </div>
    </div>
  );
}

function IconBtn({ title, onClick, danger, children }: { title: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`size-7 rounded-md grid place-items-center text-muted-foreground ${danger ? "hover:bg-destructive/10 hover:text-destructive" : "hover:bg-muted hover:text-foreground"}`}
    >
      {children}
    </button>
  );
}

// Reconectar sem excluir: usa o Client ID/Secret já salvos e o mesmo domínio,
// então só atualiza a autorização e as permissões — Produção, acessos,
// pedidos e posição no quadro continuam iguais.
function ReconnectBox({ store }: { store: any }) {
  const reconnectFn = useServerFn(reconnectShopifyStore);
  const missingFn = useServerFn(getStoreMissingScopes);
  const { data, isLoading } = useQuery({
    queryKey: ["store-missing-scopes", store.id],
    queryFn: () => missingFn({ data: { shopify_store_id: store.id } }),
    staleTime: 60_000,
  });
  const missing = data?.missing ?? [];
  const go = useMutation({
    mutationFn: () => reconnectFn({ data: { shopify_store_id: store.id } }),
    onSuccess: (r) => { window.location.href = r.url; },
    onError: (e: any) => toast.error(e.message),
  });
  const connected = (
    <p className="text-xs text-muted-foreground">Conectada{store.shop_domain ? ` (${store.shop_domain})` : ""}.</p>
  );
  // Só a loja com permissão faltando mostra o aviso e o botão.
  if (isLoading || !data?.missing || missing.length === 0) return connected;
  return (
    <div className="space-y-2">
      {connected}
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 space-y-2">
        <p className="text-xs text-foreground">
          Faltam permissões: <span className="font-mono">{missing.join(", ")}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          Marque esses escopos no app da loja na Shopify e depois reconecte. Reconectar não apaga nada: usa o mesmo domínio e as
          credenciais já salvas, e só atualiza a autorização.
        </p>
        <button
          onClick={() => go.mutate()}
          disabled={go.isPending}
          className="h-9 px-3 rounded-lg border border-border bg-background text-sm font-medium flex items-center gap-1.5 hover:bg-muted disabled:opacity-50"
        >
          {go.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Reconectar na Shopify
        </button>
      </div>
    </div>
  );
}
