import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listCategories, createCategory, deleteCategory,
  getFinanceDashboard, setFxRate, setGoal,
} from "@/lib/finance.functions";
import { listCategoryRules, upsertCategoryRule, deleteCategoryRule, reapplyRulesToPending, resetAllTransactions, reconcileTransfers } from "@/lib/banking.functions";
import { requireAuth } from "@/lib/route-guards";
import { Plus, Trash2, Sparkles, AlertTriangle, ArrowLeftRight } from "lucide-react";
import { useConfirm } from "@/components/ui/confirm-dialog";

export const Route = createFileRoute("/finance/settings")({
  beforeLoad: requireAuth,
  component: SettingsPage,
});

function SettingsPage() {
  const qc = useQueryClient();
  const listCat = useServerFn(listCategories);
  const createCat = useServerFn(createCategory);
  const delCat = useServerFn(deleteCategory);
  const getDash = useServerFn(getFinanceDashboard);
  const setFx = useServerFn(setFxRate);
  const setG = useServerFn(setGoal);
  const listRules = useServerFn(listCategoryRules);
  const upsertRule = useServerFn(upsertCategoryRule);
  const delRule = useServerFn(deleteCategoryRule);
  const reapply = useServerFn(reapplyRulesToPending);
  const resetTx = useServerFn(resetAllTransactions);
  const reconcile = useServerFn(reconcileTransfers);

  const confirm = useConfirm();

  const catQ = useQuery({ queryKey: ["finance", "cat"], queryFn: () => listCat() });
  const dashQ = useQuery({ queryKey: ["finance-dash"], queryFn: () => getDash() });
  const rulesQ = useQuery({ queryKey: ["finance", "rules"], queryFn: () => listRules() });

  const invCat = () => qc.invalidateQueries({ queryKey: ["finance", "cat"] });
  const invDash = () => qc.invalidateQueries({ queryKey: ["finance-dash"] });
  const invRules = () => qc.invalidateQueries({ queryKey: ["finance", "rules"] });

  const mCreate = useMutation({ mutationFn: (d: any) => createCat({ data: d }), onSuccess: invCat });
  const mDel = useMutation({ mutationFn: (d: any) => delCat({ data: d }), onSuccess: invCat });
  const mFx = useMutation({ mutationFn: (d: any) => setFx({ data: d }), onSuccess: invDash });
  const mGoal = useMutation({ mutationFn: (d: any) => setG({ data: d }), onSuccess: invDash });
  const mUpsertRule = useMutation({ mutationFn: (d: any) => upsertRule({ data: d }), onSuccess: invRules });
  const mDelRule = useMutation({ mutationFn: (d: any) => delRule({ data: d }), onSuccess: invRules });
  const mReapply = useMutation({
    mutationFn: () => reapply(),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["finance", "tx"] }); invDash(); },
  });
  const mReset = useMutation({
    mutationFn: () => resetTx(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance", "tx"] });
      qc.invalidateQueries({ queryKey: ["finance-dash"] });
    },
  });
  const mReconcile = useMutation({
    mutationFn: () => reconcile(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance", "tx"] });
      qc.invalidateQueries({ queryKey: ["finance-dash"] });
    },
  });

  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<"income" | "expense">("expense");
  const [fxInput, setFxInput] = useState("");
  const [monthlyGoal, setMonthlyGoal] = useState("");
  const [yearlyGoal, setYearlyGoal] = useState("");

  // Rule form
  const [ruleValue, setRuleValue] = useState("");
  const [ruleType, setRuleType] = useState<"contains" | "equals" | "regex">("contains");
  const [ruleApplies, setRuleApplies] = useState<"any" | "income" | "expense">("any");
  const [ruleCatId, setRuleCatId] = useState("");

  const cats = catQ.data ?? [];
  const incomeCats = cats.filter((c: any) => c.kind === "income");
  const expenseCats = cats.filter((c: any) => c.kind === "expense");
  const rules = rulesQ.data ?? [];
  const catById: Record<string, any> = Object.fromEntries(cats.map((c: any) => [c.id, c]));

  const now = new Date();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* FX */}
      <section className="rounded-2xl bg-surface border border-border p-5">
        <div className="text-sm font-semibold mb-3">Cotação USD → BRL</div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Atual:</span>
          <span className="text-lg font-semibold tabular-nums">{(dashQ.data?.fx ?? 5).toFixed(4)}</span>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const n = parseFloat(fxInput.replace(",", "."));
            if (!isNaN(n) && n > 0) { mFx.mutate({ usd_to_brl: n }); setFxInput(""); }
          }}
          className="mt-3 flex items-center gap-2"
        >
          <input value={fxInput} onChange={(e) => setFxInput(e.target.value)} placeholder="ex: 5,1234"
            className="flex-1 h-10 px-3 rounded-lg bg-muted border border-border text-sm outline-none focus:border-primary" />
          <button type="submit" className="h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium">Atualizar</button>
        </form>
        <p className="text-[11px] text-muted-foreground mt-2">Aplicada apenas na visualização do patrimônio total.</p>
      </section>

      {/* Goals */}
      <section className="rounded-2xl bg-surface border border-border p-5">
        <div className="text-sm font-semibold mb-3">Metas de patrimônio (BRL)</div>
        <div className="space-y-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const n = parseFloat(monthlyGoal.replace(",", "."));
              if (!isNaN(n) && n > 0) {
                mGoal.mutate({ period: "monthly", target_amount_brl: n, year: now.getFullYear(), month: now.getMonth() + 1 });
                setMonthlyGoal("");
              }
            }}
            className="flex items-center gap-2"
          >
            <span className="text-xs text-muted-foreground w-16 shrink-0">Mensal</span>
            <input value={monthlyGoal} onChange={(e) => setMonthlyGoal(e.target.value)}
              placeholder={dashQ.data?.monthlyGoal ? `Atual: ${Number(dashQ.data.monthlyGoal.target_amount_brl).toLocaleString("pt-BR")}` : "ex: 50000"}
              className="flex-1 h-9 px-3 rounded-lg bg-muted border border-border text-sm outline-none focus:border-primary" />
            <button type="submit" className="h-9 px-3 rounded-lg bg-muted text-xs font-medium">Salvar</button>
          </form>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const n = parseFloat(yearlyGoal.replace(",", "."));
              if (!isNaN(n) && n > 0) {
                mGoal.mutate({ period: "yearly", target_amount_brl: n, year: now.getFullYear() });
                setYearlyGoal("");
              }
            }}
            className="flex items-center gap-2"
          >
            <span className="text-xs text-muted-foreground w-16 shrink-0">Anual</span>
            <input value={yearlyGoal} onChange={(e) => setYearlyGoal(e.target.value)}
              placeholder={dashQ.data?.yearlyGoal ? `Atual: ${Number(dashQ.data.yearlyGoal.target_amount_brl).toLocaleString("pt-BR")}` : "ex: 600000"}
              className="flex-1 h-9 px-3 rounded-lg bg-muted border border-border text-sm outline-none focus:border-primary" />
            <button type="submit" className="h-9 px-3 rounded-lg bg-muted text-xs font-medium">Salvar</button>
          </form>
        </div>
      </section>

      {/* Categorias */}
      <section className="lg:col-span-2 rounded-2xl bg-surface border border-border p-5">
        <div className="text-sm font-semibold mb-3">Categorias</div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!newName.trim()) return;
            mCreate.mutate({ name: newName.trim(), kind: newKind, color: "oklch(0.6 0.22 285)" });
            setNewName("");
          }}
          className="flex items-center gap-2 mb-4"
        >
          <select value={newKind} onChange={(e) => setNewKind(e.target.value as any)}
            className="h-9 px-3 rounded-lg bg-muted border border-border text-sm outline-none">
            <option value="expense">Saída</option>
            <option value="income">Entrada</option>
          </select>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nome da categoria"
            className="flex-1 h-9 px-3 rounded-lg bg-muted border border-border text-sm outline-none focus:border-primary" />
          <button type="submit" className="h-9 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-medium flex items-center gap-1">
            <Plus className="size-3.5" /> Adicionar
          </button>
        </form>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Entradas</div>
            <ul className="space-y-1">
              {incomeCats.map((c: any) => (
                <li key={c.id} className="flex items-center gap-2 px-3 h-9 rounded-lg bg-muted group">
                  <div className="size-2 rounded-full" style={{ background: c.color }} />
                  <span className="text-sm flex-1">{c.name}</span>
                  <button onClick={() => mDel.mutate({ id: c.id })} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive">
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Saídas</div>
            <ul className="space-y-1">
              {expenseCats.map((c: any) => (
                <li key={c.id} className="flex items-center gap-2 px-3 h-9 rounded-lg bg-muted group">
                  <div className="size-2 rounded-full" style={{ background: c.color }} />
                  <span className="text-sm flex-1">{c.name}</span>
                  <button onClick={() => mDel.mutate({ id: c.id })} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive">
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Regras de categorização automática */}
      <section className="lg:col-span-2 rounded-2xl bg-surface border border-border p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-sm font-semibold">Regras de categorização automática</div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Aplicadas durante a importação. Use vírgula para exigir várias palavras (ex: <code>shopify, payout</code>). "Aplica a" diferencia receita de despesa para o mesmo termo.
            </p>
          </div>
          <button
            onClick={() => mReapply.mutate()}
            disabled={mReapply.isPending}
            className="h-9 px-3 rounded-lg bg-muted text-xs font-medium flex items-center gap-1.5 disabled:opacity-50"
          >
            <Sparkles className="size-3.5" />
            {mReapply.isPending ? "Aplicando…" : "Reaplicar nas pendentes"}
          </button>
        </div>

        {mReapply.isSuccess && mReapply.data && (
          <div className="mb-3 text-xs text-success">✓ {mReapply.data.updated} lançamento(s) categorizado(s).</div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!ruleValue.trim() || !ruleCatId) return;
            mUpsertRule.mutate({ match_value: ruleValue.trim(), match_type: ruleType, applies_to: ruleApplies, category_id: ruleCatId });
            setRuleValue("");
          }}
          className="grid grid-cols-1 md:grid-cols-[1fr_120px_140px_200px_auto] gap-2 mb-4"
        >
          <input value={ruleValue} onChange={(e) => setRuleValue(e.target.value)}
            placeholder='ex: "shopify, payout"'
            className="h-9 px-3 rounded-lg bg-muted border border-border text-sm outline-none focus:border-primary" />
          <select value={ruleType} onChange={(e) => setRuleType(e.target.value as any)}
            className="h-9 px-3 rounded-lg bg-muted border border-border text-sm outline-none">
            <option value="contains">contém</option>
            <option value="equals">igual a</option>
            <option value="regex">regex</option>
          </select>
          <select value={ruleApplies} onChange={(e) => setRuleApplies(e.target.value as any)}
            className="h-9 px-3 rounded-lg bg-muted border border-border text-sm outline-none">
            <option value="any">qualquer</option>
            <option value="income">só receita</option>
            <option value="expense">só despesa</option>
          </select>
          <select value={ruleCatId} onChange={(e) => setRuleCatId(e.target.value)}
            className="h-9 px-3 rounded-lg bg-muted border border-border text-sm outline-none">
            <option value="">— categoria —</option>
            <optgroup label="Saídas">
              {expenseCats.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </optgroup>
            <optgroup label="Entradas">
              {incomeCats.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </optgroup>
          </select>
          <button type="submit" className="h-9 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-medium flex items-center gap-1">
            <Plus className="size-3.5" /> Adicionar
          </button>
        </form>

        {rules.length === 0 ? (
          <div className="text-xs text-muted-foreground py-4 text-center">Nenhuma regra criada ainda.</div>
        ) : (
          <ul className="space-y-1">
            {rules.map((r: any) => {
              const cat = catById[r.category_id];
              return (
                <li key={r.id} className="flex items-center gap-3 px-3 h-10 rounded-lg bg-muted group">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground w-16 shrink-0">{r.match_type}</span>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground w-20 shrink-0">
                    {r.applies_to === "income" ? "receita" : r.applies_to === "expense" ? "despesa" : "qualquer"}
                  </span>
                  <span className="text-sm font-mono flex-1 truncate">{r.match_value}</span>
                  <span className="text-xs text-muted-foreground">→</span>
                  <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-surface text-xs">
                    <div className="size-2 rounded-full" style={{ background: cat?.color }} />
                    {cat?.name ?? "?"}
                  </div>
                  <button onClick={() => mDelRule.mutate({ id: r.id })}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive">
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Reconciliar transferências */}
      <section className="lg:col-span-2 rounded-2xl bg-surface border border-border p-5">
        <div className="flex items-start gap-3">
          <div className="size-9 rounded-lg bg-primary/10 grid place-items-center shrink-0">
            <ArrowLeftRight className="size-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold">Detectar transferências em lançamentos existentes</div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Procura pares de receita/despesa do mesmo dia, mesmo valor e contas diferentes, e os converte em uma única transferência.
            </p>
            {mReconcile.isSuccess && mReconcile.data && (
              <div className="mt-2 text-xs text-success">✓ {mReconcile.data.merged} transferência(s) reconciliada(s).</div>
            )}
            {mReconcile.isError && (
              <div className="mt-2 text-xs text-destructive">{(mReconcile.error as Error).message}</div>
            )}
          </div>
          <button
            onClick={() => mReconcile.mutate()}
            disabled={mReconcile.isPending}
            className="h-9 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-medium flex items-center gap-1.5 disabled:opacity-50 shrink-0"
          >
            <ArrowLeftRight className="size-3.5" />
            {mReconcile.isPending ? "Processando…" : "Reconciliar agora"}
          </button>
        </div>
      </section>

      {/* Zona de perigo */}
      <section className="lg:col-span-2 rounded-2xl bg-surface border border-destructive/30 p-5">
        <div className="flex items-start gap-3">
          <div className="size-9 rounded-lg bg-destructive/10 grid place-items-center shrink-0">
            <AlertTriangle className="size-4 text-destructive" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold">Resetar lançamentos</div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Apaga <strong>todos os lançamentos</strong> da sua conta. Categorias, contas e regras são mantidas. Esta ação não pode ser desfeita.
            </p>
            {mReset.isSuccess && mReset.data && (
              <div className="mt-2 text-xs text-success">✓ {mReset.data.deleted} lançamento(s) removido(s).</div>
            )}
          </div>
          <button
            onClick={() => {
              confirm("Tem certeza? Todos os lançamentos serão apagados permanentemente.").then((ok) => {
                if (ok) mReset.mutate();
              });
            }}
            disabled={mReset.isPending}
            className="h-9 px-3 rounded-lg bg-destructive text-destructive-foreground text-xs font-medium flex items-center gap-1.5 disabled:opacity-50 shrink-0"
          >
            <Trash2 className="size-3.5" />
            {mReset.isPending ? "Apagando…" : "Resetar tudo"}
          </button>
        </div>
      </section>
    </div>
  );
}
