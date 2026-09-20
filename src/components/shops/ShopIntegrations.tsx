import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { startShopifyOAuth } from "@/lib/shop-orders.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

export function ConnectStoreDialog({ open, onClose, onConnected, initialName, replacePlaceholderId }: {
  open: boolean; onClose: () => void; onConnected?: (s: any) => void;
  initialName?: string; replacePlaceholderId?: string;
}) {
  const startOAuth = useServerFn(startShopifyOAuth);
  const [name, setName] = useState(initialName ?? "");
  const [domain, setDomain] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");

  const m = useMutation({
    mutationFn: () => startOAuth({ data: {
      name: name.trim(),
      shop_domain: domain.trim(),
      client_id: clientId.trim(),
      client_secret: clientSecret.trim(),
      replace_placeholder_id: replacePlaceholderId,
    } }),
    onSuccess: (r: any) => { if (r?.url) window.location.href = r.url; },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Conectar loja Shopify</DialogTitle></DialogHeader>
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
            <code className="block bg-background rounded px-2 py-1 text-[11px] break-all">read_orders,read_products,read_shopify_payments_payouts,read_shopify_payments_disputes</code>
            <p>Salve, vá em <strong>API credentials</strong> e copie <strong>Client ID</strong> e <strong>Client secret</strong>.</p>
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Nome</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Minha loja" />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Domínio</label>
            <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="minha-loja.myshopify.com" />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Client ID</label>
            <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="ex: 1a2b3c4d..." />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Client Secret</label>
            <Input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="shpss_..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => m.mutate()}
            disabled={m.isPending || !name.trim() || !domain.trim() || !clientId.trim() || !clientSecret.trim()}>
            {m.isPending && <Loader2 className="size-4 animate-spin" />} Autorizar na Shopify
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
