import { describe, expect, it } from "vitest";
import { buildSeasonPlan, nthWeekday, seasonStatus, seasonsOf, seasonsToPrepare, upcomingSeasons, type Baseline } from "./strategy-plan";

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
    expect(keys.slice(0, 3)).toEqual(["valentines-2027", "maes-2027", "pais-2027"]);
    expect(keys.some((k) => k.startsWith("memorial") || k.startsWith("labor"))).toBe(false);
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
  it("produto sazonal novo: sem histórico de produto nem meta automática", () => {
    const val = seasonsOf(2027).find((s) => s.key === "valentines-2027")!;
    const p = buildSeasonPlan(val, { ...base, today: "2026-11-27" }, null, { mode: "novo", revenueTarget: 15000 });
    expect(p.plan_key).toBe("valentines-2027");
    expect(p.krs.every((k) => !k.metric)).toBe(true);
    expect(p.krs.find((k) => k.unit === "usd")?.target_value).toBe(15000);
    expect(p.initiatives.some((i) => i.notes.includes("A"))).toBe(true);
    expect(p.initiatives.map((i) => i.title)).toContain("Testar o produto com orçamento baixo");
    expect(JSON.stringify(p.initiatives)).not.toContain("mais vendem");
    const semMeta = buildSeasonPlan(val, base, null, { mode: "novo" });
    expect(semMeta.krs.some((k) => k.unit === "usd")).toBe(false);
  });
  it("alerta de preparo: Father's Day 2027 avisa a partir de 22/03 e para quando a campanha abre", () => {
    const has = (today: string, planned = new Set<string>()) => seasonsToPrepare(today, planned).some((x) => x.season.key === "pais-2027");
    expect(has("2027-03-21")).toBe(false);
    expect(has("2027-03-22")).toBe(true);
    expect(seasonsToPrepare("2027-03-22", new Set()).find((x) => x.season.key === "pais-2027")?.daysSincePrep).toBe(0);
    expect(has("2027-05-29")).toBe(true);   // campanha (21 dias) abre 30/05
    expect(has("2027-05-30")).toBe(false);
    expect(has("2027-04-01", new Set(["pais-2027"]))).toBe(false); // plano montado
  });
});
