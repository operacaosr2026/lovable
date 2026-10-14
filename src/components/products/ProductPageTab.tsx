import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle, AlignLeft, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Camera, Check, ChevronDown, Download, FileText, FileUp, Film, ImageOff, Images,
  LayoutPanelTop, Loader2, MessageSquareQuote, Plus, RotateCcw, ShoppingBag, Upload, X, type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  getProductPage, saveProductPage, createTestimonialUpload, generatePagefly, createTemplateUpload, activateTemplate, resetTemplate,
} from "@/lib/product-page.functions";
import { addProductImage, deleteProductImage } from "@/lib/products.functions";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { isVideoMime, type PageTestimonial, type ProductPageData } from "@/lib/product-page";
import { AutoTextarea } from "@/components/shops/StoreProduction";

type Page = Omit<ProductPageData, "cdn">;
type SectionKey = "carousel" | "details" | "testimonials" | "reviews" | "final" | "recs";
const inputCls = "w-full h-9 px-3 rounded-lg border border-border bg-background text-sm outline-none focus:border-primary/50";
const areaCls = "w-full min-h-20 px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none focus:border-primary/50";
const uploadBtn = "h-8 px-3 rounded-lg border border-border text-xs font-medium flex items-center gap-1.5 hover:bg-muted disabled:opacity-50";

