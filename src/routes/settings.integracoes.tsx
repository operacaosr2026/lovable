import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Store, Megaphone, Truck, RefreshCw } from "lucide-react";
import { getIntegrationsStatus, type IntegrationRow, type IntegrationHealth } from "@/lib/integrations-status.functions";
import { formatDateTimeUS } from "@/lib/timezone";

export const Route = createFileRoute("/settings/integracoes")({
  component: IntegracoesPage,
});

const HEALTH: Record<IntegrationHealth, { label: string; cls: string }> = {
  ok:        { label: "Funcionando",  cls: "bg-success/15 text-success" },
  atencao:   { label: "Atenção",      cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  erro:      { label: "Com erro",     cls: "bg-destructive/10 text-destructive" },
  pausada:   { label: "Pausada",      cls: "bg-muted text-muted-foreground" },
  desligada: { label: "Desligada",    cls: "bg-muted text-muted-foreground" },
};

function ago(iso: string | null) {
  if (!iso) return "nunca sincronizou";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "agora há pouco";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `há ${h} h`;
  return `há ${Math.round(h / 24)} dias`;
}

function Section({ icon: Icon, title, desc, rows, loading }: {
  icon: any; title: string; desc: string; rows?: IntegrationRow[]; loading: boolean;
}) {
  const problems = (rows ?? []).filter((r) => r.health === "erro" || r.health === "atencao").length;
  return (
    <section className="premium-card p-6">
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">{title}</h2>
        </div>
        {!loading && rows && rows.length > 0 && (
          <span className={`text-[11px] px-2 py-1 rounded-full font-medium ${problems ? "bg-destructive/10 text-destructive" : "bg-success/15 text-success"}`}>
            {problems ? `${problems} com problema` : "Tudo certo"}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground mb-4">{desc}</p>
      {loading ? (
        <div className="space-y-2">{[0, 1].map((i) => <div key={i} className="h-14 rounded-lg bg-muted animate-pulse" />)}</div>
      ) : !rows?.length ? (
        <p className="text-xs text-muted-foreground py-3">Nenhuma conexão cadastrada.</p>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          {rows.map((r, i) => (
            <div key={r.id} className={`flex items-start justify-between gap-3 px-4 py-3 ${i > 0 ? "border-t border-border" : ""}`}>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{r.name}</p>
                {r.detail && <p className="text-[11px] text-muted-foreground truncate">{r.detail}</p>}
                <p className="text-[11px] text-muted-foreground mt-0.5" title={r.lastSyncAt ? formatDateTimeUS(r.lastSyncAt) : undefined}>
                  Última sincronização: {ago(r.lastSyncAt)}
                </p>
                {r.note && <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5">{r.note}</p>}
                {r.error && <p className="text-[11px] text-destructive mt-0.5 line-clamp-2" title={r.error}>{r.error}</p>}
              </div>
              <span className={`text-[11px] px-2 py-1 rounded-full font-medium shrink-0 ${HEALTH[r.health].cls}`}>{HEALTH[r.health].label}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function IntegracoesPage() {
  const fn = useServerFn(getIntegrationsStatus);
  const q = useQuery({ queryKey: ["integrations-status"], queryFn: () => fn(), refetchInterval: 60_000 });

  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto pb-20 space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Integrações</h1>
          <p className="text-sm text-muted-foreground mt-1">Estado das conexões com Shopify, Meta Ads e Track123.</p>
        </div>
        <button onClick={() => q.refetch()} disabled={q.isFetching} title="Atualizar"
          className="size-9 rounded-lg border border-border bg-card grid place-items-center text-muted-foreground hover:text-foreground disabled:opacity-50">
          <RefreshCw className={`size-4 ${q.isFetching ? "animate-spin" : ""}`} />
        </button>
      </header>

      <Section icon={Store} title="Shopify" loading={q.isLoading} rows={q.data?.shopify}
        desc="Repasses e reembolsos: sync completo 2x por dia (08:00 e 20:00). Pedidos e disputas chegam na hora pelo webhook." />
      <Section icon={Megaphone} title="Meta Ads" loading={q.isLoading} rows={q.data?.meta}
        desc="Gasto de anúncios e cobranças do cartão. Sincroniza de 10 em 10 minutos." />
      <Section icon={Truck} title="Track123" loading={q.isLoading} rows={q.data?.track123}
        desc="Rastreio dos pedidos. Sincroniza de hora em hora." />
    </div>
  );
}
