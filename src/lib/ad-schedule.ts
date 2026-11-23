// Atribuição, ciclo de vida do cliente e início do conjunto (Lançamentos).

export const ATTRIBUTIONS = {
  default: { label: "7 dias após clique, 1 dia após visualização e 1 dia após visualização engajada (padrão)", spec: [["CLICK_THROUGH", 7], ["VIEW_THROUGH", 1], ["ENGAGED_VIDEO_VIEW", 1]] },
  c7v1: { label: "7 dias após clique e 1 dia após visualização", spec: [["CLICK_THROUGH", 7], ["VIEW_THROUGH", 1]] },
  c7: { label: "7 dias após clique", spec: [["CLICK_THROUGH", 7]] },
  c1v1: { label: "1 dia após clique e 1 dia após visualização", spec: [["CLICK_THROUGH", 1], ["VIEW_THROUGH", 1]] },
  c1: { label: "1 dia após clique", spec: [["CLICK_THROUGH", 1]] },
} as const;
export type Attribution = keyof typeof ATTRIBUTIONS;
export const ATTRIBUTION_KEYS = Object.keys(ATTRIBUTIONS) as [Attribution, ...Attribution[]];

export const attributionSpec = (a: Attribution) =>
  ATTRIBUTIONS[a].spec.map(([event_type, window_days]) => ({ event_type, window_days }));

// Estratégia de ciclo de vida do cliente (ad_set_goal.type na Meta).
export const LIFECYCLES = {
  all: { label: "Todos os clientes", help: "Mostra para qualquer pessoa, cliente ou não.", type: 0 },
  new: { label: "Só clientes novos", help: "Tira quem já comprou de você.", type: 2 },
  new_unengaged: { label: "Novos, sem os engajados", help: "Tira quem já comprou e quem já interagiu com a marca.", type: 1 },
} as const;
export type Lifecycle = keyof typeof LIFECYCLES;
export const LIFECYCLE_KEYS = Object.keys(LIFECYCLES) as [Lifecycle, ...Lifecycle[]];
// "Já comprou" = comprou nesses últimos dias (exclusão automática da Meta).
export const RETENTION_DAYS = [30, 60, 90, 180, 730] as const;

export function adSetGoal(l: Lifecycle, retentionDays: number) {
  const type = LIFECYCLES[l].type;
  return type === 0 ? { type } : { type, existing_customers_auto_exclusion_retention_days: retentionDays };
}

// "2026-11-24T08:00" no fuso da conta (ex.: America/New_York) → "2026-11-24T08:00:00-05:00".
export function zonedToIso(local: string, timeZone: string): string {
  const [d, t = "00:00"] = local.split("T");
  const [y, mo, da] = d.split("-").map(Number);
  const [h, mi] = t.split(":").map(Number);
  const asUtc = Date.UTC(y, mo - 1, da, h, mi);
  const offsetMin = (at: number) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(new Date(at)).reduce<Record<string, number>>((o, p) => (p.type !== "literal" ? { ...o, [p.type]: Number(p.value) } : o), {});
    return (Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - at) / 60000;
  };
  // Duas passadas acertam o horário de verão.
  let off = offsetMin(asUtc);
  off = offsetMin(asUtc - off * 60000);
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d}T${pad(h)}:${pad(mi)}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}
