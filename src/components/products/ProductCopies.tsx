import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft, Check, Copy, Download, Loader2, MoreVertical, Package, Pencil, Plus, Search, Trash2, Type } from "lucide-react";
import {
  createProductCopy, deleteProductCopy, importProductCopies, listCopySources, listProductCopies, updateProductCopy,
  type CopyKind, type ProductCopy,
} from "@/lib/traffic-board.functions";
import { TrafficBoard } from "@/components/products/TrafficBoard";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";

// Produto › Tráfego › Títulos e Descrições: banco de textos do produto em esteira.
// Título = headline; Descrição = texto principal (a copy). Na hora de lançar,
// cada criativo escolhe um título e uma descrição daqui.

export const copiesKey = (productId: string) => ["product-copies", productId];
export const KIND_LABEL: Record<CopyKind, string> = { title: "Título", body: "Descrição" };
const KIND_STYLE: Record<CopyKind, string> = {
  title: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  body: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
};
// Tamanho que a Meta mostra sem cortar (referência, não limite).
const SOFT_LIMIT: Record<CopyKind, number> = { title: 40, body: 125 };

export function useProductCopies(productId: string) {
  const fn = useServerFn(listProductCopies);
  return useQuery({ queryKey: copiesKey(productId), queryFn: () => fn({ data: { product_id: productId } }) });
}

