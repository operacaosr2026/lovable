import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadAuditOrders } from "@/lib/intel.server";
import { auditSupplier, type Severity, type TimelineStep } from "@/lib/intel/supplier-audit";
import { postingCalendar } from "@/lib/logistics-kpis";

// Inteligência → gaveta "Ver análise" → Pedidos: os pedidos citados numa dica,
// com a situação, o chargeback e a linha do tempo completa (supplier-audit.ts).

export type IntelOrder = {
  orderNumber: string; shopName: string; revenue: number;
  status: "entregue" | "em_transito" | "parado" | "nao_postado" | "sem_codigo";
  chargeback: { reason: string | null; initiatedAt: string } | null;
  deliveredToChargebackDays: number | null; daysSinceLastEvent: number | null; daysSincePurchase: number;
  severity: Severity; flags: string[]; steps: TimelineStep[]; trackingCode: string | null;
};

export const getIntelOrders = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ numbers: z.array(z.string().max(40)).max(60) }).parse(d))
  .handler(async ({ context, data }): Promise<IntelOrder[]> => {
    if (context.role !== "admin" && !context.permissions.some((p: any) => p.section === "consultor")) {
      throw new Error("Sem acesso à Inteligência");
    }
    const wanted = new Set(data.numbers.map((n) => (n.startsWith("#") ? n : `#${n}`)));
    if (!wanted.size) return [];
    const [orders, { data: holidays }] = await Promise.all([
      loadAuditOrders(context.ownerId),
      supabaseAdmin.from("posting_holidays").select("day,kind").eq("user_id", context.ownerId),
    ]);
    const audit = auditSupplier(orders, { cal: postingCalendar(holidays as any) });
    const now = Date.now();
    return audit.envios.filter((e) => e.orderNumber && wanted.has(e.orderNumber)).map((e) => ({
      orderNumber: e.orderNumber!, shopName: e.shopName, revenue: e.revenue, trackingCode: e.trackingCode,
      status: e.deliveredAt ? "entregue" : !e.codeAt ? "sem_codigo" : !e.firstMoveAt ? "nao_postado"
        : (e.daysSinceLastEvent ?? 0) > 5 ? "parado" : "em_transito",
      chargeback: e.chargeback,
      deliveredToChargebackDays: e.chargeback && e.deliveredAt
        ? Math.round(((Date.parse(e.chargeback.initiatedAt) - Date.parse(e.deliveredAt)) / 86_400_000) * 10) / 10 : null,
      daysSinceLastEvent: e.daysSinceLastEvent == null ? null : Math.round(e.daysSinceLastEvent * 10) / 10,
      daysSincePurchase: Math.round(((now - Date.parse(e.createdAt)) / 86_400_000) * 10) / 10,
      severity: e.severity, flags: e.flags.map((f) => f.text), steps: e.steps,
    }));
  });
