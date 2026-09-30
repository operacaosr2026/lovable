import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { selectAll, selectAllIn } from "@/lib/select-all";
import { companyShopIdsForMonth } from "@/lib/company-goals.server";
import { isoTodayUS } from "@/lib/timezone";
import { buildTrackingUrl } from "@/lib/tracking-url";
import { getZohoAccount, sendZohoMail } from "@/lib/zoho-mail.server";
import {
  DEFAULT_CHARGEBACK_SETTINGS, dunningVars, renderDunning, dunningTextToHtml,
  type AlertRow, type AlertStatus, type ChargebackSettings, type DunningStep,
} from "@/lib/chargeback-alerts.shared";

// Chargebacks > Alertas: pedidos reembolsados pelo Disputifier por alerta de
// pré-chargeback (CDRN/Ethoca/RDR). O reembolso evita o chargeback, mas o pedido
// quase sempre foi entregue — então vale contatar o cliente pra reaver o valor.
// Identificação (tudo no pedido guardado, raw->refunds): reembolso feito pelo app
// do Disputifier (transação com source_name do app) ou com a nota do alerta
// ("Ethoca Alert", "cdrn alerts"…), ou tag CDRN/Ethoca/RDR no pedido.

const DISPUTIFIER_APP = "3643375";   // source_name das transações de reembolso feitas pelo app

// Só as lojas ativas (as que contam na meta do mês).
export async function alertShopIds(ownerId: string) {
  return companyShopIdsForMonth(ownerId, `${isoTodayUS().slice(0, 7)}-01`).catch(() => [] as string[]);
}

