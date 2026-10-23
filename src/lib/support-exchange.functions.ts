import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { shopifyGql } from "@/lib/chargeback-recovery.server";
import { raiseNotification, resolveNotification } from "@/lib/notifications.server";
import { emitEvent } from "@/lib/notify.server";

// Atendimento › Pedidos › Gerar troca. A equipe escolhe o tamanho novo (ou outro
// modelo) e de quem foi o erro; o dono do workspace aprova; aprovado, vira pedido
// na Shopify igual ao feito à mão: rascunho com o mesmo cliente e endereço, 100%
// de desconto, sem frete, tag REENVIO-EMPRESA/REENVIO-FORNECEDOR, finalizado como
// pago (a Aprodrop pega pra enviar). Pedido pelo próprio dono já sai aprovado.

export const EXCHANGE_FAULTS = ["empresa", "fornecedor"] as const;
export type ExchangeFault = (typeof EXCHANGE_FAULTS)[number];
export const EXCHANGE_TAG: Record<ExchangeFault, string> = { empresa: "REENVIO-EMPRESA", fornecedor: "REENVIO-FORNECEDOR" };

export type ExchangeItem = { variant_id: string; product_title: string; variant_title: string | null; sku: string | null; quantity: number; replaces: string | null };
export type ExchangeVariant = { id: string; title: string; sku: string | null; available: boolean };
export type ExchangeProduct = { id: string; title: string; image: string | null; variants: ExchangeVariant[] };

const db = (table: string) => (supabaseAdmin as any).from(table);

type Ctx = { role: "admin" | "member"; ownerId: string; userId: string; permissions: { section: string }[] };

function assertAccess(ctx: Ctx) {
  if (ctx.role !== "admin" && !ctx.permissions.some((p) => p.section === "atendimento")) {
    throw new Error("Sem acesso ao Atendimento");
  }
}
// Quem aprova: o dono do workspace.
const isApprover = (ctx: Ctx) => ctx.role === "admin" && ctx.userId === ctx.ownerId;

const noticeKey = (id: string) => `troca:${id}`;

async function loadOrder(ownerId: string, orderId: string) {
  const { data: o } = await supabaseAdmin.from("shop_orders")
    .select("id,shop_id,order_number,raw").eq("id", orderId).eq("user_id", ownerId).maybeSingle();
  if (!o) throw new Error("Pedido não encontrado");
  return o as { id: string; shop_id: string; order_number: string | null; raw: any };
}

async function personName(userId: string) {
  const { data } = await supabaseAdmin.from("profiles").select("full_name").eq("id", userId).maybeSingle();
  return data?.full_name?.trim() || "Equipe";
}

const PRODUCT_FIELDS = `id title featuredMedia { preview { image { url } } }
  variants(first: 100) { nodes { id title sku availableForSale } }`;

function toProduct(p: any): ExchangeProduct {
  return {
    id: p.id, title: p.title, image: p.featuredMedia?.preview?.image?.url ?? null,
    variants: ((p.variants?.nodes ?? []) as any[]).map((v) => ({ id: v.id, title: v.title, sku: v.sku || null, available: !!v.availableForSale })),
  };
}

function addressLines(a: any): string[] {
  if (!a) return [];
  return [
    a.name ?? [a.first_name, a.last_name].filter(Boolean).join(" "),
    [a.address1, a.address2].filter(Boolean).join(", "),
    [a.city, a.province_code ?? a.province, a.zip].filter(Boolean).join(" "),
    a.country,
  ].filter(Boolean);
}

