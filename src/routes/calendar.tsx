import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, PageShell } from "@/components/PageHeader";
import { ChevronLeft, ChevronRight, Plus, X, Trash2 } from "lucide-react";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listCalendarEvents, createCalendarEvent, deleteCalendarEvent, updateCalendarEvent } from "@/lib/calendar.functions";
import { requireAuth } from "@/lib/route-guards";

export const Route = createFileRoute("/calendar")({
  beforeLoad: requireAuth,
  head: () => ({ meta: [{ title: "Calendário — Orbit" }] }),
  component: CalendarPage,
});

const DAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MONTHS_PT = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

const COLORS = [
  { value: "bg-primary",     label: "Roxo"     },
  { value: "bg-blue-500",    label: "Azul"      },
  { value: "bg-success",     label: "Verde"     },
  { value: "bg-warning",     label: "Amarelo"   },
  { value: "bg-orange-500",  label: "Laranja"   },
  { value: "bg-destructive", label: "Vermelho"  },
  { value: "bg-pink-500",    label: "Rosa"      },
];

function toDateStr(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function CalendarPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [showForm, setShowForm] = useState(false);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [editEvent, setEditEvent] = useState<any | null>(null);
  const [title, setTitle] = useState("");
  const [color, setColor] = useState("bg-primary");
  const [formDate, setFormDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");

  const qc = useQueryClient();
  const listFn = useServerFn(listCalendarEvents);
  const createFn = useServerFn(createCalendarEvent);
  const deleteFn = useServerFn(deleteCalendarEvent);
  const updateFn = useServerFn(updateCalendarEvent);

  const qKey = ["calendar", year, month];
  const { data: events = [], isLoading } = useQuery({
    queryKey: qKey,
    queryFn: () => listFn({ data: { year, month } }),
  });

  const inv = () => qc.invalidateQueries({ queryKey: qKey });
  const mCreate = useMutation({ mutationFn: (d: any) => createFn({ data: d }), onSuccess: inv });
  const mDelete = useMutation({ mutationFn: (d: any) => deleteFn({ data: d }), onSuccess: inv });
  const mUpdate = useMutation({ mutationFn: (d: any) => updateFn({ data: d }), onSuccess: inv });

  const prevMonth = () => { if (month === 1) { setYear(y => y - 1); setMonth(12); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 12) { setYear(y => y + 1); setMonth(1); } else setMonth(m => m + 1); };

  // Calendar grid: always 6 weeks × 7 days
  const firstDow = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells = Array.from({ length: 42 }, (_, i) => {
    const day = i - firstDow + 1;
    return (day >= 1 && day <= daysInMonth) ? day : null;
  });

  const eventsByDay: Record<number, any[]> = {};
  events.forEach((e: any) => {
    const day = parseInt(e.date.slice(8));
    if (!eventsByDay[day]) eventsByDay[day] = [];
    eventsByDay[day].push(e);
  });

  const todayStr = toDateStr(now.getFullYear(), now.getMonth() + 1, now.getDate());

  const openCreate = (day: number) => {
    setEditEvent(null);
    setSelectedDay(day);
    setFormDate(toDateStr(year, month, day));
    setTitle("");
    setColor("bg-primary");
    setStartTime("");
    setEndTime("");
    setShowForm(true);
  };

  const openEdit = (e: any) => {
    setEditEvent(e);
    setTitle(e.title);
    setColor(e.color);
    setFormDate(e.date);
    setStartTime(e.start_time?.slice(0, 5) ?? "");
    setEndTime(e.end_time?.slice(0, 5) ?? "");
    setShowForm(true);
  };

  const handleSubmit = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!title.trim()) return;
    const patch = {
      title: title.trim(),
      color,
      date: formDate,
      start_time: startTime || null,
      end_time: endTime || null,
    };
    if (editEvent) {
      mUpdate.mutate({ id: editEvent.id, patch });
    } else {
      mCreate.mutate(patch);
    }
    setShowForm(false);
  };

  return (
    <PageShell>
      <PageHeader
        title="Calendário"
        subtitle={`${MONTHS_PT[month - 1]} de ${year}`}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={prevMonth} className="size-9 rounded-lg border border-border bg-surface grid place-items-center hover:bg-muted transition-colors">
              <ChevronLeft className="size-4" />
            </button>
            <button onClick={nextMonth} className="size-9 rounded-lg border border-border bg-surface grid place-items-center hover:bg-muted transition-colors">
              <ChevronRight className="size-4" />
            </button>
            <button onClick={() => openCreate(now.getDate())} className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-1.5 hover:bg-primary/90 transition-colors">
              <Plus className="size-4" /> Evento
            </button>
          </div>
        }
      />

      <div className="rounded-2xl border border-border bg-surface overflow-hidden">
        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-border">
          {DAYS.map((d) => (
            <div key={d} className="px-3 py-2.5 text-xs font-medium text-muted-foreground text-center">{d}</div>
          ))}
        </div>

        {/* Grid */}
        {isLoading ? (
          <div className="grid place-items-center h-64">
            <div className="size-6 rounded-full border-2 border-border border-t-primary animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-7">
            {cells.map((day, i) => {
              const isToday = day !== null && toDateStr(year, month, day) === todayStr;
              const dayEvents = day ? (eventsByDay[day] ?? []) : [];
              const isLastRow = i >= 35;
              const isLastCol = (i + 1) % 7 === 0;
              return (
                <div
                  key={i}
                  onClick={() => day && openCreate(day)}
                  className={`min-h-[100px] p-2 border-border cursor-pointer transition-colors
                    ${!isLastRow ? "border-b" : ""}
                    ${!isLastCol ? "border-r" : ""}
                    ${day ? "hover:bg-muted/40" : "bg-muted/10"}
                  `}
                >
                  {day && (
                    <>
                      <div className={`text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full mb-1 ${
                        isToday ? "bg-primary text-primary-foreground" : "text-foreground"
                      }`}>
                        {day}
                      </div>
                      <div className="space-y-0.5">
                        {dayEvents.slice(0, 3).map((e: any) => (
                          <div
                            key={e.id}
                            onClick={(ev) => { ev.stopPropagation(); openEdit(e); }}
                            className={`text-[11px] px-1.5 py-0.5 rounded-md truncate cursor-pointer border-l-2 ${e.color} bg-muted hover:opacity-80 transition-opacity text-foreground`}
                          >
                            {e.start_time && (
                              <span className="text-muted-foreground mr-1">{e.start_time.slice(0, 5)}</span>
                            )}
                            {e.title}
                          </div>
                        ))}
                        {dayEvents.length > 3 && (
                          <div className="text-[10px] text-muted-foreground px-1">+{dayEvents.length - 3} mais</div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="w-full max-w-md bg-background rounded-2xl p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">{editEvent ? "Editar evento" : "Novo evento"}</h2>
              <div className="flex items-center gap-1">
                {editEvent && (
                  <button
                    onClick={() => { mDelete.mutate({ id: editEvent.id }); setShowForm(false); }}
                    className="size-8 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 grid place-items-center transition-colors"
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
                <button onClick={() => setShowForm(false)} className="size-8 rounded-full bg-muted grid place-items-center text-muted-foreground">
                  <X className="size-4" />
                </button>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Título do evento"
                className="w-full h-11 px-4 rounded-xl bg-muted border border-border text-sm outline-none focus:border-primary"
                autoFocus
              />

              <div>
                <label className="text-xs text-muted-foreground mb-2 block">Data</label>
                <input
                  type="date"
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                  className="w-full h-11 px-4 rounded-xl bg-muted border border-border text-sm outline-none focus:border-primary"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-2 block">Início <span className="opacity-60">(opcional)</span></label>
                  <input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="w-full h-11 px-4 rounded-xl bg-muted border border-border text-sm outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-2 block">Fim <span className="opacity-60">(opcional)</span></label>
                  <input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="w-full h-11 px-4 rounded-xl bg-muted border border-border text-sm outline-none focus:border-primary"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-muted-foreground mb-2 block">Cor</label>
                <div className="flex gap-2 flex-wrap">
                  {COLORS.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => setColor(c.value)}
                      title={c.label}
                      className={`size-8 rounded-full ${c.value} transition-all ${color === c.value ? "ring-2 ring-offset-2 ring-foreground/30 scale-110" : "opacity-70 hover:opacity-100"}`}
                    />
                  ))}
                </div>
              </div>

              <button
                type="submit"
                className="w-full h-11 rounded-xl bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-colors"
              >
                {editEvent ? "Salvar" : "Criar evento"}
              </button>
            </form>
          </div>
        </div>
      )}
    </PageShell>
  );
}
