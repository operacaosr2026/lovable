import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, RotateCcw, ShieldAlert } from "lucide-react";
import { getChargebackSimulatorData } from "@/lib/chargeback-simulator.functions";

// Caixa Geral > Simulador Chargeback.
//  - Taxa × limite: taxa de 90 dias de cada loja (a mesma do card de Lojas e
//    Grupos / da Shopify) contra o limite escolhido, e quantos chargebacks
//    ainda cabem antes de passar dele.
//  - E se…: somar chargebacks e/ou pedidos por loja e ver a taxa simulada.

const LIMITS = [
  { value: 0.0065, label: "0,65% — Visa (alerta antecipado)" },
  { value: 0.009, label: "0,9% — Visa (monitoramento)" },
  { value: 0.01, label: "1% — Shopify / processadoras" },
  { value: 0.015, label: "1,5% — Mastercard" },
];

type Status = "ok" | "warn" | "over" | "none";
function statusOf(rate: number | null, limit: number): Status {
  if (rate == null) return "none";
  if (rate > limit) return "over";
  if (rate >= limit * 0.75) return "warn";
  return "ok";
}
const STATUS_META: Record<Status, { label: string; cls: string; bar: string }> = {
  ok: { label: "Seguro", cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", bar: "bg-emerald-500" },
  warn: { label: "Atenção", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400", bar: "bg-amber-500" },
  over: { label: "Acima do limite", cls: "bg-destructive/10 text-destructive", bar: "bg-destructive" },
  none: { label: "Sem pedidos", cls: "bg-muted text-muted-foreground", bar: "bg-muted-foreground" },
};

const pct = (r: number | null) => (r == null ? "—" : `${(r * 100).toFixed(2).replace(".", ",")}%`);
const rateOf = (cb: number, orders: number) => (orders > 0 ? cb / orders : null);
// Chargebacks que ainda cabem sem passar do limite (negativo = já passou).
const room = (cb: number, orders: number, limit: number) => Math.floor(limit * orders + 1e-9) - cb;

export function ChargebackSimulator() {
  const getFn = useServerFn(getChargebackSimulatorData);
  const q = useQuery({ queryKey: ["chargeback-simulator"], queryFn: () => getFn() });
  const [limit, setLimit] = useState(0.01);
  // "E se…": acréscimos por loja.
  const [extra, setExtra] = useState<Record<string, { cb: number; orders: number }>>({});
  const setField = (id: string, field: "cb" | "orders", v: number) =>
    setExtra((cur) => ({ ...cur, [id]: { ...(cur[id] ?? { cb: 0, orders: 0 }), [field]: Math.max(0, Math.floor(v || 0)) } }));
  const simulating = Object.values(extra).some((e) => e.cb || e.orders);

  const shops = q.data?.shops ?? [];
  const total = useMemo(() => {
    const cb = shops.reduce((s, x) => s + x.chargebacks, 0);
    const orders = shops.reduce((s, x) => s + x.pedidos, 0);
    const addCb = shops.reduce((s, x) => s + (extra[x.id]?.cb ?? 0), 0);
    const addOrders = shops.reduce((s, x) => s + (extra[x.id]?.orders ?? 0), 0);
    return { cb, orders, rate: rateOf(cb, orders), simRate: rateOf(cb + addCb, orders + addOrders) };
  }, [shops, extra]);

  if (q.isLoading) return <div className="text-sm text-muted-foreground">Carregando...</div>;
  if (q.isError) return <div className="text-sm text-destructive">{(q.error as any)?.message ?? "Erro ao carregar"}</div>;

  const totalStatus = statusOf(simulating ? total.simRate : total.rate, limit);

  return (
    <div className="space-y-4">
      {/* Resumo + limite */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-2xl border border-border bg-surface p-4">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-1">Limite</div>
          <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}
            className="w-full h-9 px-2.5 rounded-lg bg-background border border-border text-sm outline-none focus:border-primary">
            {LIMITS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
          <div className="text-xs text-muted-foreground mt-1.5">Taxa dos últimos {q.data?.windowDays ?? 90} dias.</div>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-1">Todas as lojas</div>
          <div className="text-xl font-semibold tabular-nums">
            {pct(total.rate)}
            {simulating && <span className="text-sm font-medium text-muted-foreground"> → {pct(total.simRate)}</span>}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">{total.cb} chargebacks · {total.orders} pedidos</div>
        </div>
        <div className={`rounded-2xl border p-4 ${totalStatus === "over" ? "border-destructive/30 bg-destructive/5" : totalStatus === "warn" ? "border-amber-500/30 bg-amber-500/5" : "border-emerald-500/30 bg-emerald-500/5"}`}>
          {(() => {
            const over = shops.filter((s) => statusOf(rateOf(s.chargebacks + (extra[s.id]?.cb ?? 0), s.pedidos + (extra[s.id]?.orders ?? 0)), limit) === "over");
            return over.length ? (
              <>
                <div className="flex items-center gap-1.5 text-destructive text-[11px] uppercase tracking-wider font-medium mb-1">
                  <AlertTriangle className="size-3.5" /> {simulating ? "Na simulação" : "Agora"}
                </div>
                <div className="text-xl font-semibold text-destructive">{over.length} loja{over.length > 1 ? "s" : ""} acima do limite</div>
                <div className="text-xs text-muted-foreground mt-0.5 truncate">{over.map((s) => s.name).join(", ")}</div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-1.5 text-emerald-600 text-[11px] uppercase tracking-wider font-medium mb-1">
                  <CheckCircle2 className="size-3.5" /> {simulating ? "Na simulação" : "Agora"}
                </div>
                <div className="text-xl font-semibold text-emerald-600">Todas dentro do limite</div>
              </>
            );
          })()}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          <b className="text-foreground">E se…</b> some chargebacks ou pedidos em cada loja para ver como a taxa fica.
        </p>
        {simulating && (
          <button onClick={() => setExtra({})} className="h-8 px-3 rounded-lg border border-border text-xs font-medium flex items-center gap-1.5 hover:bg-muted shrink-0">
            <RotateCcw className="size-3.5" /> Limpar simulação
          </button>
        )}
      </div>

      {/* Lojas */}
      {!shops.length ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">Nenhuma loja conectada.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {shops.map((s) => {
            const add = extra[s.id] ?? { cb: 0, orders: 0 };
            const rate = rateOf(s.chargebacks, s.pedidos);
            const simCb = s.chargebacks + add.cb;
            const simOrders = s.pedidos + add.orders;
            const simRate = rateOf(simCb, simOrders);
            const changed = add.cb > 0 || add.orders > 0;
            const shownRate = changed ? simRate : rate;
            const st = statusOf(shownRate, limit);
            const left = room(simCb, simOrders, limit);
            return (
              <div key={s.id} className="rounded-2xl border border-border bg-surface p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">{s.name}</div>
                    <div className="text-[11px] text-muted-foreground">{s.chargebacks} chargebacks · {s.pedidos} pedidos</div>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold shrink-0 ${STATUS_META[st].cls}`}>{STATUS_META[st].label}</span>
                </div>

                <div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold tabular-nums">{pct(shownRate)}</span>
                    {changed && <span className="text-xs text-muted-foreground tabular-nums">antes {pct(rate)}</span>}
                  </div>
                  {/* Barra: taxa em relação ao limite (o traço é o limite). */}
                  <div className="relative h-2 rounded-full bg-muted mt-2 overflow-hidden">
                    <div className={`h-full rounded-full ${STATUS_META[st].bar}`}
                      style={{ width: `${Math.min(100, ((shownRate ?? 0) / (limit * 1.5)) * 100)}%` }} />
                    <div className="absolute top-0 bottom-0 w-0.5 bg-foreground/60" style={{ left: `${100 / 1.5}%` }} />
                  </div>
                  <div className="text-xs mt-1.5">
                    {simOrders === 0 ? (
                      <span className="text-muted-foreground">Sem pedidos no período.</span>
                    ) : left >= 0 ? (
                      <span className="text-muted-foreground">Cabem mais <b className="text-foreground">{left}</b> chargeback{left === 1 ? "" : "s"} antes de passar de {pct(limit)}.</span>
                    ) : (
                      <span className="text-destructive flex items-center gap-1"><ShieldAlert className="size-3.5" /> {-left} chargeback{left === -1 ? "" : "s"} acima do limite de {pct(limit)}.</span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-1 border-t border-border">
                  <label className="text-[11px] text-muted-foreground space-y-1 pt-2">
                    <span className="block">+ chargebacks</span>
                    <input type="number" min={0} inputMode="numeric" value={add.cb || ""} placeholder="0"
                      onChange={(e) => setField(s.id, "cb", Number(e.target.value))}
                      className="w-full h-9 px-2.5 rounded-lg bg-background border border-border text-sm text-foreground outline-none focus:border-primary" />
                  </label>
                  <label className="text-[11px] text-muted-foreground space-y-1 pt-2">
                    <span className="block">+ pedidos</span>
                    <input type="number" min={0} inputMode="numeric" value={add.orders || ""} placeholder="0"
                      onChange={(e) => setField(s.id, "orders", Number(e.target.value))}
                      className="w-full h-9 px-2.5 rounded-lg bg-background border border-border text-sm text-foreground outline-none focus:border-primary" />
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
