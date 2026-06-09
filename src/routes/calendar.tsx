import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, PageShell } from "@/components/PageHeader";
import { ChevronLeft, ChevronRight, Plus, X, Trash2, Users, Bell } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listCalendarEvents, listCalendarEventsToday,
  createCalendarEvent, deleteCalendarEvent, updateCalendarEvent,
} from "@/lib/calendar.functions";
import { listWorkspace } from "@/lib/members.functions";
import { requireAuth } from "@/lib/route-guards";
import { toast } from "sonner";

export const Route = createFileRoute("/calendar")({
  beforeLoad: requireAuth,
  head: () => ({ meta: [{ title: "Calendário — SRX Growth" }] }),
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
  const [editEvent, setEditEvent] = useState<any | null>(null);
  const [title, setTitle] = useState("");
  const [color, setColor] = useState("bg-primary");
  const [formDate, setFormDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const alerted = useRef<Set<string>>(new Set());

  const qc = useQueryClient();
  const listFn = useServerFn(listCalendarEvents);
  const listTodayFn = useServerFn(listCalendarEventsToday);
  const createFn = useServerFn(createCalendarEvent);
  const deleteFn = useServerFn(deleteCalendarEvent);
  const updateFn = useServerFn(updateCalendarEvent);
  const listWsFn = useServerFn(listWorkspace);

  const qKey = ["calendar", year, month];
  const { data: events = [], isLoading } = useQuery({
    queryKey: qKey,
    queryFn: () => listFn({ data: { year, month } }),
  });

  const { data: todayEvents = [] } = useQuery({
    queryKey: ["calendar-today"],
    queryFn: () => listTodayFn(),
    refetchInterval: 60_000,
  });

  const { data: wsData } = useQuery({
    queryKey: ["workspace"],
    queryFn: () => listWsFn(),
  });
  const members: { member_id: string; full_name?: string; email?: string }[] = wsData?.members ?? [];

  // Reminder: fires 30 min before and exactly at start_time
  useEffect(() => {
    const check = () => {
      const now = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes();
      (todayEvents as any[]).forEach((e: any) => {
        if (!e.start_time) return;
        const [h, m] = e.start_time.slice(0, 5).split(":").map(Number);
        const eventMin = h * 60 + m;
        const key30 = e.id + ":30:" + e.start_time;
        const key0  = e.id + ":0:"  + e.start_time;
        if (eventMin - nowMin === 30 && !alerted.current.has(key30)) {
          alerted.current.add(key30);
          toast(`⏰ ${e.title}`, {
            description: `Começa em 30 minutos, às ${e.start_time.slice(0, 5)}`,
            duration: 12_000,
          });
        }
        if (eventMin === nowMin && !alerted.current.has(key0)) {
          alerted.current.add(key0);
          toast(`🔔 ${e.title}`, {
            description: `Evento começando agora às ${e.start_time.slice(0, 5)}`,
            duration: 12_000,
          });
        }
      });
    };
    check();
    const id = setInterval(check, 60_000);
    return () => clearInterval(id);
  }, [todayEvents]);

  const inv = () => {
    qc.invalidateQueries({ queryKey: qKey });
    qc.invalidateQueries({ queryKey: ["calendar-today"] });
  };
  const mCreate = useMutation({ mutationFn: (d: any) => createFn({ data: d }), onSuccess: inv });
  const mDelete = useMutation({ mutationFn: (d: any) => deleteFn({ data: d }), onSuccess: inv });
  const mUpdate = useMutation({ mutationFn: (d: any) => updateFn({ data: d }), onSuccess: inv });

  const prevMonth = () => { if (month === 1) { setYear(y => y - 1); setMonth(12); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 12) { setYear(y => y + 1); setMonth(1); } else setMonth(m => m + 1); };

  const firstDow = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells = Array.from({ length: 42 }, (_, i) => {
    const day = i - firstDow + 1;
    return (day >= 1 && day <= daysInMonth) ? day : null;
  });

  const eventsByDay: Record<number, any[]> = {};
  (events as any[]).forEach((e: any) => {
    const day = parseInt(e.date.slice(8));
    if (!eventsByDay[day]) eventsByDay[day] = [];
    eventsByDay[day].push(e);
  });

  const todayStr = toDateStr(now.getFullYear(), now.getMonth() + 1, now.getDate());

  const openCreate = (day: number) => {
    setEditEvent(null);
    setFormDate(toDateStr(year, month, day));
    setTitle(""); setColor("bg-primary"); setStartTime(""); setEndTime(""); setMemberIds([]);
    setShowForm(true);
  };

  const openEdit = (e: any) => {
    setEditEvent(e);
    setTitle(e.title);
    setColor(e.color);
    setFormDate(e.date);
    setStartTime(e.start_time?.slice(0, 5) ?? "");
    setEndTime(e.end_time?.slice(0, 5) ?? "");
    setMemberIds(e.member_ids ?? []);
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
      member_ids: memberIds,
    };
    if (editEvent) {
      mUpdate.mutate({ id: editEvent.id, patch });
    } else {
      mCreate.mutate(patch);
    }
    setShowForm(false);
  };

  const toggleMember = (id: string) => {
    setMemberIds(prev => prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]);
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
        <div className="grid grid-cols-7 border-b border-border">
          {DAYS.map((d) => (
            <div key={d} className="px-3 py-2.5 text-xs font-medium text-muted-foreground text-center">{d}</div>
          ))}
        </div>

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
                            className={`text-[11px] px-1.5 py-0.5 rounded-md truncate cursor-pointer border-l-2 ${e.color} bg-muted hover:opacity-80 transition-opacity text-foreground flex items-center gap-1`}
                          >
                            {e.start_time && (
                              <span className="text-muted-foreground">{e.start_time.slice(0, 5)}</span>
                            )}
                            <span className="truncate flex-1">{e.title}</span>
                            {(e.member_ids?.length > 0) && (
                              <Users className="size-2.5 text-muted-foreground shrink-0" />
                            )}
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
          <div className="w-full max-w-md bg-background rounded-2xl p-4 space-y-3 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">{editEvent ? "Editar evento" : "Novo evento"}</h2>
              <div className="flex items-center gap-1">
                {editEvent && (
                  <button
                    onClick={() => { mDelete.mutate({ id: editEvent.id }); setShowForm(false); }}
                    className="size-8 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 grid place-items-center"
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
                <button onClick={() => setShowForm(false)} className="size-8 rounded-full bg-muted grid place-items-center text-muted-foreground">
                  <X className="size-4" />
                </button>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Título do evento"
                className="w-full h-10 px-3.5 rounded-xl bg-muted border border-border text-sm outline-none focus:border-primary"
                autoFocus
              />

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[11px] text-muted-foreground mb-1 block">Data</label>
                  <input
                    type="date"
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    className="w-full h-10 px-2 rounded-xl bg-muted border border-border text-xs outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground mb-1 block">Início</label>
                  <input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="w-full h-10 px-2 rounded-xl bg-muted border border-border text-xs outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground mb-1 block">Fim</label>
                  <input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="w-full h-10 px-2 rounded-xl bg-muted border border-border text-xs outline-none focus:border-primary"
                  />
                </div>
              </div>

              {/* Member picker */}
              <div>
                <label className="text-[11px] text-muted-foreground mb-1.5 flex items-center gap-1.5 block">
                  <Users className="size-3.5" /> Convidar membros
                </label>
                {members.length === 0 ? (
                  <div className="px-3 py-2 rounded-xl bg-muted text-xs text-muted-foreground">
                    Nenhum membro no workspace
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {members.map((m) => {
                      const selected = memberIds.includes(m.member_id);
                      return (
                        <button
                          key={m.member_id}
                          type="button"
                          onClick={() => toggleMember(m.member_id)}
                          title={m.full_name || m.email}
                          className={`flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full border text-xs transition-colors ${
                            selected
                              ? "bg-primary/10 border-primary text-primary"
                              : "bg-muted border-border text-muted-foreground hover:bg-muted/80"
                          }`}
                        >
                          <span className="size-6 rounded-full gradient-primary grid place-items-center text-white text-[10px] font-bold shrink-0">
                            {(m.full_name || m.email || "?").slice(0, 2).toUpperCase()}
                          </span>
                          <span className="max-w-[100px] truncate">{m.full_name || m.email}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div>
                <label className="text-[11px] text-muted-foreground mb-1.5 block">Cor</label>
                <div className="flex gap-2 flex-wrap">
                  {COLORS.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => setColor(c.value)}
                      title={c.label}
                      className={`size-7 rounded-full ${c.value} transition-all ${color === c.value ? "ring-2 ring-offset-2 ring-foreground/30 scale-110" : "opacity-70 hover:opacity-100"}`}
                    />
                  ))}
                </div>
              </div>

              <button
                type="submit"
                className="w-full h-10 rounded-xl bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-colors"
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
