import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const listLogisticsOrders = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d: unknown) =>
    z.object({
      shop_ids: z.array(z.string().uuid()),
      from: z.string(),
      to: z.string(),
    }).parse(d)
  )
  .handler(async ({ context, data }: any) => {
    // Pedido reembolsado ou cancelado no Shopify não é mais problema de
    // logística/rastreio — sai da aba inteira (não só dos KPIs, como o "fora
    // do KPI" manual). "voided" cobre cancelamento antes da cobrança.
    const { data: rows, error } = await supabaseAdmin
      .from("shop_orders")
      .select("id,order_number,order_date,shop_id,items_count,carrier,tracking_code,tracking_url,delivery_status,shipped_at,delivered_at,problem_at,logistics_note,kpi_excluded")
      .eq("user_id", context.ownerId)
      .in("shop_id", data.shop_ids)
      .gte("order_date", data.from)
      .lte("order_date", data.to)
      // NULL NOT IN (...) é NULL em SQL (não TRUE) — usar .not("in") sozinho
      // descartava silenciosamente todo pedido com shopify_financial_status
      // nulo (ex: sincronizado pelo botão manual, que não grava essa coluna).
      .or("shopify_financial_status.is.null,shopify_financial_status.not.in.(refunded,partially_refunded,voided)")
      .filter("raw->>cancelled_at", "is", null)
      .order("order_date", { ascending: false });
    if (error) throw new Error(error.message);

    // Data do último evento real de rastreio (Track123), quando o pedido tem
    // integração ativa — mais confiável que shipped_at pra saber se o rastreio
    // "parou" de andar, já que shipped_at não muda depois da postagem.
    const orderIds = (rows ?? []).map((o: any) => o.id);
    const lastEventMap = new Map<string, string | null>();
    const lastLabelMap = new Map<string, string | null>();
    if (orderIds.length) {
      const { data: trackingRows } = await supabaseAdmin
        .from("shop_order_tracking")
        .select("order_id,last_event_at,last_event_label,tracking_status")
        .in("order_id", orderIds);
      for (const t of trackingRows ?? []) {
        lastEventMap.set(t.order_id, t.last_event_at);
        lastLabelMap.set(t.order_id, t.tracking_status ?? t.last_event_label);
      }
    }
    // O Shopify já marca "shipped" assim que a etiqueta é criada (tem código de
    // rastreio), mas isso não significa que a transportadora pegou o pacote —
    // enquanto o rastreio real (Track123) só mostrar "info recebida", o status
    // exibido continua "pendente envio". Calculado na leitura (não grava nada)
    // pra não brigar com o sync do Shopify, que roda em outro job.
    function isInfoReceivedOnly(label: string | null | undefined): boolean {
      if (!label) return false;
      return label.toLowerCase().replace(/\s+/g, "").includes("inforeceived");
    }

    // O status pode ter sido atualizado automaticamente (Track123) via shipped_at/
    // delivered_at/problem_at sem que a coluna delivery_status tenha sido tocada —
    // aqui reconciliamos as duas fontes pra refletir o que já foi detectado.
    // delivered_at/problem_at são sinais fortes: sempre prevalecem sobre um
    // delivery_status desatualizado (ex.: preso em "shipped" desde o envio).
    // Pedido feito há 25+ dias e ainda não entregue (nem já marcado como problema/
    // devolvido) é sinal de atraso — sinaliza automaticamente como "problem" e
    // preenche a obs, sem sobrescrever uma nota que já tenha sido escrita à mão.
    const nowMs = Date.now();
    const withEffectiveStatus = (rows ?? []).map((o: any) => {
      let status = o.delivery_status;
      if (o.delivered_at) status = "delivered";
      else if (o.problem_at && status !== "waiting_customer") status = "problem";
      else if (!status || status === "pending_shipment") status = o.shipped_at ? "shipped" : "pending_shipment";
      // Rebaixado pra "pendente envio": some a Data Postado junto (senão fica
      // contraditório mostrar uma data de postagem com status "pendente"), e
      // não conta mais no tempo médio de postagem lá embaixo.
      let shippedAt = o.shipped_at;
      if (status === "shipped" && isInfoReceivedOnly(lastLabelMap.get(o.id))) {
        status = "pending_shipment";
        shippedAt = null;
      }

      let note = o.logistics_note;
      if (status !== "delivered" && status !== "problem" && status !== "returned" && status !== "waiting_customer") {
        const daysSinceOrder = (nowMs - new Date(o.order_date).getTime()) / 86_400_000;
        if (daysSinceOrder >= 25) {
          status = "problem";
          if (!note) note = "tempo de entrega demorado";
        }
      }
      return { ...o, delivery_status: status, shipped_at: shippedAt, logistics_note: note, last_event_at: lastEventMap.get(o.id) ?? null };
    });

    return withEffectiveStatus;
  });

export const updateOrderLogistics = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d: unknown) =>
    z.object({
      order_id: z.string().uuid(),
      carrier: z.string().optional().nullable(),
      tracking_code: z.string().optional().nullable(),
      tracking_url: z.string().optional().nullable(),
      delivery_status: z.string().optional(),
      logistics_note: z.string().max(500).optional().nullable(),
      kpi_excluded: z.boolean().optional(),
    }).parse(d)
  )
  .handler(async ({ context, data }: any) => {
    const { order_id, ...patch } = data;
    const extra: Record<string, string> = {};
    if (patch.delivery_status === "shipped") extra.shipped_at = new Date().toISOString().slice(0, 10);
    if (patch.delivery_status === "delivered") extra.delivered_at = new Date().toISOString().slice(0, 10);
    if (patch.delivery_status === "problem") extra.problem_at = new Date().toISOString().slice(0, 10);
    const { error } = await supabaseAdmin
      .from("shop_orders")
      .update({ ...patch, ...extra } as any)
      .eq("id", order_id)
      .eq("user_id", context.ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
