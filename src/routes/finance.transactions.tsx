import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listTransactions, createTransaction, updateTransaction, deleteTransaction, listCategories, createCategory,
  getFinanceDashboard,
} from "@/lib/finance.functions";
import { requireAuth } from "@/lib/route-guards";
import { useEscapeToClose } from "@/hooks/use-escape-to-close";
import { Plus, Trash2, ArrowDownCircle, ArrowUpCircle, ArrowLeftRight, X, Repeat, Pencil, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/finance/transactions")({
  beforeLoad: requireAuth,
  component: TransactionsPage,
});

const fmtBRL = (v: number) =>
  `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtCur = (v: number, cur: string) =>
  cur === "USD"
    ? `US$ ${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : fmtBRL(v);

function TransactionsPage() {
  const qc = useQueryClient();
  const listTx = useServerFn(listTransactions);
  const createTx = useServerFn(createTransaction);
  const updateTx = useServerFn(updateTransaction);
  const delTx = useServerFn(deleteTransaction);
  const listCat = useServerFn(listCategories);
  const createCat = useServerFn(createCategory);
  const getDash = useServerFn(getFinanceDashboard);

  const txQ = useQuery({ queryKey: ["finance", "tx"], queryFn: () => listTx({ data: { limit: 200 } }) });
  const catQ = useQuery({ queryKey: ["finance", "cat"], queryFn: () => listCat() });
  const dashQ = useQuery({ queryKey: ["finance-dash"], queryFn: () => getDash() });

  const inv = () => {
    qc.invalidateQueries({ queryKey: ["finance", "tx"] });
    qc.invalidateQueries({ queryKey: ["finance-dash"] });
  };

  const mCreate = useMutation({ mutationFn: (d: any) => createTx({ data: d }), onSuccess: inv });
  const mUpdate = useMutation({ mutationFn: (d: any) => updateTx({ data: d }), onSuccess: inv });
  const mDel = useMutation({ mutationFn: (d: any) => delTx({ data: d }), onSuccess: inv });
  const mCat = useMutation({ mutationFn: (d: any) => createCat({ data: d }), onSuccess: () => qc.invalidateQueries({ queryKey: ["finance", "cat"] }) });

  const [filter, setFilter] = useState<"all" | "income" | "expense" | "transfer">("all");
  const [onlyPending, setOnlyPending] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editTx, setEditTx] = useState<any>(null);

  // Keyboard shortcut
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "n" && !showModal && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        setShowModal(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showModal]);

  const accounts = dashQ.data?.accounts ?? [];
  const accById: Record<string, any> = useMemo(() => Object.fromEntries(accounts.map((a: any) => [a.id, a])), [accounts]);
  const txs = txQ.data ?? [];
  const pendingCount = txs.filter((t: any) => t.needs_review).length;
  const filteredTx = txs.filter((t: any) =>
    (filter === "all" || t.kind === filter) && (!onlyPending || t.needs_review)
  );

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
          {(["all", "income", "expense", "transfer"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 h-7 rounded-md text-xs font-medium ${filter === f ? "bg-surface shadow-sm" : "text-muted-foreground"}`}
            >
              {f === "all" ? "Todos" : f === "income" ? "Entradas" : f === "expense" ? "Saídas" : "Transferências"}
            </button>
          ))}
        </div>
        <button
          onClick={() => setOnlyPending((v) => !v)}
          className={`h-8 px-3 rounded-lg text-xs font-medium flex items-center gap-1.5 border ${onlyPending ? "bg-warning/15 text-warning border-warning/40" : "bg-muted text-muted-foreground border-transparent"}`}
        >
          <AlertTriangle className="size-3.5" />
          Pendentes {pendingCount > 0 && <span className="tabular-nums">({pendingCount})</span>}
        </button>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground hidden md:inline">atalho: <kbd className="px-1.5 py-0.5 rounded bg-muted text-[10px]">N</kbd></span>
          <button
            disabled={accounts.length === 0}
            onClick={() => setShowModal(true)}
            className="h-10 px-5 rounded-xl bg-primary text-primary-foreground text-sm font-medium flex items-center gap-2 disabled:opacity-50"
          >
            <Plus className="size-4" /> Novo lançamento
          </button>
        </div>
      </div>

      {accounts.length === 0 && (
        <div className="rounded-2xl bg-surface border border-border p-6 text-sm text-muted-foreground">
          Crie uma conta primeiro em <span className="text-foreground font-medium">Contas</span>.
        </div>
      )}

      <div className="rounded-2xl bg-surface border border-border overflow-hidden">
        {filteredTx.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">Nenhum lançamento.</div>
        ) : (
          <ul className="divide-y divide-border">
            {filteredTx.map((t: any) => {
              const acc = accById[t.account_id];
              const toAcc = t.to_account_id ? accById[t.to_account_id] : null;
              const Icon = t.kind === "income" ? ArrowDownCircle : t.kind === "expense" ? ArrowUpCircle : ArrowLeftRight;
              const color = t.kind === "income" ? "oklch(0.62 0.14 155)" : t.kind === "expense" ? "oklch(0.65 0.16 25)" : "oklch(0.6 0.22 285)";
              return (
                <li key={t.id} className="flex items-center gap-3 px-5 py-3 group hover:bg-surface-hover">
                  <Icon className="size-5 shrink-0" style={{ color }} />
                  <span className="text-[11px] text-muted-foreground tabular-nums w-14 shrink-0">
                    {new Date(t.date + "T00:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate flex items-center gap-2">
                      {t.needs_review && <AlertTriangle className="size-3.5 text-warning shrink-0" />}
                      {t.description || (t.kind === "transfer" ? "Transferência" : t.kind === "income" ? "Entrada" : "Saída")}
                      {t.recurrence_id && <Repeat className="size-3 text-muted-foreground" />}
                      {t.import_source && t.import_source !== "manual" && (
                        <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{t.import_source}</span>
                      )}
                      {!t.paid && <span className="text-[9px] uppercase tracking-wider text-warning">prev</span>}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {acc?.name ?? "?"}{toAcc ? ` → ${toAcc.name}` : ""}
                    </div>
                  </div>
                  <span className="text-sm tabular-nums font-medium" style={{ color: t.kind === "income" ? color : undefined }}>
                    {t.kind === "expense" ? "−" : t.kind === "income" ? "+" : ""}
                    {fmtCur(Number(t.amount), t.currency)}
                  </span>
                  <button onClick={() => setEditTx(t)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground" title="Editar">
                    <Pencil className="size-4" />
                  </button>
                  <button onClick={() => mDel.mutate({ id: t.id })} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive">
                    <Trash2 className="size-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {showModal && (
        <NewTransactionModal
          accounts={accounts}
          categories={catQ.data ?? []}
          onClose={() => setShowModal(false)}
          onSubmit={(d) => { mCreate.mutate(d); setShowModal(false); }}
          onCreateCategory={async (name, kind) => {
            const cat = await mCat.mutateAsync({ name, kind, color: "oklch(0.6 0.22 285)" });
            return cat as any;
          }}
        />
      )}

      {editTx && (
        <EditTransactionModal
          tx={editTx}
          categories={catQ.data ?? []}
          onClose={() => setEditTx(null)}
          onSubmit={(patch) => { mUpdate.mutate({ id: editTx.id, patch }); setEditTx(null); }}
        />
      )}
    </div>
  );
}

function EditTransactionModal({ tx, categories, onClose, onSubmit }: {
  tx: any;
  categories: any[];
  onClose: () => void;
  onSubmit: (patch: any) => void;
}) {
  const [amount, setAmount] = useState(String(tx.amount).replace(".", ","));
  const [categoryId, setCategoryId] = useState<string>(tx.category_id ?? "");
  const [description, setDescription] = useState(tx.description ?? "");
  const [date, setDate] = useState(tx.date);
  const [paid, setPaid] = useState(!!tx.paid);

  const cats = categories.filter((c) => tx.kind === "transfer" || c.kind === tx.kind);
  const isTransfer = tx.kind === "transfer";

  useEscapeToClose(onClose);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = parseFloat(amount.replace(",", "."));
    if (isNaN(n) || n <= 0) return;
    const patch: any = { amount: n, description: description.trim() || null, date, paid };
    if (!isTransfer) patch.category_id = categoryId || null;
    onSubmit(patch);
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit}
        className="bg-surface border border-border rounded-2xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-base font-semibold">Editar lançamento</div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="size-4" /></button>
        </div>

        <input autoFocus type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)}
          placeholder="0,00"
          className="w-full text-3xl font-bold tabular-nums bg-transparent outline-none border-b border-border focus:border-primary py-2" />

        {!isTransfer && (
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
            className="w-full h-10 px-3 rounded-lg bg-muted border border-border text-sm outline-none focus:border-primary">
            <option value="">Sem categoria</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}

        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descrição (opcional)"
          className="w-full h-10 px-3 rounded-lg bg-muted border border-border text-sm outline-none focus:border-primary" />

        <div className="grid grid-cols-2 gap-2">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="h-10 px-3 rounded-lg bg-muted border border-border text-sm outline-none focus:border-primary" />
          <label className="flex items-center gap-2 px-3 h-10 rounded-lg bg-muted border border-border text-sm cursor-pointer">
            <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} className="accent-primary" />
            {paid ? "Pago/efetivado" : "Previsto"}
          </label>
        </div>

        <button type="submit" className="w-full h-11 rounded-xl bg-primary text-primary-foreground font-semibold">
          Salvar alterações
        </button>
      </form>
    </div>
  );
}

function NewTransactionModal({
  accounts, categories, onClose, onSubmit, onCreateCategory,
}: {
  accounts: any[];
  categories: any[];
  onClose: () => void;
  onSubmit: (data: any) => void;
  onCreateCategory: (name: string, kind: "income" | "expense") => Promise<any>;
}) {
  const [kind, setKind] = useState<"income" | "expense" | "transfer">("expense");
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [toAccountId, setToAccountId] = useState(accounts[1]?.id ?? "");
  const [categoryId, setCategoryId] = useState<string>("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [paid, setPaid] = useState(true);
  const [recurring, setRecurring] = useState(false);
  const [frequency, setFrequency] = useState<"weekly" | "monthly" | "yearly">("monthly");
  const [newCatName, setNewCatName] = useState("");

  const cats = categories.filter((c) => c.kind === kind);

  useEscapeToClose(onClose);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = parseFloat(amount.replace(",", "."));
    if (!isNaN(n) && n > 0 && accountId) {
      onSubmit({
        tx: {
          kind,
          amount: n,
          account_id: accountId,
          to_account_id: kind === "transfer" ? toAccountId : null,
          category_id: kind === "transfer" ? null : categoryId || null,
          description: description.trim() || null,
          date,
          paid,
        },
        recurrence: recurring && kind !== "transfer" ? { frequency } : null,
      });
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="bg-surface border border-border rounded-2xl w-full max-w-md p-6 space-y-4"
      >
        <div className="flex items-center justify-between">
          <div className="text-base font-semibold">Novo lançamento</div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="size-4" /></button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {(["expense", "income", "transfer"] as const).map((k) => (
            <button
              type="button" key={k}
              onClick={() => setKind(k)}
              className={`h-10 rounded-lg text-xs font-medium border transition-colors ${kind === k ? "bg-primary text-primary-foreground border-primary" : "bg-muted border-border text-muted-foreground"}`}
            >
              {k === "expense" ? "Saída" : k === "income" ? "Entrada" : "Transferir"}
            </button>
          ))}
        </div>

        <div>
          <input
            autoFocus type="text" inputMode="decimal" value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0,00"
            className="w-full text-3xl font-bold tabular-nums bg-transparent outline-none border-b border-border focus:border-primary py-2"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <select
            value={accountId} onChange={(e) => setAccountId(e.target.value)}
            className="h-10 px-3 rounded-lg bg-muted border border-border text-sm outline-none focus:border-primary"
          >
            {accounts.map((a) => <option key={a.id} value={a.id}>{kind === "transfer" ? "De: " : ""}{a.name} ({a.currency})</option>)}
          </select>
          {kind === "transfer" ? (
            <select
              value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}
              className="h-10 px-3 rounded-lg bg-muted border border-border text-sm outline-none focus:border-primary"
            >
              {accounts.filter((a) => a.id !== accountId).map((a) => <option key={a.id} value={a.id}>Para: {a.name} ({a.currency})</option>)}
            </select>
          ) : (
            <select
              value={categoryId} onChange={(e) => {
                if (e.target.value === "__new__") return;
                setCategoryId(e.target.value);
              }}
              className="h-10 px-3 rounded-lg bg-muted border border-border text-sm outline-none focus:border-primary"
            >
              <option value="">Sem categoria</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
        </div>

        {kind !== "transfer" && (
          <div className="flex items-center gap-2">
            <input
              value={newCatName} onChange={(e) => setNewCatName(e.target.value)}
              placeholder="+ nova categoria"
              className="flex-1 h-8 px-3 rounded-lg bg-muted border border-border text-xs outline-none focus:border-primary"
            />
            <button
              type="button"
              disabled={!newCatName.trim()}
              onClick={async () => {
                const cat = await onCreateCategory(newCatName.trim(), kind);
                setCategoryId(cat.id);
                setNewCatName("");
              }}
              className="h-8 px-3 rounded-lg bg-muted text-xs font-medium disabled:opacity-50"
            >Criar</button>
          </div>
        )}

        <input
          value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder="Descrição (opcional)"
          className="w-full h-10 px-3 rounded-lg bg-muted border border-border text-sm outline-none focus:border-primary"
        />

        <div className="grid grid-cols-2 gap-2">
          <input
            type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="h-10 px-3 rounded-lg bg-muted border border-border text-sm outline-none focus:border-primary"
          />
          <label className="flex items-center gap-2 px-3 h-10 rounded-lg bg-muted border border-border text-sm cursor-pointer">
            <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} className="accent-primary" />
            {paid ? "Pago/efetivado" : "Previsto"}
          </label>
        </div>

        {kind !== "transfer" && (
          <div className="rounded-lg border border-border p-3 space-y-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} className="accent-primary" />
              <Repeat className="size-3.5" /> Salvar como conta recorrente
            </label>
            {recurring && (
              <div className="flex gap-1">
                {(["weekly", "monthly", "yearly"] as const).map((f) => (
                  <button
                    type="button" key={f}
                    onClick={() => setFrequency(f)}
                    className={`flex-1 h-8 rounded-md text-xs ${frequency === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                  >
                    {f === "weekly" ? "Semanal" : f === "monthly" ? "Mensal" : "Anual"}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <button type="submit" className="w-full h-11 rounded-xl bg-primary text-primary-foreground font-semibold">
          Salvar lançamento
        </button>
      </form>
    </div>
  );
}