// Aba "Página": preenche o modelo do PageFly e gera o .pagefly. As seções do
// formulário seguem a ordem da página no modelo, cada uma numa gaveta.
export function ProductPageTab({ productId }: { productId: string }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const getFn = useServerFn(getProductPage);
  const saveFn = useServerFn(saveProductPage);
  const uploadFn = useServerFn(createTestimonialUpload);
  const generateFn = useServerFn(generatePagefly);
  const addImageFn = useServerFn(addProductImage);
  const deleteImageFn = useServerFn(deleteProductImage);
  const queryKey = ["product-page", productId];
  const { data, isLoading, error } = useQuery({ queryKey, queryFn: () => getFn({ data: { product_id: productId } }) });

  const [page, setPage] = useState<Page | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState<Record<string, number>>({});
  const [open, setOpen] = useState<string | null>("arquivo");
  useEffect(() => {
    if (data && !page) { setPage(data.page); setThumbs(data.thumbs); }
  }, [data, page]);

  const save = useMutation({
    mutationFn: (p: Page) => saveFn({ data: { product_id: productId, page: p } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey }); toast.success("Página salva"); },
    onError: (e: any) => toast.error(e.message),
  });
  const generate = useMutation({
    mutationFn: (p: Page) => generateFn({ data: { product_id: productId, page: p } }),
    onSuccess: (r) => {
      const bin = Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bin], { type: "application/zip" }));
      const a = document.createElement("a");
      a.href = url; a.download = r.fileName; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast.success(r.uploaded > 0 ? `Arquivo gerado (${r.uploaded} arquivos enviados pra Shopify)` : "Arquivo gerado");
      r.warnings.forEach((w) => toast.warning(w));
      qc.invalidateQueries({ queryKey });
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading || !page) return <div className="flex justify-center py-8"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
  if (error || !data) return <p className="text-sm text-destructive">{(error as any)?.message ?? "Não foi possível carregar."}</p>;

  const set = (patch: Partial<Page>) => setPage((p) => ({ ...p!, ...patch }));
  const imageById = new Map(data.images.map((i) => [i.id, i]));
  const busy = (k: string) => (uploading[k] ?? 0) > 0;
  const track = (k: string, d: number) => setUploading((u) => ({ ...u, [k]: (u[k] ?? 0) + d }));

  // Fotos de depoimento e imagens finais: arquivos da própria página.
  const sendPageFiles = async (kind: "testimonials" | "finals", list: FileList | null) => {
    if (!list?.length) return;
    const room = kind === "finals" ? 3 - page.finals.length : Infinity;
    const files = Array.from(list).filter((f) => f.type.startsWith("image/")).slice(0, room);
    if (kind === "finals" && list.length > room) toast.warning("No máximo 3 imagens finais");
    if (!files.length) return;
    track(kind, files.length);
    const added: PageTestimonial[] = [];
    const views: Record<string, string> = {};
    for (const file of files) {
      try {
        const r = await uploadFn({ data: { product_id: productId, name: file.name } });
        const { error: upErr } = await supabase.storage.from("store-production").uploadToSignedUrl(r.path, r.token, file, { contentType: file.type || undefined });
        if (upErr) throw upErr;
        added.push({ id: r.id, path: r.path, name: file.name });
        if (r.viewUrl) views[r.id] = r.viewUrl;
      } catch (e: any) {
        toast.error(`${file.name}: ${e?.message ?? "erro ao enviar"}`);
      }
      track(kind, -1);
    }
    if (added.length) {
      const next = { ...page, [kind]: [...page[kind], ...added] };
      setPage(next);
      setThumbs((t) => ({ ...t, ...views }));
      save.mutate(next);
    }
  };

  // Carrossel: imagens e vídeos do produto (a 1ª imagem vira a principal do produto).
  const sendCarousel = async (list: FileList | null) => {
    const files = Array.from(list ?? []).filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));
    if (!files.length) return;
    track("carousel", files.length);
    const ids: string[] = [];
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Não autenticado");
      for (const file of files) {
        try {
          const path = `${u.user.id}/products/${productId}/${Date.now()}_${file.name.replace(/[^\w.-]+/g, "_")}`;
          const { error: upErr } = await supabase.storage.from("project-attachments").upload(path, file);
          if (upErr) throw upErr;
          const { data: signed } = await supabase.storage.from("project-attachments").createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
          const r = await addImageFn({ data: {
            product_id: productId, file_path: path, file_url: signed?.signedUrl ?? null, file_name: file.name, mime_type: file.type, size_bytes: file.size,
          } });
          ids.push((r.image as { id: string }).id);
        } catch (e: any) {
          toast.error(`${file.name}: ${e?.message ?? "erro ao enviar"}`);
        }
        track("carousel", -1);
      }
    } catch (e: any) {
      toast.error(e.message);
      setUploading((u) => ({ ...u, carousel: 0 }));
    }
    if (ids.length) {
      const next = { ...page, carousel_ids: [...page.carousel_ids, ...ids] };
      setPage(next);
      save.mutate(next);
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["product", productId] });
    }
  };
  const removeCarousel = async (id: string) => {
    const img = imageById.get(id);
    if (!(await confirm(`Excluir ${isVideoMime(img?.mime_type) ? "este vídeo" : "esta imagem"} do produto?`))) return;
    try {
      await deleteImageFn({ data: { id } });
      const next = { ...page, carousel_ids: page.carousel_ids.filter((x) => x !== id) };
      setPage(next);
      save.mutate(next);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const reviewsDone = page.reviews.length > 0 && page.reviews.every((r) => r.text.trim() && r.author.trim());
  const finalsCount = page.finals.length || page.final_ids.length;
  const sections: Record<SectionKey, { title: string; icon: LucideIcon; done: boolean; hint: string; body: React.ReactNode } | null> = {
    carousel: {
      title: "Carrossel", icon: Images,
      done: page.carousel_ids.length > 0,
      hint: `${page.carousel_ids.length} ${page.carousel_ids.length === 1 ? "item" : "itens"}`,
      body: (
        <>
          <div className="flex items-start justify-between gap-3 mb-2">
            <p className="text-xs text-muted-foreground">
              Na ordem dos números. A 1ª imagem é a principal do produto. Vídeos tocam sozinhos, sem som e em loop (só na galeria em código).
            </p>
            <FilePick label="Enviar imagens ou vídeos" accept="image/*,video/*" busy={busy("carousel")} count={uploading.carousel} onFiles={sendCarousel} />
          </div>
          {page.carousel_ids.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma imagem ainda.</p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {page.carousel_ids.map((id, i) => {
                const img = imageById.get(id);
                return (
                  <Tile
                    key={id} n={i} src={img?.file_url ?? null} video={isVideoMime(img?.mime_type)}
                    onLeft={() => set({ carousel_ids: move(page.carousel_ids, i, -1) })}
                    onRight={() => set({ carousel_ids: move(page.carousel_ids, i, 1) })}
                    onRemove={() => removeCarousel(id)}
                  />
                );
              })}
            </div>
          )}
        </>
      ),
    },
    details: {
      title: 'Acordeão "Product Details"', icon: AlignLeft,
      done: !!page.details.trim(),
      hint: "Enter = nova linha; **texto** = negrito",
      body: <AutoTextarea value={page.details} onChange={(e) => set({ details: e.target.value })} className={areaCls} />,
    },
    testimonials: {
      title: "Depoimentos (fotos)", icon: Camera,
      done: page.testimonials.length > 0,
      hint: page.testimonials.length ? `${page.testimonials.length} fotos` : "vazio = ficam as do modelo",
      body: (
        <FileStrip
          files={page.testimonials} thumbs={thumbs} busy={busy("testimonials")} count={uploading.testimonials}
          empty="Nenhuma imagem — sem imagens aqui, ficam as do modelo."
          onFiles={(l) => sendPageFiles("testimonials", l)} onChange={(testimonials) => set({ testimonials })}
        />
      ),
    },
    reviews: data.template.reviews === null ? null : {
      title: "Depoimentos (texto)", icon: MessageSquareQuote,
      done: reviewsDone,
      hint: page.reviews.length ? `${page.reviews.length} depoimentos` : "vazio = ficam os do modelo",
      body: <ReviewsEditor page={page} set={set} />,
    },
    final: {
      title: "Seção final (título, textos e imagens)", icon: LayoutPanelTop,
      done: !!(page.title.trim() && page.text1.trim() && page.text2.trim()) && finalsCount === 3,
      hint: `${finalsCount}/3 imagens`,
      body: (
        <div className="space-y-3">
          <Field label="Título">
            <input value={page.title} onChange={(e) => set({ title: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Texto 1">
            <AutoTextarea value={page.text1} onChange={(e) => set({ text1: e.target.value })} className={areaCls} />
          </Field>
          <Field label="Texto 2 — lista ✔">
            <AutoTextarea value={page.text2} onChange={(e) => set({ text2: e.target.value })} className={areaCls} />
          </Field>
          <div>
            <span className="text-xs text-muted-foreground">Imagens finais (3), ao lado da lista ✔</span>
            <div className="mt-1">
              <FileStrip
                files={page.finals} thumbs={thumbs} busy={busy("finals")} count={uploading.finals} max={3}
                empty={page.final_ids.length ? `Usando as ${page.final_ids.length} escolhidas antes — envie aqui pra trocar.` : "Nenhuma imagem — faltando alguma, fica a do modelo."}
                onFiles={(l) => sendPageFiles("finals", l)} onChange={(finals) => set({ finals })}
              />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">Enter = nova linha; **texto** = negrito. Campo vazio mantém o texto do modelo.</p>
        </div>
      ),
    },
    recs: !data.template.recs ? null : {
      title: "Produtos recomendados", icon: ShoppingBag,
      done: page.recs.length > 0 && page.recs.every((r) => r.link.trim()),
      hint: page.recs.length ? `${page.recs.length} produtos` : "vazio = ficam os do modelo",
      body: <RecsEditor page={page} set={set} products={data.products} />,
    },
  };
  const order = (data.template.order as SectionKey[]).filter((k) => sections[k]);
  const fileDone = !!(page.store_id && page.handle.trim() && page.file_name.trim());
  const toggle = (k: string) => setOpen((o) => (o === k ? null : k));

  return (
    <div className="space-y-4">
      <TemplateBox template={data.template} onChanged={() => qc.invalidateQueries({ queryKey: ["product-page"] })} />

      <div className="space-y-2">
        <Drawer icon={FileText} title="Arquivo e loja" done={fileDone} hint={page.file_name} open={open === "arquivo"} onToggle={() => toggle("arquivo")}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Nome da página / arquivo">
              <input value={page.file_name} onChange={(e) => set({ file_name: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Loja (as imagens sobem nos Arquivos dela)">
              <select
                value={page.store_id ?? ""}
                onChange={(e) => {
                  const id = e.target.value || null;
                  set({ store_id: id, ...(id && data.handleByStore[id] && !page.handle ? { handle: data.handleByStore[id] } : {}) });
                }}
                className={inputCls}
              >
                <option value="">Escolha…</option>
                {data.stores.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_matriz ? " (matriz)" : ""}</option>)}
              </select>
            </Field>
            <Field label="Handle do produto (link do botão)">
              <input value={page.handle} onChange={(e) => set({ handle: e.target.value })} placeholder="ex.: nike-air-force-cheetah" className={inputCls} />
            </Field>
          </div>
        </Drawer>
        {order.map((k) => {
          const s = sections[k]!;
          return (
            <Drawer key={k} icon={s.icon} title={s.title} done={s.done} hint={s.hint} open={open === k} onToggle={() => toggle(k)}>
              {s.body}
            </Drawer>
          );
        })}
      </div>

      <div className="flex justify-end gap-2 pt-4 border-t border-border">
        <button
          onClick={() => save.mutate(page)}
          disabled={save.isPending}
          className="h-9 px-4 rounded-lg border border-border text-sm font-medium flex items-center gap-1.5 hover:bg-muted disabled:opacity-50"
        >
          {save.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Salvar
        </button>
        <button
          onClick={() => generate.mutate(page)}
          disabled={generate.isPending || !page.store_id || page.carousel_ids.length === 0}
          className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-1.5 disabled:opacity-50"
        >
          {generate.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
          {generate.isPending ? "Gerando (subindo imagens e vídeos)..." : "Gerar arquivo .pagefly"}
        </button>
      </div>
    </div>
  );
}

// Gaveta de cada parte da página. Ícone no estilo dos cartões do dashboard:
// verde = concluída, amarelo = pendente.
function Drawer({ icon: Icon, title, done, hint, open, onToggle, children }: {
  icon: LucideIcon; title: string; done: boolean; hint?: string; open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className={`rounded-xl border bg-surface ${open ? "border-primary/40" : "border-border"}`}>
      <button type="button" onClick={onToggle} className="w-full flex items-center gap-3 px-3.5 py-3 text-left">
        <span className={`size-9 rounded-xl grid place-items-center shrink-0 ${done ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}>
          <Icon className="size-4.5" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold truncate">{title}</span>
          {hint && <span className="block text-[11px] text-muted-foreground truncate">{hint}</span>}
        </span>
        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 ${done ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}>
          {done ? "Concluída" : "Pendente"}
        </span>
        <ChevronDown className={`size-4 text-muted-foreground shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="px-3.5 pb-4 pt-1 border-t border-border/60">{children}</div>}
    </div>
  );
}

function FilePick({ label, accept, busy, count, onFiles }: {
  label: string; accept: string; busy: boolean; count?: number; onFiles: (l: FileList | null) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="file" accept={accept} multiple hidden onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
      <button onClick={() => ref.current?.click()} disabled={busy} className={`${uploadBtn} shrink-0`}>
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
        {busy ? `Enviando (${count})...` : label}
      </button>
    </>
  );
}

function Tile({ n, src, video, onLeft, onRight, onRemove }: {
  n: number; src: string | null; video?: boolean; onLeft: () => void; onRight: () => void; onRemove: () => void;
}) {
  return (
    <div className="relative aspect-square rounded-lg overflow-hidden border border-border bg-muted/40 group">
      {!src ? <ImageOff className="size-5 m-auto mt-[40%] text-muted-foreground" />
        : video ? <video src={`${src}#t=0.1`} preload="metadata" muted playsInline className="w-full h-full object-cover bg-black" />
        : <img src={src} alt="" className="w-full h-full object-cover" />}
      <span className="absolute top-1 left-1 size-5 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold grid place-items-center">{n + 1}</span>
      {video && <Film className="absolute top-1.5 right-1.5 size-3.5 text-white drop-shadow" />}
      <div className="absolute inset-x-0 bottom-0 flex justify-between p-1 opacity-0 group-hover:opacity-100 bg-gradient-to-t from-black/50">
        <button onClick={onLeft} title="Pra esquerda" className="size-6 rounded bg-background/90 grid place-items-center"><ArrowLeft className="size-3.5" /></button>
        <button onClick={onRemove} title="Remover" className="size-6 rounded bg-background/90 grid place-items-center text-destructive"><X className="size-3.5" /></button>
        <button onClick={onRight} title="Pra direita" className="size-6 rounded bg-background/90 grid place-items-center"><ArrowRight className="size-3.5" /></button>
      </div>
    </div>
  );
}

function FileStrip({ files, thumbs, busy, count, max, empty, onFiles, onChange }: {
  files: PageTestimonial[]; thumbs: Record<string, string>; busy: boolean; count?: number; max?: number; empty: string;
  onFiles: (l: FileList | null) => void; onChange: (files: PageTestimonial[]) => void;
}) {
  const full = max !== undefined && files.length >= max;
  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-2">
        {files.length === 0 ? <p className="text-sm text-muted-foreground">{empty}</p> : <span />}
        {!full && <FilePick label="Enviar imagens" accept="image/*" busy={busy} count={count} onFiles={onFiles} />}
      </div>
      {files.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {files.map((t, i) => (
            <Tile
              key={t.id} n={i} src={thumbs[t.id] ?? null}
              onLeft={() => onChange(move(files, i, -1))}
              onRight={() => onChange(move(files, i, 1))}
              onRemove={() => onChange(files.filter((x) => x.id !== t.id))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

type TemplateInfo = {
  custom: boolean; name: string; title: string | null; carousel: number; carouselKind: string; testimonials: number; finals: number;
  reviews: number | null; recs: boolean; order: SectionKey[]; buttonLink: string | null; missing: string[];
};

const move = <T,>(list: T[], i: number, d: -1 | 1) => {
  const j = i + d;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
};
const iconBtn = "size-7 rounded-md grid place-items-center text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30";

// Bloco "srx-reviews" do modelo: cabeçalho (título, nota, nº de avaliações) e
// os cards de depoimento. Lista vazia = ficam os do modelo.
function ReviewsEditor({ page, set }: { page: Page; set: (p: Partial<Page>) => void }) {
  const update = (id: string, patch: Partial<Page["reviews"][number]>) =>
    set({ reviews: page.reviews.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px_160px] gap-3 mb-3">
        <Field label="Título da seção">
          <input value={page.reviews_heading} onChange={(e) => set({ reviews_heading: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Nota geral">
          <input value={page.reviews_rating} onChange={(e) => set({ reviews_rating: e.target.value })} placeholder="4.6" className={inputCls} />
        </Field>
        <Field label="Nº de avaliações">
          <input value={page.reviews_count} onChange={(e) => set({ reviews_count: e.target.value })} placeholder="1,467" className={inputCls} />
        </Field>
      </div>
      {page.reviews.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum depoimento — sem depoimentos aqui, ficam os do modelo.</p>
      ) : (
        <div className="space-y-2">
          {page.reviews.map((r, i) => (
            <div key={r.id} className="rounded-xl border border-border p-3 flex gap-3">
              <span className="size-5 mt-1.5 shrink-0 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold grid place-items-center">{i + 1}</span>
              <div className="flex-1 min-w-0 space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_160px_90px] gap-2">
                  <input value={r.title} onChange={(e) => update(r.id, { title: e.target.value })} placeholder="Título do depoimento" className={inputCls} />
                  <input value={r.author} onChange={(e) => update(r.id, { author: e.target.value })} placeholder="Autor" className={inputCls} />
                  <select value={r.rating} onChange={(e) => update(r.id, { rating: Number(e.target.value) })} className={inputCls}>
                    {[5, 4.5, 4, 3.5, 3].map((n) => <option key={n} value={n}>{n} ★</option>)}
                  </select>
                </div>
                <AutoTextarea value={r.text} onChange={(e) => update(r.id, { text: e.target.value })} placeholder="Texto do depoimento" className={areaCls} />
              </div>
              <div className="flex flex-col gap-1 shrink-0">
                <button onClick={() => set({ reviews: move(page.reviews, i, -1) })} disabled={i === 0} title="Subir" className={iconBtn}><ArrowUp className="size-3.5" /></button>
                <button onClick={() => set({ reviews: move(page.reviews, i, 1) })} disabled={i === page.reviews.length - 1} title="Descer" className={iconBtn}><ArrowDown className="size-3.5" /></button>
                <button onClick={() => set({ reviews: page.reviews.filter((x) => x.id !== r.id) })} title="Remover" className={`${iconBtn} hover:text-destructive`}><X className="size-3.5" /></button>
              </div>
            </div>
          ))}
        </div>
      )}
      <button
        onClick={() => set({ reviews: [...page.reviews, { id: crypto.randomUUID(), title: "", text: "", author: "", rating: 5 }] })}
        className="mt-2 w-full h-9 rounded-lg border border-dashed border-border text-xs font-medium text-muted-foreground hover:text-foreground flex items-center justify-center gap-1.5"
      >
        <Plus className="size-3.5" /> Depoimento
      </button>
    </div>
  );
}

// Bloco "srx-recommendations": produtos do sistema, na ordem. Nome, foto
// principal e preço (ficha da Shopify) entram na hora de gerar; o link vem do
// card do produto (Informações › Link da página) e pode ser trocado aqui.
function RecsEditor({ page, set, products }: {
  page: Page; set: (p: Partial<Page>) => void; products: { id: string; name: string; image: string | null; link: string }[];
}) {
  const byId = new Map(products.map((p) => [p.id, p]));
  const available = products.filter((p) => !page.recs.some((r) => r.product_id === p.id));
  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <Field label="Título da seção">
          <input value={page.recs_title} onChange={(e) => set({ recs_title: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Adicionar produto">
          <select
            value=""
            onChange={(e) => {
              const p = byId.get(e.target.value);
              if (p) set({ recs: [...page.recs, { product_id: p.id, link: p.link }] });
            }}
            className={inputCls}
          >
            <option value="">Escolha um produto…</option>
            {available.map((p) => <option key={p.id} value={p.id}>{p.name}{p.link ? "" : " (sem link)"}</option>)}
          </select>
        </Field>
      </div>
      {page.recs.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum produto — sem produtos aqui, ficam os do modelo.</p>
      ) : (
        <div className="rounded-xl border border-border divide-y divide-border">
          {page.recs.map((r, i) => {
            const p = byId.get(r.product_id);
            return (
              <div key={r.product_id} className="px-3 py-2 flex items-center gap-3">
                <span className="size-5 shrink-0 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold grid place-items-center">{i + 1}</span>
                <div className="size-10 shrink-0 rounded-md overflow-hidden border border-border bg-muted/40 grid place-items-center">
                  {p?.image ? <img src={p.image} alt="" className="w-full h-full object-cover" /> : <ImageOff className="size-4 text-muted-foreground" />}
                </div>
                <div className="flex-1 min-w-0 space-y-1">
                  <p className="text-sm font-medium truncate">{p?.name ?? "Produto removido"}</p>
                  <input
                    value={r.link}
                    onChange={(e) => set({ recs: page.recs.map((x) => (x.product_id === r.product_id ? { ...x, link: e.target.value } : x)) })}
                    placeholder="https://sualoja.com/products/..."
                    className={`${inputCls} h-8 text-xs ${r.link.trim() ? "" : "border-amber-500/60"}`}
                  />
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <button onClick={() => set({ recs: move(page.recs, i, -1) })} disabled={i === 0} title="Subir" className={iconBtn}><ArrowUp className="size-3.5" /></button>
                  <button onClick={() => set({ recs: move(page.recs, i, 1) })} disabled={i === page.recs.length - 1} title="Descer" className={iconBtn}><ArrowDown className="size-3.5" /></button>
                  <button onClick={() => set({ recs: page.recs.filter((x) => x.product_id !== r.product_id) })} title="Remover" className={`${iconBtn} hover:text-destructive`}><X className="size-3.5" /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground mt-2">Nome, foto principal e preço (com o riscado e o % de desconto) saem da ficha de cada produto na hora de gerar.</p>
    </div>
  );
}

// Modelo .pagefly usado pra gerar (vale pra todos os produtos): o original ou
// o que o dono subiu (ex.: depois de mudar a página no PageFly).
function TemplateBox({ template, onChanged }: { template: TemplateInfo; onChanged: () => void }) {
  const confirm = useConfirm();
  const uploadFn = useServerFn(createTemplateUpload);
  const activateFn = useServerFn(activateTemplate);
  const resetFn = useServerFn(resetTemplate);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const send = async (file: File | undefined) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pagefly")) { toast.error("Escolha um arquivo .pagefly exportado do PageFly"); return; }
    setBusy(true);
    try {
      const { path, token } = await uploadFn();
      const { error } = await supabase.storage.from("store-production").uploadToSignedUrl(path, token, file, { contentType: "application/zip" });
      if (error) throw error;
      const r = await activateFn({ data: { path } });
      toast.success(r.missing.length ? "Modelo trocado — confira o que não foi encontrado" : "Modelo trocado");
      onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível trocar o modelo");
    } finally {
      setBusy(false);
    }
  };
  const reset = async () => {
    if (!(await confirm({ title: "Voltar ao modelo original?", description: "O modelo que você subiu é descartado e a geração volta a usar o PG de Vendas 2 original.", confirmText: "Voltar", variant: "default" }))) return;
    setBusy(true);
    try { await resetFn(); toast.success("Modelo original restaurado"); onChanged(); }
    catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  return (
    <section className="rounded-xl border border-border bg-muted/20 p-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">
            Modelo: {template.name} <span className="text-xs font-normal text-muted-foreground">({template.custom ? "enviado por você" : "original"})</span>
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Carrossel ({template.carouselKind}) com {template.carousel} imagens · {template.testimonials} fotos de depoimento · {template.finals} imagens finais{template.reviews !== null ? ` · ${template.reviews} depoimentos em texto` : ""}{template.recs ? " · produtos recomendados" : ""}
            {template.title ? ` · título "${template.title.slice(0, 50)}"` : ""}
          </p>
          {template.missing.length > 0 && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 flex items-start gap-1">
              <AlertTriangle className="size-3.5 shrink-0 mt-px" /> Não achei no modelo (fica como está no arquivo): {template.missing.join(", ")}.
            </p>
          )}
          <p className="text-[11px] text-muted-foreground mt-1">Vale pra todos os produtos. Mudou a página no PageFly? Exporte de novo e troque aqui.</p>
        </div>
        <input ref={fileRef} type="file" accept=".pagefly" hidden onChange={(e) => { send(e.target.files?.[0]); e.target.value = ""; }} />
        <div className="flex gap-2 shrink-0">
          {template.custom && (
            <button onClick={reset} disabled={busy} className="h-8 px-3 rounded-lg border border-border text-xs font-medium flex items-center gap-1.5 hover:bg-muted disabled:opacity-50">
              <RotateCcw className="size-3.5" /> Original
            </button>
          )}
          <button onClick={() => fileRef.current?.click()} disabled={busy} className="h-8 px-3 rounded-lg border border-border bg-background text-xs font-medium flex items-center gap-1.5 hover:bg-muted disabled:opacity-50">
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <FileUp className="size-3.5" />} Trocar modelo
          </button>
        </div>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
