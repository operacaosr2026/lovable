import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext, assertStoreIndicators } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getShopifyCreds } from "@/lib/shop-orders.functions";
import { addDaysISO, shopifyPaidOrdersCount, getEstornoStats, ESTORNO_WINDOW_DAYS } from "@/lib/estorno-daily.server";
import { isoTodayUS } from "@/lib/timezone";
import { fetchWithRetry } from "@/lib/http";

const StoreIdInput = z.object({ shopify_store_id: z.string().uuid() });

// Janela de detalhes da loja (Banco de Lojas). Pedidos contados direto na
// Shopify: o nosso banco só tem pedidos desde que a loja foi ligada.
//  - total: todos os pedidos da loja, qualquer status;
//  - semanas: 8 blocos de 7 dias terminando hoje (NY), só pedidos válidos
//    (pagos + parcialmente reembolsados, mesmo critério da taxa de estorno);
//  - estorno: a taxa de 90 dias já guardada (estorno-daily.server.ts).
export const getStoreDetails = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => StoreIdInput.parse(d))
  .handler(async ({ context, data }) => {
    assertStoreIndicators(context);
    const ownerId = context.ownerId;
    const { domain, token } = await getShopifyCreds(supabaseAdmin, ownerId, data.shopify_store_id);

    const today = isoTodayUS();
    const ranges = Array.from({ length: 8 }, (_, i) => {
      const to = addDaysISO(today, -7 * i);
      return { from: addDaysISO(to, -6), to };
    });

    const totalOrders = async () => {
      const res = await fetchWithRetry(`https://${domain}/admin/api/2024-10/orders/count.json?status=any`, {
        headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error(`Shopify orders/count ${res.status}`);
      return Number(((await res.json()) as any).count ?? 0);
    };

    const { data: shop } = await supabaseAdmin.from("shops").select("id")
      .eq("user_id", ownerId).eq("shopify_store_id", data.shopify_store_id).maybeSingle();

    const [total, weekCounts, estornoMap] = await Promise.all([
      totalOrders(),
      Promise.all(ranges.map((r) => shopifyPaidOrdersCount(domain, token, r.from, r.to))),
      shop ? getEstornoStats(ownerId, [shop.id]) : Promise.resolve(new Map()),
    ]);

    const weeks = ranges.map((r, i) => ({ ...r, orders: weekCounts[i], avgPerDay: weekCounts[i] / 7 }));
    const sum8 = weekCounts.reduce((s, n) => s + n, 0);
    const est = shop ? estornoMap.get(shop.id) : undefined;

    return {
      totalOrders: total,
      weeks,
      avgPerWeek: sum8 / 8,
      estorno: est
        ? { windowDays: ESTORNO_WINDOW_DAYS, pedidos: est.pedidos, estornos: est.estornos, rate: est.pedidos > 0 ? est.estornos / est.pedidos : 0 }
        : null,
    };
  });

export const listStoreCredentials = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => StoreIdInput.parse(d))
  .handler(async ({ context, data }) => {
    const { data: rows, error } = await supabaseAdmin
      .from("store_credentials")
      .select("id,label,value,position")
      .eq("user_id", context.ownerId)
      .eq("shopify_store_id", data.shopify_store_id)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const saveStoreCredential = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    id: z.string().uuid().optional(),
    shopify_store_id: z.string().uuid(),
    label: z.string().trim().min(1).max(100),
    value: z.string().max(5000),
  }).parse(d))
  .handler(async ({ context, data }) => {
    if (data.id) {
      const { error } = await supabaseAdmin
        .from("store_credentials")
        .update({ label: data.label, value: data.value })
        .eq("id", data.id)
        .eq("user_id", context.ownerId);
      if (error) throw new Error(error.message);
      return { ok: true };
    }
    const { data: store } = await supabaseAdmin.from("shopify_stores").select("id")
      .eq("id", data.shopify_store_id).eq("user_id", context.ownerId).maybeSingle();
    if (!store) throw new Error("Loja não encontrada");
    const { count } = await supabaseAdmin.from("store_credentials").select("id", { count: "exact", head: true })
      .eq("user_id", context.ownerId).eq("shopify_store_id", data.shopify_store_id);
    const { error } = await supabaseAdmin.from("store_credentials").insert({
      user_id: context.ownerId, shopify_store_id: data.shopify_store_id,
      label: data.label, value: data.value, position: count ?? 0,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteStoreCredential = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await supabaseAdmin
      .from("store_credentials")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
