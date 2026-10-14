import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ArrowDown, ArrowUp, ClipboardCopy, ClipboardPaste, ImageOff, Link2, PencilLine, Plus, Search, Star, Wand2, X,
} from "lucide-react";
import { AutoTextarea } from "@/components/shops/StoreProduction";
import { parseReviewsText, reviewsPrompt, type PageRec, type PageReview } from "@/lib/product-page";

// Campos da aba Página (e do template de recomendados em Configurações).

export const inputCls =
  "w-full h-10 px-3.5 rounded-xl border border-border bg-background text-sm shadow-xs outline-none transition placeholder:text-muted-foreground/60 " +
  "hover:border-foreground/20 focus:border-primary/60 focus:ring-4 focus:ring-primary/10";
export const areaCls =
  "w-full min-h-24 px-3.5 py-2.5 rounded-xl border border-border bg-background text-sm leading-relaxed shadow-xs outline-none transition placeholder:text-muted-foreground/60 " +
  "hover:border-foreground/20 focus:border-primary/60 focus:ring-4 focus:ring-primary/10";
const iconBtn = "size-8 rounded-lg grid place-items-center text-muted-foreground hover:bg-muted hover:text-foreground transition disabled:opacity-30 disabled:pointer-events-none";
const softBtn = "h-9 px-3.5 rounded-xl border border-border bg-background text-xs font-semibold inline-flex items-center gap-1.5 shadow-xs hover:bg-muted transition disabled:opacity-50";

export function Field({ label, hint, className = "", children }: { label: string; hint?: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-muted-foreground mt-1.5">{hint}</span>}
    </label>
  );
}

export const move = <T,>(list: T[], i: number, d: -1 | 1) => {
  const j = i + d;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
};

// Estrelas clicáveis; metade esquerda da estrela = meia nota.
function StarPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value;
  return (
    <div className="flex items-center gap-0.5" onMouseLeave={() => setHover(null)}>
      {[1, 2, 3, 4, 5].map((n) => {
        const fill = Math.max(0, Math.min(1, shown - (n - 1)));
        const pick = (e: React.MouseEvent<HTMLButtonElement>) => {
          const r = e.currentTarget.getBoundingClientRect();
          return e.clientX - r.left < r.width / 2 ? n - 0.5 : n;
        };
        return (
          <button
            key={n} type="button" title={`${n} estrelas`}
            onMouseMove={(e) => setHover(pick(e))}
            onClick={(e) => onChange(Math.max(1, pick(e)))}
            className="relative size-5"
          >
            <Star className="absolute inset-0 size-5 text-muted-foreground/30" />
            <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
              <Star className="size-5 fill-amber-400 text-amber-400" />
            </span>
          </button>
        );
      })}
      <span className="ml-1.5 text-xs font-semibold tabular-nums text-muted-foreground w-6">{shown}</span>
    </div>
  );
}

type ReviewsValue = { reviews_heading: string; reviews_rating: string; reviews_count: string; reviews: PageReview[] };

