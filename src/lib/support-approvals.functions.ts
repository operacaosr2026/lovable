import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { canSeeApprovals, db, isApprover, personNames, type SupportCtx as Ctx } from "@/lib/support-approval.server";
import { SUPPORT_IMAGES_BUCKET } from "@/lib/support-images.server";
import type { RefundLine } from "@/lib/support-refund.functions";
import type { ExchangeItem } from "@/lib/support-exchange.functions";

// Atendimento › Aprovações: reembolsos e trocas de todas as lojas num lugar só.
// Em aberto (pendente, gerando, erro) mais as decisões dos últimos 14 dias (a
// tela mostra 7; os 7 de antes servem pra comparar o tempo de análise). Vê quem
// aprova ou tem "Aprovações (ver a fila)" nas permissões.

const REFUND_COLS = "id,shop_id,conversation_id,order_id,order_number,customer_name,customer_email,mode,reason,line_items,include_shipping,amount,currency,notify_customer,charge_on_delivery,note,status,requested_by,decided_by,decided_at,reject_reason,refunded_amount,error,created_at";
const EXCHANGE_COLS = "id,shop_id,conversation_id,order_id,order_number,customer_name,customer_email,fault,items,note,status,requested_by,decided_by,decided_at,reject_reason,new_order_name,error,created_at";
const OPEN = ["pendente", "gerando", "erro"];

function assertSee(ctx: Ctx) {
  if (!canSeeApprovals(ctx)) throw new Error("Sem acesso às Aprovações");
}

// Foto do card ligado a cada produto da Shopify (product_shopify_links).
async function productImages(ownerId: string, shopifyIds: string[]) {
  const out = new Map<string, string>();
  if (!shopifyIds.length) return out;
  const { data: links } = await supabaseAdmin.from("product_shopify_links")
    .select("shopify_product_id,product_id").eq("user_id", ownerId).in("shopify_product_id", shopifyIds);
  const cardIds = [...new Set((links ?? []).map((l) => l.product_id))];
  if (!cardIds.length) return out;
  const { data: cards } = await supabaseAdmin.from("products").select("id,main_image_url").in("id", cardIds);
  const img = new Map((cards ?? []).filter((c) => c.main_image_url && !c.main_image_url.startsWith("data:")).map((c) => [c.id, c.main_image_url!]));
  for (const l of links ?? []) if (l.shopify_product_id && img.has(l.product_id)) out.set(l.shopify_product_id, img.get(l.product_id)!);
  return out;
}

type OrderLine = { title: string; variant: string | null; quantity: number; price: number; productId: string | null };
function orderLines(lineItems: any): OrderLine[] {
  return ((lineItems ?? []) as any[]).map((l) => ({
    title: String(l.title ?? ""), variant: l.variant_title || null, quantity: Number(l.current_quantity ?? l.quantity ?? 1),
    price: Number(l.price ?? 0), productId: l.product_id ? String(l.product_id) : null,
  }));
}

