import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getZohoAccount, sendZohoMail, syncZohoMailbox } from "@/lib/zoho-mail.server";
import { buildBody } from "@/lib/support-body.server";
import { NOTICE_INTERVAL_MIN } from "@/lib/order-notices";

// Fila da aba Notificações: o cron roda a cada minuto e manda 1 e-mail por
// workspace quando já passou o intervalo (NOTICE_INTERVAL_MIN) desde o último —
// o Zoho limita 50–500 e-mails externos por hora e não aceita envio em rajada.
const NOTICE_INTERVAL_MS = NOTICE_INTERVAL_MIN * 60_000;

export async function hasQueuedNotices() {
  const { count } = await supabaseAdmin.from("order_notices").select("id", { count: "exact", head: true }).eq("status", "na_fila");
  return (count ?? 0) > 0;
}

export async function runNoticeQueue() {
  const { data: owners, error } = await supabaseAdmin.from("order_notices").select("owner_id").eq("status", "na_fila");
  if (error) throw new Error(error.message);
  const result: Record<string, string> = {};
  for (const ownerId of new Set((owners ?? []).map((o) => o.owner_id))) {
    try { result[ownerId] = await sendNext(ownerId); }
    catch (e: any) { result[ownerId] = `erro: ${String(e?.message ?? e)}`; }
  }
  return result;
}

async function sendNext(ownerId: string): Promise<string> {
  // Intervalo contado do último envio (folga de 10 s pro cron, que não cai
  // exatamente no mesmo segundo).
  const { data: last } = await supabaseAdmin.from("order_notices").select("sent_at")
    .eq("owner_id", ownerId).eq("status", "enviado").not("sent_at", "is", null)
    .order("sent_at", { ascending: false }).limit(1).maybeSingle();
  if (last?.sent_at && Date.now() - Date.parse(last.sent_at) < NOTICE_INTERVAL_MS - 10_000) return "aguardando intervalo";

  const { data: n } = await supabaseAdmin.from("order_notices")
    .select("id,order_id,to_email,subject,body,sent_by")
    .eq("owner_id", ownerId).eq("status", "na_fila").order("queued_at").order("id").limit(1).maybeSingle();
  if (!n) return "fila vazia";

  // Pedido entregue, cancelado ou reembolsado enquanto esperava: não manda.
  const { data: o } = await supabaseAdmin.from("shop_orders")
    .select("delivered_at,delivery_status,shopify_financial_status,cancelled_at:raw->>cancelled_at").eq("id", n.order_id).maybeSingle();
  const why = !o ? "pedido não existe mais"
    : o.cancelled_at ? "pedido cancelado"
    : o.delivered_at || o.delivery_status === "delivered" ? "pedido já foi entregue"
    : ["refunded", "partially_refunded", "voided"].includes(String(o.shopify_financial_status)) ? "pedido reembolsado"
    : null;
  if (why) {
    await supabaseAdmin.from("order_notices").update({ status: "cancelado", error: why }).eq("id", n.id);
    return `pulado: ${why}`;
  }

  const acc = await getZohoAccount(ownerId);
  if (!acc?.refresh_token || !acc.account_id) return "Zoho não conectado (fila parada)";
  // Trava o e-mail: duas rodadas ao mesmo tempo não mandam o mesmo duas vezes.
  const { data: claimed } = await supabaseAdmin.from("order_notices").update({ status: "enviando", sending_at: new Date().toISOString() })
    .eq("id", n.id).eq("status", "na_fila").select("id");
  if (!claimed?.length) return "já sendo enviado";
  try {
    const html = await buildBody(ownerId, n.sent_by ?? ownerId, n.body ?? "", true);
    await sendZohoMail(acc, { to: n.to_email, subject: n.subject, html });
  } catch (e: any) {
    const msg = String(e?.message ?? e).slice(0, 300);
    // Zoho recusou (limite, fora do ar): volta pra fila e tenta na próxima rodada.
    // Tempo esgotado ou erro 5xx genérico NÃO volta: o Zoho pode ter mandado e só
    // a resposta falhou — reenviar mandava o mesmo aviso 2x pro cliente. Fica em
    // "erro" pra conferir nos Enviados do Zoho antes de mandar de novo.
    if (/timeout|aborted/i.test(msg)) {
      await supabaseAdmin.from("order_notices").update({ status: "erro", error: `Envio incerto (sem resposta do Zoho) — confira nos Enviados antes de reenviar. ${msg}`.slice(0, 300) }).eq("id", n.id);
      return `incerto: ${msg}`;
    }
    if (/limit|too many|rate|exceed|temporar|\b(429|503)\b/i.test(msg)) {
      await supabaseAdmin.from("order_notices").update({ status: "na_fila" }).eq("id", n.id);
      return `tentar de novo: ${msg}`;
    }
    await supabaseAdmin.from("order_notices").update({ status: "erro", error: msg }).eq("id", n.id);
    return `erro: ${msg}`;
  }
  const at = new Date().toISOString();
  await supabaseAdmin.from("order_notices").update({ status: "enviado", sent_at: at, error: null }).eq("id", n.id);
  // Rastreamento (Lojas e Grupos) mostra "Avisado em …".
  await supabaseAdmin.from("shop_orders").update({ customer_notified_at: at }).eq("id", n.order_id);
  try { await syncZohoMailbox(ownerId, { quick: true }); } catch { /* próxima sincronização */ }
  return "enviado";
}
