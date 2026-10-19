import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { LgCashflowView } from "@/components/lojas-grupos/LgCashflowView";
import { updateLgCardShopConfig } from "@/lib/lg-cards.functions";
import { listShopCash, setPayoutsToBalance } from "@/lib/shop-cash.functions";
import { toast } from "sonner";

type ShopConfig = {
  id:           string;
  name:         string;
  payout_days:  number;
  payment_days: number;
};

export function LgCaixa({
  cardId,
  shopIds,
  shops,
}: {
  cardId:  string;
  shopIds: string[];
  shops:   ShopConfig[];
}) {
  const qc             = useQueryClient();
  const updateConfigFn = useServerFn(updateLgCardShopConfig);
  const [open, setOpen] = useState(false);

  // Local editable state for payout_days per shop
  const [payoutDraft, setPayoutDraft] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const s of shops) init[s.id] = String(s.payout_days);
    return init;
  });
  const [saving, setSaving] = useState<string | null>(null);

  // Mesma consulta (e cache) do LgCashflowView — traz quais lojas têm o
  // repasse caindo no Shopify Balance.
  const cashKey  = ["shop-cash", shopIds.slice().sort().join(",")];
  const listFn   = useServerFn(listShopCash);
  const cashQuery = useQuery({ queryKey: cashKey, queryFn: () => listFn({ data: { shop_ids: shopIds } }) });
  const balanceIds = new Set<string>((cashQuery.data as any)?.balance_shop_ids ?? []);
  const setBalanceFn = useServerFn(setPayoutsToBalance);
  const toggleBalance = async (shopId: string, enabled: boolean) => {
    try {
      await setBalanceFn({ data: { shop_id: shopId, enabled } });
      qc.invalidateQueries({ queryKey: cashKey });
      toast.success(enabled ? "Repasses dessa loja marcados como Shopify Balance" : "Repasses voltam pro banco");
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao salvar");
    }
  };

  const savePayoutDays = async (shopId: string) => {
    const val = parseInt(payoutDraft[shopId] ?? "10", 10);
    if (isNaN(val) || val < 0 || val > 365) return;
    setSaving(shopId);
    try {
      await updateConfigFn({ data: { card_id: cardId, shop_id: shopId, payout_days: val } });
      qc.invalidateQueries({ queryKey: ["lg-card", cardId] });
      toast.success("Período de repasse atualizado");
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao salvar");
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-3 lg:flex-1 lg:min-h-0 lg:flex lg:flex-col">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Configurações de Repasse</DialogTitle>
          </DialogHeader>
          <div className="divide-y divide-border">
            {shops.map((shop) => (
              <div key={shop.id} className="flex items-center gap-3 py-3">
                <div className="size-7 rounded-lg bg-primary/10 text-primary text-xs font-semibold grid place-items-center shrink-0">
                  {shop.name?.[0]?.toUpperCase()}
                </div>
                <span className="text-sm text-foreground flex-1 truncate">{shop.name}</span>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none shrink-0" title="Os repasses dessa loja caem no Shopify Balance">
                  <input type="checkbox" checked={balanceIds.has(shop.id)} onChange={(e) => toggleBalance(shop.id, e.target.checked)} className="size-3.5 accent-primary" />
                  Balance
                </label>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-xs text-muted-foreground">D+</span>
                  <input
                    type="number"
                    min={0}
                    max={365}
                    value={payoutDraft[shop.id] ?? String(shop.payout_days)}
                    onChange={(e) => setPayoutDraft((prev) => ({ ...prev, [shop.id]: e.target.value }))}
                    className="w-16 h-7 rounded-lg border border-border bg-card text-foreground text-xs px-2 focus:outline-none focus:border-primary text-center"
                  />
                  <span className="text-xs text-muted-foreground">dias</span>
                  <button
                    onClick={() => savePayoutDays(shop.id)}
                    disabled={saving === shop.id}
                    className="size-7 rounded-lg bg-primary grid place-items-center text-primary-foreground disabled:opacity-50"
                  >
                    {saving === shop.id
                      ? <div className="size-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      : <Check className="size-3.5" />}
                  </button>
                </div>
              </div>
            ))}
            <div className="pt-2">
              <p className="text-[11px] text-muted-foreground">
                Os payouts pendentes são estimados usando D+ configurado por loja. Altere para ajustar a previsão no caixa.
                Marque "Balance" nas lojas cujo repasse cai no Shopify Balance — os depósitos dela ganham a marca no caixa.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <LgCashflowView
        shopIds={shopIds}
        shopNamesMap={Object.fromEntries(shops.map((s) => [s.id, s.name]))}
        simplified
        fill
        onManagePayoutDays={() => setOpen(true)}
      />
    </div>
  );
}
