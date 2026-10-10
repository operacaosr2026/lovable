import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Package, Tag as TagIcon, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { getProduct, updateProduct } from "@/lib/products.functions";
import { useProductStatuses } from "@/components/products/product-status";
import { ProductImages } from "@/components/products/ProductImages";
import { ProductTemplates } from "@/components/products/ProductTemplates";
import { ProductCreatives } from "@/components/products/ProductCreatives";
import { ProductSales } from "@/components/products/ProductSales";
import { ProductionTab } from "@/components/shops/StoreProduction";
import { ProductShopifyTab } from "@/components/products/ProductShopifyTab";
import { ProductPageTab } from "@/components/products/ProductPageTab";

const TABS = [
  { id: "cadastro", label: "Cadastro" },
  { id: "producao", label: "Produção" },
  { id: "imagens", label: "Imagens" },
  { id: "template", label: "Template da Página" },
  { id: "criativos", label: "Criativos" },
  { id: "vendas", label: "Vendas" },
  { id: "pagina", label: "Página" },
  { id: "shopify", label: "Publicar nas lojas" },
] as const;

// Conteúdo do produto (cabeçalho + abas) — usado no popup da página Produtos
// e na página /shops/products/$productId (link direto).
export function ProductDetails({ productId }: { productId: string }) {
  const qc = useQueryClient();
  const get = useServerFn(getProduct);
  const updateFn = useServerFn(updateProduct);

  const [tab, setTab] = useState<typeof TABS[number]["id"]>("cadastro");

  const { data, isLoading } = useQuery({ queryKey: ["product", productId], queryFn: () => get({ data: { id: productId } }) });
  const update = useMutation({
    mutationFn: (patch: any) => updateFn({ data: { id: productId, patch } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["product", productId] }); qc.invalidateQueries({ queryKey: ["products"] }); },
  });

  if (isLoading || !data) return <div className="flex justify-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
  const product = data.product;

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
      {tab === "producao" && <ProductionTab kind="product" targetId={productId} />}
      {tab === "imagens" && <ProductImages productId={productId} />}
      {tab === "template" && <ProductTemplates productId={productId} />}
      {tab === "criativos" && <ProductCreatives productId={productId} />}
      {tab === "vendas" && <ProductSales productId={productId} />}
      {tab === "pagina" && <ProductPageTab productId={productId} />}
      {tab === "shopify" && <ProductShopifyTab productId={productId} />}
    </div>
  );
}

export function ProductDetailsDialog({ productId, onClose }: { productId: string; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogTitle className="sr-only">Produto</DialogTitle>
        <ProductDetails productId={productId} />
      </DialogContent>
    </Dialog>
  );
}

function CadastroTab({ product, onSave }: { product: any; onSave: (patch: any) => void }) {
  const [name, setName] = useState(product.name);
  const [niche, setNiche] = useState(product.niche ?? "");
  const [supplier, setSupplier] = useState(product.supplier ?? "");
  const [cost, setCost] = useState(String(product.cost ?? 0));
  const [salePrice, setSalePrice] = useState(String(product.sale_price ?? 0));
  const [description, setDescription] = useState(product.description ?? "");
  const { statuses } = useProductStatuses();
  const [statusId, setStatusId] = useState<string>(product.board_column_id ?? "");
  const [keywords, setKeywords] = useState<string[]>(product.keywords ?? []);
  const [keywordInput, setKeywordInput] = useState("");

  const addKeyword = () => {
    const v = keywordInput.trim();
    if (v && !keywords.some((k) => k.toLowerCase() === v.toLowerCase())) setKeywords([...keywords, v]);
    setKeywordInput("");
  };

  const save = () => onSave({
    name: name.trim() || product.name,
    niche: niche.trim() || null,
    supplier: supplier.trim() || null,
    cost: Number(cost) || 0,
    sale_price: Number(salePrice) || 0,
    description: description.trim() || null,
    ...(statusId && statusId !== product.board_column_id ? { board_column_id: statusId } : {}),
    keywords,
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
          <select value={statusId} onChange={(e) => setStatusId(e.target.value)} className="w-full px-3 h-10 rounded-lg bg-surface border border-border text-sm outline-none cursor-pointer">
            {!statusId && <option value="">—</option>}
            {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Palavras-chave (para identificar este produto nos pedidos)">
        <div className="flex flex-wrap gap-1.5 items-center px-3 py-2 rounded-lg bg-surface border border-border">
          {keywords.map((k) => (
            <span key={k} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-muted">
              <TagIcon className="size-3" /> {k}
              <button type="button" onClick={() => setKeywords(keywords.filter((x) => x !== k))}><X className="size-3" /></button>
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
