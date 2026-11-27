import { describe, expect, it } from "vitest";
import { buildSeasonPlan, nthWeekday, seasonStatus, seasonsOf, upcomingSeasons, type Baseline } from "./strategy-plan";

const base: Baseline = {
  today: "2026-11-27", revenue30: 66_000, orders30: 650, ticket: 100, dailyRevenue: 2_200, refundRate: 0.08,
  deliveryMedian: 17.5, deliveryP80: 21.5, deliverySample: 900, repeatRate: 0.04, customers: 2700,
  chargebacks90: 10, orders90: 1500, topProducts: [{ name: "A", sold: 100, refundRate: 0.05 }], riskyProducts: [],
};

describe("datas sazonais (EUA)", () => {
  it("feriados móveis", () => {
    expect(nthWeekday(2026, 11, 4, 4)).toBe("2026-11-26"); // Thanksgiving
    expect(nthWeekday(2027, 5, 0, 2)).toBe("2027-05-09");  // Mother's Day
    expect(nthWeekday(2027, 6, 0, 3)).toBe("2027-06-20");  // Father's Day
    expect(nthWeekday(2027, 5, 1, -1)).toBe("2027-05-31"); // Memorial Day
    expect(nthWeekday(2027, 9, 1, 1)).toBe("2027-09-06");  // Labor Day
    const bf = seasonsOf(2026).find((s) => s.key === "bfcm-2026")!;
    expect([bf.date, bf.end]).toEqual(["2026-11-27", "2026-11-30"]);
  });
  it("data com a campanha já começada sai da lista (Black Friday e Natal em 27/11)", () => {
    const keys = upcomingSeasons("2026-11-27").map((s) => s.key);
    expect(keys.slice(0, 3)).toEqual(["valentines-2027", "maes-2027", "memorial-2027"]);
    expect(upcomingSeasons("2026-11-19")[0].key).toBe("bfcm-2026"); // campanha da BF começa 20/11
  });
  it("limite de entrega do Natal = data − 80% do prazo", () => {
    const natal = seasonsOf(2026).find((s) => s.key === "natal-2026")!;
    const st = seasonStatus(natal, base, "2026-11-27");
    expect(st.cutoff).toBe("2026-12-03");
    expect(st.phase).toBe("campanha");
    const val = seasonsOf(2027).find((s) => s.key === "valentines-2027")!;
    expect(seasonStatus(val, base, "2026-11-27").phase).toBe("preparar"); // 79 dias antes
  });
  it("plano: meta = venda diária × alta × dias; tarefas em ordem de prazo", () => {
    const natal = seasonsOf(2026).find((s) => s.key === "natal-2026")!;
    const p = buildSeasonPlan(natal, base, { margem: 0.2, cpa: 30, anuncios: null, lucro: null });
    expect(p.krs[0].target_value).toBe(Math.round(2_200 * 1.6 * 30));
    expect(p.initiatives.map((i) => i.due_date)).toEqual([...p.initiatives.map((i) => i.due_date)].sort());
    expect(p.initiatives.some((i) => i.due_date === "2026-12-03")).toBe(true);
  });
});