export async function loadAlerts(ownerId: string, shopIds: string[]): Promise<AlertRow[]> {
  if (!shopIds.length) return [];
  const { data: shops } = await supabaseAdmin.from("shops").select("id,name").eq("user_id", ownerId);
  const shopName = new Map(((shops ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]));

  // Só pedidos com reembolso (o resto do pedido não interessa aqui).
  const { data: orders, error } = await selectAll<any>(supabaseAdmin.from("shop_orders")
    .select("id,shop_id,external_id,order_number,order_date,delivery_status,delivered_at,tracking_code,tracking_url,tags:raw->>tags,currency:raw->>currency,refunds:raw->refunds,email:raw->>email,fn:raw->customer->>first_name,ln:raw->customer->>last_name,items:raw->line_items")
    .eq("user_id", ownerId).in("shop_id", shopIds).not("raw->refunds", "is", null));
  if (error) throw new Error(error.message);

  const found: any[] = [];
  for (const o of orders) {
    const tagNet = String(o.tags ?? "").match(/\b(cdrn|ethoca|rdr)\b/i)?.[1];
    for (const r of (o.refunds ?? []) as any[]) {
      const txs = (r.transactions ?? []) as any[];
      const note = String(r.note ?? "");
      const byApp = txs.some((t) => String(t.source_name) === DISPUTIFIER_APP);
      const noteNet = note.match(/\b(cdrn|ethoca|rdr)\b/i)?.[1];
      if (!byApp && !noteNet && !tagNet) continue;
      const amount = txs.filter((t) => (t.kind ?? "refund") === "refund" && (t.status ?? "success") === "success")
        .reduce((s, t) => s + Number(t.amount ?? 0), 0);
      found.push({ o, refund: r, amount, network: (noteNet ?? tagNet ?? "Alerta").toUpperCase().replace("ETHOCA", "Ethoca") });
      break;   // um alerta por pedido
    }
  }
  if (!found.length) return [];

  const orderIds = found.map((f) => f.o.id as string);
  const extIds = found.map((f) => String(f.o.external_id));
  const emails = [...new Set(found.map((f) => String(f.o.email ?? "").toLowerCase()).filter(Boolean))];
  const [{ data: tracking }, { data: followups }, { data: convs }, { data: integs }] = await Promise.all([
    selectAllIn<{ order_id: string; last_event_label: string | null }>(orderIds, (c) =>
      supabaseAdmin.from("shop_order_tracking").select("order_id,last_event_label").in("order_id", c)),
    selectAllIn<any>(extIds, (c) => supabaseAdmin.from("chargeback_alert_followups")
      .select("shop_id,order_external_id,status,recovered_amount,note,updated_at,dunning_step,dunning_last_at,dunning_paused,dunning_stop_reason,dunning_started_at,dunning_replied_at,dunning_replied_step,recovered_at,recovered_step")
      .eq("user_id", ownerId).in("order_external_id", c)),
    emails.length
      ? selectAllIn<{ id: string; customer_email: string; last_message_at: string | null }>(emails, (c) =>
          supabaseAdmin.from("support_conversations").select("id,customer_email,last_message_at").eq("owner_id", ownerId).in("customer_email", c))
      : Promise.resolve({ data: [] as { id: string; customer_email: string; last_message_at: string | null }[] }),
    supabaseAdmin.from("track123_integrations").select("shop_id,tracking_link_template").in("shop_id", shopIds),
  ]);
  const trackBy = new Map((tracking ?? []).map((t) => [t.order_id, t]));
  const fuBy = new Map((followups ?? []).map((f: any) => [`${f.shop_id}:${f.order_external_id}`, f]));
  const convBy = new Map<string, string>();
  for (const c of [...(convs ?? [])].sort((a, b) => (b.last_message_at ?? "").localeCompare(a.last_message_at ?? ""))) {
    if (!convBy.has(c.customer_email.toLowerCase())) convBy.set(c.customer_email.toLowerCase(), c.id);
  }
  const templateBy = new Map(((integs ?? []) as any[]).map((i) => [i.shop_id as string, i.tracking_link_template as string | null]));

  return found.map(({ o, refund, amount, network }): AlertRow => {
    const fu: any = fuBy.get(`${o.shop_id}:${o.external_id}`);
    const email = String(o.email ?? "").toLowerCase() || null;
    const delivered = o.delivery_status === "delivered";
    return {
      shopId: o.shop_id, shopName: shopName.get(o.shop_id) ?? "—", orderExternalId: String(o.external_id), orderNumber: o.order_number, orderDate: o.order_date,
      network, refundedAt: refund.created_at ?? null, refundedAmount: Math.round(amount * 100) / 100, currency: o.currency ?? "USD", note: refund.note ?? null,
      customerName: [o.fn, o.ln].filter(Boolean).join(" ") || null, customerFirstName: o.fn || null, customerEmail: email,
      product: ((o.items ?? []) as any[]).map((li) => li?.title).filter(Boolean).join(", ") || null,
      deliveryStatus: o.delivery_status, deliveredAt: o.delivered_at, trackingCode: o.tracking_code,
      trackingUrl: (o.tracking_code ? buildTrackingUrl(templateBy.get(o.shop_id), o.tracking_code) : null) ?? o.tracking_url,
      lastEvent: trackBy.get(o.id)?.last_event_label ?? null, conversationId: email ? convBy.get(email) ?? null : null,
      // Sem acompanhamento salvo: entregue = "a contatar"; não entregue = "não recuperável" (sugestão).
      status: (fu?.status as AlertStatus) ?? (delivered ? "a_contatar" : "nao_recuperavel"),
      recoveredAmount: fu?.recovered_amount != null ? Number(fu.recovered_amount) : null, followupNote: fu?.note ?? null, followupAt: fu?.updated_at ?? null,
      dunningStep: fu?.dunning_step ?? 0, dunningLastAt: fu?.dunning_last_at ?? null, dunningPaused: fu?.dunning_paused ?? false, dunningStopReason: fu?.dunning_stop_reason ?? null,
      dunningStartedAt: fu?.dunning_started_at ?? null, repliedAt: fu?.dunning_replied_at ?? null, repliedStep: fu?.dunning_replied_step ?? null,
      recoveredAt: fu?.recovered_at ?? null, recoveredStep: fu?.recovered_step ?? null,
    };
  }).sort((a, b) => (b.refundedAt ?? "").localeCompare(a.refundedAt ?? ""));
}

// ─── Configurações ────────────────────────────────────────────────────────────

export async function getChargebackSettings(ownerId: string): Promise<ChargebackSettings> {
  const { data } = await supabaseAdmin.from("chargeback_settings")
    .select("dunning_enabled,dunning_steps,dunning_final_wait_days").eq("owner_id", ownerId).maybeSingle();
  if (!data) return DEFAULT_CHARGEBACK_SETTINGS;
  return {
    dunningEnabled: data.dunning_enabled,
    dunningSteps: (Array.isArray(data.dunning_steps) ? data.dunning_steps : []) as DunningStep[],
    dunningFinalWaitDays: data.dunning_final_wait_days,
  };
}

// ─── Envio ────────────────────────────────────────────────────────────────────

function textToHtml(text: string) {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">${esc.replace(/\r?\n/g, "<br>")}</div>`;
}

// Mesma assinatura do Atendimento ({nome} da assinatura = quem envia; aqui, o dono do workspace).
async function dunningHtml(ownerId: string, senderId: string, text: string) {
  let html = dunningTextToHtml(text);
  const { data: st } = await supabaseAdmin.from("support_settings").select("signature,signature_enabled").eq("owner_id", ownerId).maybeSingle();
  if (st?.signature_enabled && st.signature?.trim()) {
    const { data: prof } = await supabaseAdmin.from("profiles").select("full_name").eq("id", senderId).maybeSingle();
    html += `<br><div style="color:#555">${textToHtml(st.signature.replace(/\{nome\}/gi, prof?.full_name?.trim() ?? ""))}</div>`;
  }
  return html;
}

