import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BellRing, Brain, Clock, ExternalLink, Eye, LineChart, Loader2, Megaphone, Plus, Search, Swords, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { PageShell } from "@/components/PageHeader";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { CompetitorAvatar, hostOf, hrefOf } from "@/components/products/ProductCompetitors";
import { requireAuth } from "@/lib/route-guards";
import {
  AD_LIBRARY_FIELD, addCompetitor, deleteCompetitor, editCompetitor, listAllCompetitors, type CompetitorListItem,
} from "@/lib/product-competitors.functions";

export const Route = createFileRoute("/concorrentes")({
  beforeLoad: requireAuth,
  head: () => ({ meta: [{ title: "Concorrentes — SRX Growth" }] }),
  component: ConcorrentesPage,
});

// Mesma tabela dos quadros de Produtos › Inteligência › Concorrentes; aqui o
// produto é opcional e o cadastro é só nome + Biblioteca de anúncios.
const QUERY_KEY = ["all-competitors"];
const inputCls = "h-9 px-3 rounded-lg border border-border bg-background text-sm outline-none focus:border-primary/50";

type ProductOpt = { id: string; name: string; main_image_url: string | null };

const NEXT = [
  { icon: Megaphone, title: "Anúncios ativos" },
  { icon: Clock, title: "Tempo no ar" },
  { icon: Eye, title: "Monitoramento diário" },
  { icon: BellRing, title: "Alertas" },
  { icon: Brain, title: "Análise com IA" },
  { icon: LineChart, title: "Visão de mercado" },
];

function ConcorrentesPage() {
  const getFn = useServerFn(listAllCompetitors);
  const { data, isLoading, error } = useQuery({ queryKey: QUERY_KEY, queryFn: () => getFn() });
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState("");
  const [productFilter, setProductFilter] = useState<string>("");

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data?.competitors ?? []).filter((c) => {
      if (productFilter === "none" && c.product_id) return false;
      if (productFilter && productFilter !== "none" && c.product_id !== productFilter) return false;
      if (!term) return true;
      return [c.name, c.product?.name ?? "", c.values[AD_LIBRARY_FIELD.id] ?? ""].some((s) => s.toLowerCase().includes(term));
    });
  }, [data, q, productFilter]);

  return (
    <PageShell>
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Concorrentes</h1>
          <p className="text-sm text-muted-foreground mt-1">Todos os concorrentes que você acompanha, com ou sem produto</p>
        </div>
        {!adding && (
          <button onClick={() => setAdding(true)} className="h-9 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-1.5">
            <Plus className="size-3.5" /> Adicionar concorrente
          </button>
        )}
      </div>

      {adding && <AddForm products={data?.products ?? []} onClose={() => setAdding(false)} />}

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
      ) : error || !data ? (
        <p className="text-sm text-destructive">{(error as any)?.message ?? "Não foi possível carregar os concorrentes."}</p>
      ) : data.competitors.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border py-14 flex flex-col items-center text-center">
          <div className="size-12 rounded-2xl bg-primary/10 text-primary grid place-items-center mb-3"><Swords className="size-5" /></div>
          <p className="text-sm font-medium">Nenhum concorrente ainda</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-xs">Adicione o nome e o link da Biblioteca de anúncios da Meta de cada concorrente que você quer acompanhar.</p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar concorrente ou produto" className={`${inputCls} w-full pl-8`} />
            </div>
            <select value={productFilter} onChange={(e) => setProductFilter(e.target.value)} aria-label="Produto" className={inputCls}>
              <option value="">Todos os produtos</option>
              <option value="none">Sem produto</option>
              {data.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <span className="text-xs text-muted-foreground tabular-nums">{filtered.length} de {data.competitors.length}</span>
          </div>
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Nenhum concorrente encontrado.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {filtered.map((c) => <CompetitorCard key={c.id} competitor={c} products={data.products} />)}
            </div>
          )}
        </>
      )}

      <section className="mt-8 rounded-2xl border border-dashed border-border p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600">Em breve</span>
          {NEXT.map(({ icon: Icon, title }) => (
            <span key={title} className="text-xs text-muted-foreground flex items-center gap-1.5 px-2 py-1 rounded-lg bg-muted/60">
              <Icon className="size-3.5" /> {title}
            </span>
          ))}
        </div>
      </section>
    </PageShell>
  );
}

function ProductSelect({ value, products, onChange }: { value: string | null; products: ProductOpt[]; onChange: (id: string | null) => void }) {
  return (
    <select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} aria-label="Produto" className={inputCls}>
      <option value="">Sem produto</option>
      {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
  );
}

