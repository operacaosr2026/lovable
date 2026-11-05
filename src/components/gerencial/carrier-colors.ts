// Cor de cada transportadora (selo das tabelas e linha do gráfico) — usada na
// aba Transportadoras e no Rastreamento local.
export const CARRIER_COLOR: Record<string, { hex: string; badge: string; short: string }> = {
  ZS: { hex: "#10b981", badge: "bg-emerald-500/10 text-emerald-600", short: "ZS" },
  TRF: { hex: "#3b82f6", badge: "bg-blue-500/10 text-blue-600", short: "TRF" },
  JCZ: { hex: "#8b5cf6", badge: "bg-violet-500/10 text-violet-600", short: "JC" },
  JXCZ: { hex: "#f97316", badge: "bg-orange-500/10 text-orange-600", short: "SH" },
  LZ: { hex: "#d946ef", badge: "bg-fuchsia-500/10 text-fuchsia-600", short: "LZ" },
  YTTG: { hex: "#0ea5e9", badge: "bg-sky-500/10 text-sky-600", short: "YT" },
  OUTRAS: { hex: "#94a3b8", badge: "bg-muted text-muted-foreground", short: "?" },
};
export const colorOf = (key: string) => CARRIER_COLOR[key] ?? CARRIER_COLOR.OUTRAS;
