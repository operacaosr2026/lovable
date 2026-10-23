import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { orderNumbersInText, orderNumberVariants } from "@/lib/order-numbers";

// Banco de imagens: de qual pedido (e produtos) é a foto. Pedido citado no
// assunto ("#L4-1483") vale primeiro; senão, o último pedido do cliente (pelo
// e-mail) feito até a data do e-mail. Itens que não são produto (proteção de
// envio, gorjeta) ficam de fora.

const NOT_PRODUCT = /protec|insurance|route|seguro|tip\b|gorjeta|shipping/i;

type Found = { orderId: string | null; products: string[] };

export async function imageOrderProducts(ownerId: string, email: string | null, subject: string | null, sentAt: string): Promise<Found> {
  const cols = "id,created_at_shopify,items:raw->line_items";
  let order: any = null;
  const nums = orderNumbersInText(subject);
  if (nums.length) {
    const { data } = await supabaseAdmin.from("shop_orders").select(cols)
      .eq("user_id", ownerId).in("order_number", orderNumberVariants(nums)).limit(1);
    order = data?.[0] ?? null;
  }
  if (!order && email) {
    const { data: ids } = await supabaseAdmin.rpc("shop_order_ids_by_email", { p_user_id: ownerId, p_email: email.toLowerCase() });
    if ((ids as string[] | null)?.length) {
      const { data } = await supabaseAdmin.from("shop_orders").select(cols)
        .eq("user_id", ownerId).in("id", ids as string[]).order("created_at_shopify", { ascending: false });
      const rows = (data ?? []) as any[];
      order = rows.find((o) => o.created_at_shopify && o.created_at_shopify <= sentAt) ?? rows[rows.length - 1] ?? null;
    }
  }
  if (!order) return { orderId: null, products: [] };
  const titles = ((order.items ?? []) as any[]).map((l) => String(l.title ?? "").trim()).filter((t) => t && !NOT_PRODUCT.test(t));
  return { orderId: order.id, products: [...new Set(titles)] };
}
