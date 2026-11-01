// Leitura da resposta da Clarity Data Export API (dimensões Campaign + Medium).
// Separado do clarity.server.ts pra poder ser testado sem banco.

// Valores por linha (campanha + conjunto). Percentuais em % das sessões.
export type ClarityRow = {
  campaign: string; medium: string;
  sessions: number; time: number | null; scroll: number | null;
  quickback: number | null; rage: number | null; dead: number | null; errors: number | null;
};

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const pick = (o: Record<string, unknown>, keys: string[]) => {
  for (const k of keys) { const n = num(o[k]); if (n !== null) return n; }
  return null;
};
const PCT_KEYS = ["sessionsWithMetricPercentage", "SessionsWithMetricPercentage"];

// A documentação só mostra os campos de "Traffic"; os outros nomes são os que
// a API costuma devolver, lidos com alternativas. A resposta crua fica salva.
export function parseClarity(raw: unknown): ClarityRow[] {
  const rows = new Map<string, ClarityRow>();
  if (!Array.isArray(raw)) return [];
  for (const metric of raw as any[]) {
    const name = String(metric?.metricName ?? "").toLowerCase().replace(/[\s_]/g, "");
    for (const info of (metric?.information ?? []) as Record<string, unknown>[]) {
      const campaign = String(info.Campaign ?? info.campaign ?? "").trim();
      const medium = String(info.Medium ?? info.medium ?? "").trim();
      if (!campaign) continue;
      const key = `${campaign}\u0000${medium}`;
      const r = rows.get(key) ?? { campaign, medium, sessions: 0, time: null, scroll: null, quickback: null, rage: null, dead: null, errors: null };
      rows.set(key, r);
      if (name === "traffic") {
        const total = pick(info, ["totalSessionCount"]) ?? 0;
        const bots = pick(info, ["totalBotSessionCount"]) ?? 0;
        r.sessions = Math.max(0, total - bots);
      } else if (name === "engagementtime") r.time = pick(info, ["activeTime", "averageActiveTime", "totalTime"]);
      else if (name === "scrolldepth") r.scroll = pick(info, ["averageScrollDepth", "scrollDepth"]);
      else if (name === "quickbackclick") r.quickback = pick(info, PCT_KEYS);
      else if (name === "rageclickcount") r.rage = pick(info, PCT_KEYS);
      else if (name === "deadclickcount") r.dead = pick(info, PCT_KEYS);
      else if (name === "scripterrorcount") r.errors = pick(info, PCT_KEYS);
    }
  }
  return [...rows.values()];
}
