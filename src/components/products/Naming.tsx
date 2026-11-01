import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowDown, ArrowUp, Check, Copy, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  LEVEL_LABEL, NAMING_LEVELS, getNamingTemplate, saveNamingTemplate,
  type NamingField, type NamingLevel, type NamingTemplate,
} from "@/lib/naming.functions";
import { STANDARD_URL_TAGS } from "@/lib/utm";

// Template de nomenclatura (Configurações › Templates) e o gerador do produto
// (Anúncios › Nomenclatura): preenche os campos e copia o nome e a UTM.

const QK = ["naming-template"];
const inputCls = "h-9 px-3 rounded-lg border border-border bg-background text-sm outline-none focus:border-primary/50";

// "|" separa nome e id na UTM, então sai do nome.
const clean = (v: string) => v.replace(/\|/g, "").trim();

function CopyButton({ text, disabled }: { text: string; disabled?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }, () => toast.error("Não foi possível copiar"))}
      className="h-9 px-3 rounded-lg border border-border text-xs font-medium flex items-center gap-1.5 hover:bg-muted shrink-0 disabled:opacity-50"
    >
      {done ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />} {done ? "Copiado" : "Copiar"}
    </button>
  );
}

// ── Gerador (produto) ──

export function NamingGenerator() {
  const getFn = useServerFn(getNamingTemplate);
  const { data, isLoading, error } = useQuery({ queryKey: QK, queryFn: () => getFn() });
  const [values, setValues] = useState<Record<string, string>>({});

  if (isLoading) return <div className="flex justify-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
  if (error || !data) return <p className="text-sm text-destructive">{(error as Error)?.message ?? "Não foi possível carregar a nomenclatura."}</p>;

  return (
    <div className="space-y-4 max-w-4xl">
      <section className="premium-card p-4">
        <h3 className="text-sm font-semibold">Parâmetros de URL (UTM)</h3>
        <p className="text-xs text-muted-foreground mt-0.5 mb-3">Cole no campo "Parâmetros de URL" de todos os anúncios. A Meta preenche os nomes e números sozinha; é assim que as vendas da Shopify e os dados do Clarity casam com a campanha.</p>
        <div className="flex gap-2">
          <code className="flex-1 min-w-0 rounded-lg bg-muted px-3 py-2 text-xs break-all">{STANDARD_URL_TAGS}</code>
          <CopyButton text={STANDARD_URL_TAGS} />
        </div>
      </section>

      {NAMING_LEVELS.map((level) => {
        const fields = data.levels[level];
        const key = (fld: NamingField) => `${level}:${fld.id}`;
        const name = fields.map((fld) => clean(values[key(fld)] ?? "")).filter(Boolean).join(data.separator);
        return (
          <section key={level} className="premium-card p-4">
            <h3 className="text-sm font-semibold mb-3">{LEVEL_LABEL[level]}</h3>
            {fields.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhum campo. Crie em <Link to="/settings/templates" search={{ tipo: "nomenclatura" }} className="text-primary hover:underline">Configurações › Templates › Nomenclatura</Link>.</p>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                  {fields.map((fld) => (
                    <label key={fld.id} className="block">
                      <span className="text-[11px] text-muted-foreground">{fld.label}</span>
                      <input
                        value={values[key(fld)] ?? ""}
                        onChange={(e) => setValues((v) => ({ ...v, [key(fld)]: e.target.value }))}
                        list={fld.options.length ? `naming-${level}-${fld.id}` : undefined}
                        className={`${inputCls} w-full mt-0.5`}
                      />
                      {fld.options.length > 0 && (
                        <datalist id={`naming-${level}-${fld.id}`}>{fld.options.map((o) => <option key={o} value={o} />)}</datalist>
                      )}
                    </label>
                  ))}
                </div>
                <div className="flex gap-2">
                  <code className={`flex-1 min-w-0 rounded-lg bg-muted px-3 py-2 text-xs break-all ${name ? "" : "text-muted-foreground"}`}>{name || "Preencha os campos"}</code>
                  <CopyButton text={name} disabled={!name} />
                </div>
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}

// ── Template (Configurações) ──

export function NamingTemplateEditor() {
  const qc = useQueryClient();
  const getFn = useServerFn(getNamingTemplate);
  const saveFn = useServerFn(saveNamingTemplate);
  const { data, isLoading } = useQuery({ queryKey: QK, queryFn: () => getFn() });
  const [tpl, setTpl] = useState<NamingTemplate | null>(null);
  useEffect(() => { if (data) setTpl(data); }, [data]);

  const save = useMutation({
    mutationFn: (t: NamingTemplate) => saveFn({ data: t }),
    onSuccess: () => { toast.success("Nomenclatura salva"); qc.invalidateQueries({ queryKey: QK }); },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading || !tpl) return <div className="flex justify-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;

  const setFields = (level: NamingLevel, fields: NamingField[]) => setTpl({ ...tpl, levels: { ...tpl.levels, [level]: fields } });
  const valid = tpl.separator && !tpl.separator.includes("|")
    && NAMING_LEVELS.every((l) => tpl.levels[l].every((fld) => fld.label.trim()));
  const example = (level: NamingLevel) => tpl.levels[level].map((fld) => fld.options[0] || fld.label.toUpperCase()).join(tpl.separator);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Os campos de cada nível, na ordem em que entram no nome. Opções são sugestões que aparecem ao digitar. O gerador fica no produto, em Anúncios › Nomenclatura.
      </p>
      <label className="flex items-center gap-2 text-sm">
        Separador
        <input value={tpl.separator} maxLength={3} onChange={(e) => setTpl({ ...tpl, separator: e.target.value })} className={`${inputCls} w-16 text-center`} />
        {tpl.separator.includes("|") && <span className="text-xs text-destructive">Não use | (ele separa nome e número na UTM)</span>}
      </label>

      {NAMING_LEVELS.map((level) => {
        const fields = tpl.levels[level];
        const move = (i: number, d: number) => {
          const next = [...fields];
          [next[i], next[i + d]] = [next[i + d], next[i]];
          setFields(level, next);
        };
        return (
          <section key={level} className="premium-card p-4">
            <div className="flex items-center gap-2 mb-3">
              <h3 className="text-sm font-semibold">{LEVEL_LABEL[level]}</h3>
              {fields.length > 0 && <code className="text-[11px] text-muted-foreground truncate">{example(level)}</code>}
            </div>
            <div className="space-y-2">
              {fields.map((fld, i) => (
                <div key={fld.id} className="flex flex-wrap items-center gap-2">
                  <input value={fld.label} placeholder="Nome do campo"
                    onChange={(e) => setFields(level, fields.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                    className={`${inputCls} w-44`} />
                  <OptionsInput value={fld.options} onChange={(options) => setFields(level, fields.map((x, j) => (j === i ? { ...x, options } : x)))} />
                  <button type="button" disabled={i === 0} onClick={() => move(i, -1)} title="Subir" className="size-8 rounded-lg grid place-items-center text-muted-foreground hover:bg-muted disabled:opacity-30"><ArrowUp className="size-3.5" /></button>
                  <button type="button" disabled={i === fields.length - 1} onClick={() => move(i, 1)} title="Descer" className="size-8 rounded-lg grid place-items-center text-muted-foreground hover:bg-muted disabled:opacity-30"><ArrowDown className="size-3.5" /></button>
                  <button type="button" onClick={() => setFields(level, fields.filter((_, j) => j !== i))} title="Remover" className="size-8 rounded-lg grid place-items-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 className="size-3.5" /></button>
                </div>
              ))}
            </div>
            <button type="button" onClick={() => setFields(level, [...fields, { id: crypto.randomUUID().slice(0, 8), label: "", options: [] }])}
              className="mt-3 h-8 px-3 rounded-lg border border-dashed border-border text-xs font-medium flex items-center gap-1.5 hover:bg-muted">
              <Plus className="size-3.5" /> Adicionar campo
            </button>
          </section>
        );
      })}

      <div className="flex justify-end">
        <button onClick={() => save.mutate(tpl)} disabled={!valid || save.isPending}
          className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-1.5 disabled:opacity-50">
          {save.isPending && <Loader2 className="size-3.5 animate-spin" />} Salvar
        </button>
      </div>
    </div>
  );
}

// Opções separadas por vírgula; o texto fica livre enquanto digita.
function OptionsInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState(value.join(", "));
  return (
    <input value={text} placeholder="Opções (opcional), separadas por vírgula"
      onChange={(e) => setText(e.target.value)}
      onBlur={() => { const next = text.split(",").map((s) => s.trim()).filter(Boolean); onChange(next); setText(next.join(", ")); }}
      className={`${inputCls} flex-1 min-w-[200px]`} />
  );
}
