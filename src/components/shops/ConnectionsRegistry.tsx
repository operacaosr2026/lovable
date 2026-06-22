import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listConnections, deleteConnection,
  type ShopifyConnection,
} from "@/lib/shopify-connections.functions";
import { startShopifyOAuth } from "@/lib/shop-orders.functions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Plus, Trash2, Store, CheckCircle2, AlertCircle, Clock } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";

// ─── OAuth form ───────────────────────────────────────────────────────────────

function OAuthDialog({ open, onClose, onConnected }: {
  open: boolean;
  onClose: () => void;
  onConnected: () => void;
}) {
  const startOAuth = useServerFn(startShopifyOAuth);
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");

  useEffect(() => {
    if (!open) return;
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "shopify-oauth" && e.data?.ok) {
        onConnected();
        onClose();
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [open, onConnected, onClose]);

  const m = useMutation({
    mutationFn: () => startOAuth({ data: {
      name: name.trim(),
      shop_domain: domain.trim(),
      client_id: clientId.trim(),
      client_secret: clientSecret.trim(),
    } }),
    onSuccess: (r: any) => {
      if (r?.url) window.open(r.url, "_blank", "width=800,height=700");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const canSubmit = name.trim() && domain.trim() && clientId.trim() && clientSecret.trim();

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Adicionar loja Shopify</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground space-y-2">
            <p className="font-medium text-foreground">Como obter as credenciais:</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>Na sua loja Shopify, vá em <strong>Settings → Apps and sales channels → Develop apps</strong>.</li>
              <li>Crie um app, abra a aba <strong>Configuration</strong> e cole esta URL em <strong>Allowed redirection URL(s)</strong>:</li>
            </ol>
            <code className="block bg-background rounded px-2 py-1 text-[11px] break-all">
              https://lojas-one.vercel.app/api/public/shopify/callback
            </code>
            <p>Em <strong>Admin API access scopes</strong>, marque:</p>
            <code className="block bg-background rounded px-2 py-1 text-[11px] break-all">read_orders,read_products,read_shopify_payments_payouts</code>
            <p>Salve, vá em <strong>API credentials</strong> e copie <strong>Client ID</strong> e <strong>Client secret</strong>.</p>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Nome da loja</label>
            <input className="settings-input" placeholder="Ex: Loja Principal EUA" value={name} onChange={e => setName(e.target.value)} disabled={m.isPending} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Domínio</label>
            <input className="settings-input" placeholder="minha-loja.myshopify.com" value={domain} onChange={e => setDomain(e.target.value)} disabled={m.isPending} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Client ID</label>
            <input className="settings-input" placeholder="ex: 1a2b3c4d..." value={clientId} onChange={e => setClientId(e.target.value)} disabled={m.isPending} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Client Secret</label>
            <input className="settings-input" type="password" placeholder="shpss_..." value={clientSecret} onChange={e => setClientSecret(e.target.value)} disabled={m.isPending} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={m.isPending}>Cancelar</Button>
          <Button onClick={() => m.mutate()} disabled={m.isPending || !canSubmit}>
            {m.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Autorizar na Shopify
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function SyncStatusBadge({ status }: { status: string }) {
  if (status === "ok") return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-success">
      <CheckCircle2 className="size-3" /> Sincronizado
    </span>
  );
  if (status === "error") return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-destructive">
      <AlertCircle className="size-3" /> Erro
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
      <Clock className="size-3" /> Nunca sincronizado
    </span>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ConnectionsRegistry() {
  const qc = useQueryClient();
  const listFn   = useServerFn(listConnections);
  const deleteFn = useServerFn(deleteConnection);
  const confirm  = useConfirm();

  const [oauthOpen, setOauthOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["shopify-connections"],
    queryFn: () => listFn(),
  });
  const connections = data?.connections ?? [];

  const del = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Loja removida do banco");
      qc.invalidateQueries({ queryKey: ["shopify-connections"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const handleDelete = async (conn: ShopifyConnection) => {
    const ok = await confirm(`Remover "${conn.name}"? Esta loja não pode estar vinculada a nenhum grupo.`);
    if (ok) del.mutate(conn.id);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Banco de Lojas</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Cadastre cada loja Shopify individualmente. Depois, vincule-as a grupos.
          </p>
        </div>
        <Button size="sm" onClick={() => setOauthOpen(true)}>
          <Plus className="size-4" /> Adicionar loja
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
      ) : connections.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center space-y-2">
          <div className="size-10 rounded-xl bg-muted grid place-items-center mx-auto">
            <Store className="size-5 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium text-foreground">Nenhuma loja cadastrada</p>
          <p className="text-xs text-muted-foreground">Adicione a primeira loja para começar</p>
          <Button size="sm" className="mt-2" onClick={() => setOauthOpen(true)}>
            <Plus className="size-4" /> Adicionar loja
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {connections.map(conn => (
            <div
              key={conn.id}
              className="flex items-center gap-4 rounded-xl border border-border bg-card px-4 py-3 hover:border-primary/30 transition-colors"
            >
              <div className="size-9 rounded-xl bg-primary/10 text-primary grid place-items-center shrink-0">
                <Store className="size-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{conn.name}</p>
                <p className="text-xs text-muted-foreground truncate">{conn.shop_domain}</p>
              </div>
              <SyncStatusBadge status={conn.last_sync_status} />
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => handleDelete(conn)}
                  disabled={del.isPending}
                  className="size-7 rounded-lg hover:bg-destructive/10 grid place-items-center text-muted-foreground hover:text-destructive transition-colors"
                  title="Remover"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <OAuthDialog
        open={oauthOpen}
        onClose={() => setOauthOpen(false)}
        onConnected={() => {
          qc.invalidateQueries({ queryKey: ["shopify-connections"] });
          toast.success("Loja adicionada ao banco");
        }}
      />
    </div>
  );
}
