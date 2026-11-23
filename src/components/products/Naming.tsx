import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Copy, Loader2, RotateCcw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { getNamingTemplate, saveNamingTemplate } from "@/lib/naming.functions";
import {
  DEFAULT_TEMPLATES, LEVEL_LABEL, NAMING_LEVELS, NAMING_SEPARATOR, codeLabel, codesFor, codesIn, exampleName, isKnownCode, renderName,
  type NamingLevel, type NamingTemplates,
} from "@/lib/naming";
import { STANDARD_URL_TAGS } from "@/lib/utm";
import { cn } from "@/lib/utils";
import { TabSkeleton } from "@/components/products/TabSkeleton";

// Modelo de nomes (Configurações › Templates › Nomenclatura) e o gerador do
// produto (Anúncios › Nomenclatura). Ao publicar pela aba Anúncios os nomes
// saem sozinhos deste modelo.

export const NAMING_QK = ["naming-template"];
const inputCls = "h-9 px-3 rounded-lg border border-border bg-background text-sm outline-none focus:border-primary/50";

const LEVEL_HINT: Record<NamingLevel, string> = {
  campaign: "Um nome por publicação.",
  adset: "Um por conjunto. Pode usar os códigos do anúncio: no teste com 1 conjunto por criativo, o conjunto leva o nome do criativo.",
  ad: "Um por anúncio. No anúncio com vários criativos, {{nome_do_criativo}} junta os nomes.",
};

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

// ── Template (Configurações) ──

export function NamingTemplateEditor() {
  const qc = useQueryClient();
  const getFn = useServerFn(getNamingTemplate);
  const saveFn = useServerFn(saveNamingTemplate);
  const { data, isLoading } = useQuery({ queryKey: NAMING_QK, queryFn: () => getFn() });
  const [tpl, setTpl] = useState<NamingTemplates | null>(null);
  useEffect(() => { if (data) setTpl(data); }, [data]);

  const save = useMutation({
    mutationFn: (t: NamingTemplates) => saveFn({ data: t }),
    onSuccess: () => { toast.success("Modelo de nomes salvo"); qc.invalidateQueries({ queryKey: NAMING_QK }); },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading || !tpl) return <TabSkeleton />;

  const dirty = !data || NAMING_LEVELS.some((l) => data[l] !== tpl[l]);
  const invalid = NAMING_LEVELS.some((l) => tpl[l].includes("|"));

  return (
    <div className="space-y-4 max-w-4xl">
      <p className="text-sm text-muted-foreground">
        Escreva como cada nome deve ficar e clique nos códigos para encaixar. Ao publicar pela aba <strong className="text-foreground">Anúncios</strong> do produto, o sistema troca os códigos pelos valores certos.
        Código que você inventar (ex.: <code className="text-xs">{"{{angulo}}"}</code>) vira uma caixinha para preencher na hora.
      </p>

      {NAMING_LEVELS.map((level) => (
        <LevelEditor key={level} level={level} value={tpl[level]} onChange={(v) => setTpl({ ...tpl, [level]: v })} />
      ))}

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setTpl(DEFAULT_TEMPLATES)}
          className="h-9 px-3 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted flex items-center gap-1.5"
        >
          <RotateCcw className="size-3.5" /> Usar o modelo sugerido
        </button>
        <button onClick={() => save.mutate(tpl)} disabled={!dirty || invalid || save.isPending}
          className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-1.5 disabled:opacity-50">
          {save.isPending && <Loader2 className="size-3.5 animate-spin" />} Salvar
        </button>
      </div>
    </div>
  );
}

