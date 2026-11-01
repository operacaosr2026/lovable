import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FlaskConical, Loader2, Package, Search } from "lucide-react";
import { KINDS, KIND_LABEL, RESULT_LABEL, listLearnings, type Kind, type Result } from "@/lib/experiments.functions";
import { RESULT_CLS, fmtDate } from "@/components/products/ProductExperiments";

// Página Produtos › Aprendizados: testes concluídos de todos os produtos.

const inputCls = "h-9 px-3 rounded-lg bg-surface border border-border text-sm outline-none";

export function ProductLearnings({ search, onOpen }: { search: string; onOpen: (productId: string) => void }) {
  const getFn = useServerFn(listLearnings);
  const { data, isLoading, error } = useQuery({ queryKey: ["learnings"], queryFn: () => getFn() });
  const [kind, setKind] = useState<Kind | "">("");
  const [result, setResult] = useState<Result | "">("");
  const [q, setQ] = useState("");

  const all = data ?? [];
  const filtered = useMemo(() => {
    const term = `${search} ${q}`.trim().toLowerCase();
    return all.filter((e) => (!kind || e.kind === kind) && (!result || e.result === result)
      && (!term || [e.title, e.hypothesis, e.learning, e.variant, e.product?.name ?? ""].some((s) => s.toLowerCase().includes(term))));
  }, [all, kind, result, search, q]);

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
  if (error) return <p className="text-sm text-destructive">{(error as Error).message}</p>;
  if (all.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border py-14 flex flex-col items-center text-center">
        <div className="size-12 rounded-2xl bg-primary/10 text-primary grid place-items-center mb-3"><FlaskConical className="size-5" /></div>
        <p className="text-sm font-medium">Nenhum aprendizado ainda</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-sm">Abra um produto, vá em Inteligência › Testes e conclua um teste com resultado. Ele aparece aqui.</p>
      </div>
    );
  }

  const summary = KINDS.map((k) => {
    const list = all.filter((e) => e.kind === k);
    return { kind: k, total: list.length, won: list.filter((e) => e.result === "won").length };
  }).filter((s) => s.total > 0);

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4">
        {summary.map((s) => (
          <button key={s.kind} onClick={() => setKind(kind === s.kind ? "" : s.kind)}
            className={`premium-card px-3 py-2 text-left ${kind === s.kind ? "border-primary/50" : ""}`}>
            <p className="text-[11px] text-muted-foreground">{KIND_LABEL[s.kind]}</p>
            <p className="text-sm font-semibold tabular-nums">{s.won} de {s.total} <span className="text-xs font-normal text-muted-foreground">validados</span></p>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar no aprendizado, hipótese ou variação" className={`${inputCls} w-full pl-8`} />
        </div>
        <select value={kind} onChange={(e) => setKind(e.target.value as Kind | "")} aria-label="Tipo" className={inputCls}>
          <option value="">Todos os tipos</option>
          {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
        <select value={result} onChange={(e) => setResult(e.target.value as Result | "")} aria-label="Resultado" className={inputCls}>
          <option value="">Todos os resultados</option>
          {(["won", "tie", "lost"] as Result[]).map((r) => <option key={r} value={r}>{RESULT_LABEL[r]}</option>)}
        </select>
        <span className="text-xs text-muted-foreground tabular-nums">{filtered.length} de {all.length}</span>
      </div>
      <div className="flex flex-col gap-2">
        {filtered.length === 0 && <p className="text-sm text-muted-foreground py-8 text-center">Nenhum aprendizado encontrado.</p>}
        {filtered.map((e) => (
          <article key={e.id} onClick={() => onOpen(e.product_id)} className="premium-card p-3 cursor-pointer hover:border-primary/40 flex gap-3">
            {e.product?.main_image_url ? (
              <img src={e.product.main_image_url} alt="" className="size-10 rounded-lg object-cover border border-border shrink-0" />
            ) : (
              <div className="size-10 rounded-lg bg-primary/10 text-primary grid place-items-center shrink-0"><Package className="size-4" /></div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded-md ${RESULT_CLS[e.result!]}`}>{RESULT_LABEL[e.result!]}</span>
                <p className="text-sm font-medium flex-1 min-w-0">{e.title}</p>
                <span className="text-[11px] text-muted-foreground">{KIND_LABEL[e.kind]}{e.product ? ` · ${e.product.name}` : ""}{e.ended_at ? ` · ${fmtDate(e.ended_at)}` : ""}</span>
              </div>
              {(e.control || e.variant) && <p className="text-xs text-muted-foreground mt-1">{e.control || "Atual"} → {e.variant || "Variação"}</p>}
              {e.learning && <p className="text-sm mt-1 whitespace-pre-wrap">{e.learning}</p>}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
