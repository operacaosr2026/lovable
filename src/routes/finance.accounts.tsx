import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getFinanceDashboard, createAccount, updateAccount, deleteAccount } from "@/lib/finance.functions";
import { requireAuth } from "@/lib/route-guards";
import { supabase } from "@/integrations/supabase/client";
import { Plus, Trash2, Archive, Upload, Pencil, X } from "lucide-react";
import { useConfirm } from "@/components/ui/confirm-dialog";

export const Route = createFileRoute("/finance/accounts")({
  beforeLoad: requireAuth,
  component: AccountsPage,
});

const COLORS = [
  "oklch(0.6 0.22 285)", "oklch(0.62 0.14 155)", "oklch(0.65 0.14 195)",
  "oklch(0.7 0.14 75)", "oklch(0.65 0.16 25)", "oklch(0.55 0.16 0)",
  "oklch(0.5 0.13 155)", "oklch(0.62 0.012 270)",
];

const fmtBRL = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
const fmtCur = (v: number, cur: string) => cur === "USD"
  ? `US$ ${v.toLocaleString("en-US", { minimumFractionDigits: 2 })}` : fmtBRL(v);

type EditState = { id: string; name: string; currency: "BRL" | "USD"; color: string; icon_url: string | null; match_keywords: string[] } | null;

