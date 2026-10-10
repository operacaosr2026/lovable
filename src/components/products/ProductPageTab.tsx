import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, Download, FileUp, Loader2, RotateCcw, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  getProductPage, saveProductPage, createTestimonialUpload, generatePagefly, createTemplateUpload, activateTemplate, resetTemplate,
} from "@/lib/product-page.functions";
import { useConfirm } from "@/components/ui/confirm-dialog";
import type { ProductPageData } from "@/lib/product-page";
import { AutoTextarea, SectionTitle } from "@/components/shops/StoreProduction";
import { ImagePicker } from "@/components/products/ProductShopifyTab";

type Page = Omit<ProductPageData, "cdn">;
const inputCls = "w-full h-9 px-3 rounded-lg border border-border bg-background text-sm outline-none focus:border-primary/50";
const areaCls = "w-full min-h-20 px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none focus:border-primary/50";

// Aba "Página": preenche o modelo PG de Vendas 2 do PageFly e gera o .pagefly.
export function ProductPageTab({ productId }: { productId: string }) {
  const qc = useQueryClient();
  const getFn = useServerFn(getProductPage);
  const saveFn = useServerFn(saveProductPage);
  const uploadFn = useServerFn(createTestimonialUpload);
  const generateFn = useServerFn(generatePagefly);
  const queryKey = ["product-page", productId];
  const { data, isLoading, error } = useQuery({ queryKey, queryFn: () => getFn({ data: { product_id: productId } }) });

  const [page, setPage] = useState<Page | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
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
      toast.success(r.uploaded > 0 ? `Arquivo gerado (${r.uploaded} imagens enviadas pra Shopify)` : "Arquivo gerado");
      r.warnings.forEach((w) => toast.warning(w));
      qc.invalidateQueries({ queryKey });
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading || !page) return <div className="flex justify-center py-8"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
  if (error || !data) return <p className="text-sm text-destructive">{(error as any)?.message ?? "Não foi possível carregar."}</p>;

  const set = (patch: Partial<Page>) => setPage((p) => ({ ...p!, ...patch }));

  const sendTestimonials = async (list: FileList | null) => {
    if (!list?.length) return;
    const files = Array.from(list);
    setUploading(files.length);
    const added: Page["testimonials"] = [];
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
      setUploading((n) => n - 1);
    }
    if (added.length) {
      const next = { ...page, testimonials: [...page.testimonials, ...added] };
      setPage(next);
      setThumbs((t) => ({ ...t, ...views }));
      save.mutate(next);
    }
  };
  const moveTestimonial = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= page.testimonials.length) return;
    const list = [...page.testimonials];
    [list[i], list[j]] = [list[j], list[i]];
    set({ testimonials: list });
  };

  return (
    <div className="space-y-6">
      <TemplateBox template={data.template} onChanged={() => qc.invalidateQueries({ queryKey: ["product-page"] })} />

      <section>
        <SectionTitle>Arquivo</SectionTitle>
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
      </section>

      <section>
        <SectionTitle>Carrossel</SectionTitle>
        {data.images.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma imagem — envie na aba Imagens.</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground mb-2">
              Da aba Imagens, na ordem dos números: a 1ª é a imagem principal; as outras viram os slides (recomendado 5 ou mais no total).
            </p>
            <ImagePicker images={data.images} value={page.carousel_ids} onChange={(carousel_ids) => set({ carousel_ids })} />
          </>
        )}
      </section>

      <section>
        <SectionTitle>Textos</SectionTitle>
        <p className="text-xs text-muted-foreground mb-3">Enter = nova linha; **texto** = negrito. Campo vazio mantém o texto do modelo.</p>
        <div className="space-y-3">
          <Field label='Acordeão "Product Details"'>
            <AutoTextarea value={page.details} onChange={(e) => set({ details: e.target.value })} className={areaCls} />
          </Field>
          <Field label="Título (penúltima seção)">
            <input value={page.title} onChange={(e) => set({ title: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Texto 1 (penúltima seção)">
            <AutoTextarea value={page.text1} onChange={(e) => set({ text1: e.target.value })} className={areaCls} />
          </Field>
          <Field label="Texto 2 — lista ✔ (penúltima seção)">
            <AutoTextarea value={page.text2} onChange={(e) => set({ text2: e.target.value })} className={areaCls} />
          </Field>
        </div>
      </section>

      <section>
        <SectionTitle
          action={
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading > 0}
              className="h-8 px-3 rounded-lg border border-border text-xs font-medium flex items-center gap-1.5 hover:bg-muted disabled:opacity-50"
            >
              {uploading > 0 ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
              {uploading > 0 ? `Enviando (${uploading})...` : "Enviar imagens"}
            </button>
          }
        >
          Depoimentos
        </SectionTitle>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { sendTestimonials(e.target.files); e.target.value = ""; }} />
        {page.testimonials.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma imagem — sem imagens aqui, ficam as do modelo.</p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {page.testimonials.map((t, i) => (
              <div key={t.id} className="relative aspect-square rounded-lg overflow-hidden border border-border bg-muted/40 group">
                {thumbs[t.id] && <img src={thumbs[t.id]} alt={t.name} className="w-full h-full object-cover" />}
                <span className="absolute top-1 left-1 size-5 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold grid place-items-center">{i + 1}</span>
                <div className="absolute inset-x-0 bottom-0 flex justify-between p-1 opacity-0 group-hover:opacity-100 bg-gradient-to-t from-black/50">
                  <button onClick={() => moveTestimonial(i, -1)} title="Pra esquerda" className="size-6 rounded bg-background/90 grid place-items-center"><ArrowLeft className="size-3.5" /></button>
                  <button onClick={() => set({ testimonials: page.testimonials.filter((x) => x.id !== t.id) })} title="Remover" className="size-6 rounded bg-background/90 grid place-items-center text-destructive"><X className="size-3.5" /></button>
                  <button onClick={() => moveTestimonial(i, 1)} title="Pra direita" className="size-6 rounded bg-background/90 grid place-items-center"><ArrowRight className="size-3.5" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionTitle>Imagens finais (3)</SectionTitle>
        {data.images.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma imagem — envie na aba Imagens.</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground mb-2">As 3 imagens ao lado da lista ✔, na ordem dos números. Faltando alguma, fica a do modelo.</p>
            <ImagePicker
              images={data.images}
              value={page.final_ids}
              onChange={(ids) => { if (ids.length > 3) { toast.error("No máximo 3 imagens"); return; } set({ final_ids: ids }); }}
            />
          </>
        )}
      </section>

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
          {generate.isPending ? "Gerando (subindo imagens)..." : "Gerar arquivo .pagefly"}
        </button>
      </div>
    </div>
  );
}

type TemplateInfo = {
  custom: boolean; name: string; title: string | null; carousel: number; testimonials: number; finals: number;
  buttonLink: string | null; missing: string[];
};

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
            Carrossel com {template.carousel} imagens · {template.testimonials} depoimentos · {template.finals} imagens finais
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
