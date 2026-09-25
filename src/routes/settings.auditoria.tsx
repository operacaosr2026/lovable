import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ScrollText, Search, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { listAuditLog } from "@/lib/audit.functions";
import { formatDateTimeUS } from "@/lib/timezone";

export const Route = createFileRoute("/settings/auditoria")({
  component: AuditoriaPage,
});

function AuditRow({ row }: { row: any }) {
  const [open, setOpen] = useState(false);
  const hasData = row.data && Object.keys(row.data).length > 0;
  return (
    <div className="border-t border-border first:border-t-0">
      <button
        onClick={() => hasData && setOpen((o) => !o)}
        className={`w-full text-left grid grid-cols-[140px_minmax(0,1fr)_minmax(0,220px)_16px] items-center gap-3 px-4 py-2.5 text-xs ${hasData ? "hover:bg-muted/40" : "cursor-default"}`}
      >
        <span className="text-muted-foreground tabular-nums">{formatDateTimeUS(row.created_at)}</span>
        <span className="font-medium text-foreground truncate">{row.label}</span>
        <span className="text-muted-foreground truncate">{row.actor_email ?? row.actor_id}</span>
        {hasData ? <ChevronDown className={`size-3.5 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} /> : <span />}
      </button>
      {open && hasData && (
        <pre className="mx-4 mb-3 rounded-lg bg-muted/50 border border-border p-3 text-[11px] text-foreground overflow-x-auto whitespace-pre-wrap break-all">
          {JSON.stringify(row.data, null, 2)}
        </pre>
      )}
    </div>
  );
}

function AuditoriaPage() {
  const fn = useServerFn(listAuditLog);
  const [page, setPage] = useState(0);
  const [actorId, setActorId] = useState<string>("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");

  const query = useQuery({
    queryKey: ["audit-log", page, actorId, from, to, q],
    queryFn: () => fn({ data: { page, actor_id: actorId || null, from: from || null, to: to || null, q: q || null } }),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
  const data = query.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const resetPage = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(0); };

  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto pb-20 space-y-6">
      <header>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Auditoria</h1>
        <p className="text-sm text-muted-foreground mt-1">Quem fez o quê no sistema. Registros de até 1 ano.</p>
      </header>

      <section className="premium-card p-6 space-y-4">
        <div className="flex items-center gap-2">
          <ScrollText className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">Ações registradas</h2>
          {data && <span className="text-xs text-muted-foreground">· {data.total.toLocaleString("pt-BR")}</span>}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <form onSubmit={(e) => { e.preventDefault(); setQ(search); setPage(0); }} className="relative flex-1 min-w-[200px]">
            <Search className="size-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar ação ou pessoa…"
              className="settings-input pl-8 w-full" />
          </form>
          <select value={actorId} onChange={(e) => resetPage(setActorId)(e.target.value)} className="settings-input w-auto">
            <option value="">Todas as pessoas</option>
            {(data?.people ?? []).map((p) => <option key={p.id} value={p.id}>{p.email}</option>)}
          </select>
          <input type="date" value={from} onChange={(e) => resetPage(setFrom)(e.target.value)} className="settings-input w-auto" title="De" />
          <input type="date" value={to} onChange={(e) => resetPage(setTo)(e.target.value)} className="settings-input w-auto" title="Até" />
        </div>

        {query.isLoading ? (
          <div className="space-y-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-9 rounded-lg bg-muted animate-pulse" />)}</div>
        ) : query.isError ? (
          <p className="text-sm text-destructive">{(query.error as any)?.message ?? "Erro ao carregar a auditoria."}</p>
        ) : !data?.rows.length ? (
          <p className="text-xs text-muted-foreground py-6 text-center">Nenhuma ação registrada com esses filtros.</p>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <div className="hidden sm:grid grid-cols-[140px_minmax(0,1fr)_minmax(0,220px)_16px] gap-3 px-4 py-2 bg-muted/30 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <span>Quando</span><span>Ação</span><span>Quem</span><span />
            </div>
            {data.rows.map((r: any) => <AuditRow key={r.id} row={r} />)}
          </div>
        )}

        {data && data.total > data.pageSize && (
          <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
            <span>Página {page + 1} de {pages}</span>
            <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}
              className="size-8 rounded-lg border border-border grid place-items-center disabled:opacity-40"><ChevronLeft className="size-4" /></button>
            <button onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1}
              className="size-8 rounded-lg border border-border grid place-items-center disabled:opacity-40"><ChevronRight className="size-4" /></button>
          </div>
        )}
      </section>
    </div>
  );
}
