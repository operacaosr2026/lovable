import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Eye, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { fetchProductClarityNow, getProductClarity, saveProductClarityToken } from "@/lib/clarity.functions";
import { formatDateTimeUS } from "@/lib/timezone";

// Clarity do produto (um projeto por produto), no topo da aba Testes. Token:
// Clarity › Settings › Data Export › Generate new API token.

const inputCls = "h-8 px-3 rounded-lg border border-border bg-background text-sm outline-none focus:border-primary/50";
const fmtDay = (d: string) => d.split("-").reverse().join("/");

export function ProductClarityBar({ productId }: { productId: string }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const QK = ["product-clarity", productId];
  const getFn = useServerFn(getProductClarity);
  const saveFn = useServerFn(saveProductClarityToken);
  const fetchFn = useServerFn(fetchProductClarityNow);
  const { data } = useQuery({ queryKey: QK, queryFn: () => getFn({ data: { product_id: productId } }) });
  const [editing, setEditing] = useState(false);
  const [token, setToken] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: QK });

  const save = useMutation({
    mutationFn: (t: string | null) => saveFn({ data: { product_id: productId, token: t } }),
    onSuccess: (_r, t) => { toast.success(t ? "Clarity conectado" : "Clarity desconectado"); setToken(""); setEditing(false); refresh(); },
    onError: (e: any) => toast.error(e.message),
  });
  const fetchNow = useMutation({
    mutationFn: () => fetchFn({ data: { product_id: productId } }),
    onSuccess: () => { toast.success("Clarity de hoje buscado (parcial)"); refresh(); qc.invalidateQueries({ queryKey: ["experiment-metrics"] }); },
    onError: (e: any) => { toast.error(e.message); refresh(); },
  });

  if (!data) return null;

  return (
    <div className="rounded-xl border border-border px-3 py-2 mb-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Eye className="size-3.5 text-primary shrink-0" />
        <span className="font-medium">Clarity</span>
        {data.connected ? (
          <span className="text-muted-foreground flex-1 min-w-0">
            Token {data.token_hint} · {data.remaining} de 10 buscas restantes hoje
            {data.last_day && ` · último dia salvo: ${fmtDay(data.last_day)}`}
            {data.last_fetch_at && ` · última busca ${formatDateTimeUS(data.last_fetch_at, { dateStyle: "short", timeStyle: "short" })}`}
          </span>
        ) : (
          <span className="text-muted-foreground flex-1 min-w-0">Não conectado. Conecte o projeto Clarity deste produto pra ver o comportamento na página nas tabelas dos testes.</span>
        )}
        {!editing && data.connected && (
          <>
            <button onClick={() => fetchNow.mutate()} disabled={fetchNow.isPending || data.remaining === 0}
              title="Busca as últimas 24h e grava como o dia de hoje (parcial). Usa 1 das 10 buscas do dia. A busca automática roda às 00:10 (Nova York) e fecha o dia anterior."
              className="h-7 px-2.5 rounded-lg border border-border font-medium flex items-center gap-1.5 hover:bg-muted disabled:opacity-50">
              {fetchNow.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Buscar agora
            </button>
            <button onClick={() => setEditing(true)} className="h-7 px-2.5 rounded-lg border border-border font-medium hover:bg-muted">Trocar token</button>
            <button onClick={() => confirm("Desconectar o Clarity deste produto? Os dados já salvos continuam.").then((ok) => { if (ok) save.mutate(null); })}
              title="Desconectar" className="size-7 rounded-lg grid place-items-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
              <Trash2 className="size-3.5" />
            </button>
          </>
        )}
        {!editing && !data.connected && (
          <button onClick={() => setEditing(true)} className="h-7 px-2.5 rounded-lg bg-primary text-primary-foreground font-medium">Conectar</button>
        )}
      </div>
      {data.last_error && <p className="text-destructive mt-1">{data.last_error}</p>}
      {editing && (
        <form onSubmit={(e) => { e.preventDefault(); if (token.trim()) save.mutate(token.trim()); }} className="flex flex-wrap gap-2 mt-2">
          <input autoFocus type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Cole o token da API do Clarity (Settings › Data Export)" className={`${inputCls} flex-1 min-w-[240px]`} />
          <button type="button" onClick={() => { setEditing(false); setToken(""); }} className="h-8 px-3 rounded-lg border border-border hover:bg-muted">Cancelar</button>
          <button type="submit" disabled={token.trim().length < 20 || save.isPending} className="h-8 px-3 rounded-lg bg-primary text-primary-foreground font-medium flex items-center gap-1.5 disabled:opacity-50">
            {save.isPending && <Loader2 className="size-3.5 animate-spin" />} Salvar
          </button>
        </form>
      )}
    </div>
  );
}
