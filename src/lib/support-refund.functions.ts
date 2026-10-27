import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { shopifyGql } from "@/lib/chargeback-recovery.server";
import { raiseNotification, resolveNotification } from "@/lib/notifications.server";
import {
  APPROVALS_LINK, assertSupportAccess as assertAccess, customerOf, db, isApprover, loadSupportOrder as loadOrder,
  personName, personNames, tellRequester, type SupportCtx as Ctx,
} from "@/lib/support-approval.server";

// Atendimento › Pedidos › Reembolsar. A equipe escolhe pedido inteiro, itens
// (com ou sem frete) ou um valor; o dono do workspace aprova (mesmo fluxo da
// troca); aprovado, a Shopify devolve pelo mesmo meio de pagamento, sem voltar
// ao estoque. O valor é recalculado na hora de aprovar (pedido pode ter sido
// reembolsado por fora nesse meio tempo). A nota do reembolso leva [SRX xxxxxxxx]
// pra uma nova tentativa não reembolsar duas vezes.

export const REFUND_MODES = ["total", "itens", "valor"] as const;
export type RefundMode = (typeof REFUND_MODES)[number];
export type RefundLine = { line_item_id: string; title: string; variant_title: string | null; quantity: number };

const noticeKey = (id: string) => `reembolso:${id}`;
const marker = (id: string) => `[SRX ${id.slice(0, 8)}]`;
const money = (v: number, cur: string) => {
  try { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: cur }).format(v); } catch { return `${cur} ${v.toFixed(2)}`; }
};
const amt = (m: any) => Number(m?.shopMoney?.amount ?? 0);
const orderGid = (o: { raw: any }) => o.raw?.admin_graphql_api_id ?? `gid://shopify/Order/${o.raw?.id}`;

// Valor, itens e transações que a Shopify sugere pro reembolso pedido.
async function suggest(shopId: string, orderId: string, mode: RefundMode, lines: { lineItemId: string; quantity: number }[], shipping: boolean) {
  const full = mode !== "itens";
  const data = await shopifyGql(shopId, `query RefundSuggest($id: ID!, $full: Boolean!, $lines: [RefundLineItemInput!], $ship: Boolean!) {
    order(id: $id) {
      suggestedRefund(suggestFullRefund: $full, refundLineItems: $lines, refundShipping: $ship) {
        amountSet { shopMoney { amount currencyCode } }
        refundLineItems { lineItem { id } quantity }
        suggestedTransactions { gateway amountSet { shopMoney { amount } } maximumRefundableSet { shopMoney { amount } } parentTransaction { id } }
      }
    }
  }`, {
    id: orderId, full,
    lines: full ? null : lines.map((l) => ({ lineItemId: l.lineItemId, quantity: l.quantity, restockType: "NO_RESTOCK" })),
    ship: full || shipping,
  });
  const s = data?.order?.suggestedRefund;
  if (!s) throw new Error("A Shopify não calculou o reembolso deste pedido");
  return {
    amount: amt(s.amountSet),
    currency: (s.amountSet?.shopMoney?.currencyCode as string) ?? "USD",
    lineItems: ((s.refundLineItems ?? []) as any[]).filter((l) => l.quantity > 0).map((l) => ({ lineItemId: l.lineItem.id as string, quantity: l.quantity as number })),
    transactions: ((s.suggestedTransactions ?? []) as any[]).filter((t) => t.parentTransaction?.id).map((t) => ({
      parentId: t.parentTransaction.id as string, gateway: t.gateway as string,
      max: t.maximumRefundableSet ? amt(t.maximumRefundableSet) : amt(t.amountSet),
    })),
  };
}

