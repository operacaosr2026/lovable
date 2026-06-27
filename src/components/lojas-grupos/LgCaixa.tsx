import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Settings2, ChevronDown, ChevronUp, Check } from "lucide-react";
import { LgCashflowView } from "@/components/lojas-grupos/LgCashflowView";
import { updateLgCardShopConfig } from "@/lib/lg-cards.functions";
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
    <div className="space-y-3">
      {/* ── Payout config section ── */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <button
          onClick={() => setOpen((o) => !o)}
          className="w-full flex items-center gap-2 px-5 py-3 text-left hover:bg-muted/30 transition-colors"
        >
          <Settings2 className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground flex-1">Configurações de Repasse</span>
          <span className="text-xs text-muted-foreground mr-2">Período D+X por loja</span>
          {open ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
        </button>

        {open && (
          <div className="border-t border-border divide-y divide-border">
            {shops.map((shop) => (
              <div key={shop.id} className="flex items-center gap-3 px-5 py-3">
                <div className="size-7 rounded-lg bg-primary/10 text-primary text-xs font-semibold grid place-items-center shrink-0">
                  {shop.name?.[0]?.toUpperCase()}
                </div>
                <span className="text-sm text-foreground flex-1 truncate">{shop.name}</span>
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
            <div className="px-5 py-2">
              <p className="text-[11px] text-muted-foreground">
                Os payouts pendentes são estimados usando D+ configurado por loja. Altere para ajustar a previsão no caixa.
              </p>
            </div>
          </div>
        )}
      </div>

      <LgCashflowView
        shopIds={shopIds}
        shopNamesMap={Object.fromEntries(shops.map((s) => [s.id, s.name]))}
      />
    </div>
  );
}
