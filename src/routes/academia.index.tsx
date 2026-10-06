import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { GraduationCap, Plus, Pencil, Loader2, Check, Clock, BookOpen } from "lucide-react";
import { PageShell, PageHeader } from "@/components/PageHeader";
import { requireAuth } from "@/lib/route-guards";
import { listTrainingTracks, type TrainingTrackSummary } from "@/lib/training.functions";
import { TrackDialog, formatMinutes } from "@/components/academia/TrackDialog";

export const Route = createFileRoute("/academia/")({
  beforeLoad: requireAuth,
  head: () => ({ meta: [{ title: "Academia — SRX Growth" }] }),
  component: AcademiaPage,
});

function AcademiaPage() {
  const listFn = useServerFn(listTrainingTracks);
  const { data, isLoading } = useQuery({ queryKey: ["training-tracks"], queryFn: () => listFn() });
  const [editing, setEditing] = useState<Partial<TrainingTrackSummary> | null>(null);
  const tracks = data?.tracks ?? [];

  const totals = tracks.reduce((a, t) => ({ lessons: a.lessons + t.lessons, done: a.done + t.done }), { lessons: 0, done: 0 });
  const pct = totals.lessons ? Math.round((totals.done / totals.lessons) * 100) : 0;

  return (
    <PageShell>
      <PageHeader
        title="Academia"
        actions={data?.canEdit && (
          <button
            onClick={() => setEditing({})}
            className="h-10 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-medium flex items-center gap-2"
          >
            <Plus className="size-4" /> Nova trilha
          </button>
        )}
      />

      {tracks.length > 0 && (
        <div className="rounded-2xl border border-border bg-surface p-4 sm:p-5 mb-6 flex items-center gap-4">
          <div className="size-12 rounded-2xl gradient-primary grid place-items-center text-white shrink-0">
            <GraduationCap className="size-6" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between gap-2 mb-1.5">
              <span className="text-sm font-medium">Seu progresso</span>
              <span className="text-xs text-muted-foreground tabular-nums">{totals.done} de {totals.lessons} aulas · {pct}%</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="py-20 grid place-items-center"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
      ) : tracks.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border py-16 px-6 text-center">
          <GraduationCap className="size-10 mx-auto text-muted-foreground/60 mb-3" />
          <h2 className="font-semibold mb-1">Nenhuma trilha ainda</h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            {data?.canEdit
              ? "Crie uma trilha (ex.: Onboarding, Atendimento, Criação de Lojas) e adicione aulas com documentos, vídeos, fluxogramas, mapas mentais e arquivos."
              : "Quando houver treinamentos para você, eles aparecem aqui."}
          </p>
          {data?.canEdit && (
            <button onClick={() => setEditing({})} className="mt-5 h-10 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-medium inline-flex items-center gap-2">
              <Plus className="size-4" /> Criar primeira trilha
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {tracks.map((t) => <TrackCard key={t.id} track={t} canEdit={!!data?.canEdit} onEdit={() => setEditing(t)} />)}
        </div>
      )}

      {editing && <TrackDialog track={editing} onClose={() => setEditing(null)} />}
    </PageShell>
  );
}

function TrackCard({ track, canEdit, onEdit }: { track: TrainingTrackSummary; canEdit: boolean; onEdit: () => void }) {
  const pct = track.lessons ? Math.round((track.done / track.lessons) * 100) : 0;
  const complete = track.lessons > 0 && track.done === track.lessons;
  const minutes = formatMinutes(track.minutes);
  return (
    <Link
      to="/academia/$trackId"
      params={{ trackId: track.id }}
      className="group relative rounded-2xl border border-border bg-surface overflow-hidden hover:border-primary/40 hover:shadow-lg transition"
    >
      <div className="h-24 relative" style={{ background: `linear-gradient(135deg, ${track.color}, color-mix(in oklab, ${track.color} 55%, #000))` }}>
        <span className="absolute left-5 -bottom-6 size-14 rounded-2xl bg-surface border border-border grid place-items-center text-3xl shadow-sm">
          {track.emoji || "🎓"}
        </span>
        {complete && (
          <span className="absolute top-3 right-3 h-6 px-2 rounded-full bg-white/90 text-emerald-700 text-[11px] font-semibold flex items-center gap-1">
            <Check className="size-3" /> Concluída
          </span>
        )}
        {canEdit && (
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onEdit(); }}
            className="absolute top-3 right-3 size-8 rounded-lg bg-black/30 text-white grid place-items-center opacity-0 group-hover:opacity-100 transition hover:bg-black/50"
            style={complete ? { right: "6.5rem" } : undefined}
            title="Editar trilha"
          >
            <Pencil className="size-3.5" />
          </button>
        )}
      </div>
      <div className="px-5 pt-9 pb-5">
        <h3 className="font-semibold leading-tight">{track.title}</h3>
        {track.description && <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{track.description}</p>}
        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-3">
          <span className="flex items-center gap-1"><BookOpen className="size-3.5" /> {track.lessons} {track.lessons === 1 ? "aula" : "aulas"}</span>
          {minutes && <span className="flex items-center gap-1"><Clock className="size-3.5" /> {minutes}</span>}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: track.color }} />
          </div>
          <span className="text-[11px] text-muted-foreground tabular-nums w-8 text-right">{pct}%</span>
        </div>
      </div>
    </Link>
  );
}
