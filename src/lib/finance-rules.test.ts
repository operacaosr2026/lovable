import { describe, expect, it } from "vitest";
import {
  aggregateRefundsAndChargebacks, diluteRefundsAndChargebacks, netRevenue, profit,
  supplierForecastOrders, orderCostGuard, orderCostWrite, relevantPayouts, payoutPatch, comparisonPeriod,
} from "@/lib/finance-rules";
import { orderDateFor } from "@/lib/order-date";

const SHOP = "loja-1";
const empty = { refundOrders: [], disputes: [], wonDisputes: [], recoveries: [] };
// Pedido reembolsado: transação de reembolso no dia `day`.
const refundedOrder = (day: string, amount = 99.9) => ({
  shop_id: SHOP, total_price: String(amount), current_total_price: "0",
  refunds: [{ created_at: `${day}T15:00:00-04:00`, transactions: [{ kind: "refund", status: "success", amount: String(amount), processed_at: `${day}T15:00:00-04:00` }] }],
});
const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

describe("reembolso e chargeback", () => {
  it("10. reembolso conta no dia do reembolso; o mês do pedido não muda", () => {
    const src = { ...empty, refundOrders: [refundedOrder("2026-10-05")] }; // pedido era de setembro
    const sep = aggregateRefundsAndChargebacks([SHOP], "2026-09-01", "2026-09-30", src)[0];
    const oct = aggregateRefundsAndChargebacks([SHOP], "2026-10-01", "2026-10-31", src)[0];
    expect(sep.refAmt).toBe(0);
    expect(oct.refAmt).toBeCloseTo(99.9);
    expect(oct.refByDate["2026-10-05"]).toBeCloseTo(99.9);
  });

  it("11. chargeback conta no dia em que foi aberto", () => {
    const src = { ...empty, disputes: [{ shop_id: SHOP, amount: 99.9, initiated_at: "2026-09-20" }] };
    const r = aggregateRefundsAndChargebacks([SHOP], "2026-09-01", "2026-09-30", src)[0];
    expect(r.cbAmt).toBeCloseTo(99.9);
    expect(r.cbByDate["2026-09-20"]).toBeCloseTo(99.9);
  });

  it("12. chargeback ganho volta no dia do ganho (aberto set, ganho out)", () => {
    const src = {
      ...empty,
      disputes: [{ shop_id: SHOP, amount: 99.9, initiated_at: "2026-09-20" }],
      wonDisputes: [{ shop_id: SHOP, amount: 99.9, finalized_on: "2026-10-10" }],
    };
    const sep = aggregateRefundsAndChargebacks([SHOP], "2026-09-01", "2026-09-30", src)[0];
    const oct = aggregateRefundsAndChargebacks([SHOP], "2026-10-01", "2026-10-31", src)[0];
    expect(sep.cbAmt).toBeCloseTo(99.9);
    expect(oct.cbAmt).toBeCloseTo(-99.9);
    expect(oct.cbByDate["2026-10-10"]).toBeCloseTo(-99.9);
  });

  it("13. pagamento da cobrança do alerta abate o reembolso no dia do pagamento", () => {
    const src = {
      ...empty,
      refundOrders: [refundedOrder("2026-10-02")],
      recoveries: [{ shop_id: SHOP, recovered_amount: 99.9, recovery_paid_at: "2026-10-08T16:00:00Z" }],
    };
    const r = aggregateRefundsAndChargebacks([SHOP], "2026-10-01", "2026-10-31", src)[0];
    expect(r.refAmt).toBeCloseTo(0);
    expect(r.refByDate["2026-10-08"]).toBeCloseTo(-99.9);
  });

  it("14. diluição: mês fechado dividido pelos dias; soma do mês = total real", () => {
    const monthly = [{ m: "2026-09", rows: [{ shop_id: SHOP, refAmt: 300, cbAmt: 0, refByDate: {}, cbByDate: {} }] }];
    const { rows } = diluteRefundsAndChargebacks([SHOP], "2026-09-01", "2026-09-30", "2026-10-15", monthly);
    expect(rows[0].refByDate["2026-09-15"]).toBeCloseTo(10); // 300 / 30 dias
    expect(sum(rows[0].refByDate)).toBeCloseTo(300);
    // um dia só pega a parte dele
    const day = diluteRefundsAndChargebacks([SHOP], "2026-09-15", "2026-09-15", "2026-10-15", monthly);
    expect(day.rows[0].refAmt).toBeCloseTo(10);
  });

  it("14b. mês corrente divide só até 2 dias atrás; hoje e ontem sem desconto", () => {
    // hoje 10/10: divide por 8 dias (1º a 8)
    const monthly = [{ m: "2026-10", rows: [{ shop_id: SHOP, refAmt: 80, cbAmt: 0, refByDate: {}, cbByDate: {} }] }];
    const { rows } = diluteRefundsAndChargebacks([SHOP], "2026-10-01", "2026-10-10", "2026-10-10", monthly);
    expect(rows[0].refByDate["2026-10-08"]).toBeCloseTo(10);
    expect(rows[0].refByDate["2026-10-09"]).toBeUndefined();
    expect(rows[0].refByDate["2026-10-10"]).toBeUndefined();
  });

  it("13b. reembolso parcial conta só o que saiu, não o pedido inteiro (refund_discrepancy)", () => {
    // #L2-1146: pedido 129,90, devolveu 38,97; a Shopify zera o total atual e
    // registra 90,93 como ajuste não devolvido.
    const partial = {
      shop_id: SHOP, total_price: "129.90", current_total_price: "0.00",
      refunds: [{
        created_at: "2026-10-17T19:40:28-04:00",
        transactions: [{ kind: "refund", status: "success", amount: "38.97", processed_at: "2026-10-17T19:40:28-04:00" }],
        order_adjustments: [{ kind: "refund_discrepancy", amount: "90.93" }, { kind: "refund_discrepancy", amount: "38.97" }, { kind: "refund_discrepancy", amount: "-38.97" }],
      }],
    };
    const r = aggregateRefundsAndChargebacks([SHOP], "2026-10-01", "2026-10-31", { ...empty, refundOrders: [partial] })[0];
    expect(r.refAmt).toBeCloseTo(38.97);
  });

  it("13c. item tirado sem devolver dinheiro (reembolso sem transação, com transação em outro reembolso) não conta", () => {
    // #WV1416: 1º reembolso só tira um item (sem transação); 2º devolve 74,69.
    const o = {
      shop_id: SHOP, total_price: "259.80", current_total_price: "0.00",
      refunds: [
        { created_at: "2026-09-21T12:59:18-03:00", transactions: [] },
        { created_at: "2026-10-14T13:32:36-03:00", transactions: [{ kind: "refund", status: "success", amount: "74.69", processed_at: "2026-10-14T13:32:36-03:00" }], order_adjustments: [{ kind: "refund_discrepancy", amount: "55.21" }] },
      ],
    };
    const r = aggregateRefundsAndChargebacks([SHOP], "2026-09-01", "2026-10-31", { ...empty, refundOrders: [o] })[0];
    expect(r.refAmt).toBeCloseTo(74.69);
  });

  it("13d. reembolso pendente não conta até a Shopify concluir", () => {
    const o = {
      shop_id: SHOP, total_price: "129.90", current_total_price: "0.00",
      refunds: [{ created_at: "2026-10-20T11:32:14-03:00", transactions: [{ kind: "refund", status: "pending", amount: "129.90", processed_at: "2026-10-20T11:32:14-03:00" }], order_adjustments: [{ kind: "refund_discrepancy", amount: "129.90" }] }],
    };
    const r = aggregateRefundsAndChargebacks([SHOP], "2026-10-01", "2026-10-31", { ...empty, refundOrders: [o] })[0];
    expect(r.refAmt).toBeCloseTo(0);
    // mesmo sem o ajuste refund_discrepancy, a diferença de preço não entra no lugar
    const noAdj = { ...o, refunds: [{ ...o.refunds[0], order_adjustments: [] }] };
    expect(aggregateRefundsAndChargebacks([SHOP], "2026-10-01", "2026-10-31", { ...empty, refundOrders: [noAdj] })[0].refAmt).toBeCloseTo(0);
  });

  it("15. lucro = faturamento líquido − produtos − taxas − anúncios", () => {
    const faturamento = netRevenue(1000, 100, 50);
    expect(faturamento).toBe(850);
    expect(profit({ faturamento, custoProduto: 300, taxas: 40, anuncios: 200 })).toBe(310);
  });
});