export const listSupportApprovals = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    const ctx = context as Ctx;
    assertSee(ctx);
    const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
    const load = (table: string, cols: string) => Promise.all([
      db(table).select(cols).eq("owner_id", ctx.ownerId).in("status", OPEN).order("created_at", { ascending: true }),
      db(table).select(cols).eq("owner_id", ctx.ownerId).in("status", ["aprovado", "recusado"]).gte("decided_at", since)
        .order("decided_at", { ascending: false }).limit(300),
    ]).then((res) => {
      const err = res.find((r: any) => r.error)?.error;
      if (err) throw new Error(err.message);
      return res.flatMap((r: any) => (r.data ?? []) as any[]);
    });
    const [refunds, exchanges] = await Promise.all([load("support_refund_requests", REFUND_COLS), load("support_exchange_requests", EXCHANGE_COLS)]);

    const all = [...refunds, ...exchanges];
    const orderIds = [...new Set(all.map((r) => r.order_id).filter(Boolean))] as string[];
    const [name, shops, orders] = await Promise.all([
      personNames(all.flatMap((r) => [r.requested_by, r.decided_by])),
      supabaseAdmin.from("shops").select("id,name").in("id", [...new Set(all.map((r) => r.shop_id).filter(Boolean))] as string[]),
      orderIds.length
        ? supabaseAdmin.from("shop_orders").select("id,line_items:raw->line_items").in("id", orderIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const shopName = new Map((shops.data ?? []).map((s) => [s.id, s.name]));
    const firstLine = new Map(((orders.data ?? []) as any[]).map((o) => [o.id as string, orderLines(o.line_items)[0] ?? null]));
    const images = await productImages(ctx.ownerId, [...new Set([...firstLine.values()].map((l) => l?.productId).filter(Boolean))] as string[]);

    const common = (r: any) => {
      const line = firstLine.get(r.order_id) ?? null;
      return {
        store: shopName.get(r.shop_id) ?? null,
        requestedByName: name.get(r.requested_by) ?? null,
        decidedByName: r.decided_by ? name.get(r.decided_by) ?? null : null,
        product: line ? { title: line.title, variant: line.variant, image: line.productId ? images.get(line.productId) ?? null : null } : null,
      };
    };
    return {
      canApprove: isApprover(ctx),
      items: [
        ...refunds.map((r) => ({
          kind: "reembolso" as const, ...r, ...common(r),
          amount: Number(r.amount), refunded_amount: r.refunded_amount == null ? null : Number(r.refunded_amount),
          line_items: r.line_items as RefundLine[],
        })),
        ...exchanges.map((r) => ({ kind: "troca" as const, ...r, ...common(r), items: r.items as ExchangeItem[] })),
      ],
    };
  });

// Painel lateral: itens do pedido, fotos que o cliente mandou e a conversa.
export const getSupportApprovalDetail = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ orderId: z.string().uuid(), conversationId: z.string().uuid().nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    assertSee(ctx);
    const [order, imgs, msgs] = await Promise.all([
      supabaseAdmin.from("shop_orders").select("currency,line_items:raw->line_items,total:raw->>total_price")
        .eq("id", data.orderId).eq("user_id", ctx.ownerId).maybeSingle(),
      data.conversationId
        ? db("support_images").select("id,storage_path,thumb_path,large_path,sent_at")
            .eq("owner_id", ctx.ownerId).eq("conversation_id", data.conversationId).or("kind.is.null,kind.eq.foto")
            .order("sent_at", { ascending: false }).limit(12)
        : Promise.resolve({ data: [] }),
      data.conversationId
        ? db("support_messages").select("id,direction,from_name,from_email,subject,summary,sent_at")
            .eq("owner_id", ctx.ownerId).eq("conversation_id", data.conversationId)
            .order("sent_at", { ascending: false }).limit(8)
        : Promise.resolve({ data: [] }),
    ]);

    const lines = orderLines((order.data as any)?.line_items);
    const pimg = await productImages(ctx.ownerId, [...new Set(lines.map((l) => l.productId).filter(Boolean))] as string[]);

    const rows = ((imgs as any).data ?? []) as any[];
    const paths = rows.flatMap((r) => [r.storage_path, r.thumb_path, r.large_path].filter(Boolean) as string[]);
    const signed = paths.length
      ? (await supabaseAdmin.storage.from(SUPPORT_IMAGES_BUCKET).createSignedUrls(paths, 60 * 60)).data ?? []
      : [];
    const url = new Map(signed.map((s) => [s.path, s.signedUrl]));
    const urlOf = (p: string | null) => (p ? url.get(p) ?? null : null);

    return {
      currency: ((order.data as any)?.currency as string | null) ?? "USD",
      lines: lines.map((l) => ({ ...l, image: l.productId ? pimg.get(l.productId) ?? null : null })),
      images: rows.map((r) => ({ id: r.id as string, thumb: urlOf(r.thumb_path) ?? urlOf(r.storage_path), large: urlOf(r.large_path) ?? urlOf(r.storage_path) })),
      messages: (((msgs as any).data ?? []) as any[]).reverse().map((m) => ({
        id: m.id as string, inbound: m.direction === "in", from: (m.from_name || m.from_email || "") as string,
        subject: m.subject as string | null, summary: m.summary as string | null, sentAt: m.sent_at as string,
      })),
    };
  });