// Bloco "srx-reviews": cabeçalho e cards. Dois jeitos de preencher: um a um ou
// colando o texto já organizado (prompt pronto pra mandar numa IA).
export function ReviewsEditor({ value, onChange, productName }: {
  value: ReviewsValue; onChange: (patch: Partial<ReviewsValue>) => void; productName: string;
}) {
  const [mode, setMode] = useState<"edit" | "paste">("edit");
  const [raw, setRaw] = useState("");
  const parsed = useMemo(() => parseReviewsText(raw), [raw]);
  const update = (id: string, patch: Partial<PageReview>) =>
    onChange({ reviews: value.reviews.map((r) => (r.id === id ? { ...r, ...patch } : r)) });

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(reviewsPrompt(productName));
      toast.success("Prompt copiado — cole numa IA junto com os depoimentos");
    } catch {
      toast.error("Não consegui copiar — selecione o texto do prompt manualmente");
    }
  };
  const build = () => {
    if (!parsed.reviews.length) return;
    onChange({
      reviews: parsed.reviews,
      ...(parsed.heading ? { reviews_heading: parsed.heading } : {}),
      ...(parsed.rating ? { reviews_rating: parsed.rating } : {}),
      ...(parsed.count ? { reviews_count: parsed.count } : {}),
    });
    setRaw("");
    setMode("edit");
    toast.success(`${parsed.reviews.length} depoimentos montados — confira e salve`);
  };

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-xl border border-border bg-muted/40 p-1">
        {([["edit", "Editar um a um", PencilLine], ["paste", "Colar texto", ClipboardPaste]] as const).map(([id, label, Icon]) => (
          <button
            key={id} type="button" onClick={() => setMode(id)}
            className={`h-8 px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition ${mode === id ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            <Icon className="size-3.5" /> {label}
          </button>
        ))}
      </div>

      {mode === "paste" ? (
        <div className="rounded-2xl border border-border bg-muted/20 p-4 space-y-4">
          <Step n={1} title="Copie o prompt e mande numa IA (ChatGPT, Claude...) junto com os depoimentos">
            <button type="button" onClick={copyPrompt} className={softBtn}><ClipboardCopy className="size-3.5" /> Copiar prompt</button>
          </Step>
          <Step n={2} title="Cole aqui a resposta da IA">
            <AutoTextarea
              value={raw} onChange={(e) => setRaw(e.target.value)}
              placeholder={"SECTION_TITLE: ...\nOVERALL_RATING: 4.6\nREVIEW_COUNT: 1,467\n---\nTITLE: ...\nRATING: 5\nAUTHOR: ...\nTEXT: ..."}
              className={`${areaCls} min-h-40 font-mono text-xs`}
            />
          </Step>
          <Step n={3} title={raw.trim() ? `${parsed.reviews.length} depoimentos encontrados${parsed.heading ? " + cabeçalho" : ""}` : "Monte os depoimentos"}>
            <button
              type="button" onClick={build} disabled={!parsed.reviews.length}
              className="h-9 px-4 rounded-xl bg-primary text-primary-foreground text-xs font-semibold inline-flex items-center gap-1.5 shadow-sm disabled:opacity-50"
            >
              <Wand2 className="size-3.5" /> Montar {parsed.reviews.length || ""} depoimentos
            </button>
            {value.reviews.length > 0 && <span className="text-[11px] text-muted-foreground ml-3">Substitui os {value.reviews.length} atuais.</span>}
          </Step>
        </div>
      ) : (
        <>
          <div className="rounded-2xl border border-border bg-muted/20 p-4 grid grid-cols-1 sm:grid-cols-[1fr_110px_140px] gap-3">
            <Field label="Título da seção">
              <input value={value.reviews_heading} onChange={(e) => onChange({ reviews_heading: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Nota geral">
              <div className="relative">
                <Star className="absolute left-3 top-1/2 -translate-y-1/2 size-4 fill-amber-400 text-amber-400" />
                <input value={value.reviews_rating} onChange={(e) => onChange({ reviews_rating: e.target.value })} placeholder="4.6" className={`${inputCls} pl-9`} />
              </div>
            </Field>
            <Field label="Avaliações">
              <input value={value.reviews_count} onChange={(e) => onChange({ reviews_count: e.target.value })} placeholder="1,467" className={inputCls} />
            </Field>
          </div>

          {value.reviews.length === 0 ? (
            <Empty>Nenhum depoimento — sem depoimentos aqui, ficam os do modelo. Use "Colar texto" pra montar vários de uma vez.</Empty>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {value.reviews.map((r, i) => (
                <div key={r.id} className="group rounded-2xl border border-border bg-background p-4 shadow-xs hover:border-foreground/20 transition">
                  <div className="flex items-center gap-2.5 mb-3">
                    <span className="size-9 rounded-full bg-primary/10 text-primary grid place-items-center text-sm font-bold shrink-0">
                      {(r.author.trim()[0] ?? "?").toUpperCase()}
                    </span>
                    <input
                      value={r.author} onChange={(e) => update(r.id, { author: e.target.value })} placeholder="Nome do cliente"
                      className="flex-1 min-w-0 bg-transparent text-sm font-semibold outline-none placeholder:text-muted-foreground/60"
                    />
                    <div className="flex items-center opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition">
                      <button type="button" onClick={() => onChange({ reviews: move(value.reviews, i, -1) })} disabled={i === 0} title="Mover pra trás" className={iconBtn}><ArrowUp className="size-3.5" /></button>
                      <button type="button" onClick={() => onChange({ reviews: move(value.reviews, i, 1) })} disabled={i === value.reviews.length - 1} title="Mover pra frente" className={iconBtn}><ArrowDown className="size-3.5" /></button>
                      <button type="button" onClick={() => onChange({ reviews: value.reviews.filter((x) => x.id !== r.id) })} title="Remover" className={`${iconBtn} hover:text-destructive`}><X className="size-3.5" /></button>
                    </div>
                  </div>
                  <StarPicker value={r.rating} onChange={(rating) => update(r.id, { rating })} />
                  <input
                    value={r.title} onChange={(e) => update(r.id, { title: e.target.value })} placeholder="Título do depoimento"
                    className="mt-3 w-full bg-transparent text-base font-bold outline-none placeholder:text-muted-foreground/50"
                  />
                  <AutoTextarea
                    value={r.text} onChange={(e) => update(r.id, { text: e.target.value })} placeholder="O que o cliente disse..."
                    className="mt-1 w-full min-h-16 bg-transparent text-sm leading-relaxed text-muted-foreground outline-none resize-none placeholder:text-muted-foreground/50"
                  />
                  <div className="mt-2 text-[10px] font-semibold text-muted-foreground/70">#{i + 1}</div>
                </div>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => onChange({ reviews: [...value.reviews, { id: crypto.randomUUID(), title: "", text: "", author: "", rating: 5 }] })}
            className="w-full h-11 rounded-2xl border-2 border-dashed border-border text-xs font-semibold text-muted-foreground hover:text-foreground hover:border-foreground/30 transition inline-flex items-center justify-center gap-1.5"
          >
            <Plus className="size-4" /> Adicionar depoimento
          </button>
        </>
      )}
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="size-6 rounded-full bg-primary text-primary-foreground text-[11px] font-bold grid place-items-center shrink-0 mt-0.5">{n}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium mb-2">{title}</p>
        {children}
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">{children}</p>;
}

export type ProductOption = { id: string; name: string; image: string | null; link: string };

// Busca pra adicionar produto (lista dos produtos do sistema).
function ProductSearch({ options, onPick }: { options: ProductOption[]; onPick: (p: ProductOption) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const list = options.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 30);
  return (
    <div ref={ref} className="relative" onBlur={(e) => { if (!ref.current?.contains(e.relatedTarget as Node)) setOpen(false); }}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
      <input
        value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
        placeholder="Buscar produto pra adicionar…" className={`${inputCls} pl-9`}
      />
      {open && (
        <div className="absolute z-20 mt-1.5 w-full max-h-72 overflow-y-auto rounded-xl border border-border bg-popover shadow-lg p-1">
          {list.length === 0 ? (
            <p className="px-3 py-2.5 text-xs text-muted-foreground">Nenhum produto encontrado.</p>
          ) : list.map((p) => (
            <button
              key={p.id} type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onPick(p); setQ(""); }}
              className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left hover:bg-muted"
            >
              <span className="size-8 rounded-md overflow-hidden bg-muted grid place-items-center shrink-0">
                {p.image ? <img src={p.image} alt="" className="w-full h-full object-cover" /> : <ImageOff className="size-3.5 text-muted-foreground" />}
              </span>
              <span className="flex-1 min-w-0 text-sm truncate">{p.name}</span>
              {!p.link && <span className="text-[10px] font-semibold text-warning shrink-0">sem link</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Bloco "srx-recommendations": produtos do sistema, na ordem. Nome, foto
// principal e preço entram na hora de gerar; o link vem do card do produto
// (Informações › Link da página) e pode ser trocado.
export function RecsEditor({ title, recs, products, onChange, toolbar, emptyText }: {
  title: string; recs: PageRec[]; products: ProductOption[];
  onChange: (patch: { recs_title?: string; recs?: PageRec[] }) => void;
  toolbar?: React.ReactNode; emptyText: string;
}) {
  const byId = new Map(products.map((p) => [p.id, p]));
  const available = products.filter((p) => !recs.some((r) => r.product_id === p.id));
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-muted/20 p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Título da seção">
          <input value={title} onChange={(e) => onChange({ recs_title: e.target.value })} placeholder="You might also like this" className={inputCls} />
        </Field>
        <Field label="Adicionar produto">
          <ProductSearch options={available} onPick={(p) => onChange({ recs: [...recs, { product_id: p.id, link: p.link }] })} />
        </Field>
      </div>
      {toolbar}
      {recs.length === 0 ? (
        <Empty>{emptyText}</Empty>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {recs.map((r, i) => {
            const p = byId.get(r.product_id);
            const noLink = !r.link.trim();
            return (
              <div key={r.product_id} className="group rounded-2xl border border-border bg-background p-3 shadow-xs flex gap-3 hover:border-foreground/20 transition">
                <div className="relative size-16 shrink-0 rounded-xl overflow-hidden bg-muted grid place-items-center">
                  {p?.image ? <img src={p.image} alt="" className="w-full h-full object-cover" /> : <ImageOff className="size-5 text-muted-foreground" />}
                  <span className="absolute top-1 left-1 size-5 rounded-full bg-background/90 text-[10px] font-bold grid place-items-center shadow-sm">{i + 1}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-1">
                    <p className="flex-1 min-w-0 text-sm font-semibold truncate pt-1">{p?.name ?? "Produto removido"}</p>
                    <div className="flex items-center opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition">
                      <button type="button" onClick={() => onChange({ recs: move(recs, i, -1) })} disabled={i === 0} title="Mover pra trás" className={iconBtn}><ArrowUp className="size-3.5" /></button>
                      <button type="button" onClick={() => onChange({ recs: move(recs, i, 1) })} disabled={i === recs.length - 1} title="Mover pra frente" className={iconBtn}><ArrowDown className="size-3.5" /></button>
                      <button type="button" onClick={() => onChange({ recs: recs.filter((x) => x.product_id !== r.product_id) })} title="Remover" className={`${iconBtn} hover:text-destructive`}><X className="size-3.5" /></button>
                    </div>
                  </div>
                  <div className="relative mt-1.5">
                    <Link2 className={`absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 ${noLink ? "text-warning" : "text-muted-foreground"}`} />
                    <input
                      value={r.link}
                      onChange={(e) => onChange({ recs: recs.map((x) => (x.product_id === r.product_id ? { ...x, link: e.target.value } : x)) })}
                      placeholder="Sem link — cole o link da página"
                      className={`${inputCls} h-8 pl-8 text-xs rounded-lg ${noLink ? "border-warning/60 bg-warning/5" : ""}`}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">Nome, foto principal e preço (com o riscado e o % de desconto) saem da ficha de cada produto na hora de gerar.</p>
    </div>
  );
}
