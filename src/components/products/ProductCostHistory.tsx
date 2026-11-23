import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowDownRight, ArrowUpRight, Check, History, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  COST_START, deleteProductCostEntry, getProductCostHistory, saveProductCostEntry, type CostEntry,
} from "@/lib/product-cost-history.functions";

// Custo do produto no card: mostra o preço que vale hoje e abre o Histórico de
// preços, onde cada preço vale a partir de uma data (data do pedido, horário de
// NY). Pedidos antigos continuam com o preço da época.

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const fmtDay = (d: string) => { const [y, m, day] = d.split("-"); return `${day}/${m}/${y.slice(2)}`; };
const prevDay = (d: string) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); };
const parseMoney = (s: string) => {
  const t = s.trim().replace(/\s/g, "").replace(/^\$/, "");
  if (!t) return null;
  // Aceita 12.5, 12,5, 1.234,56 e 1,234.56: o último separador é o dos centavos.
  const dec = Math.max(t.lastIndexOf(","), t.lastIndexOf("."));
  const norm = dec < 0 ? t : `${t.slice(0, dec).replace(/[.,]/g, "")}.${t.slice(dec + 1)}`;
  if (!/^\d+(\.\d+)?$/.test(norm)) return null;
  const n = Number(norm);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
};
const inputCls = "h-9 px-2.5 rounded-lg bg-background border border-border text-sm outline-none focus:border-primary/50 tabular-nums";

export function ProductCostField({ productId, cost }: { productId: string; cost: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-1">Custo (USD)</div>
      <button type="button" onClick={() => setOpen(true)} title="Ver e alterar o preço de custo por data"
        className="w-full h-9 px-3 rounded-lg bg-background border border-border text-sm flex items-center justify-between gap-2 hover:border-primary/40 hover:bg-muted/40 transition-colors">
        <span className="tabular-nums font-medium">{USD.format(cost)}</span>
        <span className="flex items-center gap-1 text-xs text-muted-foreground"><History className="size-3.5" /> Histórico</span>
      </button>
      {open && <CostHistoryDialog productId={productId} onClose={() => setOpen(false)} />}
    </div>
  );
}

