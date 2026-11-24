import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { costProductsFor } from "@/lib/product-links.server";
import { supplierCostByOrder } from "@/lib/supplier-cost.server";
import {
  assertSupportAccess as assertAccess, customerOf, db, loadSupportOrder as loadOrder, personNames, type SupportCtx as Ctx,
} from "@/lib/support-approval.server";

// Atendimento › Reembolso: reembolso que o fornecedor deve por um pedido. A
// equipe marca no pedido (Atendimento › Pedidos); alguém confere no sistema do
// fornecedor e dá o OK quando ele reembolsou. Valor sugerido = custo do
// fornecedor do pedido (mesma conta do lote no Caixa), editável.

export type SupplierRefund = {
  id: string; shop_id: string; shopName: string | null; order_id: string; order_number: string | null;
  conversation_id: string | null; customer_name: string | null; amount: number; note: string | null;
  status: "pendente" | "confirmado"; created_at: string; confirmed_at: string | null;
  requestedByName: string | null; confirmedByName: string | null;
};

const COLS = "id,shop_id,order_id,order_number,conversation_id,customer_name,amount,note,status,requested_by,confirmed_by,confirmed_at,created_at";

async function shape(rows: any[]): Promise<SupplierRefund[]> {
  const [names, shops] = await Promise.all([
    personNames(rows.flatMap((r) => [r.requested_by, r.confirmed_by])),
    rows.length
      ? supabaseAdmin.from("shops").select("id,name").in("id", [...new Set(rows.map((r) => r.shop_id as string))])
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const shopName = new Map(((shops as any).data ?? []).map((s: any) => [s.id, s.name]));
  return rows.map((r) => ({
    id: r.id, shop_id: r.shop_id, shopName: (shopName.get(r.shop_id) as string | undefined) ?? null,
    order_id: r.order_id, order_number: r.order_number, conversation_id: r.conversation_id, customer_name: r.customer_name,
    amount: Number(r.amount), note: r.note, status: r.status, created_at: r.created_at, confirmed_at: r.confirmed_at,
    requestedByName: names.get(r.requested_by) ?? null,
    confirmedByName: r.confirmed_by ? names.get(r.confirmed_by) ?? null : null,
  }));
}

// Os do(s) pedido(s) aberto(s) no painel do cliente.
export const listSupplierRefundsForOrders = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ orderIds: z.array(z.string().uuid()).max(100) }).parse(d))
  .handler(async ({ data, context }) => {
    assertAccess(context as Ctx);
    if (!data.orderIds.length) return [] as SupplierRefund[];
    const { data: rows, error } = await db("supplier_refunds").select(COLS)
      .eq("owner_id", context.ownerId).in("order_id", data.orderIds);
    if (error) throw new Error(error.message);
    return shape(rows ?? []);
  });

// Aba Reembolso: todos os pendentes + confirmados dos últimos 90 dias.
export const listSupplierRefunds = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    assertAccess(context as Ctx);
    const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
    const { data: rows, error } = await db("supplier_refunds").select(COLS)
      .eq("owner_id", context.ownerId).or(`status.eq.pendente,confirmed_at.gte.${since}`)
      .order("created_at", { ascending: true }).limit(1000);
    if (error) throw new Error(error.message);
    return shape(rows ?? []);
  });

export const requestSupplierRefund = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    orderId: z.string().uuid(),
    conversationId: z.string().uuid().nullable(),
    amount: z.number().min(0).max(100_000),
    note: z.string().trim().max(1000).nullable(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    assertAccess(ctx);
    const o = await loadOrder(ctx.ownerId, data.orderId);
    const { error } = await db("supplier_refunds").insert({
      owner_id: ctx.ownerId, shop_id: o.shop_id, order_id: o.id, order_number: o.order_number,
      conversation_id: data.conversationId, customer_name: customerOf(o.raw).name,
      amount: Math.round(data.amount * 100) / 100, note: data.note || null, requested_by: ctx.userId,
    });
    if (error) throw new Error(error.code === "23505" ? "Esse pedido já está marcado pro fornecedor reembolsar" : error.message);
    return { ok: true };
  });

// Aba Reembolso › Pedir reembolso: acha os pedidos pelo número (cola uma lista)
// e sugere o custo do fornecedor de cada um. Avisa o que não dá pra marcar.
export type SupplierRefundLookup = {
  input: string; orderId: string | null; order_number: string | null; shopName: string | null;
  customer_name: string | null; cost: number | null; already: "pendente" | "confirmado" | null;
};

