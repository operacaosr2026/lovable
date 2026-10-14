import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, Check, ChevronDown, ExternalLink, LayoutTemplate, Loader2, Plus, Radar, Settings2, Star, Swords, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AddBtn, FieldInput, SectionTitle } from "@/components/shops/StoreProduction";
import type { ProductionField } from "@/lib/store-production.functions";
import {
  createCompetitor, deleteCompetitor, deleteCompetitorTemplate, getProductCompetitors, listCompetitorTemplates,
  saveCompetitorTemplate, updateCompetitor, type Competitor, type CompetitorTemplate,
} from "@/lib/product-competitors.functions";

const newId = () => crypto.randomUUID();
const inputCls = "h-9 px-3 rounded-lg border border-border bg-background text-sm outline-none focus:border-primary/50";
const move = <T,>(list: T[], i: number, d: -1 | 1) => {
  const j = i + d;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
};

// Produtos › Inteligência › Concorrentes: um quadro por concorrente.
export function ProductCompetitors({ productId }: { productId: string }) {
  const qc = useQueryClient();
  const queryKey = ["product-competitors", productId];
  const getFn = useServerFn(getProductCompetitors);
  const createFn = useServerFn(createCompetitor);
  const { data, isLoading, error } = useQuery({ queryKey, queryFn: () => getFn({ data: { product_id: productId } }) });
  const [focusId, setFocusId] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (template_id: string | null) => createFn({ data: { product_id: productId, template_id, name: "" } }),
    onSuccess: (c) => { setFocusId(c.id); qc.invalidateQueries({ queryKey }); },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
  if (error || !data) return <p className="text-sm text-destructive">{(error as any)?.message ?? "Não foi possível carregar os concorrentes."}</p>;

  const def = data.templates.find((t) => t.is_default) ?? data.templates[0];
  const addButton = data.templates.length <= 1 ? (
    <button
      onClick={() => create.mutate(def?.id ?? null)}
      disabled={create.isPending}
      className="h-9 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-1.5 disabled:opacity-50"
    >
      {create.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} Concorrente
    </button>
  ) : (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button disabled={create.isPending} className="h-9 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-1.5 disabled:opacity-50">
          {create.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} Concorrente
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {data.templates.map((t) => (
          <DropdownMenuItem key={t.id} onClick={() => create.mutate(t.id)} className="gap-2">
            <LayoutTemplate className="size-3.5" /> <span className="flex-1 truncate">{t.name}</span>
            {t.is_default && <Star className="size-3 fill-current text-amber-500" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => create.mutate(null)} className="gap-2 text-muted-foreground">
          <Plus className="size-3.5" /> Em branco
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2.5">
        <div className="size-9 rounded-xl grid place-items-center shrink-0 bg-primary/10 text-primary"><Swords className="size-4.5" /></div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold leading-tight">Concorrentes</h3>
          <p className="text-[11px] text-muted-foreground truncate">
            Um quadro por concorrente — templates em{" "}
            <Link to="/settings/templates" search={{ tipo: "concorrentes" }} className="text-primary hover:underline">Configurações › Templates</Link>
          </p>
        </div>
        {addButton}
      </div>

      {data.competitors.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border py-14 flex flex-col items-center text-center">
          <div className="size-12 rounded-2xl bg-primary/10 text-primary grid place-items-center mb-3"><Swords className="size-5" /></div>
          <p className="text-sm font-medium">Nenhum concorrente ainda</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-xs">Crie um quadro para cada loja que vende este produto e acompanhe preço, página e anúncios.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.competitors.map((c) => (
            <CompetitorBoard key={c.id} competitor={c} autoFocus={c.id === focusId} queryKey={queryKey} />
          ))}
        </div>
      )}
    </div>
  );
}

