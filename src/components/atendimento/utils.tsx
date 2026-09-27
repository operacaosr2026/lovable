import type { SupportStatus } from "@/lib/atendimento.functions";

export const STATUS_META: Record<SupportStatus, { label: string; cls: string; dot: string }> = {
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

// Lista: hoje → 14:32; ontem → Ontem; senão 12/09.
export function listTime(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(d, now)) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export function fullTime(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
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

// Período do filtro → início/fim (horário local).
export function resolvePeriod(period: string, custom?: { from: string; to: string }) {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(); end.setHours(23, 59, 59, 999);
  const days = (n: number) => { start.setDate(start.getDate() - (n - 1)); };
  switch (period) {
    case "hoje": break;
    case "ontem": start.setDate(start.getDate() - 1); end.setDate(end.getDate() - 1); break;
    case "7d": days(7); break;
    case "mes": start.setDate(1); break;
    case "custom":
      if (custom) {
        return { from: new Date(`${custom.from}T00:00:00`).toISOString(), to: new Date(`${custom.to}T23:59:59.999`).toISOString() };
      }
      days(30); break;
    default: days(30);
  }
  return { from: start.toISOString(), to: end.toISOString() };
}