export async function sendDunningEmail(ownerId: string, senderId: string, to: string, step: DunningStep, row: AlertRow) {
  const acc = await getZohoAccount(ownerId);
  if (!acc?.refresh_token || !acc.account_id) throw new Error("Zoho Mail não conectado (Atendimento > Configurações)");
  const vars = dunningVars(row);
  await sendZohoMail(acc, { to, subject: renderDunning(step.subject, vars), html: await dunningHtml(ownerId, senderId, renderDunning(step.body, vars)) });
}

// Horário de envio: 9h às 20h em Nova York (horário do cliente).
function inSendWindow(now = new Date()) {
  const h = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "America/New_York" }).format(now));
  return h >= 9 && h < 20;
}

const DAY = 86_400_000;
// Um e-mail de cobrança a cada 30 min por workspace — envio em rajada parece robô
// (e pesa na reputação do domínio). Com o cron de 5 em 5 min, sai a cada 30–35 min.
const SEND_GAP_MS = 30 * 60_000;

// Uma rodada da sequência de cobrança pra um workspace. Roda depois do sync do
// Zoho (a cada 5 min), então uma resposta do cliente já está no banco.
export async function runChargebackDunning(ownerId: string, all?: AlertRow[]) {
  const cfg = await getChargebackSettings(ownerId);
  const steps = cfg.dunningSteps.filter((s) => s.subject.trim() && s.body.trim());
  if (!cfg.dunningEnabled || !steps.length) return { skipped: "desligada" };

  const rows = (all ?? await loadAlerts(ownerId, await alertShopIds(ownerId)))
    .filter((r) => r.deliveryStatus === "delivered" && r.customerEmail && !r.dunningPaused
      && (r.dunningStep === 0 ? r.status === "a_contatar" : r.status === "a_contatar" || r.status === "contatado")
      && !(r.dunningStopReason === "respondeu" || r.dunningStopReason === "fim"));
  if (!rows.length) return { sent: 0 };

  // Cliente respondeu depois do 1º e-mail → para a sequência (segue na mão pelo Atendimento).
  const started = rows.filter((r) => r.dunningStep > 0 && r.dunningStartedAt);
  const replied = new Map<string, string>();   // pedido → 1ª resposta depois do 1º e-mail
  if (started.length) {
    const { data: ins } = await supabaseAdmin.from("support_messages").select("from_email,sent_at")
      .eq("owner_id", ownerId).eq("direction", "in").in("from_email", [...new Set(started.map((r) => r.customerEmail!))]);
    for (const r of started) {
      const first = (ins ?? []).filter((m: any) => m.from_email?.toLowerCase() === r.customerEmail && m.sent_at > r.dunningStartedAt!)
        .map((m: any) => m.sent_at as string).sort()[0];
      if (first) replied.set(`${r.shopId}:${r.orderExternalId}`, first);
    }
  }

  const now = Date.now();
  const { data: last } = await supabaseAdmin.from("chargeback_dunning_sends").select("sent_at")
    .eq("user_id", ownerId).order("sent_at", { ascending: false }).limit(1).maybeSingle();
  let canSend = inSendWindow() && (!last || now - Date.parse(last.sent_at) >= SEND_GAP_MS);
  let sent = 0;
  const errors: string[] = [];
  // Quem está esperando há mais tempo sai primeiro.
  const dueAt = (r: AlertRow) => {
    const ref = r.dunningStep === 0 ? r.deliveredAt : r.dunningLastAt;
    const st = steps[r.dunningStep];
    return ref && st ? Date.parse(ref) + st.days * DAY : Infinity;
  };
  rows.sort((a, b) => dueAt(a) - dueAt(b));
  for (const r of rows) {
    const key = { shop_id: r.shopId, order_external_id: r.orderExternalId };
    const repliedAt = replied.get(`${r.shopId}:${r.orderExternalId}`);
    if (repliedAt) {
      await supabaseAdmin.from("chargeback_alert_followups")
        .update({ dunning_stop_reason: "respondeu", dunning_replied_at: repliedAt, dunning_replied_step: r.dunningStep }).match(key);
      continue;
    }
    // Sequência acabou sem retorno.
    if (r.dunningStep >= steps.length) {
      if (r.dunningLastAt && now - Date.parse(r.dunningLastAt) >= cfg.dunningFinalWaitDays * DAY) {
        await supabaseAdmin.from("chargeback_alert_followups")
          .update({ status: "sem_retorno", dunning_stop_reason: "fim", updated_at: new Date().toISOString() }).match(key).eq("status", "contatado");
      }
      continue;
    }
    const step = steps[r.dunningStep];
    const ref = r.dunningStep === 0 ? r.deliveredAt : r.dunningLastAt;
    if (!ref || now < Date.parse(ref) + step.days * DAY) continue;
    if (!canSend) continue;

    // Reserva o envio (evita e-mail duplicado se duas rodadas se cruzarem).
    await supabaseAdmin.from("chargeback_alert_followups")
      .upsert({ ...key, user_id: ownerId, status: r.status }, { onConflict: "shop_id,order_external_id", ignoreDuplicates: true });
    const nowIso = new Date().toISOString();
    const { data: claimed } = await supabaseAdmin.from("chargeback_alert_followups")
      .update({
        dunning_step: r.dunningStep + 1, dunning_last_at: nowIso, status: "contatado", dunning_stop_reason: null, updated_at: nowIso,
        ...(r.dunningStep === 0 ? { dunning_started_at: nowIso } : {}),
      })
      .match(key).eq("dunning_step", r.dunningStep).eq("dunning_paused", false).in("status", ["a_contatar", "contatado"]).select("id");
    if (!claimed?.length) continue;
    try {
      await sendDunningEmail(ownerId, ownerId, r.customerEmail!, step, r);
      sent++;
      canSend = false;   // próximo só daqui a 30 min
      await supabaseAdmin.from("chargeback_dunning_sends").insert({
        user_id: ownerId, shop_id: r.shopId, order_external_id: r.orderExternalId, step: r.dunningStep + 1,
        subject: renderDunning(step.subject, dunningVars(r)),
      });
    } catch (e: any) {
      const msg = String(e?.message ?? e).slice(0, 200);
      errors.push(`${r.orderNumber}: ${msg}`);
      await supabaseAdmin.from("chargeback_alert_followups").update({
        dunning_step: r.dunningStep, dunning_last_at: r.dunningLastAt, status: r.status, dunning_stop_reason: `erro: ${msg}`,
        ...(r.dunningStep === 0 ? { dunning_started_at: null } : {}),
      }).match(key);
    }
  }
  return { sent, errors };
}

