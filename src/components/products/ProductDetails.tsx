import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Package, Tag as TagIcon, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { getProduct, updateProduct } from "@/lib/products.functions";
import { useProductStatuses } from "@/components/products/product-status";
import { ProductImages } from "@/components/products/ProductImages";
import { ProductTemplates } from "@/components/products/ProductTemplates";
import { ProductCreatives } from "@/components/products/ProductCreatives";
import { ProductSales } from "@/components/products/ProductSales";
import { ProductDiary } from "@/components/products/ProductDiary";
import { ProductionTab } from "@/components/shops/StoreProduction";
import { ProductShopifyTab } from "@/components/products/ProductShopifyTab";
import { ProductPageTab } from "@/components/products/ProductPageTab";

const TABS = [
  { id: "vendas", label: "Vendas" },
  { id: "diario", label: "Diário" },
  { id: "informacoes", label: "Informações" },
  { id: "producao", label: "Produção" },
  { id: "imagens", label: "Imagens" },
  { id: "template", label: "Template da Página" },
  { id: "criativos", label: "Criativos" },
  { id: "pagina", label: "Página" },
  { id: "shopify", label: "Publicar nas lojas" },
] as const;

// Conteúdo do produto (cabeçalho + abas) — usado no popup da página Produtos
// e na página /shops/products/$productId (link direto).
export function ProductDetails({ productId }: { productId: string }) {
  const qc = useQueryClient();
  const get = useServerFn(getProduct);
  const updateFn = useServerFn(updateProduct);

  const [tab, setTab] = useState<typeof TABS[number]["id"]>("vendas");

  const { data, isLoading } = useQuery({ queryKey: ["product", productId], queryFn: () => get({ data: { id: productId } }) });
  const update = useMutation({
    mutationFn: (patch: any) => updateFn({ data: { id: productId, patch } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["product", productId] }); qc.invalidateQueries({ queryKey: ["products"] }); },
    onError: (e: any) => toast.error(e.message),
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

      {tab === "informacoes" && (
        <div className="space-y-6">
          <FixedFields product={product} onSave={(patch) => update.mutate(patch)} />
          <ProductionTab kind="product" targetId={productId} section="info" />
        </div>
      )}
      {tab === "producao" && <ProductionTab kind="product" targetId={productId} section="tasks" />}
      {tab === "imagens" && <ProductImages productId={productId} />}
      {tab === "template" && <ProductTemplates productId={productId} />}
      {tab === "criativos" && <ProductCreatives productId={productId} />}
      {tab === "vendas" && <ProductSales productId={productId} />}
      {tab === "diario" && <ProductDiary productId={productId} />}
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
    <section className="space-y-2.5">
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
    </section>
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
