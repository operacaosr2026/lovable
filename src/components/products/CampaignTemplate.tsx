import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  FIELD_TYPES, FIELD_TYPE_LABEL, getCampaignTemplate, saveCampaignTemplate,
  type FieldType, type SummaryField,
} from "@/lib/campaign-template.functions";
import { OptionsInput } from "@/components/products/Naming";

// Configurações › Templates › Campanhas: campos do Resumo da campanha
// (aba Campanhas do produto).

const QK = ["campaign-template"];
const inputCls = "h-9 px-3 rounded-lg border border-border bg-background text-sm outline-none focus:border-primary/50";

export function CampaignTemplateEditor() {
  const qc = useQueryClient();
  const getFn = useServerFn(getCampaignTemplate);
  const saveFn = useServerFn(saveCampaignTemplate);
  const { data, isLoading } = useQuery({ queryKey: QK, queryFn: () => getFn() });
  const [fields, setFields] = useState<SummaryField[] | null>(null);
  useEffect(() => { if (data) setFields(data); }, [data]);

  const save = useMutation({
    mutationFn: (f: SummaryField[]) => saveFn({ data: { fields: f } }),
    onSuccess: () => { toast.success("Template salvo"); qc.invalidateQueries({ queryKey: QK }); },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading || !fields) return <div className="flex justify-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;

  const valid = fields.every((f) => f.label.trim() && (f.type !== "select" || f.options.length > 0));
  const setAt = (i: number, patch: Partial<SummaryField>) => setFields(fields.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i: number, d: number) => {
    const next = [...fields];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setFields(next);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Os campos do Resumo de cada campanha (produto › Inteligência › Campanhas), na ordem em que aparecem. Ex.: criativos, botão, página, Advantage+ ligado ou não.
        Tirar um campo não apaga o que já foi preenchido; ele volta se o campo voltar.
      </p>
      <section className="premium-card p-4">
        <div className="space-y-2">
          {fields.map((fld, i) => (
            <div key={fld.id} className="flex flex-wrap items-center gap-2">
              <input value={fld.label} placeholder="Nome do campo" onChange={(e) => setAt(i, { label: e.target.value })} className={`${inputCls} w-44`} />
              <select value={fld.type} onChange={(e) => setAt(i, { type: e.target.value as FieldType })} className={`${inputCls} w-36`}>
                {FIELD_TYPES.map((t) => <option key={t} value={t}>{FIELD_TYPE_LABEL[t]}</option>)}
              </select>
              {fld.type === "select"
                ? <OptionsInput value={fld.options} onChange={(options) => setAt(i, { options })} />
                : <span className="flex-1 min-w-[200px]" />}
              <button type="button" disabled={i === 0} onClick={() => move(i, -1)} title="Subir" className="size-8 rounded-lg grid place-items-center text-muted-foreground hover:bg-muted disabled:opacity-30"><ArrowUp className="size-3.5" /></button>
              <button type="button" disabled={i === fields.length - 1} onClick={() => move(i, 1)} title="Descer" className="size-8 rounded-lg grid place-items-center text-muted-foreground hover:bg-muted disabled:opacity-30"><ArrowDown className="size-3.5" /></button>
              <button type="button" onClick={() => setFields(fields.filter((_, j) => j !== i))} title="Remover" className="size-8 rounded-lg grid place-items-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 className="size-3.5" /></button>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setFields([...fields, { id: crypto.randomUUID().slice(0, 8), label: "", type: "text", options: [] }])}
          className="mt-3 h-8 px-3 rounded-lg border border-dashed border-border text-xs font-medium flex items-center gap-1.5 hover:bg-muted">
          <Plus className="size-3.5" /> Adicionar campo
        </button>
      </section>
      <div className="flex items-center justify-end gap-3">
        {!valid && <span className="text-xs text-muted-foreground">Todo campo precisa de nome; campo de opções precisa de pelo menos uma opção.</span>}
        <button onClick={() => save.mutate(fields)} disabled={!valid || save.isPending}
          className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-1.5 disabled:opacity-50">
          {save.isPending && <Loader2 className="size-3.5 animate-spin" />} Salvar
        </button>
      </div>
    </div>
  );
}
