import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw, ShoppingBag } from "lucide-react";
import { getProductMonthlySales } from "@/lib/products.functions";

const PERIODS = [
  { months: 6, label: "6 meses" },
  { months: 12, label: "12 meses" },
  { months: 24, label: "24 meses" },
] as const;

function monthLabel(month: string) {
  const d = new Date(`${month}-01T00:00:00Z`);
  const label = d.toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function fmtMoney(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n);
}

export function ProductSales({ productId }: { productId: string }) {
  const [months, setMonths] = useState<number>(12);
  const fn = useServerFn(getProductMonthlySales);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["product-sales", productId, months],
    queryFn: () => fn({ data: { product_id: productId, months } }),
  });

  const rows = data?.months ?? [];
  const totals = data?.totals ?? { units: 0, revenue: 0, pedidos: 0 };

  return (
    <div className="max-w-3xl space-y-4">
      {/* Vendas são contadas casando o título dos itens do pedido com o nome/
          palavras-chave do produto (aba Cadastro) — mesmo mecanismo que já
          identifica o custo do produto no Caixa e em Pedidos. Não existe uma
          tabela separada de "vendas": é sempre derivado dos pedidos reais, pra
          nunca ficar dessincronizado. */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-xs text-muted-foreground">
          Unidades vendidas por mês, identificadas pelo nome/palavras-chave do produto nos pedidos.
        </div>
        <div className="inline-flex items-center rounded-lg border border-border overflow-hidden text-xs h-8 shrink-0">
          {PERIODS.map((p) => (
            <button
              key={p.months}
              onClick={() => setMonths(p.months)}
              className={`px-3 h-full transition-colors ${months === p.months ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <SummaryCard label="Unidades vendidas" value={totals.units.toLocaleString("pt-BR")} />
        <SummaryCard label="Pedidos" value={totals.pedidos.toLocaleString("pt-BR")} />
        <SummaryCard label="Receita" value={fmtMoney(totals.revenue)} />
      </div>

      <div className="rounded-2xl border border-border bg-surface overflow-hidden">
        <div className="grid grid-cols-[1fr_100px_100px_120px] gap-3 px-4 py-2 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
          <div>Mês</div>
          <div className="text-right">Pedidos</div>
          <div className="text-right">Unidades</div>
          <div className="text-right">Receita</div>
        </div>

        {isLoading && (
          <div className="p-8 text-center text-sm text-muted-foreground">
            <RefreshCw className="size-4 animate-spin mx-auto mb-2" />
            Carregando vendas...
          </div>
        )}

        {!isLoading && rows.length === 0 && (
          <div className="p-8 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
            <ShoppingBag className="size-6 text-muted-foreground/50" />
            Nenhuma venda encontrada no período. Confira se o nome/palavras-chave
            do produto (aba Cadastro) batem com o título nos pedidos.
          </div>
        )}

        {!isLoading && rows.map((r, i) => (
          <div
            key={r.month}
            className={`grid grid-cols-[1fr_100px_100px_120px] gap-3 px-4 py-2.5 items-center text-sm ${i > 0 ? "border-t border-border/60" : ""}`}
          >
            <div className="font-medium text-foreground">{monthLabel(r.month)}</div>
            <div className="text-right text-muted-foreground tabular-nums">{r.pedidos}</div>
            <div className="text-right font-semibold tabular-nums">{r.units}</div>
            <div className="text-right text-muted-foreground tabular-nums">{fmtMoney(r.revenue)}</div>
          </div>
        ))}
      </div>

      {isFetching && !isLoading && (
        <div className="text-xs text-muted-foreground">Atualizando...</div>
      )}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-1">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
