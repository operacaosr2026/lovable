import { describe, expect, it } from "vitest";
import { orderLineItemsCost, matchLineItemCost, type CostProduct } from "@/lib/product-cost-match";

// Regras 1–9: custo do fornecedor de um pedido.
const products: CostProduct[] = [
  { name: "Air 1 Low Georgetown", keywords: ["georgetown"], cost: 38 },
  { name: "Air Force 1 Low Cheetah Print", keywords: ["Cheetah Print"], cost: 50 },
  { name: "Handball Spezial", keywords: ["handball"], cost: 38, history: [
    { from: "2026-10-11", cost: 40 },
    { from: "1900-01-01", cost: 38 },
  ] },
];
const FALLBACK = 30; // custo padrão da loja

// Item como a Shopify manda: enviado = fulfillment_status "fulfilled".
const li = (title: string, o: { qty?: number; current?: number; shipped?: "fulfilled" | "partial" | null; fulfillable?: number } = {}) => ({
  title, quantity: o.qty ?? 1, current_quantity: o.current ?? o.qty ?? 1,
  fulfillment_status: o.shipped ?? null, fulfillable_quantity: o.fulfillable ?? 0,
});

describe("custo do fornecedor", () => {
  it("1. casa pelo nome ou palavra-chave; vence o trecho mais longo", () => {
    expect(matchLineItemCost("Nike Air Force 1 Low Cheetah Print", products)).toBe(50);
    expect(matchLineItemCost("Georgetown Retro", products)).toBe(38);
    expect(matchLineItemCost("HANDBALL SHOES", products)).toBe(38);
  });

  it("2. item sem produto cadastrado usa o custo padrão da loja", () => {
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

  it("9. custo é o da data do pedido (mudança só vale pra frente)", () => {
    expect(orderLineItemsCost([li("Handball Shoes")], products, FALLBACK, null, { date: "2026-10-09" })).toBe(38);
    expect(orderLineItemsCost([li("Handball Shoes")], products, FALLBACK, null, { date: "2026-10-12" })).toBe(40);
  });

  it("pedido normal ainda não enviado conta pela quantidade", () => {
    expect(orderLineItemsCost([li("Georgetown", { qty: 2 }), li("Cheetah Print")], products, FALLBACK)).toBe(38 * 2 + 50);
  });
});
