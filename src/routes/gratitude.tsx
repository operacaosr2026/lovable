import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getGratitudeEntry,
  saveGratitudeEntry,
  listGratitudeEntries,
  deleteGratitudeEntry,
} from "@/lib/gratitude.functions";
import { requireAuth } from "@/lib/route-guards";
import { Heart, ChevronLeft, ChevronRight, Trash2, Loader2, Check } from "lucide-react";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/gratitude")({
  beforeLoad: requireAuth,
  head: () => ({ meta: [{ title: "Gratidão — SRX Growth" }] }),
  component: GratitudePage,
});

function toDateStr(d: Date) {
  return d.toISOString().slice(0, 10);
}

function formatDisplay(dateStr: string) {
  const [y, m, day] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

const PROMPTS = [
  "O que fez hoje valer a pena?",
  "O que você é grato hoje?",
  "Que momento pequeno te fez bem hoje?",
  "O que de bom aconteceu hoje?",
  "Que pessoa ou coisa você agradece hoje?",
];

function GratitudePage() {
  const today = toDateStr(new Date());
  const [selectedDate, setSelectedDate] = useState(today);
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const qc = useQueryClient();
  const confirm = useConfirm();

  const getFn = useServerFn(getGratitudeEntry);
  const saveFn = useServerFn(saveGratitudeEntry);
  const listFn = useServerFn(listGratitudeEntries);
  const deleteFn = useServerFn(deleteGratitudeEntry);

  const entryQ = useQuery({
    queryKey: ["gratitude-entry", selectedDate],
    queryFn: () => getFn({ data: { date: selectedDate } }),
  });

  const historyQ = useQuery({
    queryKey: ["gratitude-history"],
    queryFn: () => listFn(),
  });

  useEffect(() => {
    setDraft(entryQ.data?.entry?.content ?? "");
    setSaved(false);
  }, [entryQ.data, selectedDate]);

  const persistSave = useCallback(
    async (content: string) => {
      if (!content.trim()) return;
      await saveFn({ data: { date: selectedDate, content } });
      qc.invalidateQueries({ queryKey: ["gratitude-entry", selectedDate] });
      qc.invalidateQueries({ queryKey: ["gratitude-history"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
    [selectedDate, saveFn, qc],
  );

  const onChange = (val: string) => {
    setDraft(val);
    setSaved(false);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persistSave(val), 1500);
  };

  const onSaveNow = () => {
    clearTimeout(saveTimer.current);
    persistSave(draft);
  };

  const onDelete = async (id: string, date: string) => {
    if (!(await confirm("Remover esta entrada?"))) return;
    await deleteFn({ data: { id } });
    qc.invalidateQueries({ queryKey: ["gratitude-history"] });
    qc.invalidateQueries({ queryKey: ["gratitude-entry", date] });
    if (date === selectedDate) setDraft("");
    toast.success("Entrada removida");
  };

  const prevDay = () => {
    const d = new Date(selectedDate + "T12:00:00");
    d.setDate(d.getDate() - 1);
    setSelectedDate(toDateStr(d));
  };
  const nextDay = () => {
    const d = new Date(selectedDate + "T12:00:00");
    d.setDate(d.getDate() + 1);
    if (toDateStr(d) <= today) setSelectedDate(toDateStr(d));
  };

  const isToday = selectedDate === today;
  const prompt = PROMPTS[new Date(selectedDate + "T12:00:00").getDay() % PROMPTS.length];
  const history = historyQ.data?.entries ?? [];

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-8 md:py-12">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <div className="size-10 rounded-2xl bg-rose-500/15 grid place-items-center">
            <Heart className="size-5 text-rose-400 fill-rose-400/30" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Gratidão</h1>
            <p className="text-xs text-muted-foreground">Um registro diário do que importa</p>
          </div>
        </div>

        {/* Date navigator */}
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={prevDay}
            className="size-8 rounded-lg border border-border hover:bg-surface grid place-items-center text-muted-foreground"
          >
            <ChevronLeft className="size-4" />
          </button>
          <div className="text-center">
            <div className="text-sm font-semibold capitalize">{formatDisplay(selectedDate)}</div>
            {isToday && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-400 font-medium">
                Hoje
              </span>
            )}
          </div>
          <button
            onClick={nextDay}
            disabled={isToday}
            className="size-8 rounded-lg border border-border hover:bg-surface grid place-items-center text-muted-foreground disabled:opacity-30"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>

        {/* Entry card */}
        <div className="premium-card p-6 mb-8">
          {entryQ.isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <p className="text-xs text-muted-foreground italic mb-3">{prompt}</p>
              <textarea
                value={draft}
                onChange={(e) => onChange(e.target.value)}
                placeholder="Escreva aqui o que você é grato hoje..."
                rows={6}
                className="w-full bg-transparent text-sm resize-none outline-none placeholder:text-muted-foreground/50 leading-relaxed"
              />
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
                <span className="text-[11px] text-muted-foreground">
                  {draft.length > 0 ? `${draft.length} caracteres` : ""}
                </span>
                <button
                  onClick={onSaveNow}
                  disabled={!draft.trim() || saved}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-rose-500/15 text-rose-400 text-xs font-medium hover:bg-rose-500/25 disabled:opacity-50 transition-colors"
                >
                  {saved ? <Check className="size-3" /> : <Heart className="size-3" />}
                  {saved ? "Salvo!" : "Salvar"}
                </button>
              </div>
            </>
          )}
        </div>

        {/* History */}
        {history.length > 0 && (
          <div>
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Entradas anteriores
            </h2>
            <div className="space-y-3">
              {history
                .filter((e) => e.date !== selectedDate || !isToday)
                .map((entry) => (
                  <div
                    key={entry.id}
                    className={`premium-card p-4 cursor-pointer hover:border-rose-500/30 transition-colors ${
                      entry.date === selectedDate ? "border-rose-500/40" : ""
                    }`}
                    onClick={() => setSelectedDate(entry.date)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] text-muted-foreground mb-1 capitalize">
                          {formatDisplay(entry.date)}
                        </div>
                        <p className="text-sm leading-relaxed line-clamp-3 text-foreground/80">
                          {entry.content}
                        </p>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(entry.id, entry.date);
                        }}
                        className="shrink-0 size-7 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 grid place-items-center"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {history.length === 0 && !entryQ.isLoading && (
          <div className="text-center py-12 text-muted-foreground">
            <Heart className="size-8 mx-auto mb-3 opacity-20" />
            <p className="text-sm">Comece escrevendo sua primeira gratidão acima.</p>
          </div>
        )}
      </div>
    </div>
  );
}
