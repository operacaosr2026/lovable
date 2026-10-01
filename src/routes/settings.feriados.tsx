import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CalendarOff, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  listPostingHolidays, addPostingHoliday, deletePostingHoliday, addChinaHolidays2026,
} from "@/lib/posting-holidays.functions";

export const Route = createFileRoute("/settings/feriados")({
  component: FeriadosPage,
});

const WEEKDAY = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const fmtDay = (iso: string) => {
  const d = new Date(iso + "T12:00:00Z");
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)} · ${WEEKDAY[d.getUTCDay()]}`;
};
const isWeekend = (iso: string) => [0, 6].includes(new Date(iso + "T12:00:00Z").getUTCDay());

function FeriadosPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listPostingHolidays);
  const addFn = useServerFn(addPostingHoliday);
  const delFn = useServerFn(deletePostingHoliday);
  const presetFn = useServerFn(addChinaHolidays2026);
  const q = useQuery({ queryKey: ["posting-holidays"], queryFn: () => listFn() });
  const refresh = () => qc.invalidateQueries({ queryKey: ["posting-holidays"] });

  const [day, setDay] = useState("");
  const [name, setName] = useState("");
  // Sábado/domingo só faz sentido como dia de compensação (conta); dia de
  // semana, como feriado (não conta).
  const kind = day && isWeekend(day) ? "workday" : "holiday";

  const add = useMutation({
    mutationFn: () => addFn({ data: { day, name, kind } }),
    onSuccess: () => { setDay(""); setName(""); refresh(); toast.success("Data adicionada"); },
    onError: (e: any) => toast.error(e.message ?? "Falha ao adicionar"),
  });
  const del = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: refresh,
    onError: (e: any) => toast.error(e.message ?? "Falha ao remover"),
  });
  const preset = useMutation({
    mutationFn: () => presetFn(),
    onSuccess: () => { refresh(); toast.success("Feriados da China 2026 carregados — confira as datas"); },
    onError: (e: any) => toast.error(e.message ?? "Falha ao carregar"),
  });

  const rows = q.data ?? [];

  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto pb-20 space-y-6">
      <header>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Feriados</h1>
        <p className="text-sm text-muted-foreground mt-1">
          O TM Postagem conta só dias úteis entre o pedido e a postagem. Feriados não contam; sábado ou domingo
          marcado como dia de compensação conta.
        </p>
      </header>

      <section className="premium-card p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Plus className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">Adicionar data</h2>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="sm:w-44" />
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome (ex.: Golden Week)" maxLength={80} />
          <Button onClick={() => add.mutate()} disabled={!day || add.isPending}>
            {add.isPending ? <Loader2 className="size-4 animate-spin" /> : "Adicionar"}
          </Button>
        </div>
        {day && (
          <p className="text-xs text-muted-foreground">
            {kind === "workday"
              ? "Sábado/domingo: entra como dia de compensação (conta como dia útil)."
              : "Dia de semana: entra como feriado (não conta como dia útil)."}
          </p>
        )}
        <div className="pt-1">
          <Button variant="outline" size="sm" onClick={() => preset.mutate()} disabled={preset.isPending}>
            {preset.isPending ? <Loader2 className="size-4 animate-spin" /> : "Carregar feriados da China 2026"}
          </Button>
          <p className="text-[11px] text-muted-foreground mt-1.5">
            Não altera datas já cadastradas. Confira com o calendário oficial chinês.
          </p>
        </div>
      </section>

      <section className="premium-card p-6">
        <div className="flex items-center gap-2 mb-4">
          <CalendarOff className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">Datas cadastradas</h2>
          <span className="text-xs text-muted-foreground">({rows.length})</span>
        </div>
        {q.isLoading ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma data. Hoje o TM Postagem desconta só sábado e domingo.</p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((h) => (
              <li key={h.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="tabular-nums w-40 shrink-0">{fmtDay(h.day)}</span>
                <span className="flex-1 min-w-0 truncate">{h.name || "—"}</span>
                <span className={`text-[11px] px-2 py-0.5 rounded-full border shrink-0 ${
                  h.kind === "workday" ? "border-primary/30 text-primary" : "border-border text-muted-foreground"}`}>
                  {h.kind === "workday" ? "conta (compensação)" : "não conta"}
                </span>
                <button type="button" onClick={() => del.mutate(h.id)} disabled={del.isPending}
                  className="text-muted-foreground hover:text-destructive p-1" aria-label="Remover">
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
