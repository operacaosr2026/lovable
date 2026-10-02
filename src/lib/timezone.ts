// Timezone de referência do negócio (todas as datas/horas "de hoje" e exibições usam este fuso).
export const US_TIME_ZONE = "America/New_York";

export function isoTodayUS(): string {
  return isoDateUS(new Date());
}

// Dia (YYYY-MM-DD) de um instante no fuso de Nova York.
export function isoDateUS(date: Date | string | number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: US_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date instanceof Date ? date : new Date(date));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}`;
}

export function isoMonthStartUS(): string {
  const today = isoTodayUS();
  return `${today.slice(0, 7)}-01`;
}

export function formatDateTimeUS(date: Date | string | number, opts: Intl.DateTimeFormatOptions = {}) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleString("pt-BR", { ...opts, timeZone: US_TIME_ZONE });
}

export function formatDateUS(date: Date | string | number, opts: Intl.DateTimeFormatOptions = {}) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleDateString("pt-BR", { ...opts, timeZone: US_TIME_ZONE });
}

// Lê o ano/mês/dia LOCAIS de um Date (ex: o dia que o usuário clicou num
// calendário, sempre criado à meia-noite local pelo react-day-picker) como
// "YYYY-MM-DD" — sem passar por toISOString(), que converte pra UTC e pode
// "voltar" um dia inteiro pra quem está num fuso positivo (Europa/Ásia).
export function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ─── Horário de Nova York (com horário de verão) ───────────────────────────────
// O servidor (Vercel) roda em UTC e o navegador no fuso de quem abre: nenhum dos
// dois é NY. Estas funções fazem a conta sempre no fuso do negócio.

const nyFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: US_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", weekday: "short",
});
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Partes de um instante em NY: dia (YYYY-MM-DD), hora, minuto e dia da semana (0 = domingo).
export function nyParts(date: Date | string | number) {
  const ms = date instanceof Date ? date.getTime() : typeof date === "number" ? date : Date.parse(date);
  const p = nyFmt.formatToParts(new Date(ms));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return {
    iso: `${g("year")}-${g("month")}-${g("day")}`,
    year: Number(g("year")), month: Number(g("month")), day: Number(g("day")),
    hour: Number(g("hour")), minute: Number(g("minute")), second: Number(g("second")),
    weekday: WEEKDAYS.indexOf(g("weekday")),
    hm: `${g("hour")}:${g("minute")}`,
  };
}

// Diferença (ms) entre o relógio de NY e o UTC naquele instante (−4h no verão, −5h no inverno).
function nyOffsetMs(ms: number) {
  const p = nyParts(ms);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

// Instante de um horário de parede em NY: nyWallTime("2026-10-02", "09:00") = 9h em Nova York.
export function nyWallTime(isoDay: string, hm = "00:00"): Date {
  const [y, m, d] = isoDay.split("-").map(Number);
  const [h, mi] = hm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, h || 0, mi || 0);
  let t = guess - nyOffsetMs(guess);
  const again = guess - nyOffsetMs(t);   // virada do horário de verão
  if (again !== t) t = again;
  return new Date(t);
}

export function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Início (00:00) e fim (23:59:59.999) de um dia de NY, como instantes.
export function nyStartOfDay(isoDay: string): Date { return nyWallTime(isoDay, "00:00"); }
export function nyEndOfDay(isoDay: string): Date { return new Date(nyWallTime(addDaysIso(isoDay, 1), "00:00").getTime() - 1); }

export function formatTimeUS(date: Date | string | number) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: US_TIME_ZONE });
}
