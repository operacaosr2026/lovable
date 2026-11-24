import { describe, expect, it } from "vitest";
import { codesIn, customCodes, fromOldLevels, renderName } from "@/lib/naming";
import { buildPlan } from "@/lib/ad-plan";

describe("renderName", () => {
  it("troca os códigos", () => {
    expect(renderName("{{produto}} - {{estrutura}} - #{{numero}}", { produto: "Bolsa", estrutura: "CBO", numero: "4" })).toBe("Bolsa - CBO - #4");
  });
  it("limpa separadores de código vazio", () => {
    expect(renderName("{{produto}} - {{angulo}} - {{data}}", { produto: "Bolsa", data: "23/11" })).toBe("Bolsa - 23/11");
    expect(renderName("{{a}}_{{b}}_{{c}}", { a: "A", c: "C" })).toBe("A_C");
    expect(renderName("{{a}} - {{b}}", { b: "B" })).toBe("B");
    expect(renderName("{{p}} #{{numero}}", { p: "X" })).toBe("X");
  });
  it("tira | (separa nome e id na UTM)", () => {
    expect(renderName("{{a}}", { a: "x|y" })).toBe("x-y");
  });
  it("aceita espaço e maiúscula no código", () => {
    expect(renderName("{{ Produto }}", { produto: "Bolsa" })).toBe("Bolsa");
  });
});

describe("códigos", () => {
  it("acha códigos e os inventados", () => {
    expect(codesIn("{{produto}} {{angulo}} {{produto}}")).toEqual(["produto", "angulo"]);
    expect(customCodes({ campaign: "{{produto}} {{angulo}}", adset: "{{publico}}", ad: "{{nome_do_criativo}}" })).toEqual(["angulo", "publico"]);
  });
  it("converte o modelo antigo", () => {
    const t = fromOldLevels("_", { campaign: [{ id: "produto", label: "Produto" }, { id: "x1", label: "Ângulo" }], ad: [{ id: "criativo", label: "Criativo" }] });
    expect(t.campaign).toBe("{{produto}}_{{angulo}}");
    expect(t.ad).toBe("{{nome_do_criativo}}");
    expect(t.adset).toBe("");
  });
});

describe("buildPlan", () => {
  const templates = { campaign: "{{produto}} - {{estrutura}}", adset: "{{numero_conjunto}} - {{nome_do_criativo}}", ad: "{{nome_do_criativo}} - {{formato}}" };
  const creatives = [
    { id: "1", name: "video-a.mp4", kind: "video" as const },
    { id: "2", name: "foto-b.jpg", kind: "image" as const },
  ];
  const values = { produto: "Bolsa", estrutura: "CBO" };

  it("1 conjunto por criativo", () => {
    const p = buildPlan({ creatives, distribution: "per_creative", multiFormat: "flexible", templates, values });
    expect(p.campaign_name).toBe("Bolsa - CBO");
    expect(p.adsets.map((s) => s.name)).toEqual(["01 - video-a", "02 - foto-b"]);
    expect(p.adsets[1].ads[0]).toMatchObject({ name: "foto-b - IMG", format: "single", creative_ids: ["2"] });
  });
  it("todos num conjunto", () => {
    const p = buildPlan({ creatives, distribution: "together", multiFormat: "flexible", templates, values });
    expect(p.adsets).toHaveLength(1);
    expect(p.adsets[0].ads.map((a) => a.name)).toEqual(["video-a - VID", "foto-b - IMG"]);
  });
  it("1 anúncio com vários criativos", () => {
    const p = buildPlan({ creatives, distribution: "single_ad", multiFormat: "carousel", templates, values });
    expect(p.adsets[0].ads).toHaveLength(1);
    expect(p.adsets[0].ads[0]).toMatchObject({ format: "carousel", creative_ids: ["1", "2"], name: "video-a + foto-b - CAR" });
  });
  it("nome editado à mão vale", () => {
    const p = buildPlan({ creatives, distribution: "together", multiFormat: "flexible", templates, values, overrides: { campaign: "Minha", s0a1: "Outro" } });
    expect(p.campaign_name).toBe("Minha");
    expect(p.adsets[0].ads[1].name).toBe("Outro");
  });
  it("{{pasta}} separa o mesmo nome de criativo em pastas diferentes", () => {
    const cs = [
      { id: "a", name: "AD1", kind: "video" as const, folder: "Preto" },
      { id: "b", name: "AD1", kind: "video" as const, folder: "Branco" },
    ];
    const t = { ...templates, ad: "{{nome_do_criativo}}_{{pasta}}" };
    const names = buildPlan({ creatives: cs, distribution: "together", multiFormat: "flexible", templates: t, values }).adsets[0].ads.map((a) => a.name);
    expect(names).toEqual(["AD1_Preto", "AD1_Branco"]);
    const multi = buildPlan({ creatives: cs, distribution: "single_ad", multiFormat: "flexible", templates: t, values }).adsets[0].ads[0].name;
    expect(multi).toBe("AD1 + AD1_Preto + Branco");
  });
  it("sem criativos, sem conjuntos", () => {
    expect(buildPlan({ creatives: [], distribution: "single_ad", multiFormat: "flexible", templates, values }).adsets).toEqual([]);
  });
});
