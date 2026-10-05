import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FlaskConical, Loader2, Search, ListRestart, Eye } from "lucide-react";
import { toast } from "sonner";
import { PageShell, PageHeader } from "@/components/PageHeader";
import { requireAuth } from "@/lib/route-guards";
import { formatDateTimeUS } from "@/lib/timezone";
import { useMyAccess } from "@/hooks/useMyAccess";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { TrackingPageView, TrackingShell } from "@/components/tracking/TrackingPageView";
import { buildSteps, sanitizeEvents, officialEdd } from "@/lib/tracking-display";
import {
  query17track, get17trackQuota, getTrack123Rows, listStuckTrackings,
  type Result17, type Track123Row,
} from "@/lib/teste-17track.functions";

// Aba de testes (só admin): coisas novas são testadas aqui antes de mexer no
// que já está em uso. Agora: 17track × Track123 + prévia da página de rastreio.
export const Route = createFileRoute("/teste")({
  beforeLoad: requireAuth,
  head: () => ({ meta: [{ title: "Teste — SRX Growth" }] }),
  component: TestePage,
});

const when = (iso: string | null) => (iso ? formatDateTimeUS(iso, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");

function TestePage() {
  const { role, isLoading } = useMyAccess();
  if (isLoading) return null;
  if (role !== "admin") return <PageShell><p className="text-sm text-muted-foreground">Só o administrador acessa a aba Teste.</p></PageShell>;
  return <Teste17track />;
}

function Teste17track() {
  const queryFn = useServerFn(query17track);
  const quotaFn = useServerFn(get17trackQuota);
  const t123Fn = useServerFn(getTrack123Rows);
  const stuckFn = useServerFn(listStuckTrackings);

  const [text, setText] = useState("JXCZI0005703743YQ");
  const [results, setResults] = useState<Result17[]>([]);
  const [t123, setT123] = useState<Map<string, Track123Row>>(new Map());
  const [preview, setPreview] = useState<string | null>(null);

  const quota = useQuery({ queryKey: ["17track-quota"], queryFn: () => quotaFn() });
  const numbers = useMemo(() => [...new Set(text.split(/[\s,;]+/).map((s) => s.trim()).filter((s) => s.length >= 5))], [text]);

  const loadStuck = useMutation({
    mutationFn: () => stuckFn(),
    onSuccess: ({ numbers }) => {
      if (!numbers.length) return toast.info("Nenhum código parado no Track123.");
      setText(numbers.slice(0, 10).join("\n"));
      toast.success(`${Math.min(10, numbers.length)} de ${numbers.length} códigos parados carregados.`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const run = useMutation({
    mutationFn: async () => {
      const [r17, r123] = await Promise.all([queryFn({ data: { numbers } }), t123Fn({ data: { numbers } })]);
      return { r17, r123 };
    },
    onSuccess: ({ r17, r123 }) => {
      setResults(r17.results);
      setT123(new Map(r123.rows.map((r) => [r.number, r])));
      setPreview(r17.results.find((r) => r.ok)?.number ?? null);
      quota.refetch();
      if (r17.registeredNow) toast.info(`${r17.registeredNow} código(s) registrado(s) agora no 17track (1 crédito cada). Os novos podem levar alguns minutos pra trazer dados — consulte de novo.`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const previewRow = results.find((r) => r.number === preview);
  const previewT123 = preview ? t123.get(preview) : undefined;

  return (
    <PageShell>
      <PageHeader title="Teste" />
      <div className="rounded-xl border bg-card p-4 sm:p-5 mb-5">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <FlaskConical className="size-4 text-primary" />
          <h2 className="font-semibold">17track × Track123</h2>
          <span className="text-xs text-muted-foreground ml-auto">
            {quota.isLoading ? "…" : quota.error ? <span className="text-destructive">{(quota.error as Error).message}</span>
              : !quota.data?.configured ? <span className="text-destructive">Chave do 17track não configurada (SEVENTEEN_TRACK_API_KEY)</span>
              : <>Cota 17track: <b className="text-foreground">{quota.data.remain}</b> de {quota.data.total} restantes</>}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Não altera nada no sistema: consulta os códigos no 17track e mostra ao lado o que o Track123 gravou. Código novo no 17track gasta 1 crédito; consultar de novo o mesmo código não gasta.
        </p>
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} className="font-mono text-xs" placeholder="Códigos de rastreio, um por linha (até 40)" />
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <Button onClick={() => run.mutate()} disabled={!numbers.length || numbers.length > 40 || run.isPending}>
            {run.isPending ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
            Consultar {numbers.length ? `(${numbers.length})` : ""}
          </Button>
          <Button variant="outline" onClick={() => loadStuck.mutate()} disabled={loadStuck.isPending}>
            {loadStuck.isPending ? <Loader2 className="size-4 animate-spin" /> : <ListRestart className="size-4" />}
            Carregar parados no Track123
          </Button>
          {numbers.length > 40 && <span className="text-xs text-destructive">Máximo de 40 por consulta.</span>}
        </div>
      </div>

      {results.length > 0 && (
        <div className="rounded-xl border bg-card overflow-x-auto mb-5">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-left font-medium px-3 py-2">Código</th>
                <th className="text-left font-medium px-3 py-2">Track123 (hoje no sistema)</th>
                <th className="text-left font-medium px-3 py-2">17track</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {results.map((r) => {
                const a = t123.get(r.number);
                const newer = r.events[0]?.at && a?.lastEventAt && Date.parse(r.events[0].at) > Date.parse(a.lastEventAt) + 60_000;
                return (
                  <tr key={r.number} className={`border-b last:border-0 align-top ${preview === r.number ? "bg-muted/40" : ""}`}>
                    <td className="px-3 py-2.5">
                      <div className="font-mono text-xs">{r.number}</div>
                      {a?.orderNumber && <div className="text-xs text-muted-foreground">{a.orderNumber} · {a.shopName}</div>}
                    </td>
                    <td className="px-3 py-2.5 max-w-[320px]">
                      {a ? (
                        <>
                          <div className="font-medium">{a.status ?? "—"} <span className="text-xs text-muted-foreground font-normal">· {a.carrier} · {a.events.length} evento(s)</span></div>
                          <div className="text-xs text-muted-foreground truncate" title={a.lastEventLabel ?? ""}>{when(a.lastEventAt)} — {a.lastEventLabel ?? "—"}</div>
                        </>
                      ) : <span className="text-xs text-muted-foreground">Não está no sistema</span>}
                    </td>
                    <td className="px-3 py-2.5 max-w-[360px]">
                      {!r.ok ? (
                        <span className={`text-xs ${r.pending ? "text-muted-foreground" : "text-destructive"}`}>{r.pending ? "Buscando na transportadora… consulte de novo em alguns minutos" : r.error}</span>
                      ) : r.pending ? (
                        <span className="text-xs text-muted-foreground">Registrado — 17track ainda buscando dados. Consulte de novo em alguns minutos.</span>
                      ) : (
                        <>
                          <div className="font-medium">
                            {r.status ?? "—"}{r.subStatus && r.subStatus !== r.status ? <span className="text-xs text-muted-foreground font-normal"> ({r.subStatus})</span> : null}
                            <span className="text-xs text-muted-foreground font-normal"> · {r.carrier ?? "?"} · {r.events.length} evento(s)</span>
                            {newer && <span className="ml-1.5 text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-success/10 text-success">mais novo</span>}
                          </div>
                          <div className="text-xs text-muted-foreground truncate" title={r.events[0]?.description ?? ""}>{when(r.events[0]?.at ?? null)} — {r.events[0]?.description ?? "—"}</div>
                          <div className="text-xs text-muted-foreground">
                            Previsão: {r.edd ? <>{[r.edd.from, r.edd.to].filter(Boolean).map((d) => d!.slice(0, 10)).join(" a ")} <span className="text-[11px]">({r.edd.source ?? "origem ?"}{officialEdd(r.edd) ? " · aparece pro cliente" : " · não é oficial, não aparece"})</span></> : "ainda não informada"}
                          </div>
                        </>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Button size="sm" variant="ghost" onClick={() => setPreview(r.number)} disabled={!r.ok}>
                        <Eye className="size-4" /> Prévia
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {previewRow && (() => {
        const { steps, current } = buildSteps({ orderedAt: null, deliveredAt: null, status: previewRow.status, events: previewRow.events });
        return (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Prévia da página do cliente com os dados do 17track</span>
              <span>Transportadora(s): {previewRow.carrier ?? "—"}</span>
              <span>Última consulta deles: {when(previewRow.lastSyncAt)}</span>
              <span>Eventos: 17track {previewRow.events.length} (mostrados {sanitizeEvents(previewRow.events).length}) × Track123 {previewT123?.events.length ?? 0}</span>
            </div>
            <div className="rounded-xl border overflow-hidden">
              <TrackingShell>
                <TrackingPageView
                  orderNumber={previewT123?.orderNumber ?? null}
                  trackingNumber={previewRow.number}
                  status={previewRow.status}
                  steps={steps}
                  currentStep={current}
                  events={sanitizeEvents(previewRow.events)}
                  destination={null}
                  edd={officialEdd(previewRow.edd)}
                />
              </TrackingShell>
            </div>
          </div>
        );
      })()}
    </PageShell>
  );
}