export function ProductCopies({ productId }: { productId: string }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const deleteFn = useServerFn(deleteProductCopy);
  const { data, isLoading } = useProductCopies(productId);
  const copies = useMemo(() => data ?? [], [data]);
  const [kind, setKind] = useState<"all" | CopyKind>("all");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<{ copy?: ProductCopy; columnId?: string | null } | null>(null);
  const [importing, setImporting] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: copiesKey(productId) });

  const counts = { title: copies.filter((c) => c.kind === "title").length, body: copies.filter((c) => c.kind === "body").length };
  const term = q.trim().toLowerCase();
  const visible = (c: ProductCopy) => (kind === "all" || c.kind === kind) && (!term || c.text.toLowerCase().includes(term));

  const remove = async (c: ProductCopy) => {
    if (!(await confirm(`Excluir este ${KIND_LABEL[c.kind].toLowerCase()}?`))) return;
    deleteFn({ data: { id: c.id } }).then(refresh, (e: any) => toast.error(e.message));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-lg border border-border bg-surface p-0.5">
          {([["all", `Todos (${copies.length})`], ["title", `Títulos (${counts.title})`], ["body", `Descrições (${counts.body})`]] as const).map(([id, label]) => (
            <button key={id} onClick={() => setKind(id)} className={cn("h-7 px-2.5 rounded-md text-xs font-medium transition-colors", kind === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
              {label}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar texto" className="h-8 w-48 pl-8 pr-3 rounded-lg bg-surface border border-border text-xs outline-none focus:border-primary/50" />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setImporting(true)} className="h-8 px-3 rounded-lg border border-border bg-surface text-xs font-medium inline-flex items-center gap-1.5 hover:bg-muted">
            <Download className="size-3.5" /> Importar de outro produto
          </button>
          <button onClick={() => setEditing({ columnId: null })} className="h-8 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-medium inline-flex items-center gap-1.5">
            <Plus className="size-3.5" /> Novo texto
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="h-64 rounded-2xl border border-border bg-card soft-shadow-sm animate-pulse" />
      ) : (
        <TrafficBoard
          board="copies"
          items={copies}
          visible={visible}
          onMoved={refresh}
          onAdd={(columnId) => setEditing({ columnId })}
          addLabel="Adicionar texto"
          emptyText={copies.length ? "Arraste um texto para cá." : "Nenhum texto ainda. Cadastre títulos e descrições para usar nos anúncios."}
          columnSubtitle={(n) => `${n} texto(s)`}
          renderCard={(c, { tone, dragging }) => (
            <CopyCard c={c} stripe={tone.stripe} dragging={dragging} onEdit={() => setEditing({ copy: c })} onDelete={() => remove(c)} />
          )}
        />
      )}

      {editing && (
        <CopyEditor productId={productId} copy={editing.copy} columnId={editing.columnId ?? null} defaultKind={kind === "all" ? "title" : kind}
          onClose={() => setEditing(null)} onSaved={() => { refresh(); setEditing(null); }} />
      )}
      {importing && <ImportCopies productId={productId} onClose={() => setImporting(false)} onImported={refresh} />}
    </div>
  );
}

function CopyCard({ c, stripe, dragging, onEdit, onDelete }: { c: ProductCopy; stripe: string; dragging: boolean; onEdit: () => void; onDelete: () => void }) {
  return (
    <div onClick={dragging ? undefined : onEdit} className={cn("group rounded-xl bg-card border border-border border-l-4 p-2.5 shadow-sm hover:shadow-md transition-shadow", stripe, dragging && "shadow-xl")}>
      <div className="flex items-start gap-2">
        <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-semibold shrink-0", KIND_STYLE[c.kind])}>{KIND_LABEL[c.kind]}</span>
        <div className="flex-1" />
        {!dragging && (
          <div className="shrink-0 -mr-1 -mt-0.5" onPointerDown={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button onClick={(e) => e.stopPropagation()} title="Mais opções" className="size-6 rounded-md grid place-items-center text-muted-foreground hover:bg-muted hover:text-foreground">
                  <MoreVertical className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                <DropdownMenuItem onSelect={onEdit}><Pencil className="size-3.5" /> Editar</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => navigator.clipboard.writeText(c.text).then(() => toast.success("Texto copiado"))}><Copy className="size-3.5" /> Copiar texto</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onDelete} className="text-destructive focus:text-destructive"><Trash2 className="size-3.5" /> Excluir</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
      <p className={cn("mt-1.5 text-sm whitespace-pre-line break-words", c.kind === "title" ? "font-semibold line-clamp-3" : "line-clamp-6 text-foreground/90")}>{c.text}</p>
      {c.kind === "title" && c.text.length > SOFT_LIMIT.title && <p className="text-[11px] text-warning mt-1">{c.text.length} caracteres: pode cortar no celular</p>}
    </div>
  );
}

function CopyEditor({ productId, copy, columnId, defaultKind, onClose, onSaved }: {
  productId: string; copy?: ProductCopy; columnId: string | null; defaultKind: CopyKind; onClose: () => void; onSaved: () => void;
}) {
  const createFn = useServerFn(createProductCopy);
  const updateFn = useServerFn(updateProductCopy);
  const [kind, setKind] = useState<CopyKind>(copy?.kind ?? defaultKind);
  const [text, setText] = useState(copy?.text ?? "");
  // Novo título: cada linha vira um título (cadastrar vários de uma vez).
  const lines = !copy && kind === "title" ? text.split("\n").map((l) => l.trim()).filter(Boolean) : [];

  const save = useMutation({
    mutationFn: async () => {
      if (copy) return updateFn({ data: { id: copy.id, kind, text: text.trim() } });
      const items = kind === "title" ? lines : [text.trim()];
      for (const t of items) await createFn({ data: { product_id: productId, kind, text: t, column_id: columnId } });
    },
    onSuccess: () => { toast.success(copy ? "Texto salvo" : kind === "title" && lines.length > 1 ? `${lines.length} títulos cadastrados` : "Texto cadastrado"); onSaved(); },
    onError: (e: any) => toast.error(e.message),
  });

  const len = text.trim().length;
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogTitle>{copy ? `Editar ${KIND_LABEL[kind].toLowerCase()}` : "Novo texto"}</DialogTitle>
        <div className="space-y-3 pt-1">
          <div className="grid grid-cols-2 gap-2">
            {(["title", "body"] as const).map((k) => (
              <button key={k} type="button" onClick={() => setKind(k)}
                className={cn("text-left rounded-xl border px-3 py-2 transition-all", kind === k ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "border-border hover:border-primary/40")}>
                <div className="text-sm font-medium flex items-center gap-1.5"><Type className="size-3.5 text-muted-foreground" /> {KIND_LABEL[k]}</div>
                <div className="text-xs text-muted-foreground">{k === "title" ? "Headline, em negrito abaixo da mídia" : "Texto principal (a copy), acima da mídia"}</div>
              </button>
            ))}
          </div>
          <textarea
            autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={kind === "title" ? 4 : 8}
            placeholder={kind === "title" ? (copy ? "Título" : "Um título por linha") : "Escreva a copy do anúncio"}
            className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm outline-none focus:border-primary/50 resize-y"
          />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {!copy && kind === "title" ? (lines.length > 1 ? `${lines.length} títulos serão cadastrados` : "Dica: um título por linha cadastra vários de uma vez") : ""}
            </span>
            {(copy || kind === "body") && <span className={len > SOFT_LIMIT[kind] ? "text-amber-600 dark:text-amber-400" : ""}>{len} caracteres{len > SOFT_LIMIT[kind] ? ` · a Meta mostra ~${SOFT_LIMIT[kind]} antes do "ver mais"` : ""}</span>}
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="h-9 px-4 rounded-lg text-sm hover:bg-muted">Cancelar</button>
            <button onClick={() => save.mutate()} disabled={!len || save.isPending} className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium inline-flex items-center gap-1.5 disabled:opacity-50">
              {save.isPending && <Loader2 className="size-3.5 animate-spin" />} Salvar
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ImportCopies({ productId, onClose, onImported }: { productId: string; onClose: () => void; onImported: () => void }) {
  const sourcesFn = useServerFn(listCopySources);
  const listFn = useServerFn(listProductCopies);
  const importFn = useServerFn(importProductCopies);
  const sources = useQuery({ queryKey: ["copy-sources", productId], queryFn: () => sourcesFn({ data: { product_id: productId } }) });
  const [source, setSource] = useState<{ id: string; name: string } | null>(null);
  const items = useQuery({ queryKey: copiesKey(source?.id ?? ""), enabled: !!source, queryFn: () => listFn({ data: { product_id: source!.id } }) });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const grouped = useMemo(() => ({
    title: (items.data ?? []).filter((c) => c.kind === "title"),
    body: (items.data ?? []).filter((c) => c.kind === "body"),
  }), [items.data]);
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const run = useMutation({
    mutationFn: () => importFn({ data: { product_id: productId, ids: [...selected] } }),
    onSuccess: (r) => {
      toast.success(`${r.imported} texto(s) importado(s)${r.skipped ? ` · ${r.skipped} já existia(m)` : ""}`);
      onImported();
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col gap-0 p-0 overflow-hidden">
        <div className="px-5 pt-5 pb-3 border-b border-border">
          <DialogTitle className="flex items-center gap-2">
            {source && <button onClick={() => { setSource(null); setSelected(new Set()); }} className="size-7 rounded-md grid place-items-center hover:bg-muted text-muted-foreground"><ArrowLeft className="size-4" /></button>}
            {source ? source.name : "Importar textos de outro produto"}
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">{source ? "Marque os títulos e descrições que quer trazer. Eles entram na primeira coluna deste produto." : "Escolha o produto de onde vêm os textos."}</p>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {!source ? (
            sources.isLoading ? <div className="py-10 grid place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
            : !sources.data?.length ? <p className="text-sm text-muted-foreground text-center py-10">Nenhum outro produto tem textos cadastrados.</p>
            : (
              <div className="space-y-1.5">
                {sources.data.map((p) => (
                  <button key={p.id} onClick={() => setSource({ id: p.id, name: p.name })} className="w-full flex items-center gap-3 rounded-xl border border-border px-3 py-2.5 text-left hover:border-primary/40 hover:bg-primary/5">
                    <div className="size-9 rounded-lg bg-muted overflow-hidden grid place-items-center shrink-0">
                      {p.main_image_url ? <img src={p.main_image_url} alt="" className="w-full h-full object-cover" /> : <Package className="size-4 text-muted-foreground" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{p.name}</div>
                      <div className="text-xs text-muted-foreground">{p.titles} título(s) · {p.bodies} descrição(ões)</div>
                    </div>
                  </button>
                ))}
              </div>
            )
          ) : items.isLoading ? (
            <div className="py-10 grid place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="space-y-4">
              {(["title", "body"] as const).filter((k) => grouped[k].length).map((k) => (
                <div key={k}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="text-xs text-muted-foreground font-medium">{k === "title" ? "Títulos" : "Descrições"}</div>
                    <button onClick={() => setSelected((s) => { const n = new Set(s); const all = grouped[k].every((c) => n.has(c.id)); grouped[k].forEach((c) => (all ? n.delete(c.id) : n.add(c.id))); return n; })} className="text-xs text-muted-foreground hover:text-foreground">
                      {grouped[k].every((c) => selected.has(c.id)) ? "Desmarcar" : "Marcar todos"}
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    {grouped[k].map((c) => {
                      const on = selected.has(c.id);
                      return (
                        <button key={c.id} onClick={() => toggle(c.id)} className={cn("w-full flex items-start gap-2.5 rounded-lg border px-3 py-2 text-left", on ? "border-primary bg-primary/5" : "border-border hover:border-primary/40")}>
                          <span className={cn("mt-0.5 size-4 rounded border grid place-items-center shrink-0", on ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/50")}>{on && <Check className="size-3" />}</span>
                          <span className={cn("text-sm whitespace-pre-line break-words line-clamp-4", k === "title" && "font-medium")}>{c.text}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        {source && (
          <div className="px-5 py-3 border-t border-border flex justify-end gap-2">
            <button onClick={onClose} className="h-9 px-4 rounded-lg text-sm hover:bg-muted">Cancelar</button>
            <button onClick={() => run.mutate()} disabled={!selected.size || run.isPending} className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium inline-flex items-center gap-1.5 disabled:opacity-50">
              {run.isPending && <Loader2 className="size-3.5 animate-spin" />} Importar {selected.size || ""}
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
