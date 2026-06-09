import { useState } from "react";
import { X } from "lucide-react";
import { CATEGORIES, STATUSES, PRIORITIES } from "@/lib/projects.functions";
import { CATEGORY_META, STATUS_META, PRIORITY_META } from "./meta";

type Project = {
  id?: string; name?: string | null; description?: string | null;
  category?: string; status?: string; priority?: string;
  due_date?: string | null;
};

export function ProjectEditor({ project, onClose, onSave }: {
  project: Project | null;
  onClose: () => void;
  onSave: (patch: any) => void | Promise<void>;
}) {
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [category, setCategory] = useState(project?.category ?? "outros");
  const [status, setStatus] = useState(project?.status ?? "planejando");
  const [priority, setPriority] = useState(project?.priority ?? "media");
  const [dueDate, setDueDate] = useState(project?.due_date ?? "");
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        description: description.trim() || null,
        category, status, priority,
        due_date: dueDate || null,
      });
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-lg rounded-2xl bg-popover border border-border shadow-xl"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div className="text-base font-semibold">{project?.id ? "Editar projeto" : "Novo projeto"}</div>
          <button type="button" onClick={onClose} className="size-7 rounded-md grid place-items-center hover:bg-muted text-muted-foreground">
            <X className="size-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <Field label="Nome">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Reforma da cozinha, Aniversário da Ana, TCC..."
              className="w-full h-10 px-3 rounded-lg bg-surface border border-border text-sm outline-none focus:border-primary/50"
            />
          </Field>

          <Field label="Descrição">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="O que esse projeto é?"
              rows={2}
              className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-sm outline-none focus:border-primary/50 resize-none"
            />
          </Field>

          <Field label="Categoria">
            <div className="grid grid-cols-4 gap-1.5">
              {CATEGORIES.map((c) => {
                const m = CATEGORY_META[c];
                const active = category === c;
                return (
                  <button
                    type="button"
                    key={c}
                    onClick={() => setCategory(c)}
                    className={`flex flex-col items-center gap-1 p-2 rounded-lg border text-[11px] transition-colors ${active ? "border-primary bg-primary/10 text-foreground" : "border-border bg-surface text-muted-foreground hover:border-primary/30"}`}
                  >
                    <m.icon className="size-4" style={active ? { color: m.accent } : undefined} />
                    {m.label}
                  </button>
                );
              })}
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Status">
              <select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full h-10 px-3 rounded-lg bg-surface border border-border text-sm outline-none">
                {STATUSES.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
              </select>
            </Field>
            <Field label="Prioridade">
              <select value={priority} onChange={(e) => setPriority(e.target.value)} className="w-full h-10 px-3 rounded-lg bg-surface border border-border text-sm outline-none">
                {PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}
              </select>
            </Field>
          </div>

          <Field label="Data limite">
            <input
              type="date"
              value={dueDate ?? ""}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full h-10 px-3 rounded-lg bg-surface border border-border text-sm outline-none"
            />
          </Field>
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-border">
          <button type="button" onClick={onClose} className="h-9 px-3 rounded-lg text-sm text-muted-foreground hover:bg-muted">Cancelar</button>
          <button type="submit" disabled={saving || !name.trim()} className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
            {saving ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">{label}</div>
      {children}
    </div>
  );
}
