// Timezone de referência do negócio (todas as datas/horas "de hoje" e exibições usam este fuso).
export const US_TIME_ZONE = "America/New_York";

export function isoTodayUS(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: US_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
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