function CostHistoryDialog({ productId, onClose }: { productId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const getFn = useServerFn(getProductCostHistory);
  const saveFn = useServerFn(saveProductCostEntry);
  const delFn = useServerFn(deleteProductCostEntry);
  const key = ["product-cost-history", productId];
  const { data, isLoading, error } = useQuery({ queryKey: key, queryFn: () => getFn({ data: { product_id: productId } }) });

  const today = data?.today ?? "";
  const entries = data?.entries ?? [];
  const current = entries.find((e) => e.valid_from <= today) ?? null;
  const onlyStart = entries.length === 1 && entries[0].valid_from === COST_START;

  const [newCost, setNewCost] = useState("");
  const [newFrom, setNewFrom] = useState("");
  const from = newFrom || today;
  const clash = entries.find((e) => e.valid_from === from);
  const [editing, setEditing] = useState<string | null>(null);

  const done = (r: { cashDays: number; cashError: string | null }, msg: string) => {
    // Custo entra em lucro, pedidos, dashboards e Caixa: recarrega tudo que está na tela.
    qc.invalidateQueries();
    if (r.cashError) toast.warning(`${msg}, mas a previsão do Caixa não foi refeita: ${r.cashError}`);
    else toast.success(`${msg}. Lucros e custos já usam o preço novo${r.cashDays ? ` (previsão do Caixa refeita em ${r.cashDays} ${r.cashDays === 1 ? "dia" : "dias"})` : ""}.`);
  };
  const save = useMutation({
    mutationFn: (v: { entry_id: string | null; valid_from: string; cost: number }) => saveFn({ data: { product_id: productId, ...v } }),
    onSuccess: (r, v) => { done(r, v.entry_id ? "Preço corrigido" : "Preço salvo"); setEditing(null); if (!v.entry_id) { setNewCost(""); setNewFrom(""); } },
    onError: (e: Error) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: (entry_id: string) => delFn({ data: { product_id: productId, entry_id } }),
    onSuccess: (r) => done(r, "Preço apagado"),
    onError: (e: Error) => toast.error(e.message),
  });
  const busy = save.isPending || del.isPending;

  const addNew = () => {
    const c = parseMoney(newCost);
    if (c === null) { toast.error("Digite o custo, ex.: 12,50"); return; }
    if (!from || from > today) { toast.error("Escolha uma data até hoje"); return; }
    save.mutate({ entry_id: null, valid_from: from, cost: c });
  };
  const remove = async (e: CostEntry, prev: CostEntry | undefined) => {
    const ok = await confirm({
      title: "Apagar este preço?",
      description: `Os pedidos a partir de ${fmtDay(e.valid_from)} voltam a usar ${prev ? USD.format(prev.cost) : "o preço anterior"}${prev ? ` (preço de ${prev.valid_from === COST_START ? "desde o início" : fmtDay(prev.valid_from)})` : ""}.`,
      confirmText: "Apagar",
    });
    if (ok) del.mutate(e.id);
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogTitle className="text-base font-semibold">Preço de custo</DialogTitle>
        <p className="text-xs text-muted-foreground -mt-2">
          Cada pedido usa o preço que valia no dia em que foi feito (horário de Nova York). Pedidos já pagos ao fornecedor não mudam.
        </p>

        {error ? <p className="text-sm text-destructive">{(error as Error).message}</p>
          : isLoading ? <div className="flex justify-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
          : (
          <>
            {current && (
              <div className="rounded-xl border border-primary/25 bg-primary/5 px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground">Preço atual</p>
                  <p className="text-2xl font-bold tabular-nums tracking-tight">{USD.format(current.cost)}</p>
                </div>
                <p className="text-xs text-muted-foreground text-right">{current.valid_from === COST_START ? "desde o início" : `desde ${fmtDay(current.valid_from)}`}</p>
              </div>
            )}

            <div className="rounded-xl border border-border p-3">
              <p className="text-sm font-medium mb-2 flex items-center gap-1.5"><Plus className="size-4" /> Novo preço</p>
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex-1 min-w-[110px]">
                  <span className="block text-xs text-muted-foreground mb-1">Custo (US$)</span>
                  <input value={newCost} onChange={(e) => setNewCost(e.target.value)} inputMode="decimal" placeholder="0,00" autoFocus
                    onKeyDown={(e) => { if (e.key === "Enter") addNew(); }} className={`${inputCls} w-full`} />
                </label>
                <label className="flex-1 min-w-[140px]">
                  <span className="block text-xs text-muted-foreground mb-1">Vale a partir de</span>
                  <input type="date" value={from} max={today} onChange={(e) => setNewFrom(e.target.value)} className={`${inputCls} w-full`} />
                </label>
                <button onClick={addNew} disabled={busy || !newCost.trim()}
                  className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-1.5 disabled:opacity-50">
                  {save.isPending && !editing ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Salvar
                </button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {clash
                  ? <span className="text-warning">Já existe um preço começando em {fmtDay(from)} ({USD.format(clash.cost)}). Salvar substitui ele.</span>
                  : `Pedidos de ${from ? fmtDay(from) : "—"} em diante passam a usar este preço${onlyStart && entries[0].cost === 0 ? ". Se o produto sempre custou isso, corrija o preço \"Desde o início\" abaixo" : ""}.`}
              </p>
            </div>

            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1.5">Histórico</p>
              <ul className="rounded-xl border border-border divide-y divide-border">
                {entries.map((e, i) => {
                  const newer = entries[i - 1];
                  const older = entries[i + 1];
                  const end = newer ? fmtDay(prevDay(newer.valid_from)) : "hoje";
                  const start = e.valid_from === COST_START ? "Desde o início" : fmtDay(e.valid_from);
                  const diff = older ? e.cost - older.cost : 0;
                  const isCurrent = current?.id === e.id;
                  return editing === e.id ? (
                    <EditRow key={e.id} entry={e} today={today} busy={busy}
                      onCancel={() => setEditing(null)}
                      onSave={(v) => save.mutate({ entry_id: e.id, ...v })} />
                  ) : (
                    <li key={e.id} className="flex items-center gap-3 px-3 py-2.5 group">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm">
                          {start} <span className="text-muted-foreground">→ {end}</span>
                          {isCurrent && <span className="ml-2 text-xs font-semibold px-1.5 py-0.5 rounded bg-primary/10 text-primary">atual</span>}
                        </p>
                      </div>
                      {older && diff !== 0 && (
                        <span className={`text-xs tabular-nums flex items-center ${diff > 0 ? "text-destructive" : "text-success"}`}
                          title={diff > 0 ? "Ficou mais caro que o preço anterior" : "Ficou mais barato que o preço anterior"}>
                          {diff > 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}{USD.format(Math.abs(diff))}
                        </span>
                      )}
                      <span className="text-sm font-semibold tabular-nums w-20 text-right">{USD.format(e.cost)}</span>
                      <div className="flex items-center gap-0.5 w-14 justify-end">
                        <button onClick={() => setEditing(e.id)} disabled={busy} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted" aria-label="Corrigir">
                          <Pencil className="size-3.5" />
                        </button>
                        {e.valid_from !== COST_START && (
                          <button onClick={() => remove(e, older)} disabled={busy} className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10" aria-label="Apagar">
                            <Trash2 className="size-3.5" />
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditRow({ entry, today, busy, onCancel, onSave }: {
  entry: CostEntry; today: string; busy: boolean; onCancel: () => void; onSave: (v: { valid_from: string; cost: number }) => void;
}) {
  const [cost, setCost] = useState(String(entry.cost).replace(".", ","));
  const [from, setFrom] = useState(entry.valid_from);
  const isStart = entry.valid_from === COST_START;
  const submit = () => {
    const c = parseMoney(cost);
    if (c === null) { toast.error("Digite o custo, ex.: 12,50"); return; }
    if (!isStart && (!from || from > today)) { toast.error("Escolha uma data até hoje"); return; }
    if (c === entry.cost && from === entry.valid_from) { onCancel(); return; }
    onSave({ valid_from: isStart ? COST_START : from, cost: c });
  };
  return (
    <li className="flex flex-wrap items-center gap-2 px-3 py-2 bg-muted/40">
      {isStart
        ? <span className="text-sm flex-1 min-w-[120px]">Desde o início</span>
        : <input type="date" value={from} max={today} onChange={(e) => setFrom(e.target.value)} className={`${inputCls} flex-1 min-w-[140px]`} aria-label="Vale a partir de" />}
      <input value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" autoFocus aria-label="Custo"
        onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") onCancel(); }} className={`${inputCls} w-24`} />
      <button onClick={submit} disabled={busy} className="h-9 px-3 rounded-lg bg-primary text-primary-foreground text-sm flex items-center gap-1 disabled:opacity-50">
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Salvar
      </button>
      <button onClick={onCancel} disabled={busy} className="h-9 px-2 rounded-lg text-muted-foreground hover:bg-muted" aria-label="Cancelar"><X className="size-4" /></button>
    </li>
  );
}