function AddForm({ products, onClose }: { products: ProductOpt[]; onClose: () => void }) {
  const qc = useQueryClient();
  const addFn = useServerFn(addCompetitor);
  const [name, setName] = useState("");
  const [link, setLink] = useState("");
  const [productId, setProductId] = useState<string | null>(null);

  const add = useMutation({
    mutationFn: () => addFn({ data: { name: name.trim(), ad_library: link.trim(), product_id: productId } }),
    onSuccess: () => {
      toast.success("Concorrente adicionado");
      qc.invalidateQueries({ queryKey: QUERY_KEY });
      if (productId) qc.invalidateQueries({ queryKey: ["product-competitors", productId] });
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (name.trim()) add.mutate(); }}
      className="premium-card p-4 mb-6 grid grid-cols-1 sm:grid-cols-[1fr_1.4fr_auto] gap-3 items-end"
    >
      <label className="block">
        <span className="text-xs font-medium text-muted-foreground">Nome</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Loja X" className={`${inputCls} w-full mt-1`} />
      </label>
      <label className="block">
        <span className="text-xs font-medium text-muted-foreground">Link da Biblioteca de anúncios</span>
        <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://www.facebook.com/ads/library/?..." className={`${inputCls} w-full mt-1`} />
      </label>
      <label className="block">
        <span className="text-xs font-medium text-muted-foreground">Produto (opcional)</span>
        <div className="mt-1"><ProductSelect value={productId} products={products} onChange={setProductId} /></div>
      </label>
      <div className="sm:col-span-3 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="h-9 px-3 rounded-lg border border-border text-sm hover:bg-muted">Cancelar</button>
        <button type="submit" disabled={!name.trim() || add.isPending} className="h-9 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-1.5 disabled:opacity-50">
          {add.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} Adicionar
        </button>
      </div>
    </form>
  );
}

function CompetitorCard({ competitor, products }: { competitor: CompetitorListItem; products: ProductOpt[] }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const editFn = useServerFn(editCompetitor);
  const deleteFn = useServerFn(deleteCompetitor);
  const savedLink = competitor.values[AD_LIBRARY_FIELD.id] ?? "";
  const [name, setName] = useState(competitor.name);
  const [link, setLink] = useState(savedLink);
  useEffect(() => { setName(competitor.name); }, [competitor.name]);
  useEffect(() => { setLink(savedLink); }, [savedLink]);

  const refresh = (productIds: (string | null)[]) => {
    qc.invalidateQueries({ queryKey: QUERY_KEY });
    for (const id of productIds) if (id) qc.invalidateQueries({ queryKey: ["product-competitors", id] });
  };
  const edit = useMutation({
    mutationFn: (patch: { name?: string; ad_library?: string; product_id?: string | null }) => editFn({ data: { id: competitor.id, ...patch } }),
    onSuccess: (_r, patch) => refresh([competitor.product_id, patch.product_id ?? null]),
    onError: (e: any) => { toast.error(e.message); refresh([]); },
  });
  const remove = useMutation({
    mutationFn: () => deleteFn({ data: { id: competitor.id } }),
    onSuccess: () => refresh([competitor.product_id]),
    onError: (e: any) => toast.error(e.message),
  });

  const commitName = () => {
    const next = name.trim();
    if (!next) { setName(competitor.name); return; }
    setName(next);
    if (next !== competitor.name) edit.mutate({ name: next });
  };
  const commitLink = () => {
    const next = link.trim();
    setLink(next);
    if (next !== savedLink) edit.mutate({ ad_library: next });
  };

  return (
    <section className="premium-card p-4 flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <CompetitorAvatar name={competitor.name} host={savedLink ? hostOf(savedLink) : null} />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
          placeholder="Nome do concorrente"
          className="min-w-0 flex-1 h-7 px-1.5 -ml-1.5 rounded-md bg-transparent text-[15px] font-semibold tracking-tight outline-none hover:bg-muted/60 focus:bg-background focus:ring-2 focus:ring-primary/15"
        />
        <button
          onClick={() => confirm(`Excluir o concorrente "${competitor.name || "sem nome"}"?`).then((ok) => { if (ok) remove.mutate(); })}
          title="Excluir"
          className="size-8 rounded-lg grid place-items-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
        >
          <Trash2 className="size-4" />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onBlur={commitLink}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
            placeholder="Link da Biblioteca de anúncios"
            className={`${inputCls} w-full text-xs pr-8`}
          />
          {link && (
            <button onClick={() => { setLink(""); edit.mutate({ ad_library: "" }); }} title="Limpar" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="size-3.5" />
            </button>
          )}
        </div>
        {savedLink && (
          <a href={hrefOf(savedLink)} target="_blank" rel="noreferrer" title="Abrir Biblioteca de anúncios"
            className="h-9 px-3 rounded-lg border border-border text-xs font-medium flex items-center gap-1.5 hover:bg-muted shrink-0">
            <ExternalLink className="size-3.5" /> Abrir
          </a>
        )}
      </div>

      <ProductSelect
        value={competitor.product_id}
        products={competitor.product && !products.some((p) => p.id === competitor.product!.id) ? [competitor.product, ...products] : products}
        onChange={(id) => edit.mutate({ product_id: id })}
      />
    </section>
  );
}