// Itens do pedido com as variantes do produto (pra escolher o tamanho novo).
export const getExchangeSetup = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ orderId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    assertAccess(context as Ctx);
    const o = await loadOrder(context.ownerId, data.orderId);
    const lines = ((o.raw?.line_items ?? []) as any[]).filter((l) => (l.current_quantity ?? l.quantity) > 0);
    const productIds = [...new Set(lines.map((l) => l.product_id).filter(Boolean))].map((id) => `gid://shopify/Product/${id}`);
    const products = new Map<string, ExchangeProduct>();
    if (productIds.length) {
      const res = await shopifyGql(o.shop_id, `query ExchangeProducts($ids: [ID!]!) {
        nodes(ids: $ids) { ... on Product { ${PRODUCT_FIELDS} } }
      }`, { ids: productIds });
      for (const p of (res?.nodes ?? []) as any[]) if (p?.id) products.set(p.id, toProduct(p));
    }
    const { data: shop } = await supabaseAdmin.from("shops").select("name").eq("id", o.shop_id).maybeSingle();
    return {
      orderNumber: o.order_number,
      store: shop?.name ?? null,
      address: addressLines(o.raw?.shipping_address),
      canApprove: isApprover(context as Ctx),
      lines: lines.map((l) => ({
        title: l.title as string,
        variantTitle: (l.variant_title as string) || null,
        variantId: l.variant_id ? `gid://shopify/ProductVariant/${l.variant_id}` : null,
        quantity: Number(l.current_quantity ?? l.quantity ?? 1),
        product: l.product_id ? products.get(`gid://shopify/Product/${l.product_id}`) ?? null : null,
      })),
    };
  });

// Trocar por outro modelo: busca na loja do pedido.
export const searchExchangeProducts = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ orderId: z.string().uuid(), q: z.string().trim().min(2).max(100) }).parse(d))
  .handler(async ({ data, context }) => {
    assertAccess(context as Ctx);
    const o = await loadOrder(context.ownerId, data.orderId);
    const res = await shopifyGql(o.shop_id, `query ExchangeSearch($q: String!) {
      products(first: 12, query: $q, sortKey: RELEVANCE) { nodes { ${PRODUCT_FIELDS} } }
    }`, { q: data.q });
    return ((res?.products?.nodes ?? []) as any[]).map(toProduct);
  });

// Pedidos de troca dos pedidos do cliente (cartão no painel).
export const listExchangeRequests = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ orderIds: z.array(z.string().uuid()).max(100) }).parse(d))
  .handler(async ({ data, context }) => {
    assertAccess(context as Ctx);
    if (!data.orderIds.length) return { canApprove: isApprover(context as Ctx), requests: [] };
    const { data: rows, error } = await db("support_exchange_requests")
      .select("id,order_id,order_number,fault,items,note,status,requested_by,decided_by,decided_at,reject_reason,new_order_name,error,created_at")
      .eq("owner_id", context.ownerId).in("order_id", data.orderIds).order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const people = [...new Set((rows ?? []).flatMap((r: any) => [r.requested_by, r.decided_by]).filter(Boolean))] as string[];
    const { data: profs } = people.length
      ? await supabaseAdmin.from("profiles").select("id,full_name").in("id", people)
      : { data: [] as { id: string; full_name: string | null }[] };
    const name = new Map((profs ?? []).map((p) => [p.id, p.full_name]));
    return {
      canApprove: isApprover(context as Ctx),
      requests: ((rows ?? []) as any[]).map((r) => ({
        ...r, items: r.items as ExchangeItem[],
        requestedByName: name.get(r.requested_by) ?? null,
        decidedByName: r.decided_by ? name.get(r.decided_by) ?? null : null,
      })),
    };
  });

const ItemInput = z.object({
  variant_id: z.string().regex(/^gid:\/\/shopify\/ProductVariant\/\d+$/),
  product_title: z.string().trim().min(1).max(300),
  variant_title: z.string().trim().max(200).nullable(),
  sku: z.string().trim().max(200).nullable(),
  quantity: z.number().int().min(1).max(20),
  replaces: z.string().trim().max(300).nullable(),
});