export const getRefundSetup = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ orderId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    assertAccess(context as Ctx);
    const o = await loadOrder(context.ownerId, data.orderId);
    const res = await shopifyGql(o.shop_id, `query RefundOrder($id: ID!) {
      order(id: $id) {
        name cancelledAt
        totalReceivedSet { shopMoney { amount currencyCode } }
        totalRefundedSet { shopMoney { amount } }
        lineItems(first: 50) { nodes { id title variantTitle refundableQuantity discountedUnitPriceAfterAllDiscountsSet { shopMoney { amount } } } }
        suggestedRefund(suggestFullRefund: true, refundShipping: true) {
          amountSet { shopMoney { amount } }
          shipping { amountSet { shopMoney { amount } } }
        }
      }
    }`, { id: orderGid(o) });
    const order = res?.order;
    if (!order) throw new Error("Pedido não encontrado na Shopify");
    const { data: shop } = await supabaseAdmin.from("shops").select("name").eq("id", o.shop_id).maybeSingle();
    return {
      orderNumber: o.order_number ?? order.name,
      store: shop?.name ?? null,
      currency: (order.totalReceivedSet?.shopMoney?.currencyCode as string) ?? "USD",
      received: amt(order.totalReceivedSet),
      refunded: amt(order.totalRefundedSet),
      maxRefundable: amt(order.suggestedRefund?.amountSet),
      shippingRefundable: amt(order.suggestedRefund?.shipping?.amountSet),
      canApprove: isApprover(context as Ctx),
      lines: ((order.lineItems?.nodes ?? []) as any[]).filter((l) => l.refundableQuantity > 0).map((l) => ({
        id: l.id as string, title: l.title as string, variantTitle: (l.variantTitle as string) || null,
        refundable: l.refundableQuantity as number, unitPrice: amt(l.discountedUnitPriceAfterAllDiscountsSet),
      })),
    };
  });

const LinesInput = z.array(z.object({
  line_item_id: z.string().regex(/^gid:\/\/shopify\/LineItem\/\d+$/),
  title: z.string().trim().min(1).max(300),
  variant_title: z.string().trim().max(200).nullable(),
  quantity: z.number().int().min(1).max(100),
})).max(50);

// Valor exato dos itens escolhidos (com imposto/desconto do jeito da Shopify).
export const previewRefund = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ orderId: z.string().uuid(), lines: LinesInput, includeShipping: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    assertAccess(context as Ctx);
    if (!data.lines.length && !data.includeShipping) return { amount: 0 };
    const o = await loadOrder(context.ownerId, data.orderId);
    const s = await suggest(o.shop_id, orderGid(o), "itens", data.lines.map((l) => ({ lineItemId: l.line_item_id, quantity: l.quantity })), data.includeShipping);
    return { amount: s.amount };
  });

export const listRefundRequests = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ orderIds: z.array(z.string().uuid()).max(100) }).parse(d))
  .handler(async ({ data, context }) => {
    assertAccess(context as Ctx);
    if (!data.orderIds.length) return { canApprove: isApprover(context as Ctx), requests: [] };
    const { data: rows, error } = await db("support_refund_requests")
      .select("id,order_id,order_number,mode,line_items,include_shipping,amount,currency,notify_customer,charge_on_delivery,note,status,requested_by,decided_by,decided_at,reject_reason,refunded_amount,error,created_at")
      .eq("owner_id", context.ownerId).in("order_id", data.orderIds).order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const name = await personNames((rows ?? []).flatMap((r: any) => [r.requested_by, r.decided_by]));
    return {
      canApprove: isApprover(context as Ctx),
      requests: ((rows ?? []) as any[]).map((r) => ({
        ...r, amount: Number(r.amount), refunded_amount: r.refunded_amount == null ? null : Number(r.refunded_amount),
        line_items: r.line_items as RefundLine[],
        requestedByName: name.get(r.requested_by) ?? null,
        decidedByName: r.decided_by ? name.get(r.decided_by) ?? null : null,
      })),
    };
  });

