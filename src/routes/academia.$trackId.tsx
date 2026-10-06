import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  ArrowLeft, Plus, Check, Loader2, Pencil, Trash2, Users, ChevronUp, ChevronDown, ChevronLeft, ChevronRight,
  FileText, PlayCircle, Workflow, Network, Paperclip, Eye, Clock, CircleCheck,
} from "lucide-react";
import { toast } from "sonner";
import { PageShell } from "@/components/PageHeader";
import { requireAuth } from "@/lib/route-guards";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useEscapeToClose } from "@/hooks/use-escape-to-close";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  getTrainingTrack, createTrainingLesson, updateTrainingLesson, deleteTrainingLesson, reorderTrainingLessons,
  setTrainingLessonDone, deleteTrainingTrack, getTrainingTeamProgress,
  type LessonKind, type TrainingLesson,
} from "@/lib/training.functions";
import { TrackDialog, formatMinutes } from "@/components/academia/TrackDialog";
import { LessonDoc } from "@/components/academia/LessonDoc";
import { LessonVideo } from "@/components/academia/LessonVideo";
import { LessonFile } from "@/components/academia/LessonFile";
import { LessonDiagram } from "@/components/academia/LessonDiagram";
import { formatDateUS } from "@/lib/timezone";

export const Route = createFileRoute("/academia/$trackId")({
  beforeLoad: requireAuth,
  validateSearch: z.object({ aula: z.string().optional() }),
  head: () => ({ meta: [{ title: "Academia — SRX Growth" }] }),
  component: TrackPage,
});

const KINDS: { kind: LessonKind; label: string; hint: string; Icon: typeof FileText }[] = [
  { kind: "doc", label: "Documento", hint: "Texto, passo a passo, imagens, tabelas", Icon: FileText },
  { kind: "video", label: "Vídeo aula", hint: "YouTube, Loom, Vimeo, Drive ou upload", Icon: PlayCircle },
  { kind: "flow", label: "Fluxograma", hint: "Processo com etapas e decisões", Icon: Workflow },
  { kind: "mindmap", label: "Mapa mental", hint: "Tema central e ramos", Icon: Network },
  { kind: "file", label: "Arquivo / PDF", hint: "Material para ler ou baixar", Icon: Paperclip },
];
const kindInfo = (k: LessonKind) => KINDS.find((x) => x.kind === k) ?? KINDS[0];

type TrackData = Awaited<ReturnType<typeof getTrainingTrack>>;

