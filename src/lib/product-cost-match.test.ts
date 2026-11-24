import { describe, expect, it } from "vitest";
import { orderLineItemsCost, matchLineItemCost, type CostProduct } from "@/lib/product-cost-match";

// Regras 1–9: custo do fornecedor de um pedido.
const products: CostProduct[] = [
  { name: "Air 1 Low Georgetown", shopify_product_ids: ["101"], line_item_titles: ["adidas samba og"], cost: 38 },
  { name: "Air Force 1 Low Cheetah Print", shopify_product_ids: ["102", "202"], cost: 50 },
  { name: "Handball Spezial", shopify_product_ids: ["103"], cost: 38, history: [
    { from: "2026-10-11", cost: 40 },
    { from: "1900-01-01", cost: 38 },
  ] },
];
// product_id da Shopify de cada título usado nos testes (Leopard: sem card).
const SHOPIFY_ID: Record<string, string> = {
  "Georgetown": "101", "Cheetah Print": "102", "Handball Shoes": "103", "Leopard Shoes": "999",
};
const FALLBACK = 30; // custo padrão da loja

// Item como a Shopify manda: enviado = fulfillment_status "fulfilled".
const li = (title: string, o: { qty?: number; current?: number; shipped?: "fulfilled" | "partial" | null; fulfillable?: number } = {}) => ({
  title, product_id: SHOPIFY_ID[title] ?? null, quantity: o.qty ?? 1, current_quantity: o.current ?? o.qty ?? 1,
  fulfillment_status: o.shipped ?? null, fulfillable_quantity: o.fulfillable ?? 0,
});

describe("custo do fornecedor", () => {
  it("1. casa pelo produto da Shopify ligado ao card, não pelo título", () => {
    expect(matchLineItemCost({ title: "Qualquer nome", product_id: 202 }, products)).toBe(50);
    expect(matchLineItemCost({ title: "Air 1 Low Georgetown", product_id: 555 }, products)).toBeNull();
    expect(matchLineItemCost({ title: "Air 1 Low Georgetown" }, products)).toBeNull();
  });

  it("1b. item sem produto na Shopify casa pelo título exato ligado", () => {
    expect(matchLineItemCost({ title: "  Adidas  SAMBA OG " }, products)).toBe(38);
    expect(matchLineItemCost({ title: "Adidas Samba OG Leopard" }, products)).toBeNull();
    // com product_id, o título não conta
    expect(matchLineItemCost({ title: "Adidas Samba OG", product_id: 555 }, products)).toBeNull();
  });

  it("2. item sem card usa o custo padrão da loja", () => {
    expect(orderLineItemsCost([li("Leopard Shoes")], products, FALLBACK)).toBe(30);
  });

  it("3. tag reenvio-fornecedor zera o custo", () => {
    expect(orderLineItemsCost([li("Georgetown", { shipped: "fulfilled" })], products, FALLBACK, "vip, reenvio-fornecedor")).toBe(0);
  });

  it("4. item enviado e reembolsado depois tem custo", () => {
    // reembolso zera a quantidade atual, mas o produto já saiu
    expect(orderLineItemsCost([li("Georgetown", { current: 0, shipped: "fulfilled" })], products, FALLBACK)).toBe(38);
  });

  it("5. reembolsado ou cancelado antes do envio não tem custo", () => {
    expect(orderLineItemsCost([li("Georgetown", { current: 0, shipped: null })], products, FALLBACK)).toBe(0);
  });

  it("6. item removido por edição antes do envio não conta", () => {
    expect(orderLineItemsCost([li("Georgetown", { qty: 2, current: 1 })], products, FALLBACK)).toBe(38);
  });

  it("7. 2 unidades, 1 enviada, depois reembolsado: custo de 1", () => {
    expect(orderLineItemsCost([li("Georgetown", { qty: 2, current: 0, shipped: "partial", fulfillable: 1 })], products, FALLBACK)).toBe(38);
  });

  it("8. rastreio lançado à mão conta como enviado", () => {
    const item = li("Georgetown", { current: 0, shipped: null });
    expect(orderLineItemsCost([item], products, FALLBACK, null, { hasTracking: true })).toBe(38);
    expect(orderLineItemsCost([item], products, FALLBACK, null, { hasTracking: false })).toBe(0);
  });

  it("8b. item trocado por edição não conta, mesmo com rastreio", () => {
    const trocado = [li("Georgetown", { current: 0, shipped: null }), li("Georgetown", { shipped: "fulfilled" })];
    expect(orderLineItemsCost(trocado, products, FALLBACK, null, { hasTracking: true })).toBe(38);
    expect(orderLineItemsCost(trocado, products, FALLBACK, null, { hasTracking: false })).toBe(38);
  });

  it("9. custo é o da data do pedido (mudança só vale pra frente)", () => {
    expect(orderLineItemsCost([li("Handball Shoes")], products, FALLBACK, null, { date: "2026-10-09" })).toBe(38);
    expect(orderLineItemsCost([li("Handball Shoes")], products, FALLBACK, null, { date: "2026-10-12" })).toBe(40);
  });

  it("pedido normal ainda não enviado conta pela quantidade", () => {
    expect(orderLineItemsCost([li("Georgetown", { qty: 2 }), li("Cheetah Print")], products, FALLBACK)).toBe(38 * 2 + 50);
  });
});

describe("preço de custo por data (Histórico de preços)", () => {
  const p: CostProduct = { name: "X", shopify_product_ids: ["500"], cost: 11.5, history: [
    { from: "2026-11-18", cost: 11.5 },
    { from: "2026-11-05", cost: 12 },
    { from: "1900-01-01", cost: 10 },
  ] };
  const item = { product_id: "500", quantity: 2, current_quantity: 2, fulfillment_status: null };
  const at = (date: string) => orderLineItemsCost([item], [p], FALLBACK, null, { date });
  it("cada pedido usa o preço que valia no dia; o dia da virada já é o preço novo", () => {
    expect(at("2026-01-01")).toBe(20);
    expect(at("2026-11-04")).toBe(20);
    expect(at("2026-11-05")).toBe(24);
    expect(at("2026-11-17")).toBe(24);
    expect(at("2026-11-18")).toBe(23);
    expect(at("2026-12-01")).toBe(23);
  });
});

describe("custo por fornecedor", () => {
  const georgetown = { id: "g", name: "Georgetown", cost: 40.5, shopify_product_ids: ["1"], supplierCosts: { FlowBorder: 37.17 } };
  const li = { product_id: 1, quantity: 1, title: "Air Jordan 1 Low Georgetown" };
  it("pago: usa o fornecedor do pagamento", () => {
    expect(orderLineItemsCost([li], [georgetown], 0, "", { supplier: "FlowBorder" })).toBeCloseTo(37.17);
    expect(orderLineItemsCost([li], [georgetown], 0, "", { supplier: "Alice" })).toBeCloseTo(40.5);
  });
  it("não pago: usa o padrão do produto", () => {
    expect(orderLineItemsCost([li], [georgetown], 0, "")).toBeCloseTo(40.5);
    expect(orderLineItemsCost([li], [{ ...georgetown, defaultSupplier: "FlowBorder" }], 0, "")).toBeCloseTo(37.17);
  });
  it("fornecedor sem preço cai no da Alice", () => {
    expect(orderLineItemsCost([li], [{ ...georgetown, supplierCosts: {} }], 0, "", { supplier: "FlowBorder" })).toBeCloseTo(40.5);
  });
});