export const requestRefund = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    orderId: z.string().uuid(),
    conversationId: z.string().uuid().nullable(),
    mode: z.enum(REFUND_MODES),
    lines: LinesInput,
    includeShipping: z.boolean(),
    amount: z.number().positive().max(100_000).nullable(),
    notifyCustomer: z.boolean(),
    chargeOnDelivery: z.boolean().default(false),
    note: z.string().trim().max(1000).nullable(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    assertAccess(ctx);
    if (data.mode === "itens" && !data.lines.length) throw new Error("Escolha pelo menos um item");
    if (data.mode === "valor" && !data.amount) throw new Error("Digite o valor do reembolso");
    const o = await loadOrder(ctx.ownerId, data.orderId);
    const { data: open } = await db("support_refund_requests").select("id")
      .eq("owner_id", ctx.ownerId).eq("order_id", o.id).in("status", ["pendente", "gerando"]).limit(1);
    if (open?.length) throw new Error("Este pedido já tem um reembolso aguardando aprovação");

    // Valor calculado aqui (não confia no da tela).
    const plan = await suggest(o.shop_id, orderGid(o), data.mode, data.lines.map((l) => ({ lineItemId: l.line_item_id, quantity: l.quantity })), data.includeShipping);
    const full = data.mode === "valor" ? plan : await suggest(o.shop_id, orderGid(o), "total", [], true);
    const amount = data.mode === "valor" ? Math.round(data.amount! * 100) / 100 : plan.amount;
    if (amount <= 0) throw new Error("Nada a reembolsar neste pedido");
    if (amount > full.amount + 0.001) throw new Error(`Valor maior que o reembolsável (${money(full.amount, full.currency)})`);

    const customer = customerOf(o.raw);
    const { data: row, error } = await db("support_refund_requests").insert({
      owner_id: ctx.ownerId, requested_by: ctx.userId, shop_id: o.shop_id, conversation_id: data.conversationId,
      order_id: o.id, order_number: o.order_number, customer_email: customer.email, customer_name: customer.name,
      mode: data.mode, line_items: data.mode === "itens" ? data.lines : [], include_shipping: data.mode === "itens" && data.includeShipping,
      amount, currency: plan.currency, notify_customer: data.notifyCustomer, charge_on_delivery: data.mode === "total" && data.chargeOnDelivery, note: data.note,
    }).select("id").single();
    if (error) throw new Error(error.message);

    if (isApprover(ctx)) {
      const r = await executeRefund(ctx, row.id);
      return { status: "aprovado" as const, amount: r.amount, currency: plan.currency };
    }

    const who = await personName(ctx.userId);
    const what = data.mode === "total" ? "pedido inteiro"
      : data.mode === "valor" ? "valor avulso"
      : data.lines.map((l) => `${l.quantity}× ${l.title}${l.variant_title ? ` (${l.variant_title})` : ""}`).join(", ") + (data.includeShipping ? " + frete" : "");
    await raiseNotification(ctx.ownerId, noticeKey(row.id), {
      level: "warning",
      title: `Reembolso para aprovar — ${o.order_number ?? "pedido"} · ${money(amount, plan.currency)}`,
      body: `${who} pediu: ${what}.${data.note ? ` Obs.: ${data.note}` : ""}`,
      link: APPROVALS_LINK,
      targetUserId: ctx.ownerId,
    });
    return { status: "pendente" as const, amount, currency: plan.currency };
  });

export const decideRefund = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    id: z.string().uuid(), approve: z.boolean(), reason: z.string().trim().max(500).nullable().default(null),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    if (!isApprover(ctx)) throw new Error("Sem permissão para aprovar reembolsos");
    if (data.approve) {
      const r = await executeRefund(ctx, data.id);
      return { status: "aprovado" as const, amount: r.amount };
    }
    const { data: done, error } = await db("support_refund_requests").update({
      status: "recusado", decided_by: ctx.userId, decided_at: new Date().toISOString(), reject_reason: data.reason,
    }).eq("id", data.id).eq("owner_id", ctx.ownerId).in("status", ["pendente", "erro"]).select("id,requested_by,order_number,conversation_id");
    if (error) throw new Error(error.message);
    if (!done?.length) throw new Error("Esse reembolso já foi decidido");
    await resolveNotification(ctx.ownerId, noticeKey(data.id));
    await tellRequester(ctx, "reembolso_res", done[0], `Reembolso recusado — ${done[0].order_number ?? "pedido"}`, data.reason ?? "Sem motivo informado.");
    return { status: "recusado" as const, amount: null };
  });