export const requestExchange = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    orderId: z.string().uuid(),
    conversationId: z.string().uuid().nullable(),
    fault: z.enum(EXCHANGE_FAULTS),
    items: z.array(ItemInput).min(1).max(20),
    note: z.string().trim().max(1000).nullable(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    assertAccess(ctx);
    const o = await loadOrder(ctx.ownerId, data.orderId);
    const { data: open } = await db("support_exchange_requests").select("id")
      .eq("owner_id", ctx.ownerId).eq("order_id", o.id).in("status", ["pendente", "gerando"]).limit(1);
    if (open?.length) throw new Error("Este pedido já tem uma troca aguardando aprovação");
    const raw = o.raw ?? {};
    const customerName = [raw.customer?.first_name, raw.customer?.last_name].filter(Boolean).join(" ")
      || raw.shipping_address?.name || null;
    const { data: row, error } = await db("support_exchange_requests").insert({
      owner_id: ctx.ownerId, requested_by: ctx.userId, shop_id: o.shop_id, conversation_id: data.conversationId,
      order_id: o.id, order_number: o.order_number, customer_email: raw.email ?? raw.customer?.email ?? null,
      customer_name: customerName, fault: data.fault, items: data.items, note: data.note,
    }).select("id").single();
    if (error) throw new Error(error.message);

    if (isApprover(ctx)) {
      const order = await generateExchangeOrder(ctx, row.id);
      return { status: "aprovado" as const, orderName: order.name };
    }

    const who = await personName(ctx.userId);
    const what = data.items.map((i) => `${i.quantity}× ${i.product_title}${i.variant_title ? ` (${i.variant_title})` : ""}`).join(", ");
    await raiseNotification(ctx.ownerId, noticeKey(row.id), {
      level: "warning",
      title: `Troca para aprovar — ${o.order_number ?? "pedido"}`,
      body: `${who} pediu: ${what}. Erro ${data.fault === "empresa" ? "da empresa" : "do fornecedor"}.${data.note ? ` Obs.: ${data.note}` : ""}`,
      link: data.conversationId ? `/atendimento?c=${data.conversationId}` : "/atendimento",
      targetUserId: ctx.ownerId,
    });
    return { status: "pendente" as const, orderName: null };
  });

export const decideExchange = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    id: z.string().uuid(), approve: z.boolean(), reason: z.string().trim().max(500).nullable().default(null),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    if (!isApprover(ctx)) throw new Error("Só o dono do workspace aprova trocas");
    if (data.approve) {
      const order = await generateExchangeOrder(ctx, data.id);
      return { status: "aprovado" as const, orderName: order.name };
    }
    const { data: done, error } = await db("support_exchange_requests").update({
      status: "recusado", decided_by: ctx.userId, decided_at: new Date().toISOString(), reject_reason: data.reason,
    }).eq("id", data.id).eq("owner_id", ctx.ownerId).in("status", ["pendente", "erro"]).select("id,requested_by,order_number,conversation_id");
    if (error) throw new Error(error.message);
    if (!done?.length) throw new Error("Essa troca já foi decidida");
    await resolveNotification(ctx.ownerId, noticeKey(data.id));
    await tellRequester(ctx, done[0], `Troca recusada — ${done[0].order_number ?? "pedido"}`, data.reason ?? "Sem motivo informado.");
    return { status: "recusado" as const, orderName: null };
  });

async function tellRequester(ctx: Ctx, r: { id: string; requested_by: string; conversation_id: string | null }, title: string, body: string) {
  if (r.requested_by === ctx.userId) return;
  await emitEvent(ctx.ownerId, {
    key: `troca_res:${r.id}:${Date.now()}`, title, body,
    link: r.conversation_id ? `/atendimento?c=${r.conversation_id}` : "/atendimento",
    targetUserId: r.requested_by,
  });
}

