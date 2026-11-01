import { describe, expect, it } from "vitest";
import { compareToBase, deriveMetrics, EMPTY_COUNTS, sumCounts } from "@/lib/experiment-metrics";
import { parseClarity } from "@/lib/clarity-parse";
import { splitUtm } from "@/lib/utm";

describe("splitUtm", () => {
  it("separa nome e id no padrão novo", () => {
    expect(splitUtm("L5_LUMINARIA_ABO|120210000000001")).toEqual({ name: "L5_LUMINARIA_ABO", id: "120210000000001" });
  });
  it("UTM antiga (só nome) volta sem id", () => {
    expect(splitUtm("Campanha teste")).toEqual({ name: "Campanha teste", id: null });
    expect(splitUtm(null)).toEqual({ name: "", id: null });
  });
  it("texto depois do | que não é número não vira id", () => {
    expect(splitUtm("A|B")).toEqual({ name: "A", id: null });
  });
});

describe("deriveMetrics", () => {
  it("calcula as taxas a partir das contagens", () => {
    const m = deriveMetrics({ ...EMPTY_COUNTS, spend: 100, impressions: 10000, clicks: 200, lpv: 150, ic: 30, purchases_meta: 4, purchases_shop: 5, revenue: 250 });
    expect(m.cpm).toBe(10);
    expect(m.ctr).toBe(2);
    expect(m.cpc).toBe(0.5);
    expect(m.arrival_rate).toBe(75);
    expect(m.desire_rate).toBe(20);
    expect(m.cpa_meta).toBe(25);
    expect(m.cpa_real).toBe(20);
    expect(m.roas_real).toBe(2.5);
    expect(m.cvr_real).toBeCloseTo(3.333, 2);
  });
  it("divisão por zero vira null", () => {
    const m = deriveMetrics(EMPTY_COUNTS);
    expect(m.cpm).toBeNull();
    expect(m.cpa_real).toBeNull();
    expect(m.sessions).toBeNull();
  });
  it("média do Clarity no total é ponderada pelas sessões", () => {
    const a = { ...EMPTY_COUNTS, c_sessions: 100, c_scroll: 100 * 40, c_scroll_n: 100 };
    const b = { ...EMPTY_COUNTS, c_sessions: 300, c_scroll: 300 * 80, c_scroll_n: 300 };
    expect(deriveMetrics(sumCounts([a, b])).scroll_depth).toBe(70);
  });
});

describe("compareToBase", () => {
  it("CPA menor que a base é melhora", () => {
    expect(compareToBase(20, 25, "down")).toEqual({ change: -20, good: true });
  });
  it("CTR menor que a base é piora", () => {
    expect(compareToBase(1.5, 2, "up")).toEqual({ change: -25, good: false });
  });
  it("sem base não compara", () => {
    expect(compareToBase(10, undefined, "up")).toBeNull();
  });
});

describe("parseClarity", () => {
  it("junta as métricas da mesma campanha + conjunto e desconta os bots", () => {
    const rows = parseClarity([
      { metricName: "Traffic", information: [{ totalSessionCount: "120", totalBotSessionCount: "20", Campaign: "C|1", Medium: "A|2" }] },
      { metricName: "Scroll Depth", information: [{ averageScrollDepth: 55.5, Campaign: "C|1", Medium: "A|2" }] },
      { metricName: "RageClickCount", information: [{ sessionsWithMetricPercentage: 3, Campaign: "C|1", Medium: "A|2" }] },
      { metricName: "Traffic", information: [{ totalSessionCount: "9", OS: "Other" }] },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ campaign: "C|1", medium: "A|2", sessions: 100, scroll: 55.5, rage: 3, time: null });
  });
  it("resposta inválida vira lista vazia", () => {
    expect(parseClarity(null)).toEqual([]);
    expect(parseClarity({ error: "x" })).toEqual([]);
  });
});