describe("comparação dos cards", () => {
  it("24. 'Este mês' compara com os mesmos dias do mês anterior", () => {
    expect(comparisonPeriod("2026-10-01", "2026-10-06")).toMatchObject({ prevFrom: "2026-09-01", prevTo: "2026-09-06", sameDaysPrevMonth: true });
    // dia 31 num mês de 30: vai até o último dia do mês anterior
    expect(comparisonPeriod("2026-10-01", "2026-10-31")).toMatchObject({ prevFrom: "2026-09-01", prevTo: "2026-09-30" });
    // março × fevereiro
    expect(comparisonPeriod("2026-03-01", "2026-03-30")).toMatchObject({ prevFrom: "2026-02-01", prevTo: "2026-02-28" });
  });
  it("25. outros períodos comparam com os mesmos N dias logo antes", () => {
    expect(comparisonPeriod("2026-10-01", "2026-10-01")).toMatchObject({ prevFrom: "2026-09-01", prevTo: "2026-09-01" });
    expect(comparisonPeriod("2026-09-30", "2026-10-06")).toMatchObject({ prevFrom: "2026-09-23", prevTo: "2026-09-29", sameDaysPrevMonth: false });
  });
});

describe("Caixa", () => {
  it("16. previsão do fornecedor só conta pedido ainda não pago", () => {
    const orders = [
      { external_id: "1", payment_status: "pending", shopify_financial_status: "paid" },
      { external_id: "2", payment_status: "paid", shopify_financial_status: "paid" },
    ];
    expect(supplierForecastOrders(orders, []).map((o) => o.external_id)).toEqual(["1"]);
  });

  it("17. reembolsado ou com chargeback sai; chargeback ganho volta", () => {
    const orders = [
      { external_id: "1", payment_status: "pending", shopify_financial_status: "refunded" },
      { external_id: "2", payment_status: "pending", shopify_financial_status: "paid" },
      { external_id: "3", payment_status: "pending", shopify_financial_status: "paid" },
      { external_id: "4", payment_status: "pending", shopify_financial_status: "partially_refunded" },
    ];
    const cbs = [{ order_external_id: "2", status: "lost" }, { order_external_id: "3", status: "won" }];
    expect(supplierForecastOrders(orders, cbs).map((o) => o.external_id)).toEqual(["3"]);
  });

  it("18. lançamento conciliado nunca muda", () => {
    expect(orderCostGuard({ source: "auto", reconciled: true }, null, "2026-10-05")).toBe("keep");
  });

  it("19. data e valor travados não são sobrescritos", () => {
    const w = orderCostWrite({ source: "auto", date_locked: true, amount_locked: false }, 120, 3, "2026-10-06");
    expect(w).toEqual({ action: "update", patch: { description: "3 itens", amount: 120 } });
    const w2 = orderCostWrite({ source: "auto", date_locked: false, amount_locked: true }, 120, 3, "2026-10-06");
    expect(w2).toEqual({ action: "update", patch: { description: "3 itens", date: "2026-10-06" } });
    // valor zerou mas tem trava: não apaga
    expect(orderCostWrite({ source: "auto", amount_locked: true }, 0, 0, "2026-10-06").action).toBe("update");
    // sem trava e zerou: apaga; sem lançamento e valor > 0: cria
    expect(orderCostWrite({ source: "auto" }, 0, 0, "2026-10-06").action).toBe("delete");
    expect(orderCostWrite(null, 76, 2, "2026-10-06").action).toBe("insert");
    expect(orderCostWrite(null, 0, 0, "2026-10-06").action).toBe("none");
  });

  it("20. ajuste manual do custo do dia prevalece", () => {
    expect(orderCostGuard({ source: "manual_override" }, null, "2026-10-05")).toBe("keep");
  });

  it("21. nada é lançado antes do início do Caixa", () => {
    expect(orderCostGuard(null, "2026-09-01", "2026-08-31")).toBe("cutoff");
    expect(orderCostGuard(null, "2026-09-01", "2026-09-01")).toBe("compute");
  });

  it("22. depósito apagado à mão não volta; conciliado não muda data/valor", () => {
    const payouts = [{ id: 1, status: "paid" }, { id: 2, status: "paid" }, { id: 3, status: "failed" }];
    expect(relevantPayouts(payouts, new Set(["2"])).map((p) => p.id)).toEqual([1]);
    const p = { status: "paid", date: "2026-10-07", amount: "500.00" };
    expect(payoutPatch({ reconciled: true }, p)).toEqual({ description: "Payout Shopify · depositado", shopify_payout_status: "paid" });
    expect(payoutPatch({ date_locked: true }, p)).toEqual({ description: "Payout Shopify · depositado", shopify_payout_status: "paid", amount: 500 });
    expect(payoutPatch(null, p)).toEqual({ description: "Payout Shopify · depositado", shopify_payout_status: "paid", date: "2026-10-07", amount: 500 });
  });
});

describe("datas", () => {
  it("23. desde 23/09/2026 o pedido conta no dia de Nova York", () => {
    // 23h30 de NY em 05/10 = 00h30 de 06/10 no fuso da loja (Halifax, 1h à frente)
    expect(orderDateFor("2026-10-06T00:30:00-03:00")).toBe("2026-10-05");
    // antes do corte, mantém a data do fuso da loja
    expect(orderDateFor("2026-09-10T00:30:00-03:00")).toBe("2026-09-10");
  });
});
