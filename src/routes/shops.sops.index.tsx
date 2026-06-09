import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageShell, PageHeader } from "@/components/PageHeader";
import { Plus, Workflow, Copy, Trash2, Search, X, FileStack } from "lucide-react";
import {
  listSopProcesses, createSopProcess, deleteSopProcess, duplicateSopProcess, updateSopProcess,
} from "@/lib/sops.functions";

export const Route = createFileRoute("/shops/sops/")({
  component: SopList,
});

function SopList() {
  const qc = useQueryClient();
  const listFn = useServerFn(listSopProcesses);
  const createFn = useServerFn(createSopProcess);
  const delFn = useServerFn(deleteSopProcess);
  const dupFn = useServerFn(duplicateSopProcess);
  const updFn = useServerFn(updateSopProcess);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);

  const { data } = useQuery({ queryKey: ["sop-processes"], queryFn: () => listFn() });
  const processes = ((data as any)?.processes ?? []) as any[];

  const refresh = () => qc.invalidateQueries({ queryKey: ["sop-processes"] });
  const create = useMutation({ mutationFn: (i: any) => createFn({ data: i }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => delFn({ data: { id } }), onSuccess: refresh });
  const duplicate = useMutation({ mutationFn: (id: string) => dupFn({ data: { id } }), onSuccess: refresh });
  const update = useMutation({ mutationFn: ({ id, patch }: any) => updFn({ data: { id, patch } }), onSuccess: refresh });

  const filtered = useMemo(
    () => processes.filter((p) => !search || p.name.toLowerCase().includes(search.toLowerCase())),
    [processes, search]
  );

  return (
    <PageShell>
      <PageHeader
        title="SOPs & Processos"
        subtitle="Fluxos visuais, onboarding e passo a passo operacional"
        actions={
          <button
            onClick={() => setCreating(true)}
            className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-1.5"
          >
            <Plus className="size-4" /> Novo processo
          </button>
        }
      />

      <div className="flex items-center gap-2 px-3 h-9 rounded-lg bg-surface border border-border mb-5 max-w-md">
        <Search className="size-3.5 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar processo..."
          className="bg-transparent text-sm outline-none flex-1 placeholder:text-muted-foreground"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center">
          <Workflow className="size-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground mb-1">Nenhum processo ainda.</p>
          <p className="text-xs text-muted-foreground mb-4">Crie um fluxo visual para documentar passo a passo qualquer operação.</p>
          <button
            onClick={() => setCreating(true)}
            className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium inline-flex items-center gap-1.5"
          >
            <Plus className="size-4" /> Criar primeiro processo
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((p) => {
            const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
            return (
              <div key={p.id} className="group relative rounded-2xl border border-border bg-surface hover:border-primary/40 transition-colors overflow-hidden">
                <Link to="/shops/sops/$processId" params={{ processId: p.id }} className="block p-5">
                  <div className="flex items-start gap-3 mb-3">
                    <div
                      className="size-11 rounded-xl grid place-items-center shrink-0"
                      style={{ background: `color-mix(in oklab, ${p.color} 18%, transparent)`, color: p.color }}
                    >
                      <Workflow className="size-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="text-base font-semibold leading-tight truncate">{p.name}</div>
                        {p.is_template && (
                          <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/10 text-primary font-semibold">Template</span>
                        )}
                      </div>
                      {p.description && (
                        <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{p.description}</p>
                      )}
                    </div>
                  </div>

                  <div className="mt-4">
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
                      <span>{p.done}/{p.total} etapas</span>
                      <span className="tabular-nums font-medium text-foreground">{pct}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: p.color }} />
                    </div>
                  </div>
                </Link>
                <div className="absolute top-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => setEditing(p)}
                    className="text-[11px] px-2 h-6 rounded-md bg-background border border-border text-muted-foreground hover:text-foreground"
                    title="Editar"
                  >
                    editar
                  </button>
                  <button
                    onClick={() => duplicate.mutate(p.id)}
                    className="size-6 grid place-items-center rounded-md bg-background border border-border text-muted-foreground hover:text-foreground"
                    title="Duplicar"
                  >
                    <Copy className="size-3" />
                  </button>
                  <button
                    onClick={() => { if (confirm(`Excluir "${p.name}"?`)) remove.mutate(p.id); }}
                    className="size-6 grid place-items-center rounded-md bg-background border border-border text-muted-foreground hover:text-destructive"
                    title="Excluir"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {creating && (
        <ProcessEditor
          onClose={() => setCreating(false)}
          onSave={async (patch) => { await create.mutateAsync(patch); setCreating(false); }}
        />
      )}
      {editing && (
        <ProcessEditor
          initial={editing}
          onClose={() => setEditing(null)}
          onSave={async (patch) => { await update.mutateAsync({ id: editing.id, patch }); setEditing(null); }}
        />
      )}
    </PageShell>
  );
}

const COLORS = [
  "oklch(0.6 0.22 285)", "oklch(0.62 0.14 155)", "oklch(0.7 0.14 75)",
  "oklch(0.65 0.16 25)", "oklch(0.65 0.14 195)", "oklch(0.55 0.16 0)",
];

function ProcessEditor({ initial, onClose, onSave }: { initial?: any; onClose: () => void; onSave: (patch: any) => void | Promise<void> }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [color, setColor] = useState(initial?.color ?? COLORS[0]);
  const [isTemplate, setIsTemplate] = useState(!!initial?.is_template);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl bg-popover border border-border shadow-xl">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div className="text-base font-semibold flex items-center gap-2"><FileStack className="size-4" /> {initial ? "Editar processo" : "Novo processo"}</div>
          <button onClick={onClose} className="size-7 rounded-md grid place-items-center hover:bg-muted text-muted-foreground"><X className="size-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome do processo (ex: Criar Loja Shopify)"
            className="w-full px-3 h-10 rounded-lg bg-surface border border-border text-sm outline-none focus:border-primary/50"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Descrição curta..."
            rows={2}
            className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-sm outline-none focus:border-primary/50 resize-none"
          />
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Cor</div>
            <div className="flex gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`size-7 rounded-full border-2 ${color === c ? "border-foreground" : "border-transparent"}`}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={isTemplate} onChange={(e) => setIsTemplate(e.target.checked)} />
            Marcar como template reutilizável
          </label>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-border">
          <button onClick={onClose} className="h-9 px-4 rounded-lg text-sm hover:bg-muted">Cancelar</button>
          <button
            onClick={() => onSave({ name: name.trim() || "Novo processo", description: description.trim() || null, color, is_template: isTemplate })}
            className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium"
          >
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}
