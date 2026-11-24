import { orderLineItemsCost, costOpts, type CostProduct } from "@/lib/product-cost-match";

// Custo de fornecedor por pedido — a mesma conta do lote no Caixa (produto do
// card com o custo da data do pedido; sem card, o custo da loja na data).

// Custo unitário da loja na data (shop_product_cost_history); sem faixa que
// cubra a data, `fallback` (default_unit_cost da loja).
export async function unitCostFor(supabase: any, ownerId: string, shopId: string, date: string, fallback: number) {
  const { data } = await supabase.from("shop_product_cost_history").select("unit_cost,valid_from,valid_to")
    .eq("user_id", ownerId).eq("shop_id", shopId)
    .or(`valid_from.is.null,valid_from.lte.${date}`)
    .order("valid_from", { ascending: false, nullsFirst: false });
  for (const r of data ?? []) {
    const okFrom = !r.valid_from || r.valid_from <= date;
    const okTo = !r.valid_to || r.valid_to >= date;
    if (okFrom && okTo) return Number(r.unit_cost);
  }
  return Number(fallback ?? 0);
}

// `orders`: linhas de shop_orders com id, shop_id, order_date, line_items
// (raw->line_items), tags (raw->>tags), tracking_code, paid_supplier.
// Pedido pago usa o fornecedor do pagamento; não pago, o padrão do produto.
export async function supplierCostByOrder(supabase: any, ownerId: string, orders: any[], products: CostProduct[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const defaults = new Map<string, number>();
  const units = new Map<string, number>();
  for (const o of orders) {
    if (!defaults.has(o.shop_id)) {
      const { data: s } = await supabase.from("shop_order_settings").select("default_unit_cost")
        .eq("user_id", ownerId).eq("shop_id", o.shop_id).maybeSingle();
      defaults.set(o.shop_id, Number(s?.default_unit_cost ?? 0));
    }
    const key = `${o.shop_id}|${o.order_date}`;
    if (!units.has(key)) units.set(key, await unitCostFor(supabase, ownerId, o.shop_id, o.order_date, defaults.get(o.shop_id)!));
    const cost = orderLineItemsCost(o.line_items, products, units.get(key)!, o.tags, costOpts(o));
    out.set(o.id, Math.round(cost * 100) / 100);
  }
  return out;
}