function AccountsPage() {
  const qc = useQueryClient();
  const get = useServerFn(getFinanceDashboard);
  const create = useServerFn(createAccount);
  const update = useServerFn(updateAccount);
  const del = useServerFn(deleteAccount);

  const { data, isLoading } = useQuery({ queryKey: ["finance-dash"], queryFn: () => get() });
  const inv = () => qc.invalidateQueries({ queryKey: ["finance-dash"] });
  const mCreate = useMutation({ mutationFn: (d: any) => create({ data: d }), onSuccess: inv });
  const mUpdate = useMutation({ mutationFn: (d: any) => update({ data: d }), onSuccess: inv });
  const mDel = useMutation({ mutationFn: (d: any) => del({ data: d }), onSuccess: inv });
  const confirm = useConfirm();

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<EditState>(null);
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState<"BRL" | "USD">("BRL");
  const [color, setColor] = useState(COLORS[0]);
  const [iconUrl, setIconUrl] = useState<string | null>(null);
  const [keywords, setKeywords] = useState<string>("");
  const [uploading, setUploading] = useState(false);

  const openEdit = (a: any) => {
    setEditing({ id: a.id, name: a.name, currency: a.currency, color: a.color, icon_url: a.icon_url, match_keywords: a.match_keywords ?? [] });
    setName(a.name); setCurrency(a.currency); setColor(a.color); setIconUrl(a.icon_url);
    setKeywords((a.match_keywords ?? []).join(", "));
    setShowForm(false);
  };

  const closeEdit = () => {
    setEditing(null);
    setName(""); setCurrency("BRL"); setColor(COLORS[0]); setIconUrl(null); setKeywords("");
  };


  const upload = async (file: File) => {
    setUploading(true);
    const { data: u } = await supabase.auth.getUser();
    const userId = u.user?.id;
    if (!userId) { setUploading(false); return; }
    const ext = file.name.split(".").pop();
    const path = `${userId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from("account-icons").upload(path, file, { upsert: true });
    if (!error) {
      const { data: pub } = supabase.storage.from("account-icons").getPublicUrl(path);
      setIconUrl(pub.publicUrl);
    }
    setUploading(false);
  };

  if (isLoading || !data) return <div className="grid place-items-center h-64"><div className="size-6 rounded-full border-2 border-border border-t-primary animate-spin" /></div>;

  const isFormOpen = showForm || !!editing;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => { closeEdit(); setShowForm((s) => !s); if (!showForm) { setName(""); setIconUrl(null); setColor(COLORS[0]); setCurrency("BRL"); } }}
          className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-1.5"
        >
          <Plus className="size-4" /> Nova conta
        </button>
      </div>

      {isFormOpen && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            const kws = keywords.split(/[,\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 20);
            if (editing) {
              mUpdate.mutate({ id: editing.id, patch: { name: name.trim(), currency, color, icon_url: iconUrl, match_keywords: kws } });
              closeEdit();
            } else {
              mCreate.mutate({ name: name.trim(), currency, color, icon_url: iconUrl ?? undefined, match_keywords: kws });
              setName(""); setIconUrl(null); setKeywords(""); setShowForm(false);
            }
          }}
          className="rounded-2xl bg-surface border border-border p-5 space-y-3"
        >
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">{editing ? "Editar conta" : "Nova conta"}</div>
            {editing && (
              <button type="button" onClick={closeEdit} className="text-muted-foreground hover:text-foreground">
                <X className="size-4" />
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_120px] gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome (ex: Nubank)"
              className="h-10 px-3 rounded-lg bg-muted border border-border text-sm outline-none focus:border-primary" />
            <select value={currency} onChange={(e) => setCurrency(e.target.value as any)}
              className="h-10 px-3 rounded-lg bg-muted border border-border text-sm outline-none focus:border-primary">
              <option value="BRL">BRL</option>
              <option value="USD">USD</option>
            </select>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {COLORS.map((c) => (
              <button type="button" key={c} onClick={() => setColor(c)}
                className={`size-7 rounded-lg ${color === c ? "ring-2 ring-foreground ring-offset-2 ring-offset-surface" : ""}`}
                style={{ background: c }} />
            ))}
          </div>
          <div className="space-y-1">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
              Palavras-chave para importação (separadas por vírgula)
            </label>
            <input value={keywords} onChange={(e) => setKeywords(e.target.value)}
              placeholder="ex: Checking ••1234, Operating, Walkesty"
              className="w-full h-10 px-3 rounded-lg bg-muted border border-border text-sm outline-none focus:border-primary" />
            <p className="text-[11px] text-muted-foreground">
              Ao importar um CSV, o sistema procura essas palavras na coluna "Conta de origem" para enviar cada lançamento à conta certa. Transferências entre suas contas são detectadas automaticamente.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <label className="h-10 px-3 rounded-lg bg-muted border border-border text-sm flex items-center gap-2 cursor-pointer">
              <Upload className="size-3.5" /> {uploading ? "Enviando..." : iconUrl ? "Trocar ícone" : "Ícone (opcional)"}
              <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            </label>
            {iconUrl && <img src={iconUrl} alt="" className="size-10 rounded-lg object-cover" />}
            <button type="submit" className="ml-auto h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium">
              {editing ? "Salvar" : "Criar"}
            </button>
          </div>
        </form>

      )}

      <div className="rounded-2xl bg-surface border border-border overflow-hidden">
        {data.accounts.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">Nenhuma conta ainda.</div>
        ) : (
          <ul className="divide-y divide-border">
            {data.accounts.map((a: any) => (
              <li key={a.id} className="flex items-center gap-3 px-5 py-3 group">
                {a.icon_url ? (
                  <img src={a.icon_url} alt="" className="size-9 rounded-lg object-cover bg-muted" />
                ) : (
                  <div className="size-9 rounded-lg" style={{ background: a.color }} />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{a.name}</div>
                  <div className="text-[11px] text-muted-foreground flex items-center gap-1.5 flex-wrap">
                    <span>{a.currency}</span>
                    {(a.match_keywords ?? []).length > 0 && (
                      <>
                        <span>·</span>
                        {(a.match_keywords as string[]).slice(0, 3).map((k) => (
                          <span key={k} className="px-1.5 py-0.5 rounded bg-muted text-[10px]">{k}</span>
                        ))}
                        {(a.match_keywords as string[]).length > 3 && <span>+{a.match_keywords.length - 3}</span>}
                      </>
                    )}
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-sm tabular-nums font-semibold">{fmtCur(a.balance, a.currency)}</div>
                  {a.currency === "USD" && <div className="text-[11px] text-muted-foreground tabular-nums">≈ {fmtBRL(a.balanceBRL)}</div>}
                </div>
                <button onClick={() => openEdit(a)}
                  className="opacity-0 group-hover:opacity-100 size-8 grid place-items-center rounded-lg text-muted-foreground hover:bg-muted" title="Editar">
                  <Pencil className="size-4" />
                </button>
                <button onClick={() => mUpdate.mutate({ id: a.id, patch: { archived: true } })}
                  className="opacity-0 group-hover:opacity-100 size-8 grid place-items-center rounded-lg text-muted-foreground hover:bg-muted" title="Arquivar">
                  <Archive className="size-4" />
                </button>
                <button onClick={() => { confirm(`Excluir ${a.name}? Todos os lançamentos serão removidos.`).then((ok) => { if (ok) mDel.mutate({ id: a.id }); }); }}
                  className="opacity-0 group-hover:opacity-100 size-8 grid place-items-center rounded-lg text-muted-foreground hover:text-destructive">
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
