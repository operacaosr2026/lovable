import { describe, expect, it } from "vitest";
import { beforeCashflowStart, shopifyTrackingPatch } from "@/lib/shopify-order-apply";

const TEMPLATE = "https://voultie.com/track?code=[CODE]";
const shipped = (over: Record<string, unknown> = {}) => ({
  fulfillments: [{ tracking_number: "YT111", tracking_company: "YunExpress", tracking_url: "https://outra-loja.com/t/YT111", created_at: "2026-10-10T23:30:00-04:00", ...over }],
});

describe("pedido da Shopify em shop_orders", () => {
  it("com template, o link usa o código do pedido (trocado à mão) e não regrava se já está certo", () => {
    const existing = { carrier: "YunExpress", tracking_code: "MANUAL9", tracking_url: null, delivery_status: "shipped" };
    expect(shopifyTrackingPatch(shipped(), existing, TEMPLATE, "2026-10-21")).toEqual({ tracking_url: "https://voultie.com/track?code=MANUAL9" });
    const already = { ...existing, tracking_url: "https://voultie.com/track?code=MANUAL9" };
    expect(shopifyTrackingPatch(shipped(), already, TEMPLATE, "2026-10-21")).toBeNull();
  });

  it("sem template, o link da Shopify só preenche se estiver vazio", () => {
    const empty = { carrier: null, tracking_code: null, tracking_url: null, delivery_status: null };
    expect(shopifyTrackingPatch(shipped(), empty, null, "2026-10-21")).toMatchObject({ tracking_url: "https://outra-loja.com/t/YT111", tracking_code: "YT111", carrier: "YunExpress" });
    const kept = { ...empty, tracking_url: "https://minha.com/x", tracking_code: "YT111", carrier: "YunExpress", delivery_status: "shipped" };
    expect(shopifyTrackingPatch(shipped(), kept, null, "2026-10-21")).toBeNull();
  });

  it("postagem conta no dia de NY", () => {
    const empty = { carrier: null, tracking_code: null, tracking_url: null, delivery_status: "pending_shipment" };
    expect(shopifyTrackingPatch(shipped(), empty, null, "2026-10-21")?.shipped_at).toBe("2026-10-10");
  });

  it("pedido sem envio com código não muda nada", () => {
    expect(shopifyTrackingPatch({ fulfillments: [] }, { delivery_status: null }, TEMPLATE, "2026-10-21")).toBeNull();
  });

  it("pedido anterior ao início do Caixa fica de fora", () => {
    expect(beforeCashflowStart({ created_at: "2026-09-30T10:00:00-04:00" }, "2026-10-01")).toBe(true);
    expect(beforeCashflowStart({ created_at: "2026-10-01T10:00:00-04:00" }, "2026-10-01")).toBe(false);
    expect(beforeCashflowStart({ created_at: "2026-09-30T10:00:00-04:00" }, null)).toBe(false);
  });
});
