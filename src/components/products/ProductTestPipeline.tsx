import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowDown, ArrowUp, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  getTestPipeline, getTestPipelineItems, saveTestPipelineItems, setTestPipelineCheck, type PipelineItem,
} from "@/lib/test-pipeline.functions";

// Esteira de Testes: lista de testes que dá pra fazer, igual em todos os
// produtos. No produto (Inteligência › Esteira de Testes) só se marca o ✓, que
// vale só pra ele; a lista é editada em Configurações › Templates.

const inputCls = "h-9 px-3 rounded-lg border border-border bg-background text-sm outline-none focus:border-primary/50";

type Data = { items: PipelineItem[]; checked: Record<string, string> };

export function ProductTestPipeline({ productId }: { productId: string }) {
  const qc = useQueryClient();
  const QK = ["test-pipeline", productId];
  const getFn = useServerFn(getTestPipeline);
  const checkFn = useServerFn(setTestPipelineCheck);
  const { data, isLoading, error } = useQuery({ queryKey: QK, queryFn: () => getFn({ data: { product_id: productId } }) });

  // Marca na tela na hora; se o servidor recusar, volta ao que está salvo.
  const check = useMutation({
    mutationFn: (v: { item_id: string; checked: boolean }) => checkFn({ data: { product_id: productId, ...v } }),
    onMutate: ({ item_id, checked }) => qc.setQueryData<Data>(QK, (d) => {
      if (!d) return d;
      const next = { ...d.checked };
      if (checked) next[item_id] = new Date().toISOString();
      else delete next[item_id];
      return { ...d, checked: next };
    }),
    onError: (e: any) => { toast.error(e.message); qc.invalidateQueries({ queryKey: QK }); },
  });

  if (isLoading) return <div className="flex justify-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
  if (error || !data) return <p className="text-sm text-destructive">{(error as Error)?.message ?? "Não foi possível carregar a esteira."}</p>;

  const { items, checked } = data;
  const done = items.filter((i) => checked[i.id]).length;
  const editLink = (
    <Link to="/settings/templates" search={{ tipo: "esteira" }} className="text-primary hover:underline inline-flex items-center gap-1">
      <Pencil className="size-3" /> Editar lista
    </Link>
  );

  if (!items.length) {
    return (
      <div className="max-w-3xl rounded-xl border border-dashed border-border py-10 text-center">
        <p className="text-sm font-medium">A esteira ainda está vazia</p>
        <p className="text-xs text-muted-foreground mt-1">
          Monte a lista de testes em <Link to="/settings/templates" search={{ tipo: "esteira" }} className="text-primary hover:underline">Configurações › Templates › Esteira de testes</Link>. Ela aparece em todos os produtos.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-baseline gap-3 mb-2 text-xs">
        <p className="text-muted-foreground">A lista é a mesma em todos os produtos. O ✓ vale só para este produto.</p>
        <span className="ml-auto text-muted-foreground tabular-nums">{done} de {items.length} feitos</span>
        {editLink}
      </div>
      <div className="rounded-xl border border-border overflow-hidden">
        {items.map((item) => (
          <label key={item.id} className="flex items-center gap-2.5 px-3 py-2 border-b border-border/60 last:border-b-0 cursor-pointer hover:bg-muted/40">
            <input type="checkbox" checked={!!checked[item.id]} onChange={(e) => check.mutate({ item_id: item.id, checked: e.target.checked })}
              className="size-4 shrink-0 cursor-pointer accent-primary" />
            <span className={`text-sm ${checked[item.id] ? "line-through text-muted-foreground" : ""}`}>{item.text}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

// Configurações › Templates › Esteira de testes.
export function TestPipelineTemplateEditor() {
  const qc = useQueryClient();
  const getFn = useServerFn(getTestPipelineItems);
  const saveFn = useServerFn(saveTestPipelineItems);
  const { data, isLoading } = useQuery({ queryKey: ["test-pipeline-items"], queryFn: () => getFn() });
  const [items, setItems] = useState<PipelineItem[] | null>(null);
  useEffect(() => { if (data) setItems(data); }, [data]);

  const save = useMutation({
    mutationFn: (list: PipelineItem[]) => saveFn({ data: { items: list.map((i) => ({ ...i, text: i.text.trim() })) } }),
    onSuccess: () => {
      toast.success("Esteira salva");
      qc.invalidateQueries({ queryKey: ["test-pipeline-items"] });
      qc.invalidateQueries({ queryKey: ["test-pipeline"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading || !items) return <div className="flex justify-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;

  const valid = items.every((i) => i.text.trim());
  const setAt = (i: number, text: string) => setItems(items.map((x, j) => (j === i ? { ...x, text } : x)));
  const move = (i: number, d: number) => {
    const next = [...items];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setItems(next);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Os testes que dá pra fazer num produto, na ordem em que aparecem. A lista é a mesma em todos os produtos (produto › Inteligência › Esteira de Testes);
        lá você marca o que já fez em cada um. Tirar um teste daqui tira de todos os produtos.
      </p>
      <section className="premium-card p-4">
        <div className="space-y-2">
          {items.map((item, i) => (
            <div key={item.id} className="flex items-center gap-2">
              <span className="w-6 text-right text-xs text-muted-foreground tabular-nums">{i + 1}.</span>
              <input value={item.text} maxLength={300} placeholder="Ex.: vídeo UGC 15s" onChange={(e) => setAt(i, e.target.value)}
                className={`${inputCls} flex-1 min-w-0 ${item.text.trim() ? "" : "border-destructive"}`} />
              <button type="button" disabled={i === 0} onClick={() => move(i, -1)} title="Subir" className="size-8 rounded-lg grid place-items-center text-muted-foreground hover:bg-muted disabled:opacity-30"><ArrowUp className="size-3.5" /></button>
              <button type="button" disabled={i === items.length - 1} onClick={() => move(i, 1)} title="Descer" className="size-8 rounded-lg grid place-items-center text-muted-foreground hover:bg-muted disabled:opacity-30"><ArrowDown className="size-3.5" /></button>
              <button type="button" onClick={() => setItems(items.filter((_, j) => j !== i))} title="Remover" className="size-8 rounded-lg grid place-items-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 className="size-3.5" /></button>
            </div>
          ))}
        </div>
        <button type="button" disabled={items.length >= 200} onClick={() => setItems([...items, { id: `t${Date.now().toString(36)}`, text: "" }])}
          className="mt-3 h-8 px-3 rounded-lg border border-dashed border-border text-xs font-medium flex items-center gap-1.5 hover:bg-muted disabled:opacity-50">
          <Plus className="size-3.5" /> Adicionar teste
        </button>
      </section>
      <div className="flex items-center justify-end gap-3">
        {!valid && <span className="text-xs text-muted-foreground">Todo teste precisa de um nome.</span>}
        <button onClick={() => save.mutate(items)} disabled={!valid || save.isPending}
          className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-1.5 disabled:opacity-50">
          {save.isPending && <Loader2 className="size-3.5 animate-spin" />} Salvar
        </button>
      </div>
    </div>
  );
}
