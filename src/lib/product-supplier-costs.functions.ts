import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { recomputeOrderCostForProduct } from "@/lib/shop-orders.functions";
import { BASE_SUPPLIER, SUPPLIERS } from "@/lib/suppliers";

// Card do Produto › Custo › Fornecedores. O preço da Alice é o custo do produto
// (com o Histórico de preços); os outros fornecedores têm um preço próprio
// (product_supplier_costs). O fornecedor padrão do produto (products.default_supplier,
// null = Alice) dá o custo dos pedidos ainda não pagos — lucro e previsão do
// Caixa; pedido pago usa o fornecedor do pagamento. Mudou: refaz a previsão.

const SUPPLIER = z.enum(SUPPLIERS);
const money = z.number().finite().nonnegative().max(1_000_000).transform((v) => Math.round(v * 100) / 100);

async function assertProduct(context: any, productId: string) {
  const { data } = await context.supabase.from("products").select("id,user_id").eq("id", productId).maybeSingle();
  if (!data || data.user_id !== context.ownerId) throw new Error("Produto não encontrado");
}

async function refreshCash(ownerId: string, productId: string) {
  try {
    return { cashDays: (await recomputeOrderCostForProduct(ownerId, productId, "1900-01-01")).days, cashError: null as string | null };
  } catch (e: any) {
    console.error("[product-supplier-costs] previsão do Caixa:", e);
    return { cashDays: 0, cashError: String(e?.message ?? e) };
  }
}

export const getProductSuppliers = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ product_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await assertProduct(context, data.product_id);
    const [{ data: p }, { data: rows, error }] = await Promise.all([
      supabaseAdmin.from("products").select("default_supplier").eq("id", data.product_id).maybeSingle(),
      supabaseAdmin.from("product_supplier_costs").select("supplier,cost").eq("product_id", data.product_id),
    ]);
    if (error) throw new Error(error.message);
    const costs: Record<string, number> = {};
    for (const r of rows ?? []) costs[r.supplier] = Number(r.cost ?? 0);
    return { defaultSupplier: ((p as any)?.default_supplier as string | null) || BASE_SUPPLIER, costs };
  });

// cost null = apaga o preço desse fornecedor (volta a cair no preço da Alice).
export const saveProductSupplierCost = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ product_id: z.string().uuid(), supplier: SUPPLIER, cost: money.nullable() }).parse(d))
  .handler(async ({ context, data }) => {
    if (data.supplier === BASE_SUPPLIER) throw new Error("O preço da Alice é o custo do produto (Histórico de preços)");
    await assertProduct(context, data.product_id);
    const q = data.cost == null
      ? supabaseAdmin.from("product_supplier_costs").delete().eq("product_id", data.product_id).eq("supplier", data.supplier)
      : supabaseAdmin.from("product_supplier_costs").upsert({
          user_id: context.ownerId, product_id: data.product_id, supplier: data.supplier, cost: data.cost, updated_at: new Date().toISOString(),
        }, { onConflict: "product_id,supplier" });
    const { error } = await q;
    if (error) throw new Error(error.message);
    return { ok: true, ...(await refreshCash(context.ownerId, data.product_id)) };
  });

export const setProductDefaultSupplier = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ product_id: z.string().uuid(), supplier: SUPPLIER }).parse(d))
  .handler(async ({ context, data }) => {
    await assertProduct(context, data.product_id);
    const { error } = await supabaseAdmin.from("products")
      .update({ default_supplier: data.supplier === BASE_SUPPLIER ? null : data.supplier }).eq("id", data.product_id);
    if (error) throw new Error(error.message);
    return { ok: true, ...(await refreshCash(context.ownerId, data.product_id)) };
  });
