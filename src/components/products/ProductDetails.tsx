import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Brain, DollarSign, Hammer, ListChecks, Loader2, Megaphone, Package, Tag as TagIcon, Target, TrendingUp, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { getProduct, updateProduct, saveProductPricing } from "@/lib/products.functions";
import { useProductStatuses } from "@/components/products/product-status";
import { ProductImages } from "@/components/products/ProductImages";
import { ProductCreatives } from "@/components/products/ProductCreatives";
import { ProductSales } from "@/components/products/ProductSales";
import { ProductDiary } from "@/components/products/ProductDiary";
import { ProductionTab } from "@/components/shops/StoreProduction";
import { ProductShopifyTab } from "@/components/products/ProductShopifyTab";
import { ProductPageTab } from "@/components/products/ProductPageTab";
import { ProductCompetitors } from "@/components/products/ProductCompetitors";

const GROUPS = [
  {
    id: "inteligencia", label: "Inteligência", icon: Brain,
    tabs: [
      { id: "vendas", label: "Vendas" },
      { id: "diario", label: "Diário" },
      { id: "informacoes", label: "Informações" },
      { id: "concorrentes", label: "Concorrentes" },
    ],
  },
  {
    id: "producao", label: "Produção", icon: Hammer,
    tabs: [
      { id: "imagens", label: "Imagens" },
      { id: "criativos", label: "Criativos" },
      { id: "pagina", label: "Página" },
      { id: "shopify", label: "Publicar nas lojas" },
    ],
  },
  { id: "tarefas", label: "Tarefas", icon: ListChecks, tabs: [{ id: "tarefas", label: "Tarefas" }] },
  { id: "anuncios", label: "Anúncios", icon: Megaphone, tabs: [{ id: "anuncios", label: "Anúncios" }] },
] as const;

type TabId = typeof GROUPS[number]["tabs"][number]["id"];