// Faz o reembolso na Shopify. Trava em "gerando" (dois cliques não reembolsam
// 2x); nova tentativa depois de erro confere antes se o reembolso já entrou.
async function executeRefund(ctx: Ctx, id: string): Promise<{ amount: number }> {
  const { data: claimed, error: claimErr } = await db("support_refund_requests")
    .update({ status: "gerando", error: null, decided_by: ctx.userId, decided_at: new Date().toISOString() })
    .eq("id", id).eq("owner_id", ctx.ownerId).in("status", ["pendente", "erro"]).select("*");
  if (claimErr) throw new Error(claimErr.message);
  const r = claimed?.[0];
  if (!r) throw new Error("Esse reembolso já foi decidido ou está sendo feito");

  const finish = async (refund: { id: string; amount: number }) => {
    await db("support_refund_requests").update({ status: "aprovado", refund_id: refund.id, refunded_amount: refund.amount, error: null }).eq("id", id);
    await resolveNotification(ctx.ownerId, noticeKey(id));
    await tellRequester(ctx, "reembolso_res", r, `Reembolso aprovado — ${r.order_number ?? "pedido"}`,
      `${money(refund.amount, r.currency)} devolvido ao cliente.`);
    return { amount: refund.amount };
  };

  try {
    const o = await loadOrder(ctx.ownerId, r.order_id);
    const gid = orderGid(o);

    const prev = await shopifyGql(o.shop_id, `query RefundDone($id: ID!) {
      order(id: $id) { refunds(first: 50) { id note totalRefundedSet { shopMoney { amount } } } }
    }`, { id: gid });
    const already = ((prev?.order?.refunds ?? []) as any[]).find((x) => String(x.note ?? "").includes(marker(id)));
    if (already) return await finish({ id: already.id, amount: amt(already.totalRefundedSet) });

    const lines = (r.line_items as RefundLine[]).map((l) => ({ lineItemId: l.line_item_id, quantity: l.quantity }));
    const plan = await suggest(o.shop_id, gid, r.mode, lines, r.include_shipping);
    const amount = r.mode === "valor" ? Number(r.amount) : plan.amount;
    if (amount <= 0) throw new Error("Nada a reembolsar — o pedido já foi reembolsado");
    const max = plan.transactions.reduce((s, t) => s + t.max, 0);
    if (amount > max + 0.001) throw new Error(`Valor maior que o reembolsável agora (${money(max, plan.currency)})`);

    // Distribui o valor entre os pagamentos do pedido (quase sempre um só).
    let left = Math.round(amount * 100);
    const transactions = [];
    for (const t of plan.transactions) {
      if (left <= 0) break;
      const part = Math.min(left, Math.round(t.max * 100));
      if (part <= 0) continue;
      transactions.push({ orderId: gid, parentId: t.parentId, gateway: t.gateway, kind: "REFUND", amount: (part / 100).toFixed(2) });
      left -= part;
    }
    if (left > 0 || !transactions.length) throw new Error("Pedido sem pagamento reembolsável na Shopify");

    const requester = await personName(r.requested_by);
    // Chave de idempotência obrigatória no refundCreate desde a API 2026-04;
    // uma por tentativa (a nota com o marcador cobre a tentativa seguinte).
    const out = (await shopifyGql(o.shop_id, `mutation SupportRefund($input: RefundInput!, $key: String!) {
      refundCreate(input: $input) @idempotent(key: $key) { refund { id totalRefundedSet { shopMoney { amount } } } userErrors { field message } }
    }`, {
      key: crypto.randomUUID(),
      input: {
        orderId: gid,
        note: `${r.note ? `${r.note} — ` : ""}pedido por ${requester} no SRX Growth ${marker(id)}`,
        notify: !!r.notify_customer,
        refundLineItems: r.mode === "valor" ? [] : plan.lineItems.map((l) => ({ ...l, restockType: "NO_RESTOCK" })),
        shipping: r.mode === "total" || (r.mode === "itens" && r.include_shipping) ? { fullRefund: true } : undefined,
        transactions,
      },
    }))?.refundCreate;
    if (out?.userErrors?.length) throw new Error(out.userErrors.map((e: any) => e.message).join("; ").slice(0, 200));
    if (!out?.refund?.id) throw new Error("A Shopify não confirmou o reembolso");
    return await finish({ id: out.refund.id, amount: amt(out.refund.totalRefundedSet) || amount });
  } catch (e: any) {
    const msg = String(e?.message ?? e).slice(0, 300);
    await db("support_refund_requests").update({ status: "erro", error: msg }).eq("id", id);
    throw new Error(`Não deu pra reembolsar: ${msg}`);
  }
}
