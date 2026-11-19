import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isoTodayUS } from "@/lib/timezone";
import { recomputeOrderCostForProduct } from "@/lib/shop-orders.functions";

// Histórico de preços do produto (Card do Produto › Custo). Cada pedido usa o
// custo que valia na data do pedido (productCostAt); a gravação é feita por
// product_cost_history_write (uma transação: histórico + products.cost) e
// depois a previsão do Caixa dos pedidos ainda não pagos é refeita.

export const COST_START = "1900-01-01";
export type CostEntry = { id: string; valid_from: string; cost: number };

const ISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.number().finite().nonnegative().max(1_000_000).transform((v) => Math.round(v * 100) / 100);

// Conferir o acesso: quem enxerga o produto (RLS) pode editá-lo (mesma política FOR ALL).
async function assertProduct(context: any, productId: string) {
  const { data } = await context.supabase.from("products").select("id,user_id").eq("id", productId).maybeSingle();
  if (!data || data.user_id !== context.ownerId) throw new Error("Produto não encontrado");
}

async function write(context: any, args: { product_id: string; entry_id: string | null; valid_from: string | null; cost: number | null; del: boolean }) {
  await assertProduct(context, args.product_id);
  const { data: affected, error } = await (supabaseAdmin as any).rpc("product_cost_history_write", {
    p_product_id: args.product_id, p_entry_id: args.entry_id, p_valid_from: args.valid_from, p_cost: args.cost, p_delete: args.del,
  });
  if (error) throw new Error(error.message);
  let cashError: string | null = null;
  let days = 0;
  try {
    days = (await recomputeOrderCostForProduct(context.ownerId, args.product_id, String(affected))).days;
  } catch (e: any) {
    console.error("[product-cost] previsão do Caixa:", e);
    cashError = String(e?.message ?? e);
  }
  return { ok: true, cashDays: days, cashError };
}

export const getProductCostHistory = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ product_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await assertProduct(context, data.product_id);
    const { data: rows, error } = await supabaseAdmin.from("product_cost_history").select("id,valid_from,cost")
      .eq("product_id", data.product_id).order("valid_from", { ascending: false });
    if (error) throw new Error(error.message);
    return {
      today: isoTodayUS(),
      entries: (rows ?? []).map((r: any) => ({ id: r.id, valid_from: String(r.valid_from), cost: Number(r.cost ?? 0) })) as CostEntry[],
    };
  });

export const saveProductCostEntry = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    product_id: z.string().uuid(),
    entry_id: z.string().uuid().nullable(),
    valid_from: ISO,
    cost: money,
  }).parse(d))
  .handler(async ({ context, data }) => {
    if (data.valid_from !== COST_START && data.valid_from > isoTodayUS()) throw new Error("A data não pode ser no futuro");
    return write(context, { product_id: data.product_id, entry_id: data.entry_id, valid_from: data.valid_from, cost: data.cost, del: false });
  });

export const deleteProductCostEntry = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ product_id: z.string().uuid(), entry_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => write(context, { product_id: data.product_id, entry_id: data.entry_id, valid_from: null, cost: null, del: true }));
