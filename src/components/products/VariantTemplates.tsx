import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Layers, Loader2, Plus, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { listVariantTemplates, saveVariantTemplate, deleteVariantTemplate } from "@/lib/product-shopify.functions";
import type { ShopifyOption, VariantTemplate } from "@/lib/product-shopify";
import { AddBtn, SectionTitle } from "@/components/shops/StoreProduction";
import { OptionRow } from "@/components/products/ProductShopifyTab";

type Draft = Omit<VariantTemplate, "id"> & { id?: string };
const QK = ["variant-templates"];
const emptyDraft = (): Draft => ({ name: "", options: [{ name: "", values: [] }], is_default: false });

// Configurações > Templates > Variantes: opções e valores que se repetem nos
// produtos. O padrão já vem preenchido em toda ficha nova de "Publicar nas lojas".
export function VariantTemplates() {
  const listFn = useServerFn(listVariantTemplates);
  const { data = [], isLoading } = useQuery({ queryKey: QK, queryFn: () => listFn() });
  const [selected, setSelected] = useState<string | "new" | null>(null);

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
  const current = selected === "new" ? emptyDraft() : (data.find((t) => t.id === selected) ?? data[0]);
  const activeId = selected === "new" ? "new" : current?.id;

  return (
    <section className="premium-card p-6">
      <SectionTitle action={<AddBtn onClick={() => setSelected("new")}>Template</AddBtn>}>Templates de variantes</SectionTitle>
      <p className="text-xs text-muted-foreground mb-4">
        Opções e valores que se repetem nos produtos (ex.: Size com a grade de tamanhos). O padrão já vem preenchido na aba
        "Publicar nas lojas" de todo produto novo; nos outros, use "Aplicar template" na seção Variantes.
      </p>
      <div className="flex flex-col md:flex-row gap-4">
        <div className="md:w-52 shrink-0 space-y-1">
          {data.map((t) => (
            <button
              key={t.id}
              onClick={() => setSelected(t.id)}
              className={`w-full h-9 px-3 rounded-lg text-sm flex items-center gap-2 text-left ${
                activeId === t.id ? "bg-primary/10 text-foreground font-medium" : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Layers className="size-3.5 shrink-0" />
              <span className="flex-1 truncate">{t.name}</span>
              {t.is_default && <Star className="size-3 fill-current text-amber-500 shrink-0" />}
            </button>
          ))}
          {selected === "new" && (
            <div className="h-9 px-3 rounded-lg text-sm flex items-center gap-2 bg-primary/10 font-medium">
              <Plus className="size-3.5" /> Novo template
            </div>
          )}
          {data.length === 0 && selected !== "new" && <p className="text-sm text-muted-foreground px-1">Nenhum template.</p>}
        </div>
        <div className="flex-1 min-w-0">
          {current && (
            <Editor
              key={activeId}
              initial={current}
              onSaved={(id) => setSelected(id)}
              onDone={() => setSelected(null)}
            />
          )}
        </div>
      </div>
    </section>
  );
}

function Editor({ initial, onSaved, onDone }: { initial: Draft; onSaved: (id: string) => void; onDone: () => void }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const saveFn = useServerFn(saveVariantTemplate);
  const deleteFn = useServerFn(deleteVariantTemplate);
  const [tpl, setTpl] = useState<Draft>(initial);

  const options = tpl.options.filter((o) => o.name.trim() && o.values.length > 0);
  const save = useMutation({
    mutationFn: () => saveFn({ data: { id: tpl.id, name: tpl.name.trim(), options, is_default: tpl.is_default } }),
    onSuccess: ({ id }) => { qc.invalidateQueries({ queryKey: QK }); toast.success("Template salvo"); onSaved(id); },
    onError: (e: any) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: QK }); onDone(); },
    onError: (e: any) => toast.error(e.message),
  });
  const setOption = (i: number, o: ShopifyOption) => setTpl({ ...tpl, options: tpl.options.map((x, j) => (j === i ? o : x)) });
  const combos = options.reduce((n, o) => n * o.values.length, options.length ? 1 : 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={tpl.name}
          autoFocus={!tpl.name}
          onChange={(e) => setTpl({ ...tpl, name: e.target.value })}
          placeholder="Nome do template (ex.: Tamanhos W / M)"
          className="flex-1 min-w-48 h-9 px-3 rounded-lg border border-border bg-background text-sm font-medium outline-none focus:border-primary/50"
        />
        <label className="h-9 px-3 rounded-lg border border-border text-sm flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" checked={tpl.is_default} onChange={(e) => setTpl({ ...tpl, is_default: e.target.checked })} className="accent-primary" />
          Padrão para produtos novos
        </label>
      </div>

      <div className="space-y-2">
        {tpl.options.map((o, i) => (
          <OptionRow
            key={i}
            option={o}
            onChange={(next) => setOption(i, next)}
            onRemove={() => setTpl({ ...tpl, options: tpl.options.filter((_, j) => j !== i) })}
          />
        ))}
        {tpl.options.length < 3 && (
          <AddBtn onClick={() => setTpl({ ...tpl, options: [...tpl.options, { name: "", values: [] }] })}>Opção</AddBtn>
        )}
        <p className="text-xs text-muted-foreground">{combos > 0 ? `${combos} variantes` : "Preencha o nome da opção e os valores."}</p>
      </div>

      <div className="flex items-center gap-2 pt-3 border-t border-border">
        {tpl.id ? (
          <button
            onClick={() => confirm(`Excluir o template "${initial.name}"?`).then((ok) => { if (ok) remove.mutate(tpl.id!); })}
            className="h-9 px-3 rounded-lg text-sm text-destructive hover:bg-destructive/10 flex items-center gap-1.5"
          >
            <Trash2 className="size-3.5" /> Excluir
          </button>
        ) : (
          <button onClick={onDone} className="h-9 px-4 rounded-lg text-sm hover:bg-muted">Cancelar</button>
        )}
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending || !tpl.name.trim() || options.length === 0}
          className="ml-auto h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-1.5 disabled:opacity-50"
        >
          {save.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Salvar template
        </button>
      </div>
    </div>
  );
}
