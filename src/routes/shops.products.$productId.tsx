import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageShell } from "@/components/PageHeader";
import { ArrowLeft, Package } from "lucide-react";
import { getProduct, updateProduct, PRODUCT_STATUSES } from "@/lib/products.functions";
import { ProductImages } from "@/components/products/ProductImages";
import { ProductTemplates } from "@/components/products/ProductTemplates";
import { ProductCreatives } from "@/components/products/ProductCreatives";
import { ProductPricing } from "@/components/products/ProductPricing";

export const Route = createFileRoute("/shops/products/$productId")({
  component: ProductDetail,
});

const TABS = [
  { id: "cadastro", label: "Cadastro" },
  { id: "imagens", label: "Imagens" },
  { id: "template", label: "Template da Página" },
  { id: "criativos", label: "Criativos" },
  { id: "precificacao", label: "Precificação" },
] as const;

function ProductDetail() {
  const { productId } = Route.useParams();
  const qc = useQueryClient();
  const get = useServerFn(getProduct);
  const updateFn = useServerFn(updateProduct);

  const [tab, setTab] = useState<typeof TABS[number]["id"]>("cadastro");

  const { data, isLoading } = useQuery({ queryKey: ["product", productId], queryFn: () => get({ data: { id: productId } }) });
  const update = useMutation({
    mutationFn: (patch: any) => updateFn({ data: { id: productId, patch } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["product", productId] }); qc.invalidateQueries({ queryKey: ["products"] }); },
  });

  if (isLoading || !data) return <PageShell><div className="text-sm text-muted-foreground">Carregando...</div></PageShell>;
  const product = data.product;

  return (
    <PageShell>
      <Link to="/shops/products" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-3">
        <ArrowLeft className="size-4" /> Produtos
      </Link>
      <div className="flex items-center gap-3 mb-6">
        {product.main_image_url ? (
          <img src={product.main_image_url} alt={product.name} className="size-12 rounded-xl object-cover border border-border" />
        ) : (
          <div className="size-12 rounded-xl bg-primary/10 text-primary grid place-items-center"><Package className="size-6" /></div>
        )}
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{product.name}</h1>
          {product.niche && <div className="text-xs text-muted-foreground">{product.niche}</div>}
        </div>
      </div>

      <div className="border-b border-border mb-6 flex gap-1 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 h-9 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${tab === t.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "cadastro" && <CadastroTab product={product} onSave={(patch) => update.mutate(patch)} />}
      {tab === "imagens" && <ProductImages productId={productId} />}
      {tab === "template" && <ProductTemplates productId={productId} />}
      {tab === "criativos" && <ProductCreatives productId={productId} />}
      {tab === "precificacao" && <ProductPricing product={product} pricing={data.pricing} />}
    </PageShell>
  );
}

function CadastroTab({ product, onSave }: { product: any; onSave: (patch: any) => void }) {
  const [name, setName] = useState(product.name);
  const [niche, setNiche] = useState(product.niche ?? "");
  const [supplier, setSupplier] = useState(product.supplier ?? "");
  const [cost, setCost] = useState(String(product.cost ?? 0));
  const [salePrice, setSalePrice] = useState(String(product.sale_price ?? 0));
  const [description, setDescription] = useState(product.description ?? "");
  const [status, setStatus] = useState<string>(product.status ?? "ativo");

  const save = () => onSave({
    name: name.trim() || product.name,
    niche: niche.trim() || null,
    supplier: supplier.trim() || null,
    cost: Number(cost) || 0,
    sale_price: Number(salePrice) || 0,
    description: description.trim() || null,
    status,
  });

  return (
    <div className="max-w-2xl space-y-4">
      <Field label="Nome do produto"><input value={name} onChange={(e) => setName(e.target.value)} className="w-full px-3 h-10 rounded-lg bg-surface border border-border text-sm outline-none focus:border-primary/50" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Nicho"><input value={niche} onChange={(e) => setNiche(e.target.value)} className="w-full px-3 h-10 rounded-lg bg-surface border border-border text-sm outline-none" /></Field>
        <Field label="Fornecedor"><input value={supplier} onChange={(e) => setSupplier(e.target.value)} className="w-full px-3 h-10 rounded-lg bg-surface border border-border text-sm outline-none" /></Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Custo (USD)"><input type="number" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} className="w-full px-3 h-10 rounded-lg bg-surface border border-border text-sm outline-none tabular-nums" /></Field>
        <Field label="Preço de venda (USD)"><input type="number" step="0.01" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} className="w-full px-3 h-10 rounded-lg bg-surface border border-border text-sm outline-none tabular-nums" /></Field>
        <Field label="Status">
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full px-3 h-10 rounded-lg bg-surface border border-border text-sm outline-none cursor-pointer">
            {PRODUCT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Descrição"><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-sm outline-none resize-none" /></Field>
      <div className="flex justify-end">
        <button onClick={save} className="h-9 px-5 rounded-lg bg-primary text-primary-foreground text-sm font-medium">Salvar</button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">{label}</div>
      {children}
    </label>
  );
}
