import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Brain, DollarSign, Hammer, LayoutDashboard, Loader2, Megaphone, Package, Target, TrendingUp, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { getProduct, updateProduct, saveProductPricing, listCreatives } from "@/lib/products.functions";
import { useProductStatuses } from "@/components/products/product-status";
import { ProductCreatives } from "@/components/products/ProductCreatives";
import { ProductSales } from "@/components/products/ProductSales";
import { ProductCampaigns } from "@/components/products/ProductCampaigns";
import { NamingGenerator } from "@/components/products/Naming";
import { ProductionTab } from "@/components/shops/StoreProduction";
import { ProductShopifyTab } from "@/components/products/ProductShopifyTab";
import { ProductPageTab } from "@/components/products/ProductPageTab";
import { ProductCompetitors } from "@/components/products/ProductCompetitors";
import { ProductAds } from "@/components/products/ProductAds";
import { ProductCopies, useProductCopies } from "@/components/products/ProductCopies";
import { ProductSyncCard } from "@/components/products/ProductSyncCard";
import { ProductCostField } from "@/components/products/ProductCostHistory";

const GROUPS = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, tabs: [{ id: "vendas", label: "Dashboard" }] },
  {
    id: "inteligencia", label: "Inteligência do produto", icon: Brain,
    tabs: [
      { id: "viabilidade", label: "Viabilidade" },
      { id: "informacoes", label: "Informações" },
      { id: "concorrentes", label: "Concorrentes" },
    ],
  },
  {
    id: "producao", label: "Produção", icon: Hammer,
    tabs: [
      { id: "pagina", label: "Página" },
      { id: "shopify", label: "Publicar nas lojas" },
    ],
  },
  {
    id: "trafego", label: "Tráfego", icon: Megaphone,
    tabs: [
      { id: "campanhas", label: "Campanhas" },
      { id: "criativos", label: "Criativos" },
      { id: "textos", label: "Títulos e Descrições" },
      { id: "anuncios", label: "Lançamentos" },
    ],
  },
] as const;

type TabId = typeof GROUPS[number]["tabs"][number]["id"];