// Conteúdo do produto (cabeçalho + abas) — usado no popup da página Produtos
// e na página /shops/products/$productId (link direto).
export function ProductDetails({ productId }: { productId: string }) {
  const qc = useQueryClient();
  const get = useServerFn(getProduct);
  const updateFn = useServerFn(updateProduct);

  const [tab, setTab] = useState<TabId>("vendas");

  const { data, isLoading } = useQuery({ queryKey: ["product", productId], queryFn: () => get({ data: { id: productId } }) });
  const update = useMutation({
    mutationFn: (patch: any) => updateFn({ data: { id: productId, patch } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["product", productId] }); qc.invalidateQueries({ queryKey: ["products"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading || !data) return <div className="flex justify-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
  const product = data.product;
  const group = GROUPS.find((g) => g.tabs.some((t) => t.id === tab))!;

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-3 mb-6 pr-8">
        {product.main_image_url ? (
          <img src={product.main_image_url} alt={product.name} className="size-12 rounded-xl object-cover border border-border" />
        ) : (
          <div className="size-12 rounded-xl bg-primary/10 text-primary grid place-items-center"><Package className="size-6" /></div>
        )}
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{product.name}</h2>
          {product.niche && <div className="text-xs text-muted-foreground">{product.niche}</div>}
        </div>
      </div>

      <div className="border-b border-border mb-4 flex gap-1 overflow-x-auto">
        {GROUPS.map((g) => (
          <button
            key={g.id}
            onClick={() => setTab(g.tabs[0].id)}
            className={`flex items-center gap-1.5 px-3 h-10 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${g.id === group.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            <g.icon className="size-4" />
            {g.label}
          </button>
        ))}
      </div>

      {group.tabs.length > 1 && (
        <div className="mb-6 flex gap-1 overflow-x-auto">
          {group.tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 h-8 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${tab === t.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {tab === "informacoes" && (
        <div className="space-y-4">
          <Card icon={Package} accent="primary" title="Cadastro" subtitle="Nome, custo e palavras-chave identificam o produto nos pedidos">
            <FixedFields product={product} onSave={(patch) => update.mutate(patch)} />
          </Card>
          <Card icon={DollarSign} accent="success" title="Precificação" subtitle="Margem por unidade com o CPA que você estima">
            <Pricing product={product} pricing={data.pricing} />
          </Card>
          <Card><ProductionTab kind="product" targetId={productId} section="info" /></Card>
        </div>
      )}
      {tab === "tarefas" && <ProductionTab kind="product" targetId={productId} section="tasks" />}
      {tab === "imagens" && <ProductImages productId={productId} />}
      {tab === "criativos" && <ProductCreatives productId={productId} />}
      {tab === "vendas" && <ProductSales productId={productId} />}
      {tab === "diario" && <ProductDiary productId={productId} />}
      {tab === "pagina" && <ProductPageTab productId={productId} />}
      {tab === "shopify" && <ProductShopifyTab productId={productId} />}
      {tab === "concorrentes" && <ProductCompetitors productId={productId} />}
      {tab === "anuncios" && <ComingSoon title="Anúncios" description="Em breve: publique as campanhas deste produto nas contas de anúncio." />}
    </div>
  );
}

function ComingSoon({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border py-16 text-center">
      <div className="text-sm font-semibold">{title}</div>
      <div className="text-xs text-muted-foreground mt-1">{description}</div>
    </div>
  );
}

export function ProductDetailsDialog({ productId, onClose }: { productId: string; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="w-full max-w-5xl h-[90vh] overflow-y-auto [scrollbar-gutter:stable]">
        <DialogTitle className="sr-only">Produto</DialogTitle>
        <ProductDetails productId={productId} />
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
function InfoCardHeader({ icon: Icon, accent, title, subtitle, action }: {
  icon: typeof Package; accent: Accent; title: string; subtitle?: string; action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5 mb-4">
      <div className={`size-9 rounded-xl grid place-items-center shrink-0 ${ACCENT[accent]}`}><Icon className="size-4.5" /></div>
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold leading-tight">{title}</h3>
        {subtitle && <p className="text-[11px] text-muted-foreground truncate">{subtitle}</p>}
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
            <span>{usd(cost)}</span><span className="text-[10px] uppercase tracking-wide">Cadastro</span>
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
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
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
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground truncate">{label}</p>
      </div>
      <p className={`text-xl font-bold tracking-tight tabular-nums truncate ${negative ? "text-destructive" : highlight ? "text-success" : "text-foreground"}`}>{value}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground truncate">{hint}</p>
    </div>
  );
}

// Campos fixos (não vêm do template): custo e palavras-chave alimentam o custo
// dos pedidos no dashboard. Salvam ao sair do campo.
function FixedFields({ product, onSave }: { product: any; onSave: (patch: any) => void }) {
  const [name, setName] = useState(product.name);
  const [cost, setCost] = useState(String(product.cost ?? 0));
  const { statuses } = useProductStatuses();
  const [keywordInput, setKeywordInput] = useState("");
  const keywords: string[] = product.keywords ?? [];
  useEffect(() => { setName(product.name); }, [product.name]);
  useEffect(() => { setCost(String(product.cost ?? 0)); }, [product.cost]);

  const saveName = () => {
    const v = name.trim();
    if (!v) setName(product.name);
    else if (v !== product.name) onSave({ name: v });
  };
  const saveCost = () => {
    const v = Number(cost.replace(",", "."));
    if (!Number.isFinite(v) || v < 0) setCost(String(product.cost ?? 0));
    else if (v !== Number(product.cost ?? 0)) onSave({ cost: v });
  };
  const addKeyword = () => {
    const v = keywordInput.trim();
    setKeywordInput("");
    if (v && !keywords.some((k) => k.toLowerCase() === v.toLowerCase())) onSave({ keywords: [...keywords, v] });
  };
  const inputCls = "w-full px-3 h-9 rounded-lg bg-background border border-border text-sm outline-none focus:border-primary/50";

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2.5">
        <Field label="Nome do produto">
          <input value={name} onChange={(e) => setName(e.target.value)} onBlur={saveName} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} className={inputCls} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Custo (USD)">
            <input type="number" step="0.01" min="0" value={cost} onChange={(e) => setCost(e.target.value)} onBlur={saveCost} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} className={`${inputCls} tabular-nums`} />
          </Field>
          <Field label="Status">
            <select value={product.board_column_id ?? ""} onChange={(e) => e.target.value && onSave({ board_column_id: e.target.value })} className={`${inputCls} cursor-pointer`}>
              {!product.board_column_id && <option value="">—</option>}
              {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
        </div>
      </div>
      <Field label="Palavras-chave (para identificar este produto nos pedidos)">
        <div className="flex flex-wrap gap-1.5 items-center px-3 py-1.5 rounded-lg bg-background border border-border">
          {keywords.map((k) => (
            <span key={k} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-muted">
              <TagIcon className="size-3" /> {k}
              <button type="button" onClick={() => onSave({ keywords: keywords.filter((x) => x !== k) })}><X className="size-3" /></button>
            </span>
          ))}
          <input
            value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addKeyword(); } }}
            onBlur={addKeyword}
            placeholder="+ palavra-chave"
            className="text-xs px-2 h-7 rounded-md bg-transparent outline-none flex-1 min-w-24"
          />
        </div>
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      {children}
    </label>
  );
}