function LevelEditor({ level, value, onChange }: { level: NamingLevel; value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const used = new Set(codesIn(value));
  const own = codesFor(level).filter((c) => c.level === level);
  const inherited = codesFor(level).filter((c) => c.level !== level);
  const custom = codesIn(value).filter((c) => !isKnownCode(c));

  // Encaixa o código onde está o cursor (ou no fim), com espaço/separador se precisar.
  const insert = (code: string) => {
    const el = ref.current;
    const at = el?.selectionStart ?? value.length;
    const before = value.slice(0, at);
    const after = value.slice(el?.selectionEnd ?? at);
    const glue = before && !/[\s\-_·/#(]$/.test(before) ? NAMING_SEPARATOR : "";
    const token = `{{${code}}}`;
    onChange(before + glue + token + after);
    requestAnimationFrame(() => {
      el?.focus();
      const pos = (before + glue + token).length;
      el?.setSelectionRange(pos, pos);
    });
  };

  const chip = (code: string, label: string) => (
    <button
      key={code}
      type="button"
      title={label}
      onClick={() => insert(code)}
      className={cn(
        "h-7 px-2 rounded-md border text-[11px] font-mono transition-colors",
        used.has(code) ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-background hover:border-primary/40 hover:bg-primary/5",
      )}
    >
      {`{{${code}}}`}
    </button>
  );

  return (
    <section className="rounded-2xl border border-border bg-card soft-shadow-sm p-4 sm:p-5 space-y-3">
      <div>
        <h3 className="text-sm font-semibold">{LEVEL_LABEL[level]}</h3>
        <p className="text-xs text-muted-foreground mt-0.5">{LEVEL_HINT[level]}</p>
      </div>
      <input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`Ex.: ${DEFAULT_TEMPLATES[level]}`}
        className={cn(inputCls, "w-full h-10 font-mono text-[13px]", value.includes("|") && "border-destructive")}
      />
      {value.includes("|") && <p className="text-xs text-destructive">Não use | (barra em pé): ela separa o nome do número na UTM. Use _ no lugar.</p>}

      <div className="space-y-1.5">
        <div className="flex flex-wrap gap-1.5">{own.map((c) => chip(c.code, c.label))}</div>
        {inherited.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground mr-0.5">Também:</span>
            {inherited.map((c) => chip(c.code, c.label))}
          </div>
        )}
      </div>

      <div className="rounded-lg bg-muted/60 px-3 py-2 flex items-start gap-2">
        <Sparkles className="size-3.5 text-primary mt-0.5 shrink-0" />
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">Exemplo</div>
          <div className="text-sm font-medium break-all">{exampleName(value) || <span className="text-muted-foreground font-normal">Vazio. O sistema usa "{LEVEL_LABEL[level]} 01".</span>}</div>
          {custom.length > 0 && (
            <div className="text-xs text-muted-foreground mt-1">
              Seus códigos: {custom.map((c) => <code key={c} className="mr-1 text-foreground">{`{{${c}}}`}</code>)} preenchidos na hora de publicar.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ── Gerador (produto) ──

export function NamingGenerator({ productName = "" }: { productName?: string }) {
  const getFn = useServerFn(getNamingTemplate);
  const { data, isLoading, error } = useQuery({ queryKey: NAMING_QK, queryFn: () => getFn() });
  const today = new Date();
  const [values, setValues] = useState<Record<string, string>>({
    produto: productName,
    data: `${String(today.getDate()).padStart(2, "0")}/${String(today.getMonth() + 1).padStart(2, "0")}`,
  });

  const codes = useMemo(() => (data ? [...new Set(NAMING_LEVELS.flatMap((l) => codesIn(data[l])))] : []), [data]);

  if (isLoading) return <TabSkeleton />;
  if (error || !data) return <p className="text-sm text-destructive">{(error as Error)?.message ?? "Não foi possível carregar o modelo de nomes."}</p>;

  return (
    <div className="space-y-4 max-w-4xl">
      <section className="rounded-2xl border border-border bg-card soft-shadow-sm p-4 sm:p-5">
        <h3 className="text-sm font-semibold">Parâmetros de URL (UTM)</h3>
        <p className="text-xs text-muted-foreground mt-0.5 mb-3">Cole no campo "Parâmetros de URL" de todos os anúncios. A Meta preenche os nomes e números sozinha; é assim que as vendas da Shopify e os dados do Clarity casam com a campanha.</p>
        <div className="flex gap-2">
          <code className="flex-1 min-w-0 rounded-lg bg-muted px-3 py-2 text-xs break-all">{STANDARD_URL_TAGS}</code>
          <CopyButton text={STANDARD_URL_TAGS} />
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card soft-shadow-sm p-4 sm:p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold">Gerar nomes à mão</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Para subir direto no Gerenciador. Pela aba Criar campanha os nomes saem sozinhos. Modelo em{" "}
            <Link to="/settings/templates" search={{ tipo: "nomenclatura" }} className="text-primary hover:underline">Configurações › Templates › Nomenclatura</Link>.
          </p>
        </div>
        {codes.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {codes.map((code) => (
              <label key={code} className="block">
                <span className="text-xs text-muted-foreground">{codeLabel(code)}</span>
                <input value={values[code] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [code]: e.target.value }))} className={`${inputCls} w-full mt-0.5`} />
              </label>
            ))}
          </div>
        )}
        <div className="space-y-2">
          {NAMING_LEVELS.map((level) => {
            const name = renderName(data[level], values);
            return (
              <div key={level} className="flex items-center gap-2">
                <span className="w-20 text-xs text-muted-foreground shrink-0">{LEVEL_LABEL[level]}</span>
                <code className={`flex-1 min-w-0 rounded-lg bg-muted px-3 py-2 text-xs break-all ${name ? "" : "text-muted-foreground"}`}>{name || "Preencha os campos"}</code>
                <CopyButton text={name} disabled={!name} />
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

// Opções separadas por vírgula; o texto fica livre enquanto digita (usado no template de Campanhas).
export function OptionsInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState(value.join(", "));
  return (
    <input value={text} placeholder="Opções (opcional), separadas por vírgula"
      onChange={(e) => setText(e.target.value)}
      onBlur={() => { const next = text.split(",").map((s) => s.trim()).filter(Boolean); onChange(next); setText(next.join(", ")); }}
      className={`${inputCls} flex-1 min-w-[200px]`} />
  );
}
