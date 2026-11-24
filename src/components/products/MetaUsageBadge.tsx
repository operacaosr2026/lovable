import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Gauge, RefreshCw } from "lucide-react";
import { getMetaUsage } from "@/lib/product-ads.functions";
import { cn } from "@/lib/utils";

// Quanto do limite de chamadas da Meta já foi usado (pela conta de anúncio e pelo app).
// Em 100% a Meta pausa as chamadas por alguns minutos.
export function MetaUsageBadge({ adAccountId, live = false, className }: { adAccountId?: string; live?: boolean; className?: string }) {
  const fn = useServerFn(getMetaUsage);
  const q = useQuery({
    queryKey: ["meta-usage", adAccountId],
    enabled: !!adAccountId,
    queryFn: () => fn({ data: { ad_account_id: adAccountId! } }),
    refetchInterval: live ? 60_000 : 5 * 60_000,
    staleTime: 30_000,
  });
  if (!adAccountId) return null;
  const u = q.data;
  const pct = u?.pct ?? 0;
  const tone = !u ? "text-muted-foreground" : u.limited || pct >= 90 ? "text-destructive" : pct >= 60 ? "text-warning" : "text-success";
  const bar = !u ? "bg-muted-foreground/40" : u.limited || pct >= 90 ? "bg-destructive" : pct >= 60 ? "bg-warning" : "bg-success";
  const title = [
    "Quanto do limite de chamadas da Meta já foi usado nesta conta (janela de ~1 hora).",
    "Em 100% a Meta pausa as chamadas por alguns minutos e o sistema espera sozinho.",
    u?.tier ? `Nível de acesso: ${u.tier === "development_access" ? "desenvolvimento (limite menor)" : u.tier === "standard_access" ? "padrão" : u.tier}.` : "",
  ].filter(Boolean).join(" ");
  return (
    <div className={cn("inline-flex items-center gap-1.5 text-xs", className)} title={title}>
      <Gauge className={cn("size-3.5", tone)} />
      <span className="text-muted-foreground">Uso da Meta</span>
      {q.isLoading ? <span className="text-muted-foreground">…</span> : q.error ? <span className="text-muted-foreground">indisponível</span> : (
        <>
          <span className="w-12 h-1.5 rounded-full bg-muted overflow-hidden"><span className={cn("block h-full", bar)} style={{ width: `${Math.max(3, pct)}%` }} /></span>
          <span className={cn("font-semibold tabular-nums", tone)}>{pct}%</span>
          {u?.limited && <span className="text-destructive">· libera em ~{Math.max(1, u.regain_minutes)} min</span>}
        </>
      )}
      <button type="button" onClick={() => q.refetch()} className="text-muted-foreground hover:text-foreground" title="Atualizar">
        <RefreshCw className={cn("size-3", q.isFetching && "animate-spin")} />
      </button>
    </div>
  );
}