// Cria o pedido na Shopify. Trava a linha em "gerando" pra dois cliques não
// criarem dois pedidos; rascunho já criado numa tentativa que falhou é
// reaproveitado (só finaliza).
async function generateExchangeOrder(ctx: Ctx, id: string): Promise<{ id: string; name: string }> {
  const { data: claimed, error: claimErr } = await db("support_exchange_requests")
    .update({ status: "gerando", error: null, decided_by: ctx.userId, decided_at: new Date().toISOString() })
    .eq("id", id).eq("owner_id", ctx.ownerId).in("status", ["pendente", "erro"]).select("*");
  if (claimErr) throw new Error(claimErr.message);
  const r = claimed?.[0];
  if (!r) throw new Error("Essa troca já foi decidida ou está sendo gerada");

  try {
    const o = await loadOrder(ctx.ownerId, r.order_id);
    const raw = o.raw ?? {};
    let draftId: string | null = r.draft_order_id;
    if (!draftId) {
      const [approver, requester] = await Promise.all([personName(ctx.userId), personName(r.requested_by)]);
      const a = raw.shipping_address;
      const address = a ? {
        firstName: a.first_name ?? null, lastName: a.last_name ?? null, address1: a.address1 ?? null, address2: a.address2 ?? null,
        city: a.city ?? null, provinceCode: a.province_code ?? null, zip: a.zip ?? null, countryCode: a.country_code ?? null,
        phone: a.phone ?? null, company: a.company ?? null,
      } : undefined;
      const items = r.items as ExchangeItem[];
      const out = (await shopifyGql(o.shop_id, `mutation ExchangeDraft($input: DraftOrderInput!) {
        draftOrderCreate(input: $input) { draftOrder { id } userErrors { field message } }
      }`, {
        input: {
          email: raw.email || raw.customer?.email || undefined,
          purchasingEntity: raw.customer?.admin_graphql_api_id ? { customerId: raw.customer.admin_graphql_api_id } : undefined,
          shippingAddress: address,
          billingAddress: address,
          lineItems: items.map((i) => ({
            variantId: i.variant_id, quantity: i.quantity,
            appliedDiscount: { valueType: "PERCENTAGE", value: 100, title: "Troca" },
          })),
          tags: [EXCHANGE_TAG[r.fault as ExchangeFault]],
          note: `Troca do pedido ${o.order_number ?? ""} (erro ${r.fault === "empresa" ? "da empresa" : "do fornecedor"}). `
            + `Pedido por ${requester}, aprovado por ${approver} no SRX Growth.${r.note ? ` Obs.: ${r.note}` : ""}`,
          customAttributes: [{ key: "Original order", value: o.order_number ?? String(raw.id ?? "") }],
        },
      }))?.draftOrderCreate;
      if (out?.userErrors?.length) throw new Error(out.userErrors.map((e: any) => e.message).join("; ").slice(0, 200));
      draftId = out?.draftOrder?.id ?? null;
      if (!draftId) throw new Error("A Shopify não devolveu o rascunho");
      await db("support_exchange_requests").update({ draft_order_id: draftId }).eq("id", id);
    }

    const done = (await shopifyGql(o.shop_id, `mutation ExchangeComplete($id: ID!) {
      draftOrderComplete(id: $id) { draftOrder { order { id name } } userErrors { field message } }
    }`, { id: draftId }))?.draftOrderComplete;
    if (done?.userErrors?.length) throw new Error(done.userErrors.map((e: any) => e.message).join("; ").slice(0, 200));
    const order = done?.draftOrder?.order;
    if (!order?.id) throw new Error("A Shopify não finalizou o rascunho");

    await db("support_exchange_requests").update({ status: "aprovado", new_order_id: order.id, new_order_name: order.name, error: null }).eq("id", id);
    await resolveNotification(ctx.ownerId, noticeKey(id));
    await tellRequester(ctx, r, `Troca aprovada — ${order.name}`, `Pedido ${order.name} gerado (troca do ${r.order_number ?? "pedido"}).`);
    return { id: order.id, name: order.name };
  } catch (e: any) {
    const msg = String(e?.message ?? e).slice(0, 300);
    await db("support_exchange_requests").update({ status: "erro", error: msg }).eq("id", id);
    throw new Error(`Não deu pra gerar o pedido: ${msg}`);
  }
}