function TrackPage() {
  const { trackId } = Route.useParams();
  const { aula } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const qc = useQueryClient();
  const confirm = useConfirm();
  const getFn = useServerFn(getTrainingTrack);
  const createFn = useServerFn(createTrainingLesson);
  const deleteFn = useServerFn(deleteTrainingLesson);
  const reorderFn = useServerFn(reorderTrainingLessons);
  const doneFn = useServerFn(setTrainingLessonDone);
  const deleteTrackFn = useServerFn(deleteTrainingTrack);

  const key = ["training-track", trackId];
  const { data, isLoading, error } = useQuery({ queryKey: key, queryFn: () => getFn({ data: { id: trackId } }) });
  const [editMode, setEditMode] = useState(false);
  const [editingTrack, setEditingTrack] = useState(false);
  const [showTeam, setShowTeam] = useState(false);

  const lessons = data?.lessons ?? [];
  const done = new Set(data?.done ?? []);
  const current = lessons.find((l) => l.id === aula) ?? lessons[0];
  const idx = current ? lessons.indexOf(current) : -1;
  const editing = !!data?.canEdit && editMode;

  const select = (id: string) => navigate({ search: { aula: id }, replace: true });
  const patchCache = (fn: (d: TrackData) => TrackData) => qc.setQueryData<TrackData>(key, (d) => (d ? fn(d) : d));

  const addLesson = async (kind: LessonKind) => {
    try {
      const { id } = await createFn({ data: { track_id: trackId, kind, title: `Nova aula — ${kindInfo(kind).label}` } });
      await qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ["training-tracks"] });
      setEditMode(true);
      select(id);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const removeLesson = (l: TrainingLesson) => {
    confirm({ title: "Excluir aula?", variant: "destructive", description: `"${l.title}" e o conteúdo dela serão apagados.` }).then(async (ok) => {
      if (!ok) return;
      try {
        await deleteFn({ data: { id: l.id } });
        await qc.invalidateQueries({ queryKey: key });
        qc.invalidateQueries({ queryKey: ["training-tracks"] });
      } catch (e: any) { toast.error(e.message); }
    });
  };

  const move = async (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= lessons.length) return;
    const next = [...lessons];
    [next[i], next[j]] = [next[j], next[i]];
    patchCache((d) => ({ ...d, lessons: next }));
    try { await reorderFn({ data: { ids: next.map((l) => l.id) } }); } catch (e: any) { toast.error(e.message); }
  };

  const toggleDone = async (id: string, value: boolean) => {
    patchCache((d) => ({ ...d, done: value ? [...d.done, id] : d.done.filter((x) => x !== id) }));
    try {
      await doneFn({ data: { lesson_id: id, done: value } });
      qc.invalidateQueries({ queryKey: ["training-tracks"] });
    } catch (e: any) {
      toast.error(e.message);
      qc.invalidateQueries({ queryKey: key });
    }
  };

  const completeAndNext = async () => {
    if (!current) return;
    if (!done.has(current.id)) await toggleDone(current.id, true);
    const next = lessons[idx + 1];
    if (next) select(next.id);
    else toast.success("Trilha concluída! 🎉");
  };

  const removeTrack = () => {
    confirm({ title: "Excluir trilha?", variant: "destructive", description: "Todas as aulas, arquivos e o progresso da equipe nessa trilha serão apagados." }).then(async (ok) => {
      if (!ok) return;
      try {
        await deleteTrackFn({ data: { id: trackId } });
        qc.invalidateQueries({ queryKey: ["training-tracks"] });
        navigate({ to: "/academia" });
      } catch (e: any) { toast.error(e.message); }
    });
  };

  if (isLoading) return <PageShell><div className="py-24 grid place-items-center"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div></PageShell>;
  if (error || !data) {
    return (
      <PageShell>
        <Link to="/academia" className="text-sm text-muted-foreground flex items-center gap-1.5 mb-4"><ArrowLeft className="size-4" /> Academia</Link>
        <p className="text-sm text-muted-foreground">{(error as Error)?.message ?? "Trilha não encontrada"}</p>
      </PageShell>
    );
  }

  const { track } = data;
  const pct = lessons.length ? Math.round((lessons.filter((l) => done.has(l.id)).length / lessons.length) * 100) : 0;

  const addMenu = (trigger: React.ReactNode) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {KINDS.map(({ kind, label, hint, Icon }) => (
          <DropdownMenuItem key={kind} onClick={() => addLesson(kind)} className="gap-3 py-2">
            <Icon className="size-4 text-primary" />
            <div>
              <div className="text-sm font-medium">{label}</div>
              <div className="text-[11px] text-muted-foreground">{hint}</div>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <PageShell wide>
      <Link to="/academia" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 mb-4">
        <ArrowLeft className="size-4" /> Academia
      </Link>

      <div className="flex flex-col lg:flex-row lg:items-center gap-4 mb-6">
        <div className="flex items-center gap-4 flex-1 min-w-0">
          <div className="size-14 rounded-2xl grid place-items-center text-3xl shrink-0" style={{ background: `color-mix(in oklab, ${track.color} 18%, transparent)` }}>
            {track.emoji || "🎓"}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight truncate">{track.title}</h1>
            {track.description && <p className="text-sm text-muted-foreground line-clamp-2">{track.description}</p>}
            <div className="flex items-center gap-2 mt-1.5 max-w-sm">
              <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: track.color }} />
              </div>
              <span className="text-[11px] text-muted-foreground tabular-nums">{pct}%</span>
            </div>
          </div>
        </div>
        {data.canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setShowTeam(true)} className="h-9 px-3 rounded-xl border border-border text-sm flex items-center gap-2 hover:bg-muted">
              <Users className="size-4" /> Equipe
            </button>
            <button onClick={() => setEditingTrack(true)} className="h-9 px-3 rounded-xl border border-border text-sm flex items-center gap-2 hover:bg-muted">
              <Pencil className="size-4" /> Trilha
            </button>
            <button onClick={removeTrack} title="Excluir trilha" className="size-9 rounded-xl border border-border grid place-items-center text-destructive hover:bg-destructive/10">
              <Trash2 className="size-4" />
            </button>
            <button
              onClick={() => setEditMode((v) => !v)}
              className={`h-9 px-3.5 rounded-xl text-sm font-medium flex items-center gap-2 ${editMode ? "bg-primary text-primary-foreground" : "border border-border hover:bg-muted"}`}
            >
              {editMode ? <><Eye className="size-4" /> Ver como aluno</> : <><Pencil className="size-4" /> Editar aulas</>}
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-col lg:flex-row gap-6 items-start">
        <aside className="w-full lg:w-80 shrink-0 rounded-2xl border border-border bg-surface overflow-hidden lg:sticky lg:top-6">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {lessons.length} {lessons.length === 1 ? "aula" : "aulas"}
              {formatMinutes(lessons.reduce((a, l) => a + (l.duration_min ?? 0), 0)) && ` · ${formatMinutes(lessons.reduce((a, l) => a + (l.duration_min ?? 0), 0))}`}
            </span>
            {editing && addMenu(
              <button className="h-7 px-2 rounded-lg text-xs font-medium text-primary hover:bg-primary/10 flex items-center gap-1"><Plus className="size-3.5" /> Aula</button>,
            )}
          </div>
          <ol className="max-h-[60vh] lg:max-h-[calc(100dvh-14rem)] overflow-y-auto py-1">
            {lessons.map((l, i) => {
              const { Icon } = kindInfo(l.kind);
              const active = l.id === current?.id;
              const isDone = done.has(l.id);
              return (
                <li key={l.id} className="group relative">
                  <button
                    onClick={() => select(l.id)}
                    className={`w-full text-left flex items-start gap-3 px-4 py-2.5 transition ${active ? "bg-primary/10" : "hover:bg-surface-hover"}`}
                  >
                    <span
                      className={`mt-0.5 size-6 rounded-full grid place-items-center shrink-0 text-[11px] font-semibold ${isDone ? "text-white" : active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}
                      style={isDone ? { background: track.color } : undefined}
                    >
                      {isDone ? <Check className="size-3.5" /> : i + 1}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className={`block text-sm leading-snug ${active ? "font-medium text-foreground" : "text-foreground/80"}`}>{l.title}</span>
                      <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-0.5">
                        <Icon className="size-3" /> {kindInfo(l.kind).label}
                        {l.duration_min ? <> · {formatMinutes(l.duration_min)}</> : null}
                      </span>
                    </span>
                  </button>
                  {editing && (
                    <div className="absolute right-2 top-2 hidden group-hover:flex items-center gap-0.5 bg-surface rounded-lg border border-border p-0.5">
                      <button onClick={() => move(i, -1)} disabled={i === 0} className="size-6 grid place-items-center rounded hover:bg-muted disabled:opacity-30" title="Subir"><ChevronUp className="size-3.5" /></button>
                      <button onClick={() => move(i, 1)} disabled={i === lessons.length - 1} className="size-6 grid place-items-center rounded hover:bg-muted disabled:opacity-30" title="Descer"><ChevronDown className="size-3.5" /></button>
                      <button onClick={() => removeLesson(l)} className="size-6 grid place-items-center rounded hover:bg-destructive/10 text-destructive" title="Excluir aula"><Trash2 className="size-3.5" /></button>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          {lessons.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              {data.canEdit ? (
                addMenu(<button className="h-9 px-3 rounded-xl bg-primary text-primary-foreground text-sm font-medium inline-flex items-center gap-2"><Plus className="size-4" /> Adicionar aula</button>)
              ) : "Nenhuma aula ainda"}
            </div>
          )}
        </aside>

        <main className="flex-1 min-w-0 w-full">
          {current ? (
            <>
              <LessonView
                key={current.id}
                lesson={current}
                editable={editing}
                onSaved={(patch) => patchCache((d) => ({ ...d, lessons: d.lessons.map((l) => (l.id === current.id ? { ...l, ...patch } : l)) }))}
              />
              <div className="mt-6 flex flex-col-reverse sm:flex-row sm:items-center gap-3 border-t border-border pt-5">
                <div className="flex gap-2">
                  <button
                    disabled={idx <= 0}
                    onClick={() => select(lessons[idx - 1].id)}
                    className="h-10 px-3 rounded-xl border border-border text-sm flex items-center gap-1.5 hover:bg-muted disabled:opacity-40"
                  >
                    <ChevronLeft className="size-4" /> Anterior
                  </button>
                  <button
                    disabled={idx >= lessons.length - 1}
                    onClick={() => select(lessons[idx + 1].id)}
                    className="h-10 px-3 rounded-xl border border-border text-sm flex items-center gap-1.5 hover:bg-muted disabled:opacity-40"
                  >
                    Próxima <ChevronRight className="size-4" />
                  </button>
                </div>
                <div className="sm:ml-auto flex gap-2">
                  {done.has(current.id) ? (
                    <button onClick={() => toggleDone(current.id, false)} className="h-10 px-4 rounded-xl text-sm font-medium flex items-center gap-2 text-emerald-600 bg-emerald-500/10 hover:bg-emerald-500/15">
                      <CircleCheck className="size-4" /> Concluída
                    </button>
                  ) : (
                    <button onClick={completeAndNext} className="h-10 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-medium flex items-center gap-2">
                      <Check className="size-4" /> {idx < lessons.length - 1 ? "Concluir e avançar" : "Concluir aula"}
                    </button>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-2xl border border-dashed border-border py-20 text-center text-sm text-muted-foreground">
              {data.canEdit ? "Adicione a primeira aula pelo menu ao lado." : "Essa trilha ainda não tem aulas."}
            </div>
          )}
        </main>
      </div>

      {editingTrack && <TrackDialog track={track} onClose={() => setEditingTrack(false)} />}
      {showTeam && <TeamProgress trackId={trackId} lessons={lessons} onClose={() => setShowTeam(false)} />}
    </PageShell>
  );
}

type LessonPatch = Partial<Pick<TrainingLesson, "title" | "content" | "duration_min">>;

// Aula aberta: edição salva sozinha (~1s depois de parar de mexer).
function LessonView({ lesson, editable, onSaved }: {
  lesson: TrainingLesson; editable: boolean; onSaved: (patch: LessonPatch) => void;
}) {
  const updateFn = useServerFn(updateTrainingLesson);
  const [title, setTitle] = useState(lesson.title);
  const [duration, setDuration] = useState(lesson.duration_min?.toString() ?? "");
  const [content, setContent] = useState<Record<string, any>>(lesson.content ?? {});
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const pending = useRef<LessonPatch>({});
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    const patch = pending.current;
    if (!Object.keys(patch).length) return;
    pending.current = {};
    setStatus("saving");
    try {
      await updateFn({ data: { id: lesson.id, patch } });
      onSavedRef.current(patch);
      setStatus("saved");
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao salvar a aula");
      setStatus("idle");
    }
  }, [lesson.id, updateFn]);

  const queue = (patch: LessonPatch) => {
    pending.current = { ...pending.current, ...patch };
    setStatus("saving");
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 900);
  };

  useEffect(() => () => { flush(); }, [flush]);
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => { if (Object.keys(pending.current).length) e.preventDefault(); };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, []);

  const setContentAndQueue = (c: Record<string, any>) => { setContent(c); queue({ content: c }); };
  const { Icon, label } = kindInfo(lesson.kind);

  return (
    <div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
        <Icon className="size-3.5 text-primary" /> {label}
        {!editable && lesson.duration_min ? <span className="flex items-center gap-1">· <Clock className="size-3" /> {formatMinutes(lesson.duration_min)}</span> : null}
        {editable && (
          <span className="ml-auto flex items-center gap-1.5">
            {status === "saving" && <><Loader2 className="size-3 animate-spin" /> Salvando…</>}
            {status === "saved" && <><Check className="size-3 text-emerald-500" /> Salvo</>}
          </span>
        )}
      </div>

      {editable ? (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-5">
          <input
            value={title}
            onChange={(e) => { setTitle(e.target.value); if (e.target.value.trim()) queue({ title: e.target.value.trim() }); }}
            placeholder="Título da aula"
            className="flex-1 text-xl sm:text-2xl font-semibold tracking-tight bg-transparent outline-none border-b border-transparent focus:border-border pb-1"
          />
          <label className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
            <Clock className="size-3.5" />
            <input
              value={duration}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, "").slice(0, 4);
                setDuration(v);
                queue({ duration_min: v ? Math.min(1440, Number(v)) : null });
              }}
              inputMode="numeric"
              placeholder="0"
              className="w-14 h-8 px-2 rounded-lg bg-background border border-border text-sm text-foreground text-right outline-none focus:border-primary"
            />
            min
          </label>
        </div>
      ) : (
        <h2 className="text-xl sm:text-2xl font-semibold tracking-tight mb-5">{lesson.title}</h2>
      )}

      {lesson.kind === "doc" && (
        <div className="rounded-2xl border border-border bg-surface p-4 sm:p-8">
          <LessonDoc
            key={String(editable)}
            blocks={content.blocks}
            editable={editable}
            onChange={(blocks) => setContentAndQueue({ ...content, blocks })}
          />
        </div>
      )}
      {lesson.kind === "video" && <LessonVideo key={String(editable)} content={content} editable={editable} onChange={setContentAndQueue} />}
      {lesson.kind === "file" && <LessonFile key={String(editable)} content={content} editable={editable} onChange={setContentAndQueue} />}
      {(lesson.kind === "flow" || lesson.kind === "mindmap") && (
        <LessonDiagram key={String(editable)} mode={lesson.kind} content={content} editable={editable} onChange={setContentAndQueue} />
      )}
    </div>
  );
}

function TeamProgress({ trackId, lessons, onClose }: { trackId: string; lessons: TrainingLesson[]; onClose: () => void }) {
  const fn = useServerFn(getTrainingTeamProgress);
  const { data, isLoading } = useQuery({ queryKey: ["training-team", trackId], queryFn: () => fn({ data: { track_id: trackId } }) });
  const [open, setOpen] = useState<string | null>(null);
  const close = useCallback(() => onClose(), [onClose]);
  useEscapeToClose(close);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[85vh] flex flex-col bg-surface border border-border rounded-2xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 pt-6 pb-4 border-b border-border">
          <h2 className="text-base font-bold">Progresso da equipe</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Clique em uma pessoa para ver aula por aula.</p>
        </div>
        <div className="overflow-y-auto p-3">
          {isLoading && <div className="py-10 grid place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>}
          {data?.people.map((p) => {
            const doneSet = new Set(p.done);
            const pct = data.total ? Math.round((p.done.length / data.total) * 100) : 0;
            return (
              <div key={p.id} className="rounded-xl hover:bg-surface-hover">
                <button onClick={() => setOpen(open === p.id ? null : p.id)} className="w-full flex items-center gap-3 px-3 py-2.5 text-left">
                  <span className="size-8 rounded-full gradient-primary grid place-items-center text-white text-xs font-bold shrink-0">
                    {p.name.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-medium truncate">{p.name}</span>
                      <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">{p.done.length}/{data.total}</span>
                    </span>
                    <span className="flex items-center gap-2 mt-1">
                      <span className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                        <span className="block h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                      </span>
                      <span className="text-[10px] text-muted-foreground w-24 text-right">
                        {p.last ? `últ. ${formatDateUS(p.last)}` : "não começou"}
                      </span>
                    </span>
                  </span>
                </button>
                {open === p.id && (
                  <ul className="px-3 pb-3 pl-14 space-y-1">
                    {lessons.map((l) => (
                      <li key={l.id} className="flex items-center gap-2 text-xs">
                        {doneSet.has(l.id)
                          ? <Check className="size-3.5 text-emerald-500 shrink-0" />
                          : <span className="size-3.5 rounded-full border border-border shrink-0" />}
                        <span className={doneSet.has(l.id) ? "" : "text-muted-foreground"}>{l.title}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
        <div className="p-4 border-t border-border">
          <button onClick={onClose} className="w-full h-10 rounded-xl border border-border text-sm">Fechar</button>
        </div>
      </div>
    </div>
  );
}
