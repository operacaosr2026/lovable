import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { upsertPricing, updateProduct } from "@/lib/products.functions";

const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(isFinite(n) ? n : 0);
const pct = (n: number) => `${(isFinite(n) ? n : 0).toFixed(2)}%`;

export function ProductPricing({ product, pricing }: { product: any; pricing: any | null }) {
  const qc = useQueryClient();
  const upsertFn = useServerFn(upsertPricing);
  const updateProdFn = useServerFn(updateProduct);

  const [cost, setCost] = useState(String(product.cost ?? 0));
  const [salePrice, setSalePrice] = useState(String(product.sale_price ?? 0));
  const [iof, setIof] = useState(String(pricing?.iof_pct ?? 0));
  const [payments, setPayments] = useState(String(pricing?.payments_pct ?? 0));
  const [domPag, setDomPag] = useState(String(pricing?.dom_pagamentos_pct ?? 0));
  const [chargeback, setChargeback] = useState(String(pricing?.retorno_chargeback_pct ?? 0));
  const [imposto, setImposto] = useState(String(pricing?.imposto_pct ?? 0));
  const [marketing, setMarketing] = useState(String(pricing?.marketing_pct ?? 0));

  const upsert = useMutation({ mutationFn: (input: any) => upsertFn({ data: input }) });
  const updateProd = useMutation({ mutationFn: (input: any) => updateProdFn({ data: input }), onSuccess: () => qc.invalidateQueries({ queryKey: ["products"] }) });

  // debounced persist
  useEffect(() => {
    const t = setTimeout(() => {
      upsert.mutate({
        product_id: product.id,
        iof_pct: Number(iof) || 0,
        payments_pct: Number(payments) || 0,
        dom_pagamentos_pct: Number(domPag) || 0,
        retorno_chargeback_pct: Number(chargeback) || 0,
        imposto_pct: Number(imposto) || 0,
        marketing_pct: Number(marketing) || 0,
      });
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iof, payments, domPag, chargeback, imposto, marketing]);

  useEffect(() => {
    const t = setTimeout(() => {
      updateProd.mutate({ id: product.id, patch: { cost: Number(cost) || 0, sale_price: Number(salePrice) || 0 } });
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cost, salePrice]);

  const calc = useMemo(() => {
    const c = Number(cost) || 0;
    const sp = Number(salePrice) || 0;
    const fixedPct = (Number(iof) || 0) + (Number(payments) || 0) + (Number(domPag) || 0) + (Number(chargeback) || 0) + (Number(imposto) || 0);
    const mkt = Number(marketing) || 0;
    const fixedCost = sp * (fixedPct / 100);
    const cpa = sp * (mkt / 100);
    const maxCpa = sp - c - fixedCost;
    const profit = sp - c - fixedCost - cpa;
    const profitPct = sp > 0 ? (profit / sp) * 100 : 0;
    const markup = c > 0 ? sp / c : 0;
    return { fixedPct, fixedCost, cpa, maxCpa, profit, profitPct, markup };
  }, [cost, salePrice, iof, payments, domPag, chargeback, imposto, marketing]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Section title="Detalhe do Produto">
        <Field label="Custo do produto (USD)"><NumInput value={cost} onChange={setCost} /></Field>
        <Field label="Preço de venda (USD)"><NumInput value={salePrice} onChange={setSalePrice} /></Field>
      </Section>

      <Section title="Custos Fixos (%)">
        <Field label="IOF Aliexpress"><NumInput value={iof} onChange={setIof} suffix="%" /></Field>
        <Field label="Payments"><NumInput value={payments} onChange={setPayments} suffix="%" /></Field>
        <Field label="Dom Pagamentos"><NumInput value={domPag} onChange={setDomPag} suffix="%" /></Field>
        <Field label="Retorno e Chargeback"><NumInput value={chargeback} onChange={setChargeback} suffix="%" /></Field>
        <Field label="Imposto"><NumInput value={imposto} onChange={setImposto} suffix="%" /></Field>
      </Section>

      <Section title="Custo de Marketing">
        <Field label="Porcentagem de marketing"><NumInput value={marketing} onChange={setMarketing} suffix="%" /></Field>
      </Section>

      <Section title="Estimador" highlight>
        <Stat label="Markup" value={`${calc.markup.toFixed(2)}x`} />
        <Stat label="Preço de Venda" value={usd(Number(salePrice) || 0)} />
        <Stat label="Custo Fixo" value={usd(calc.fixedCost)} sub={pct(calc.fixedPct)} />
        <Stat label="CPA" value={usd(calc.cpa)} />
        <Stat label="Máximo CPA" value={usd(calc.maxCpa)} />
        <Stat label="Lucro" value={usd(calc.profit)} accent={calc.profit < 0 ? "danger" : "success"} />
        <Stat label="% de Lucro" value={pct(calc.profitPct)} accent={calc.profitPct < 0 ? "danger" : "success"} />
      </Section>
    </div>
  );
}

function Section({ title, children, highlight }: { title: string; children: React.ReactNode; highlight?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 ${highlight ? "border-primary/30 bg-primary/5" : "border-border bg-surface"}`}>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-3">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="w-32">{children}</div>
    </label>
  );
}

function NumInput({ value, onChange, suffix }: { value: string; onChange: (v: string) => void; suffix?: string }) {
  return (
    <div className="relative">
      <input type="number" step="0.01" value={value} onChange={(e) => onChange(e.target.value)} className="w-full px-2 h-9 rounded-lg bg-background border border-border text-sm outline-none focus:border-primary/50 tabular-nums text-right pr-7" />
      {suffix && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">{suffix}</span>}
    </div>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: "success" | "danger" }) {
  const color = accent === "danger" ? "text-rose-500" : accent === "success" ? "text-emerald-500" : "text-foreground";
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="text-right">
        <div className={`text-sm font-semibold tabular-nums ${color}`}>{value}</div>
        {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
      </div>
    </div>
  );
}
