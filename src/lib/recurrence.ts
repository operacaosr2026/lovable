import { addDaysIso, nyParts, nyWallTime } from "@/lib/timezone";

export type RecurrenceFrequency = "daily" | "weekly" | "monthly" | "custom";

// Próxima ocorrência de uma rotina/tarefa recorrente, no horário de Nova York
// (o servidor roda em UTC: setHours/getDay daqui dariam o dia/hora errados).
// time "HH:MM" = horário em NY; sem time, mantém o horário da ocorrência atual.
export function computeNextDueAt(
  current: string | null,
  frequency: RecurrenceFrequency,
  weekdays: number[],
  time: string | null,
): string {
  const base = nyParts(current ? Date.parse(current) : Date.now());
  let day = base.iso;
  if (frequency === "daily") day = addDaysIso(day, 1);
  else if (frequency === "weekly") day = addDaysIso(day, 7);
  else if (frequency === "monthly") {
    const d = new Date(Date.UTC(base.year, base.month, 1));            // 1º do mês seguinte
    const last = new Date(Date.UTC(base.year, base.month + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(base.day, last));
    day = d.toISOString().slice(0, 10);
  } else {
    const days = (weekdays ?? []).filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);
    let delta = 1;
    if (days.length) {
      delta = 7;
      for (const d of days) { const diff = (d - base.weekday + 7) % 7 || 7; if (diff < delta) delta = diff; }
    }
    day = addDaysIso(day, delta);
  }
  const hm = time && /^\d{2}:\d{2}$/.test(time) ? time : base.hm;
  return nyWallTime(day, hm).toISOString();
}