// Tag "Chargeback" nas conversas do Atendimento com clientes de alerta (e-mail
// da sequência, "Contatar" ou resposta do cliente) — só conversas com mensagem
// depois do reembolso. Usa a tag da lista do Atendimento que contém "chargeback";
// se não houver, cria "Chargeback".
export async function tagAlertConversations(ownerId: string, rows: AlertRow[]) {
  const byEmail = new Map<string, string>();   // e-mail → reembolso mais antigo
  for (const r of rows) {
    if (!r.customerEmail || !r.refundedAt) continue;
    const cur = byEmail.get(r.customerEmail);
    if (!cur || r.refundedAt < cur) byEmail.set(r.customerEmail, r.refundedAt);
  }
  if (!byEmail.size) return 0;
  const { data: convs } = await supabaseAdmin.from("support_conversations").select("id,customer_email,last_message_at,tags")
    .eq("owner_id", ownerId).in("customer_email", [...byEmail.keys()]);
  const { data: st } = await supabaseAdmin.from("support_settings").select("tags").eq("owner_id", ownerId).maybeSingle();
  const list: string[] = st?.tags ?? [];
  const tag = list.find((t) => /chargeback/i.test(t)) ?? "Chargeback";
  const todo = (convs ?? []).filter((c) => (c.last_message_at ?? "") >= byEmail.get(c.customer_email.toLowerCase())!
    && !c.tags.some((t: string) => t.toLowerCase() === tag.toLowerCase()));
  if (!todo.length) return 0;
  if (!list.some((t) => t.toLowerCase() === tag.toLowerCase())) {
    await supabaseAdmin.from("support_settings").upsert({ owner_id: ownerId, tags: [...list, tag], updated_at: new Date().toISOString() }, { onConflict: "owner_id" });
  }
  await Promise.all(todo.map((c) => supabaseAdmin.from("support_conversations").update({ tags: [...c.tags, tag] }).eq("id", c.id)));
  return todo.length;
}

// Roda depois do sync do Zoho: tag nas conversas + sequência de cobrança (se ligada).
export async function runAllChargebackDunning() {
  const { data } = await supabaseAdmin.from("zoho_mail_accounts").select("owner_id").not("refresh_token", "is", null);
  const out: Record<string, unknown> = {};
  for (const a of data ?? []) {
    try {
      const rows = await loadAlerts(a.owner_id, await alertShopIds(a.owner_id));
      const tagged = await tagAlertConversations(a.owner_id, rows);
      out[a.owner_id] = { tagged, ...(await runChargebackDunning(a.owner_id, rows)) };
    } catch (e: any) { out[a.owner_id] = { error: String(e?.message ?? e) }; }
  }
  return out;
}