const AVATAR_TONES = ["bg-primary/10 text-primary", "bg-info/10 text-info", "bg-success/10 text-success", "bg-amber-500/10 text-amber-600"];
const toneFor = (seed: string) => AVATAR_TONES[[...seed].reduce((n, ch) => n + ch.charCodeAt(0), 0) % AVATAR_TONES.length]!;
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "?";
const hostOf = (raw: string) => {
  try { return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.replace(/^www\./, ""); } catch { return null; }
};
const hrefOf = (raw: string) => (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
const fmtUsd = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("en-US", { style: "currency", currency: "USD" }) : v;
};
function timeAgo(iso: string) {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  return d < 30 ? `há ${d} ${d === 1 ? "dia" : "dias"}` : new Date(iso).toLocaleDateString("pt-BR");
}

function CompetitorAvatar({ name, host }: { name: string; host: string | null }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => { setBroken(false); }, [host]);
  if (host && !broken) {
    return (
      <div className="size-11 rounded-xl border border-border bg-background grid place-items-center shrink-0">
        <img src={`https://www.google.com/s2/favicons?domain=${host}&sz=64`} alt="" onError={() => setBroken(true)} className="size-6 rounded" />
      </div>
    );
  }
  return <div className={`size-11 rounded-xl grid place-items-center shrink-0 text-sm font-semibold ${toneFor(name || "?")}`}>{initials(name)}</div>;
}

