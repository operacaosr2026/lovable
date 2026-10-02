import { US_TIME_ZONE, addDaysIso, formatTimeUS, isoDateUS, isoTodayUS, nyEndOfDay, nyStartOfDay } from "@/lib/timezone";
import type { SupportStatus } from "@/lib/atendimento.functions";

export const STATUS_META: Record<SupportStatus, { label: string; cls: string; dot: string }> = {
  novo:               { label: "Novo",               cls: "bg-sky-500/10 text-sky-600 dark:text-sky-400",        dot: "bg-sky-500" },
  em_atendimento:     { label: "Em atendimento",     cls: "bg-primary/10 text-primary",                          dot: "bg-primary" },
  resolvido:          { label: "Resolvido",          cls: "bg-success/15 text-success",                          dot: "bg-success" },
};

const AVATAR_TONES = [
  "bg-rose-500/15 text-rose-600 dark:text-rose-400",
  "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  "bg-pink-500/15 text-pink-600 dark:text-pink-400",
  "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400",
];

export function displayName(name: string | null | undefined, email: string) {
  return (name && name.trim()) || email.split("@")[0];
}

export function initials(name: string | null | undefined, email: string) {
  const n = displayName(name, email).replace(/[^\p{L}\p{N} ]/gu, " ").trim();
  const parts = n.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : parts[0]?.[1] ?? "")).toUpperCase();
}

export function Avatar({ name, email, size = "md" }: { name: string | null | undefined; email: string; size?: "sm" | "md" | "lg" }) {
  let h = 0;
  for (const ch of email) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const dim = size === "lg" ? "size-12 text-sm" : size === "sm" ? "size-8 text-[11px]" : "size-9 text-xs";
  return (
    <div className={`${dim} rounded-full grid place-items-center font-semibold shrink-0 ${AVATAR_TONES[h % AVATAR_TONES.length]}`}>
      {initials(name, email)}
    </div>
  );
}

// Lista: hoje → 14:32; ontem → Ontem; senão 12/09 (tudo no horário de Nova York).
export function listTime(iso: string | null) {
  if (!iso) return "";
  const day = isoDateUS(iso), today = isoTodayUS();
  if (day === today) return formatTimeUS(iso);
  if (day === addDaysIso(today, -1)) return "Ontem";
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

export function fullTime(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: US_TIME_ZONE });
}

export function formatDuration(ms: number | null) {
  if (ms == null) return "—";
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h}h ${String(min % 60).padStart(2, "0")}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function formatMoney(v: number, currency: string) {
  try {
    return v.toLocaleString("pt-BR", { style: "currency", currency });
  } catch {
    return `${currency} ${v.toFixed(2)}`;
  }
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

// Período do filtro → início/fim (dias de Nova York).
export function resolvePeriod(period: string, custom?: { from: string; to: string }) {
  const today = isoTodayUS();
  let from = addDaysIso(today, -29), to = today;
  switch (period) {
    case "hoje": from = today; break;
    case "ontem": from = to = addDaysIso(today, -1); break;
    case "7d": from = addDaysIso(today, -6); break;
    case "mes": from = `${today.slice(0, 7)}-01`; break;
    case "custom": if (custom) { from = custom.from; to = custom.to; } break;
  }
  return { from: nyStartOfDay(from).toISOString(), to: nyEndOfDay(to).toISOString() };
}