// Conteúdo do produto (cabeçalho + abas) — usado no popup da página Produtos
// e na página /shops/products/$productId (link direto).
export function ProductDetails({ productId, sticky = false }: { productId: string; sticky?: boolean }) {
  const qc = useQueryClient();
  const get = useServerFn(getProduct);
  const updateFn = useServerFn(updateProduct);

  const [tab, setTab] = useState<TabId>("vendas");
  const listCreativesFn = useServerFn(listCreatives);
  const creativesQ = useQuery({ queryKey: ["creatives", productId], queryFn: () => listCreativesFn({ data: { product_id: productId } }) });
  const { data: copies } = useProductCopies(productId);
  const counts = { criativos: creativesQ.data?.creatives?.length ?? 0, textos: copies?.length ?? 0 };

  const { data, isLoading } = useQuery({ queryKey: ["product", productId], queryFn: () => get({ data: { id: productId } }) });
  const update = useMutation({
    mutationFn: (patch: any) => updateFn({ data: { id: productId, patch } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["product", productId] }); qc.invalidateQueries({ queryKey: ["products"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading || !data) return <DetailsSkeleton />;
  const product = data.product;
  const group = GROUPS.find((g) => g.tabs.some((t) => t.id === tab))!;

  return (
    <div className="min-w-0">
      {/* Cabeçalho + abas: ficam no topo ao rolar (no popup). */}
      <div className={sticky ? "sticky -top-6 z-20 -mx-6 -mt-6 px-6 pt-6 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/85 mb-5" : "mb-5"}>
        <ProductHeader product={product} pricing={data.pricing} />

        <div className="flex gap-1 overflow-x-auto border-b border-border [scrollbar-width:none]">
          {GROUPS.map((g) => {
            const active = g.id === group.id;
            return (
              <button
                key={g.id}
                onClick={() => setTab(g.tabs[0].id)}
                className={`flex items-center gap-2 px-3.5 h-11 text-sm font-semibold border-b-2 -mb-px whitespace-nowrap transition-colors ${active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              >
                <g.icon className={`size-4 ${active ? "text-primary" : ""}`} />
                {g.label}
              </button>
            );
          })}
        </div>

        {group.tabs.length > 1 && (
          <div className="flex gap-1 overflow-x-auto py-2.5 [scrollbar-width:none]">
            {group.tabs.map((t) => {
              const count = counts[t.id as keyof typeof counts];
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-[13px] font-medium whitespace-nowrap transition-colors ${active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
                >
                  {t.label}
                  {count ? <span className={`min-w-5 h-5 px-1.5 rounded-full text-[11px] font-semibold grid place-items-center tabular-nums ${active ? "bg-primary/15" : "bg-muted text-muted-foreground"}`}>{count}</span> : null}
                </button>
              );
            })}
          </div>
        )}
        {group.tabs.length <= 1 && <div className="h-2.5" />}
      </div>

      {tab === "informacoes" && (
        <div className="space-y-4">
          <Card icon={Package} accent="primary" title="Cadastro" subtitle="Nome, custo e os produtos da Shopify que são este card nos pedidos">
            <FixedFields product={product} onSave={(patch) => update.mutate(patch)} />
          </Card>
          <Card><ProductionTab kind="product" targetId={productId} section="info" /></Card>
        </div>
      )}
      {tab === "viabilidade" && (
        <Card icon={DollarSign} accent="success" title="Precificação" subtitle="Margem por unidade com o CPA que você estima">
          <Pricing product={product} pricing={data.pricing} />
        </Card>
      )}
      {tab === "criativos" && <ProductCreatives productId={productId} />}
      {tab === "vendas" && <ProductSales productId={productId} />}
      {tab === "campanhas" && <ProductCampaigns productId={productId} />}
      {tab === "pagina" && <ProductPageTab productId={productId} />}
      {tab === "shopify" && <ProductShopifyTab productId={productId} />}
      {tab === "concorrentes" && <ProductCompetitors productId={productId} />}
      {tab === "textos" && <ProductCopies productId={productId} />}
      {tab === "anuncios" && <AdsTab productId={productId} />}
    </div>
  );
}

// Lançamentos (dentro de Tráfego): criar campanha + gerador de nomenclatura.
function AdsTab({ productId }: { productId: string }) {
  const [sub, setSub] = useState<"criar" | "nomenclatura">("criar");
  return (
    <div>
      <div className="mb-4 inline-flex items-center rounded-lg border border-border bg-surface p-0.5">
        {([["criar", "Criar campanha"], ["nomenclatura", "Nomenclatura"]] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setSub(id)}
            className={`h-7 px-3 rounded-md text-xs font-medium transition-colors ${sub === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {sub === "criar" ? <ProductAds productId={productId} /> : <NamingGenerator />}
    </div>
  );
}

export function ProductDetailsDialog({ productId, onClose }: { productId: string; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="w-full max-w-[min(96vw,1400px)] h-[90vh] overflow-y-auto [scrollbar-gutter:stable]">
        <DialogTitle className="sr-only">Produto</DialogTitle>
        <ProductDetails productId={productId} sticky />
      </DialogContent>
    </Dialog>
  );
}

type Accent = "primary" | "info" | "warning" | "success" | "destructive";
const ACCENT: Record<Accent, string> = {
  primary: "bg-primary/10 text-primary",
  info: "bg-info/10 text-info",
  warning: "bg-warning/15 text-warning",
  success: "bg-success/15 text-success",
  destructive: "bg-destructive/10 text-destructive",
};

// Mesmo visual dos cartões do Dashboard (borda, sombra leve, ícone em chip colorido).
// Foto, nome, nicho e números rápidos (custo, preço, máx. CPA).
function ProductHeader({ product, pricing }: { product: any; pricing: any | null }) {
  const cost = Number(product.cost ?? 0);
  const price = Number(product.sale_price ?? 0);
  const fee = Number(pricing?.payments_pct ?? 0);
  const maxCpa = price > 0 ? price - cost - (price * fee) / 100 : null;
  return (
    <div className="flex items-center gap-4 pb-4 pr-8">
      {product.main_image_url ? (
        <img src={product.main_image_url} alt={product.name} className="size-14 rounded-2xl object-cover border border-border soft-shadow-sm" />
      ) : (
        <div className="size-14 rounded-2xl bg-primary/10 text-primary grid place-items-center"><Package className="size-6" /></div>
      )}
      <div className="min-w-0 flex-1">
        <h2 className="text-xl sm:text-2xl font-semibold tracking-tight truncate">{product.name}</h2>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {product.niche && <HeaderChip>{product.niche}</HeaderChip>}
          <HeaderChip label="Custo">{usd(cost)}</HeaderChip>
          {price > 0 && <HeaderChip label="Preço">{usd(price)}</HeaderChip>}
          {maxCpa != null && <HeaderChip label="Máx. CPA" tone={maxCpa > 0 ? "success" : "destructive"}>{usd(maxCpa)}</HeaderChip>}
        </div>
      </div>
    </div>
  );
}

function HeaderChip({ label, tone, children }: { label?: string; tone?: "success" | "destructive"; children: React.ReactNode }) {
  const color = tone === "success" ? "text-success" : tone === "destructive" ? "text-destructive" : "text-foreground";
  return (
    <span className="inline-flex items-center gap-1 h-6 px-2 rounded-md bg-muted/70 text-xs">
      {label && <span className="text-muted-foreground">{label}</span>}
      <span className={`font-semibold tabular-nums ${color}`}>{children}</span>
    </span>
  );
}

function DetailsSkeleton() {
  return (
    <div className="animate-pulse space-y-5">
      <div className="flex items-center gap-4">
        <div className="size-14 rounded-2xl bg-muted" />
        <div className="space-y-2 flex-1"><div className="h-6 w-64 rounded bg-muted" /><div className="h-5 w-80 rounded bg-muted/70" /></div>
      </div>
      <div className="h-11 rounded bg-muted/60" />
      <div className="grid sm:grid-cols-3 gap-4">{[0, 1, 2].map((i) => <div key={i} className="h-28 rounded-2xl bg-muted/60" />)}</div>
      <div className="h-64 rounded-2xl bg-muted/50" />
    </div>
  );
}

function InfoCardHeader({ icon: Icon, accent, title, subtitle, action }: {
  icon: typeof Package; accent: Accent; title: string; subtitle?: string; action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5 mb-4">
      <div className={`size-9 rounded-xl grid place-items-center shrink-0 ${ACCENT[accent]}`}><Icon className="size-4.5" /></div>
      <div className="min-w-0 flex-1">
        <h3 className="text-[15px] font-semibold leading-tight">{title}</h3>
        {subtitle && <p className="text-xs text-muted-foreground truncate">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

function Card({ icon, accent, title, subtitle, children }: {
  icon?: typeof Package; accent?: Accent; title?: string; subtitle?: string; children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4 sm:p-5 soft-shadow-sm">
      {icon && title && <InfoCardHeader icon={icon} accent={accent ?? "primary"} title={title} subtitle={subtitle} />}
      {children}
    </section>
  );
}

const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number.isFinite(n) ? n : 0);
const pct = (n: number) => `${(Number.isFinite(n) ? n : 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const num = (v: string) => { const n = Number(v.replace(",", ".")); return Number.isFinite(n) && n >= 0 ? n : null; };

// Máximo CPA = preço − custo no fornecedor − taxa Shopify (% do preço).
// CPA estimado = % do preço; lucro = máximo CPA − CPA. Custo no fornecedor é o
// Custo (USD) do Cadastro.
function Pricing({ product, pricing }: { product: any; pricing: any | null }) {
  const qc = useQueryClient();
  const saveFn = useServerFn(saveProductPricing);
  const savedPrice = Number(product.sale_price ?? 0);
  const savedFee = Number(pricing?.payments_pct ?? 0);
  const savedCpa = Number(pricing?.marketing_pct ?? 0);
  const [price, setPrice] = useState(String(savedPrice));
  const [fee, setFee] = useState(String(savedFee));
  const [cpaPct, setCpaPct] = useState(String(savedCpa));
  useEffect(() => { setPrice(String(savedPrice)); }, [savedPrice]);
  useEffect(() => { setFee(String(savedFee)); }, [savedFee]);
  useEffect(() => { setCpaPct(String(savedCpa)); }, [savedCpa]);

  const save = useMutation({
    mutationFn: (patch: { sale_price?: number; shopify_fee_pct?: number; cpa_pct?: number }) => saveFn({ data: { product_id: product.id, ...patch } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["product", product.id] }); qc.invalidateQueries({ queryKey: ["products"] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const commit = (raw: string, saved: number, reset: (v: string) => void, key: "sale_price" | "shopify_fee_pct" | "cpa_pct", max: number) => {
    const n = num(raw);
    if (n == null || n > max) { reset(String(saved)); return; }
    if (n !== saved) save.mutate({ [key]: n });
  };

  const p = num(price) ?? 0;
  const cost = Number(product.cost ?? 0);
  const feeAmt = p * ((num(fee) ?? 0) / 100);
  const maxCpa = p - cost - feeAmt;
  const cpa = p * ((num(cpaPct) ?? 0) / 100);
  const lucro = maxCpa - cpa;
  const share = (v: number) => (p > 0 ? (v / p) * 100 : 0);
  const blurOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") e.currentTarget.blur(); };
  const inputCls = "w-full h-10 rounded-xl bg-background border border-border text-sm outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 tabular-nums transition-colors";

  // Composição do preço (barra empilhada): custo, taxa, CPA e lucro.
  const parts = [
    { label: "Custo", value: cost, color: "var(--color-warning)" },
    { label: "Taxa Shopify", value: feeAmt, color: "var(--color-info)" },
    { label: "CPA", value: cpa, color: "var(--color-destructive)" },
    { label: "Lucro", value: Math.max(0, lucro), color: "var(--color-success)" },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Field label="Preço de venda">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">$</span>
            <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} onKeyDown={blurOnEnter}
              onBlur={() => commit(price, savedPrice, setPrice, "sale_price", 1_000_000)} className={`${inputCls} pl-7 pr-3 font-semibold`} />
          </div>
        </Field>
        <Field label="Custo no fornecedor">
          <div className={`${inputCls} px-3 flex items-center justify-between bg-muted/40 text-muted-foreground`} title="Vem do Custo (USD) do Cadastro">
            <span>{usd(cost)}</span><span className="text-xs font-medium">Cadastro</span>
          </div>
        </Field>
        <Field label="Taxa Shopify">
          <div className="relative">
            <input inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} onKeyDown={blurOnEnter}
              onBlur={() => commit(fee, savedFee, setFee, "shopify_fee_pct", 100)} className={`${inputCls} pl-3 pr-16`} />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none tabular-nums">% · {usd(feeAmt)}</span>
          </div>
        </Field>
        <Field label="CPA estimado">
          <div className="relative">
            <input inputMode="decimal" value={cpaPct} onChange={(e) => setCpaPct(e.target.value)} onKeyDown={blurOnEnter}
              onBlur={() => commit(cpaPct, savedCpa, setCpaPct, "cpa_pct", 1000)} className={`${inputCls} pl-3 pr-16`} />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none tabular-nums">% · {usd(cpa)}</span>
          </div>
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Metric icon={Target} accent="info" label="Máximo CPA" value={usd(maxCpa)} negative={maxCpa < 0}
          hint={p > 0 ? `${pct(share(maxCpa))} do preço · preço − custo − taxa` : "Preço − custo − taxa"} />
        <Metric icon={Megaphone} accent="destructive" label="CPA" value={usd(cpa)}
          hint={p > 0 ? `${pct(share(cpa))} do preço` : "% do preço de venda"} />
        <Metric icon={TrendingUp} accent={lucro < 0 ? "destructive" : "success"} label="Lucro" value={usd(lucro)} negative={lucro < 0}
          hint={p > 0 ? `${pct(share(lucro))} de lucro · máximo CPA − CPA` : "Máximo CPA − CPA"} highlight />
      </div>

      {p > 0 && (
        <div>
          <div className="h-2.5 rounded-full bg-muted overflow-hidden flex">
            {parts.map((x) => share(x.value) > 0 && (
              <div key={x.label} style={{ width: `${Math.min(100, share(x.value))}%`, background: x.color }} title={`${x.label}: ${usd(x.value)}`} />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {parts.map((x) => (
              <span key={x.label} className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ background: x.color }} />
                {x.label} <span className="font-medium text-foreground tabular-nums">{pct(share(x.value))}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ icon: Icon, accent, label, value, hint, negative, highlight }: {
  icon: typeof Package; accent: Accent; label: string; value: string; hint: string; negative?: boolean; highlight?: boolean;
}) {
  return (
    <div className={`rounded-xl border p-3.5 min-w-0 ${highlight ? (negative ? "border-destructive/30 bg-destructive/5" : "border-success/30 bg-success/5") : "border-border bg-background"}`}>
      <div className="flex items-center gap-2 mb-1.5">
        <div className={`size-7 rounded-lg grid place-items-center shrink-0 ${ACCENT[accent]}`}><Icon className="size-3.5" /></div>
        <p className="text-xs font-semibold text-muted-foreground truncate">{label}</p>
      </div>
      <p className={`text-xl font-bold tracking-tight tabular-nums truncate ${negative ? "text-destructive" : highlight ? "text-success" : "text-foreground"}`}>{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground truncate">{hint}</p>
    </div>
  );
}

// Campos fixos (não vêm do template): o custo e os produtos da Shopify ligados
// (Sincronizar Card) alimentam o custo dos pedidos no dashboard. Salvam ao sair do campo.
function FixedFields({ product, onSave }: { product: any; onSave: (patch: any) => void }) {
  const [name, setName] = useState(product.name);
  const { statuses } = useProductStatuses();
  useEffect(() => { setName(product.name); }, [product.name]);

  const saveName = () => {
    const v = name.trim();
    if (!v) setName(product.name);
    else if (v !== product.name) onSave({ name: v });
  };
  const inputCls = "w-full px-3 h-9 rounded-lg bg-background border border-border text-sm outline-none focus:border-primary/50";

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2.5">
        <Field label="Nome do produto">
          <input value={name} onChange={(e) => setName(e.target.value)} onBlur={saveName} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} className={inputCls} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <ProductCostField productId={product.id} cost={Number(product.cost ?? 0)} />
          <Field label="Status">
            <select value={product.board_column_id ?? ""} onChange={(e) => e.target.value && onSave({ board_column_id: e.target.value })} className={`${inputCls} cursor-pointer`}>
              {!product.board_column_id && <option value="">—</option>}
              {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
        </div>
      </div>
      <div>
        <div className="text-xs text-muted-foreground mb-1">Produtos da Shopify (identificam este produto nos pedidos)</div>
        <ProductSyncCard productId={product.id} productName={product.name} />
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs font-medium text-muted-foreground mb-1.5">{label}</div>
      {children}
    </label>
  );
}
