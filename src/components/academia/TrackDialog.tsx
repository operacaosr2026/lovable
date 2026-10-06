import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useEscapeToClose } from "@/hooks/use-escape-to-close";
import { saveTrainingTrack, type TrainingTrackSummary } from "@/lib/training.functions";

export const TRACK_COLORS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#8b5cf6", "#64748b"];
const EMOJIS = ["🎓", "🚀", "🛒", "📦", "🎧", "💳", "📊", "📣", "🧠", "⚙️", "🤝", "🏆"];

export function formatMinutes(min: number) {
  if (!min) return null;
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return min % 60 ? `${h}h ${min % 60}min` : `${h}h`;
}

export function TrackDialog({ track, onClose, onSaved }: {
  track: Partial<TrainingTrackSummary>; onClose: () => void; onSaved?: () => void;
}) {
  const qc = useQueryClient();
  const saveFn = useServerFn(saveTrainingTrack);
  const [title, setTitle] = useState(track.title ?? "");
  const [description, setDescription] = useState(track.description ?? "");
  const [color, setColor] = useState(track.color ?? TRACK_COLORS[0]);
  const [emoji, setEmoji] = useState(track.emoji ?? "🎓");
  const [saving, setSaving] = useState(false);
  const close = useCallback(() => onClose(), [onClose]);
  useEscapeToClose(close);

  const save = async () => {
    if (!title.trim()) return toast.error("Dê um nome para a trilha");
    setSaving(true);
    try {
      await saveFn({ data: { id: track.id, title: title.trim(), description: description.trim() || null, color, emoji: emoji || null } });
      await qc.invalidateQueries({ queryKey: ["training-tracks"] });
      if (track.id) await qc.invalidateQueries({ queryKey: ["training-track", track.id] });
      onSaved?.();
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-md bg-surface border border-border rounded-2xl shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-bold mb-5">{track.id ? "Editar trilha" : "Nova trilha"}</h2>
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Nome</label>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && save()}
              placeholder="Ex.: Onboarding da equipe"
              className="w-full h-10 px-3.5 rounded-xl bg-background border border-border text-sm outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Descrição</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="O que a pessoa aprende nessa trilha"
              className="w-full px-3.5 py-2.5 rounded-xl bg-background border border-border text-sm outline-none focus:border-primary resize-none"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">Ícone</label>
            <div className="flex flex-wrap gap-1.5">
              {EMOJIS.map((em) => (
                <button
                  key={em}
                  onClick={() => setEmoji(em)}
                  className={`size-9 rounded-lg text-lg grid place-items-center border ${emoji === em ? "border-primary bg-primary/10" : "border-border hover:bg-muted"}`}
                >
                  {em}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">Cor</label>
            <div className="flex flex-wrap gap-2">
              {TRACK_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className="size-7 rounded-full grid place-items-center"
                  style={{ background: c, boxShadow: color === c ? `0 0 0 2px var(--surface), 0 0 0 4px ${c}` : undefined }}
                >
                  {color === c && <Check className="size-3.5 text-white" />}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex gap-2 mt-6">
          <button onClick={onClose} className="flex-1 h-10 rounded-xl border border-border text-sm">Cancelar</button>
          <button
            onClick={save}
            disabled={saving}
            className="flex-1 h-10 rounded-xl bg-primary text-primary-foreground text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}
