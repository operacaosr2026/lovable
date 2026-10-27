import { createServerFn } from "@tanstack/react-start";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { assertSupportAccess, db, isApprover, personNames, type SupportCtx as Ctx } from "@/lib/support-approval.server";
import type { RefundLine } from "@/lib/support-refund.functions";
import type { ExchangeItem } from "@/lib/support-exchange.functions";

// Atendimento › Aprovações: reembolsos e trocas de todas as lojas num lugar só.
// Em aberto (pendente, gerando, erro) mais as decisões dos últimos 7 dias.

const REFUND_COLS = "id,shop_id,conversation_id,order_id,order_number,customer_name,customer_email,mode,line_items,include_shipping,amount,currency,notify_customer,charge_on_delivery,note,status,requested_by,decided_by,decided_at,reject_reason,refunded_amount,error,created_at";
const EXCHANGE_COLS = "id,shop_id,conversation_id,order_id,order_number,customer_name,customer_email,fault,items,note,status,requested_by,decided_by,decided_at,reject_reason,new_order_name,error,created_at";
const OPEN = ["pendente", "gerando", "erro"];

export const listSupportApprovals = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    const ctx = context as Ctx;
    assertSupportAccess(ctx);
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const load = (table: string, cols: string) => Promise.all([
      db(table).select(cols).eq("owner_id", ctx.ownerId).in("status", OPEN).order("created_at", { ascending: true }),
      db(table).select(cols).eq("owner_id", ctx.ownerId).in("status", ["aprovado", "recusado"]).gte("decided_at", since)
        .order("decided_at", { ascending: false }).limit(50),
    ]).then((res) => {
      const err = res.find((r: any) => r.error)?.error;
      if (err) throw new Error(err.message);
      return res.flatMap((r: any) => (r.data ?? []) as any[]);
    });
    const [refunds, exchanges] = await Promise.all([load("support_refund_requests", REFUND_COLS), load("support_exchange_requests", EXCHANGE_COLS)]);

    const all = [...refunds, ...exchanges];
    const [name, shops] = await Promise.all([
      personNames(all.flatMap((r) => [r.requested_by, r.decided_by])),
      supabaseAdmin.from("shops").select("id,name").in("id", [...new Set(all.map((r) => r.shop_id).filter(Boolean))] as string[]),
    ]);
    const shopName = new Map((shops.data ?? []).map((s) => [s.id, s.name]));
    const common = (r: any) => ({
      store: shopName.get(r.shop_id) ?? null,
      requestedByName: name.get(r.requested_by) ?? null,
      decidedByName: r.decided_by ? name.get(r.decided_by) ?? null : null,
    });
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