const normNumber = (s: string) => {
  const t = s.trim().toUpperCase();
  return t ? (t.startsWith("#") ? t : `#${t}`) : "";
};

export const lookupSupplierRefundOrders = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ numbers: z.array(z.string().trim().min(1).max(40)).min(1).max(200) }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    assertAccess(ctx);
    const numbers = [...new Set(data.numbers.map(normNumber).filter(Boolean))];
    const { data: orders, error } = await supabaseAdmin.from("shop_orders")
      .select("id,shop_id,order_number,order_date,customer:raw->customer,line_items:raw->line_items,tags:raw->>tags,tracking_code,paid_supplier")
      .eq("user_id", ctx.ownerId).in("order_number", numbers);
    if (error) throw new Error(error.message);
    const list = (orders ?? []) as any[];
    const ids = list.map((o) => o.id as string);
    const [products, existing, shops] = await Promise.all([
      costProductsFor(supabaseAdmin, ctx.ownerId),
      ids.length ? db("supplier_refunds").select("order_id,status").eq("owner_id", ctx.ownerId).in("order_id", ids) : Promise.resolve({ data: [] }),
      list.length ? supabaseAdmin.from("shops").select("id,name").in("id", [...new Set(list.map((o) => o.shop_id as string))]) : Promise.resolve({ data: [] as any[] }),
    ]);
    const costs = await supplierCostByOrder(supabaseAdmin, ctx.ownerId, list, products);
    const status = new Map(((existing as any).data ?? []).map((r: any) => [r.order_id, r.status]));
    const shopName = new Map(((shops as any).data ?? []).map((s: any) => [s.id, s.name]));
    const byNumber = new Map(list.map((o) => [o.order_number as string, o]));
    return numbers.map((n): SupplierRefundLookup => {
      const o = byNumber.get(n);
      if (!o) return { input: n, orderId: null, order_number: null, shopName: null, customer_name: null, cost: null, already: null };
      const name = [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(" ").trim();
      return {
        input: n, orderId: o.id, order_number: o.order_number, shopName: (shopName.get(o.shop_id) as string | undefined) ?? null,
        customer_name: name || null, cost: costs.get(o.id) ?? 0, already: (status.get(o.id) as any) ?? null,
      };
    });
  });

// Marca vários de uma vez (mesmo motivo). Pedido já marcado é pulado.
export const requestSupplierRefunds = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    items: z.array(z.object({ orderId: z.string().uuid(), amount: z.number().min(0).max(100_000) })).min(1).max(200),
    note: z.string().trim().max(1000).nullable(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    assertAccess(ctx);
    const { data: orders, error } = await supabaseAdmin.from("shop_orders")
      .select("id,shop_id,order_number,customer:raw->customer")
      .eq("user_id", ctx.ownerId).in("id", data.items.map((i) => i.orderId));
    if (error) throw new Error(error.message);
    const byId = new Map(((orders ?? []) as any[]).map((o) => [o.id as string, o]));
    const rows = data.items.filter((i) => byId.has(i.orderId)).map((i) => {
      const o = byId.get(i.orderId);
      const name = [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(" ").trim();
      return {
        owner_id: ctx.ownerId, shop_id: o.shop_id, order_id: o.id, order_number: o.order_number, conversation_id: null,
        customer_name: name || null, amount: Math.round(i.amount * 100) / 100, note: data.note || null, requested_by: ctx.userId,
      };
    });
    if (!rows.length) return { inserted: 0 };
    const { data: ins, error: e2 } = await db("supplier_refunds")
      .upsert(rows, { onConflict: "order_id", ignoreDuplicates: true }).select("id");
    if (e2) throw new Error(e2.message);
    return { inserted: (ins ?? []).length };
  });

// OK de que o fornecedor reembolsou (ou desfazer o OK). Dá pra acertar o valor
// que ele de fato devolveu.
export const confirmSupplierRefund = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    id: z.string().uuid(),
    confirmed: z.boolean(),
    amount: z.number().min(0).max(100_000).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    assertAccess(ctx);
    const { error } = await db("supplier_refunds").update({
      status: data.confirmed ? "confirmado" : "pendente",
      confirmed_by: data.confirmed ? ctx.userId : null,
      confirmed_at: data.confirmed ? new Date().toISOString() : null,
      ...(data.amount != null ? { amount: Math.round(data.amount * 100) / 100 } : {}),
    }).eq("id", data.id).eq("owner_id", ctx.ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteSupplierRefund = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    assertAccess(context as Ctx);
    const { error } = await db("supplier_refunds").delete().eq("id", data.id).eq("owner_id", context.ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