function CompetitorBoard({ competitor, autoFocus, queryKey }: { competitor: Competitor; autoFocus: boolean; queryKey: unknown[] }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const updateFn = useServerFn(updateCompetitor);
  const deleteFn = useServerFn(deleteCompetitor);
  const [name, setName] = useState(competitor.name);
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(autoFocus);
  useEffect(() => { setName(competitor.name); }, [competitor.name]);

  const update = useMutation({
    mutationFn: (patch: Partial<Pick<Competitor, "name" | "fields" | "values">>) => updateFn({ data: { id: competitor.id, patch } }),
    onMutate: (patch) => {
      qc.setQueryData(queryKey, (old: any) => old && ({
        ...old,
        competitors: old.competitors.map((c: Competitor) => (c.id === competitor.id ? { ...c, ...patch, updated_at: new Date().toISOString() } : c)),
      }));
    },
    onError: (e: any) => { toast.error(e.message); qc.invalidateQueries({ queryKey }); },
  });
  const remove = useMutation({
    mutationFn: () => deleteFn({ data: { id: competitor.id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
    onError: (e: any) => toast.error(e.message),
  });

  const commitName = () => {
    const next = name.trim();
    setName(next);
    if (next !== competitor.name) update.mutate({ name: next });
  };

  const value = (f: ProductionField) => (competitor.values[f.id] ?? "").trim();
  const links = competitor.fields.filter((f) => f.type === "link" && value(f));
  const price = competitor.fields.find((f) => f.type === "currency" && value(f));
  const host = links.length ? hostOf(value(links[0]!)) : null;
  const filled = competitor.fields.filter((f) => value(f)).length;
  const total = competitor.fields.length;
  const iconBtn = "size-8 rounded-lg grid place-items-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors";

  return (
    <section className="premium-card overflow-hidden">
      <div className="flex items-center gap-3 p-4">
        <CompetitorAvatar name={competitor.name} host={host} />
        <div className="min-w-0 flex-1">
          <input
            value={name}
            autoFocus={autoFocus}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
            placeholder="Nome do concorrente"
            className="w-full h-7 px-1.5 -ml-1.5 rounded-md bg-transparent text-[15px] font-semibold tracking-tight outline-none hover:bg-muted/60 focus:bg-background focus:ring-2 focus:ring-primary/15"
          />
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5 min-w-0">
            {host ? <span className="truncate">{host}</span> : <span>Sem link</span>}
            <span className="text-muted-foreground/40">·</span>
            <span className="tabular-nums shrink-0">{filled}/{total} campos</span>
          </div>
        </div>

        {price && (
          <div className="hidden sm:flex flex-col items-end shrink-0 px-3 py-1 rounded-lg bg-success/10">
            <span className="text-[10px] uppercase tracking-wide text-success/80 font-medium">{price.label}</span>
            <span className="text-sm font-semibold text-success tabular-nums">{fmtUsd(value(price))}</span>
          </div>
        )}

        <div className="flex items-center gap-0.5 shrink-0">
          {links.map((f) => (
            <a key={f.id} href={hrefOf(value(f))} target="_blank" rel="noreferrer" title={f.label} className={iconBtn}>
              <ExternalLink className="size-4" />
            </a>
          ))}
          {links.length > 0 && <div className="w-px h-5 bg-border mx-1" />}
          <button
            onClick={() => toast.info("Em breve: concorrentes de alto nível vão para a página Concorrentes, com anúncios, análises e alertas.")}
            title="Enviar para a página Concorrentes"
            className="h-8 px-2.5 rounded-lg text-xs font-medium flex items-center gap-1.5 text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors"
          >
            <Radar className="size-3.5" /> <span className="hidden sm:inline">Alto nível</span>
          </button>
          <button
            onClick={() => { setEditing(!editing); setOpen(true); }}
            title="Editar campos"
            className={editing ? "size-8 rounded-lg grid place-items-center bg-primary/10 text-primary" : iconBtn}
          >
            <Settings2 className="size-4" />
          </button>
          <button
            onClick={() => confirm(`Excluir o concorrente "${competitor.name || "sem nome"}"?`).then((ok) => { if (ok) remove.mutate(); })}
            title="Excluir"
            className={`${iconBtn} hover:!bg-destructive/10 hover:!text-destructive`}
          >
            <Trash2 className="size-4" />
          </button>
          <button onClick={() => setOpen(!open)} title={open ? "Recolher" : "Expandir"} className={iconBtn}>
            <ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      {total > 0 && (
        <div className="h-0.5 bg-muted">
          <div className="h-full bg-primary/60 transition-all" style={{ width: `${(filled / total) * 100}%` }} />
        </div>
      )}

      {open && (
        <div className="border-t border-border/60 bg-muted/20 p-4">
          {editing ? (
            <FieldsDraftEditor
              fields={competitor.fields}
              pending={update.isPending}
              onCancel={() => setEditing(false)}
              onSave={(fields) => { update.mutate({ fields }); setEditing(false); }}
            />
          ) : total === 0 ? (
            <div className="py-4 text-center text-sm text-muted-foreground">
              Este quadro ainda não tem campos.{" "}
              <button onClick={() => setEditing(true)} className="text-primary font-medium hover:underline">Adicionar campos</button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
              {competitor.fields.map((f) => (
                <FieldInput
                  key={f.id}
                  field={f}
                  value={competitor.values[f.id] ?? ""}
                  onSave={(v) => update.mutate({ values: { ...competitor.values, [f.id]: v } })}
                />
              ))}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground/70 mt-3 text-right">Atualizado {timeAgo(competitor.updated_at)}</p>
        </div>
      )}
    </section>
  );
}

function FieldsDraftEditor({ fields, pending, onSave, onCancel }: {
  fields: ProductionField[]; pending: boolean; onSave: (fields: ProductionField[]) => void; onCancel: () => void;
}) {
  const [list, setList] = useState(fields);
  return (
    <div className="space-y-3">
      <FieldsListEditor list={list} onChange={setList} />
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="h-9 px-4 rounded-lg text-sm hover:bg-muted">Cancelar</button>
        <button
          onClick={() => onSave(list.filter((f) => f.label.trim()))}
          disabled={pending}
          className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-1.5 disabled:opacity-50"
        >
          <Check className="size-3.5" /> Salvar campos
        </button>
      </div>
    </div>
  );
}

function FieldsListEditor({ list, onChange }: { list: ProductionField[]; onChange: (list: ProductionField[]) => void }) {
  const set = (id: string, patch: Partial<ProductionField>) => onChange(list.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const btn = "size-7 rounded-md grid place-items-center text-muted-foreground hover:bg-muted hover:text-foreground shrink-0";
  return (
    <div className="space-y-1.5">
      {list.map((f, i) => (
        <div key={f.id} className="flex items-center gap-1.5">
          <input
            value={f.label}
            autoFocus={!f.label}
            onChange={(e) => set(f.id, { label: e.target.value })}
            placeholder="Nome do campo"
            className={`flex-1 min-w-0 ${inputCls}`}
          />
          <select
            value={f.type}
            onChange={(e) => set(f.id, { type: e.target.value as ProductionField["type"] })}
            className="h-9 px-2 rounded-lg border border-border bg-background text-sm outline-none"
          >
            <option value="text">Texto</option>
            <option value="longtext">Texto longo</option>
            <option value="link">Link</option>
            <option value="email">E-mail</option>
            <option value="currency">Moeda (US$)</option>
          </select>
          <button onClick={() => onChange(move(list, i, -1))} className={btn} title="Subir"><ArrowUp className="size-3.5" /></button>
          <button onClick={() => onChange(move(list, i, 1))} className={btn} title="Descer"><ArrowDown className="size-3.5" /></button>
          <button onClick={() => onChange(list.filter((x) => x.id !== f.id))} className={`${btn} hover:!bg-destructive/10 hover:!text-destructive`} title="Remover">
            <Trash2 className="size-3.5" />
          </button>
        </div>
      ))}
      <AddBtn onClick={() => onChange([...list, { id: newId(), label: "", type: "text" }])}>Campo</AddBtn>
    </div>
  );
}

// ── Configurações › Templates › Concorrentes ──

type Draft = Omit<CompetitorTemplate, "id"> & { id?: string };
const TEMPLATES_QK = ["competitor-templates"];
const emptyDraft = (): Draft => ({ name: "", fields: [], is_default: false });

export function CompetitorTemplates() {
  const listFn = useServerFn(listCompetitorTemplates);
  const { data = [], isLoading } = useQuery({ queryKey: TEMPLATES_QK, queryFn: () => listFn() });
  const [selected, setSelected] = useState<string | "new" | null>(null);

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
  const current = selected === "new" ? emptyDraft() : (data.find((t) => t.id === selected) ?? data[0]);
  const activeId = selected === "new" ? "new" : current?.id;

  return (
    <section className="premium-card p-6">
      <SectionTitle action={<AddBtn onClick={() => setSelected("new")}>Template</AddBtn>}>Templates de concorrentes</SectionTitle>
      <p className="text-xs text-muted-foreground mb-4">
        Campos de cada quadro de concorrente (aba Concorrentes do produto). O quadro copia os campos do template ao ser
        criado — mudar o template não altera os quadros que já existem.
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
              <Swords className="size-3.5 shrink-0" />
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
            <TemplateEditor key={activeId} initial={current} onSaved={(id) => setSelected(id)} onDone={() => setSelected(null)} />
          )}
        </div>
      </div>
    </section>
  );
}

function TemplateEditor({ initial, onSaved, onDone }: { initial: Draft; onSaved: (id: string) => void; onDone: () => void }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const saveFn = useServerFn(saveCompetitorTemplate);
  const deleteFn = useServerFn(deleteCompetitorTemplate);
  const [tpl, setTpl] = useState<Draft>(initial);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: TEMPLATES_QK });
    qc.invalidateQueries({ queryKey: ["product-competitors"] });
  };
  const save = useMutation({
    mutationFn: () => saveFn({ data: { id: tpl.id, name: tpl.name.trim(), fields: tpl.fields.filter((f) => f.label.trim()), is_default: tpl.is_default } }),
    onSuccess: ({ id }) => { invalidate(); toast.success("Template salvo"); onSaved(id); },
    onError: (e: any) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => { invalidate(); onDone(); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={tpl.name}
          autoFocus={!tpl.name}
          onChange={(e) => setTpl({ ...tpl, name: e.target.value })}
          placeholder="Nome do template (ex.: Loja Shopify)"
          className={`flex-1 min-w-48 font-medium ${inputCls}`}
        />
        <label className="h-9 px-3 rounded-lg border border-border text-sm flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" checked={tpl.is_default} onChange={(e) => setTpl({ ...tpl, is_default: e.target.checked })} className="accent-primary" />
          Padrão
        </label>
      </div>

      <FieldsListEditor list={tpl.fields} onChange={(fields) => setTpl({ ...tpl, fields })} />

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
          disabled={save.isPending || !tpl.name.trim()}
          className="ml-auto h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-1.5 disabled:opacity-50"
        >
          {save.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Salvar template
        </button>
      </div>
    </div>
  );
}
