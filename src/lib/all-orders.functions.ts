import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { selectAll } from "@/lib/select-all";
import { buildTrackingUrl } from "@/lib/tracking-url";
import { sanitizeEvents } from "@/lib/tracking-display";
import { orderLineItemsCost, costOpts } from "@/lib/product-cost-match";
import { costProductsFor } from "@/lib/product-links.server";
// supplier_refunds ainda não está nos tipos gerados do Supabase (por isso o "as any").
import { needsAttention, attentionReason, businessDaysSince, postingCalendar, type PostingCalendar } from "@/lib/logistics-kpis";
import { isoDateUS, isoTodayUS } from "@/lib/timezone";
import { parseEvents } from "@/lib/carrier-stats";
import { phaseResolver } from "@/lib/tracking-phases";
import { effectiveLocalNumber, localCarrierLabel, localLegOf, localNumberDisplay, localNumberOrZero, localTrackingUrl } from "@/lib/local-carriers";

// Aba Pedidos (menu principal): todos os pedidos de todas as lojas num lugar
// só, com busca — antes só dava pra achar um pedido pelo Atendimento. A lista
// é paginada no servidor (são milhares de pedidos e o JSON da Shopify é
// pesado); o detalhe junta pedido, envio/rastreio, fornecedor/custo,
// reembolso/chargeback/alerta e as conversas do cliente.

// Acesso: admin, ou membro com a permissão "pedidos".
function assertAccess(ctx: { role: string; permissions: { section: string }[] }) {
  if (ctx.role !== "admin" && !ctx.permissions.some((p) => p.section === "pedidos")) throw new Error("Sem acesso a Pedidos");
}

// Não exportar valores/funções comuns daqui (só server fns e tipos): o arquivo
// importa client.server e quebraria o build da Vercel no cliente.
const ORDER_FILTERS = ["todos", "a_enviar", "em_transito", "entregue", "problema", "reembolsado", "reemb_fornecedor", "chargeback"] as const;
export type OrderFilter = (typeof ORDER_FILTERS)[number];
export type OrderCounts = Record<OrderFilter, number> & { atencao: number };

export type OrderListRow = {
  id: string; shopId: string; shopName: string; externalId: string; orderNumber: string; orderDate: string | null;
  customerName: string | null; customerEmail: string | null; product: string | null; itemsQty: number;
  revenue: number; currency: string | null; financialStatus: string | null;
  // Status de envio efetivo (mesma regra do Rastreamento).
  deliveryStatus: string | null;
  supplierStatus: string | null; supplierPaidAt: string | null;
  // Reembolso do fornecedor (Atendimento › Reembolso): confirmado troca o "Pago" por "Reembolsado".
  supplierRefund: { status: "pendente" | "confirmado"; amount: number; date: string } | null; trackingCode: string | null; trackingUrl: string | null; lastEvent: string | null; lastEventAt: string | null;
  // Transportadora local dos EUA (GOFO, USPS…) e o código dela — mesma regra do Atendimento.
  local: { label: string; number: string | null; url: string | null } | null;
  // Prazo de postagem (3 dias úteis da compra/reenvio), só pra quem ainda vai ser enviado.
  deadline: string | null; attention: boolean; attentionWhy: string | null; adminUrl: string | null;
  // Nota da equipe (a mesma do Rastreamento e da aba Notificações).
  note: string | null;
  dispute: { type: string; status: string | null } | null; conversations: number; conversationId: string | null;
};

const cleanLabel = (label: string | null | undefined) =>
  label ? sanitizeEvents([{ at: null, description: label, location: null }])[0]?.description ?? null : null;

const fullName = (first?: string | null, last?: string | null) => [first, last].filter(Boolean).join(" ").trim() || null;

function productSummary(items: any[] | null | undefined) {
  const titles = [...new Set((items ?? []).map((li) => li?.title ?? li?.name).filter(Boolean))] as string[];
  if (!titles.length) return null;
  return titles.length > 1 ? `${titles[0]} +${titles.length - 1}` : titles[0];
}

// Termo de busca seguro pro filtro "or" do PostgREST (vírgula, parênteses e curingas quebram a sintaxe).
const safeTerm = (q: string) => q.replace(/[,()*%\\#"']/g, " ").replace(/\s+/g, " ").trim();

// Pedidos até 05/08/2026 (lojas antigas: walkesty-caixa, Walktowave) sem
// entrega registrada contam como entregues e com fornecedor pago — decisão do
// usuário (nov/2026). Só na exibição: não grava no banco nem mexe no Caixa.
const LEGACY_CUTOFF = "2026-08-05";

// Etiqueta criada mas a transportadora ainda não pegou o pacote (mesma regra do Rastreamento).
const infoReceivedOnly = (label: string | null | undefined) => {
  if (!label) return false;
  const t = label.toLowerCase().replace(/\s+/g, "");
  return t.includes("inforeceived") || t.includes("pending");
};

// Data em que o pedido completa N dias úteis (sem sáb/dom e feriados de postagem).
function addBusinessDays(fromIso: string, n: number, cal: PostingCalendar): string {
  const cur = new Date(`${fromIso.slice(0, 10)}T00:00:00Z`);
  let count = 0;
  while (count < n) {
    cur.setUTCDate(cur.getUTCDate() + 1);
    const iso = cur.toISOString().slice(0, 10);
    const wd = cur.getUTCDay();
    if (cal.workdays.has(iso) || (wd !== 0 && wd !== 6 && !cal.holidays.has(iso))) count++;
  }
  return cur.toISOString().slice(0, 10);
}

// Lojas cuja loja Shopify está numa coluna "Cemitério" do Banco de Lojas.
async function buriedShopIds(ownerId: string): Promise<Set<string>> {
  const { data: cols } = await supabaseAdmin.from("store_board_columns").select("id,name").eq("user_id", ownerId);
  const colIds = (cols ?? []).filter((c: any) => /cemit/i.test(String(c.name ?? ""))).map((c: any) => c.id as string);
  if (!colIds.length) return new Set();
  const { data: stores } = await supabaseAdmin.from("shopify_stores").select("id").in("board_column_id", colIds);
  const storeIds = (stores ?? []).map((x: any) => x.id as string);
  if (!storeIds.length) return new Set();
  const { data: shops } = await supabaseAdmin.from("shops").select("id").eq("user_id", ownerId).in("shopify_store_id", storeIds);
  return new Set((shops ?? []).map((x: any) => x.id as string));
}

// Transportadora local (última milha nos EUA) e o código dela, dos pedidos da página.
// Rastreio gravado de outro código (reenvio) não vale.
async function localCarriers(orders: any[]) {
  const out = new Map<string, { label: string; number: string | null; url: string | null }>();
  if (!orders.length) return out;
  const { data: tracks } = await supabaseAdmin.from("shop_order_tracking")
    .select("order_id,tracking_number,timeline,local_tracking_number").in("order_id", orders.map((o) => o.id));
  const phaseOf = phaseResolver();
  for (const t of (tracks ?? []) as any[]) {
    const o = orders.find((x) => x.id === t.order_id);
    if (!o || String(t.tracking_number ?? "").toUpperCase() !== String(o.tracking_code ?? "").trim().toUpperCase()) continue;
    const leg = localLegOf(parseEvents(t.timeline), t.local_tracking_number ?? null, phaseOf);
    if (!leg && !t.local_tracking_number) continue;
    const n: string | null = effectiveLocalNumber(leg?.key, t.local_tracking_number ?? null, String(o.tracking_code ?? ""));
    const delivered = leg?.deliveredTs != null || o.delivery_status === "delivered" || !!o.delivered_at;
    const shown = localNumberOrZero(leg?.key, n ? localNumberDisplay(n) : null, delivered);
    out.set(o.id, { label: leg ? localCarrierLabel(leg.key) : "Transportadora local", number: shown, url: localTrackingUrl(n) });
  }
  return out;
}

export const listAllOrders = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    q: z.string().max(80).optional(),
    shopId: z.string().uuid().nullable().optional(),
    filter: z.enum(ORDER_FILTERS).default("todos"),
    attention: z.boolean().default(false),
    sort: z.enum(["desc", "asc"]).default("desc"),
    page: z.number().int().min(0).max(2000).default(0),
    pageSize: z.number().int().min(10).max(100).default(10),
  }).parse(d))
  .handler(async ({ data, context }) => {
    assertAccess(context);
    const { ownerId } = context;
    const nowMs = Date.now();

    const [{ data: shops }, { data: disputes }, { data: holidays }, { data: tracking }] = await Promise.all([
      supabaseAdmin.from("shops").select("id,name").eq("user_id", ownerId).order("name"),
      // Disputas do dono (poucas): marcam a linha e alimentam o filtro "Chargeback".
      selectAll<{ shop_id: string; order_external_id: string | null; type: string; status: string | null; initiated_at: string }>(
        supabaseAdmin.from("shop_order_disputes").select("shop_id,order_external_id,type,status,initiated_at").eq("user_id", ownerId).order("initiated_at", { ascending: false })),
      supabaseAdmin.from("posting_holidays").select("day,kind").eq("user_id", ownerId),
      selectAll<{ order_id: string; last_event_at: string | null; last_event_label: string | null; tracking_status: string | null; registered_17track_at: string | null }>(
        supabaseAdmin.from("shop_order_tracking").select("order_id,last_event_at,last_event_label,tracking_status,registered_17track_at").eq("user_id", ownerId)),
    ]);
    // Lojas no Cemitério (Banco de Lojas) ficam fora da aba — encerradas, só
    // inflavam os contadores (ex.: Chierie e Serafinie).
    const buried = await buriedShopIds(ownerId);
    const liveShops = (shops ?? []).filter((s) => !buried.has(s.id as string));
    const shopName = new Map(liveShops.map((s) => [s.id as string, s.name as string]));
    // Pedidos com reembolso do fornecedor confirmado (Atendimento › Reembolso).
    const { data: supRefunded } = await selectAll<{ order_id: string }>((supabaseAdmin as any).from("supplier_refunds")
      .select("order_id").eq("owner_id", ownerId).eq("status", "confirmado"));
    const supplierRefunded = new Set((supRefunded ?? []).map((r) => r.order_id));
    const cal = postingCalendar(holidays as any);
    const trackBy = new Map((tracking ?? []).map((t) => [t.order_id, t]));
    const disputeBy = new Map<string, { type: string; status: string | null }>();
    for (const d of disputes ?? []) {
      const k = `${d.shop_id}:${d.order_external_id}`;
      if (d.order_external_id && !disputeBy.has(k)) disputeBy.set(k, { type: d.type, status: d.status });
    }

    // 1) Todos os pedidos da busca/loja, só com as colunas leves — pra contar
    //    cada aba e aplicar o status efetivo/atenção, que não dá pra filtrar no banco.
    let base = supabaseAdmin.from("shop_orders")
      .select("id,shop_id,external_id,order_date,created_at_shopify,delivery_status,shipped_at,delivered_at,problem_at,shopify_financial_status,tracking_code_history,tracking_code_manual_at,logistics_note,cancelled:raw->>cancelled_at")
      .eq("user_id", ownerId);
    if (data.shopId) base = base.eq("shop_id", data.shopId);
    if (buried.size) base = base.not("shop_id", "in", `(${[...buried].join(",")})`);
    // Busca: nº do pedido, rastreio, e-mail e nome do cliente / destinatário.
    const term = safeTerm(data.q ?? "");
    if (term.length >= 2) {
      const like = `*${term}*`;
      const fields = ["order_number", "tracking_code", "external_id", "raw->>email", "raw->customer->>email",
        "raw->customer->>first_name", "raw->customer->>last_name", "raw->shipping_address->>name"];
      const ors = fields.map((f) => `${f}.ilike.${like}`);
      // "Nome Sobrenome": também casa nome no primeiro campo e sobrenome no segundo.
      const parts = term.split(" ");
      if (parts.length >= 2) ors.push(`and(raw->customer->>first_name.ilike.*${parts[0]}*,raw->customer->>last_name.ilike.*${parts.slice(1).join(" ")}*)`);
      base = base.or(ors.join(","));
    }
    const { data: slim, error } = await selectAll<any>(base.order("id"));
    if (error) throw new Error(error.message);

    type Slim = { id: string; date: string; created: string; status: string; refunded: boolean; deadline: string | null; attention: boolean; why: string | null; cb: boolean; sup: boolean; fin: string | null };
    const all: Slim[] = (slim ?? []).map((o: any) => {
      const t = trackBy.get(o.id);
      const refunded = ["refunded", "partially_refunded", "voided"].includes(o.shopify_financial_status ?? "") || !!o.cancelled;
      let status = o.delivery_status as string | null;
      if (o.delivered_at) status = "delivered";
      else if (o.problem_at && status !== "waiting_customer") status = "problem";
      else if (!status || status === "pending_shipment") status = o.shipped_at ? "shipped" : "pending_shipment";
      const history = Array.isArray(o.tracking_code_history) ? o.tracking_code_history : [];
      const resentAt: string | null = history[history.length - 1]?.until ?? o.tracking_code_manual_at ?? null;
      // Etiqueta criada sem a transportadora ter registrado o pacote: "info recebida", ou
      // rastreio já cadastrado no 17track sem nenhum evento ainda — continua "a enviar".
      if (status === "shipped" && (infoReceivedOnly(t?.tracking_status ?? t?.last_event_label) || (t?.registered_17track_at && !t.last_event_at))) status = "pending_shipment";
      const legacy = !!o.order_date && o.order_date <= LEGACY_CUTOFF;
      if (legacy && !refunded && (status === "shipped" || status === "pending_shipment" || status === "problem")) status = "delivered";
      const clockFrom = resentAt ? isoDateUS(resentAt) : o.order_date;
      // Reembolsado/cancelado — ou já reembolsado pelo fornecedor — sai do radar
      // de envio: não conta em A enviar/Em trânsito/Com problema nem na atenção.
      const supRefunded = supplierRefunded.has(o.id);
      const logistic = !refunded && !supRefunded;
      const row = { delivery_status: status, order_date: o.order_date, clock_from: clockFrom, shipped_at: o.shipped_at, last_event_at: t?.last_event_at ?? null };
      const attention = logistic && needsAttention(row, nowMs, cal);
      // O que está errado (mostrado ao passar o mouse no aviso).
      let why: string | null = null;
      if (attention) {
        if (status === "pending_shipment") {
          const n = businessDaysSince(clockFrom, nowMs, cal);
          why = `${resentAt ? "Reenvio" : "Pedido"} sem postagem há ${n} dias úteis (prazo: 3)`;
        } else if (status === "problem") {
          why = `Problema no rastreio${o.logistics_note ? `: ${o.logistics_note}` : t?.last_event_label ? `: ${cleanLabel(t.last_event_label)}` : ""}`;
        } else {
          const r = attentionReason(row, nowMs);
          why = r ? (r.includes("sem atualização") ? `Rastreio parado: ${r}` : `Ainda não entregue: ${r.replace("sem entrega", `desde o ${resentAt ? "reenvio" : "pedido"}`)}`) : null;
        }
      }
      return {
        id: o.id, date: o.order_date ?? "", created: o.created_at_shopify ?? "", status: status ?? "pending_shipment", refunded,
        deadline: logistic && status === "pending_shipment" && clockFrom ? addBusinessDays(clockFrom, 3, cal) : null,
        attention, why,
        cb: disputeBy.has(`${o.shop_id}:${o.external_id}`), sup: supplierRefunded.has(o.id), fin: o.shopify_financial_status ?? null,
      };
    });

    const inTab = (o: Slim, f: OrderFilter) => {
      switch (f) {
        case "a_enviar": return !o.refunded && !o.sup && o.status === "pending_shipment";
        case "em_transito": return !o.refunded && !o.sup && o.status === "shipped";
        case "entregue": return o.status === "delivered";
        case "problema": return !o.refunded && !o.sup && o.status === "problem";
        case "reembolsado": return o.fin === "refunded" || o.fin === "partially_refunded";
        case "chargeback": return o.cb;
        case "reemb_fornecedor": return o.sup;
        default: return true;
      }
    };
    const counts = Object.fromEntries(ORDER_FILTERS.map((f) => [f, all.filter((o) => inTab(o, f)).length])) as OrderCounts;
    counts.atencao = all.filter((o) => o.attention).length;

    const dir = data.sort === "asc" ? 1 : -1;
    const filtered = all.filter((o) => inTab(o, data.filter) && (!data.attention || o.attention))
      .sort((a, b) => (a.date === b.date ? a.created.localeCompare(b.created) : a.date.localeCompare(b.date)) * dir);
    const total = filtered.length;
    const pageRows = filtered.slice(data.page * data.pageSize, data.page * data.pageSize + data.pageSize);
    const slimBy = new Map(pageRows.map((o) => [o.id, o]));

    // 2) Só a página: os campos pesados (cliente, itens) e o resto da linha.
    const ids = pageRows.map((o) => o.id);
    const { data: rows } = ids.length
      ? await supabaseAdmin.from("shop_orders")
          .select("id,shop_id,external_id,order_number,order_date,revenue,currency,shopify_financial_status,payment_status,payment_batch_id,paid_at,tracking_code,tracking_url,notice_note,delivery_status,delivered_at,"
            + "email:raw->>email,cust_email:raw->customer->>email,first_name:raw->customer->>first_name,last_name:raw->customer->>last_name,"
            + "ship_name:raw->shipping_address->>name,items:raw->line_items")
          .in("id", ids)
      : { data: [] as any[] };
    const list = ((rows ?? []) as any[]).sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));

    const pageShops = [...new Set(list.map((o) => o.shop_id as string))];
    const emails = [...new Set(list.map((o) => String(o.email ?? o.cust_email ?? "").toLowerCase()).filter(Boolean))];
    // Data do pagamento ao fornecedor: a do lote (a que se ajusta em "Alterar data de pagamento").
    const batchIds = [...new Set(list.map((o) => o.payment_batch_id).filter(Boolean))] as string[];
    const { data: batches } = batchIds.length
      ? await supabaseAdmin.from("shop_order_payment_batches").select("id,payment_date").in("id", batchIds)
      : { data: [] as any[] };
    const batchDate = new Map((batches ?? []).map((b: any) => [b.id as string, b.payment_date as string]));
    const localBy = await localCarriers(list);
    // Reembolso do fornecedor do pedido (confirmado tem prioridade; senão o pendente mais recente).
    const { data: sRefunds } = ids.length
      ? await (supabaseAdmin as any).from("supplier_refunds").select("order_id,status,amount,created_at,confirmed_at").eq("owner_id", ownerId).in("order_id", ids)
      : { data: [] as any[] };
    const refundBy = new Map<string, { status: "pendente" | "confirmado"; amount: number; date: string }>();
    for (const r of (sRefunds ?? []) as any[]) {
      const cur = refundBy.get(r.order_id);
      const next = { status: r.status, amount: Number(r.amount ?? 0), date: isoDateUS(r.status === "confirmado" ? (r.confirmed_at ?? r.created_at) : r.created_at) };
      if (!cur || (cur.status !== "confirmado" && (next.status === "confirmado" || next.date > cur.date))) refundBy.set(r.order_id, next);
    }
    const [{ data: convs }, { data: settings }, { data: integs }] = await Promise.all([
      emails.length ? supabaseAdmin.from("support_conversations").select("id,customer_email,last_message_at").eq("owner_id", ownerId).in("customer_email", emails).order("last_message_at", { ascending: false }) : Promise.resolve({ data: [] as any[] }),
      pageShops.length ? supabaseAdmin.from("shop_order_settings").select("shop_id,shopify_store_id").eq("user_id", ownerId).in("shop_id", pageShops) : Promise.resolve({ data: [] as any[] }),
      pageShops.length ? supabaseAdmin.from("track123_integrations").select("shop_id,tracking_link_template").in("shop_id", pageShops) : Promise.resolve({ data: [] as any[] }),
    ]);
    const convCount = new Map<string, number>();
    const convLatest = new Map<string, string>();
    for (const c of convs ?? []) {
      const e = String(c.customer_email).toLowerCase();
      convCount.set(e, (convCount.get(e) ?? 0) + 1);
      if (!convLatest.has(e)) convLatest.set(e, c.id);
    }
    const storeIds = [...new Set((settings ?? []).map((s: any) => s.shopify_store_id).filter(Boolean))] as string[];
    const { data: stores } = storeIds.length ? await supabaseAdmin.from("shopify_stores").select("id,shop_domain").in("id", storeIds) : { data: [] as any[] };
    const domainByShop = new Map((settings ?? []).map((s: any) => [s.shop_id as string, (stores ?? []).find((x: any) => x.id === s.shopify_store_id)?.shop_domain ?? null]));
    const templateByShop = new Map((integs ?? []).map((i: any) => [i.shop_id as string, i.tracking_link_template as string | null]));

    const out: OrderListRow[] = list.map((o) => {
      const s = slimBy.get(o.id)!;
      const email = String(o.email ?? o.cust_email ?? "").toLowerCase() || null;
      const items = (o.items ?? []) as any[];
      const domain = domainByShop.get(o.shop_id);
      return {
        id: o.id, shopId: o.shop_id, shopName: shopName.get(o.shop_id) ?? "—", externalId: o.external_id,
        orderNumber: String(o.order_number ?? o.external_id), orderDate: o.order_date,
        customerName: fullName(o.first_name, o.last_name) ?? o.ship_name ?? null, customerEmail: email,
        product: productSummary(items), itemsQty: items.reduce((n, li) => n + Number(li?.quantity ?? 0), 0),
        revenue: Number(o.revenue ?? 0), currency: o.currency, financialStatus: o.shopify_financial_status,
        deliveryStatus: s.status, supplierStatus: o.payment_status, trackingCode: o.tracking_code,
        supplierRefund: refundBy.get(o.id) ?? null,
        // Antigo (até o corte): fornecedor conta como pago.
        ...(o.order_date && o.order_date <= LEGACY_CUTOFF && o.payment_status !== "paid" ? { supplierStatus: "paid" } : {}),
        supplierPaidAt: o.payment_status === "paid" ? (batchDate.get(o.payment_batch_id) ?? (o.paid_at ? isoDateUS(o.paid_at) : null)) : null,
        trackingUrl: (o.tracking_code ? buildTrackingUrl(templateByShop.get(o.shop_id), o.tracking_code) : null) ?? o.tracking_url ?? null,
        lastEvent: cleanLabel(trackBy.get(o.id)?.last_event_label),
        lastEventAt: trackBy.get(o.id)?.last_event_at ?? null,
        local: localBy.get(o.id) ?? null,
        deadline: s.deadline, attention: s.attention, attentionWhy: s.why, note: (o.notice_note as string | null) || null,
        adminUrl: domain ? `https://${domain}/admin/orders/${o.external_id}` : null,
        dispute: disputeBy.get(`${o.shop_id}:${o.external_id}`) ?? null,
        conversations: email ? convCount.get(email) ?? 0 : 0, conversationId: email ? convLatest.get(email) ?? null : null,
      };
    });
    return { rows: out, total, counts, shops: liveShops, today: isoTodayUS() };
  });

export type OrderDetail = Awaited<ReturnType<typeof loadOrderDetail>>;

async function loadOrderDetail(ownerId: string, id: string, supabase: any) {
  const { data: o, error } = await supabaseAdmin.from("shop_orders").select("*").eq("user_id", ownerId).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!o) throw new Error("Pedido não encontrado");
  const raw = (o.raw ?? {}) as any;
  const email = String(raw.email ?? raw.customer?.email ?? "").toLowerCase() || null;

  const [shopRes, settingsRes, integRes, trackRes, disputesRes, followRes, batchRes, convRes, costProducts] = await Promise.all([
    supabaseAdmin.from("shops").select("name").eq("id", o.shop_id).maybeSingle(),
    supabaseAdmin.from("shop_order_settings").select("shopify_store_id,default_unit_cost").eq("user_id", ownerId).eq("shop_id", o.shop_id).maybeSingle(),
    supabaseAdmin.from("track123_integrations").select("tracking_link_template").eq("shop_id", o.shop_id).maybeSingle(),
    supabaseAdmin.from("shop_order_tracking").select("tracking_number,carrier,tracking_status,last_event_at,last_event_label,timeline,shipped_at,delivered_at,problem_at,edd_from,edd_to,replaced_packages,extra_packages").eq("order_id", o.id).maybeSingle(),
    supabaseAdmin.from("shop_order_disputes").select("type,status,reason,amount,initiated_at,evidence_due_by,finalized_on").eq("user_id", ownerId).eq("shop_id", o.shop_id).eq("order_external_id", o.external_id).order("initiated_at", { ascending: false }),
    supabaseAdmin.from("chargeback_alert_followups").select("status,dunning_step,dunning_last_at,dunning_stop_reason,recovered_amount,recovered_at,recovery_order_name,recovery_invoice_url,excluded_at").eq("shop_id", o.shop_id).eq("order_external_id", o.external_id).maybeSingle(),
    o.payment_batch_id ? supabaseAdmin.from("shop_order_payment_batches").select("batch_number,payment_date,total_amount,total_orders").eq("id", o.payment_batch_id).maybeSingle() : Promise.resolve({ data: null }),
    email ? supabaseAdmin.from("support_conversations").select("id,subject,status,last_message_at,message_count").eq("owner_id", ownerId).eq("customer_email", email).order("last_message_at", { ascending: false }).limit(10) : Promise.resolve({ data: [] }),
    costProductsFor(supabase, ownerId).catch(() => []),
  ]);
  const { data: sRefunds } = await (supabaseAdmin as any).from("supplier_refunds")
    .select("amount,status,note,created_at,confirmed_at,requested_by,confirmed_by").eq("owner_id", ownerId).eq("order_id", o.id).order("created_at");
  const personIds = [...new Set((sRefunds ?? []).flatMap((r: any) => [r.requested_by, r.confirmed_by]).filter(Boolean))] as string[];
  const { data: people } = personIds.length ? await supabaseAdmin.from("profiles").select("id,full_name").in("id", personIds) : { data: [] as any[] };
  const personName = new Map((people ?? []).map((p: any) => [p.id as string, (p.full_name as string | null) ?? null]));

  const store = settingsRes.data?.shopify_store_id
    ? (await supabaseAdmin.from("shopify_stores").select("shop_domain").eq("id", settingsRes.data.shopify_store_id).maybeSingle()).data
    : null;
  const t = trackRes.data as any;
  const local = (await localCarriers([o])).get(o.id) ?? null;
  const timeline = sanitizeEvents(((Array.isArray(t?.timeline) ? t.timeline : []) as any[]).map((e) => ({
    at: e.event_time_utc ?? e.event_time ?? null, description: String(e.event_detail ?? ""), location: e.event_location ?? null,
  })).filter((e) => e.description)).slice(-8).reverse();

  const refunded = ((raw.refunds ?? []) as any[]).flatMap((r) => r.transactions ?? [])
    .filter((x: any) => x.kind === "refund" && x.status === "success")
    .reduce((s: number, x: any) => s + Number(x.amount ?? 0), 0);
  const refundedQty = new Map<string, number>();
  for (const r of (raw.refunds ?? []) as any[]) for (const rli of r.refund_line_items ?? []) {
    const k = String(rli.line_item_id); refundedQty.set(k, (refundedQty.get(k) ?? 0) + Number(rli.quantity ?? 0));
  }

  // Mesma regra da lista pros pedidos antigos (até LEGACY_CUTOFF).
  const legacy = !!o.order_date && o.order_date <= LEGACY_CUTOFF;
  const refundedOrCancelled = ["refunded", "partially_refunded", "voided"].includes(o.shopify_financial_status ?? "") || !!raw.cancelled_at;
  const legacyDelivered = legacy && !refundedOrCancelled && !o.delivered_at && o.delivery_status !== "waiting_customer" && o.delivery_status !== "shipment_cancelled";
  const cost = orderLineItemsCost(raw.line_items, costProducts as any, Number(settingsRes.data?.default_unit_cost ?? 0), raw.tags, costOpts(o as any));
  const ship = raw.shipping_address ?? null;

  return {
    id: o.id as string, shopId: o.shop_id as string, shopName: (shopRes.data?.name as string) ?? "—",
    externalId: o.external_id as string, orderNumber: String(o.order_number ?? o.external_id),
    orderDate: o.order_date as string | null, createdAt: (raw.created_at ?? o.created_at_shopify) as string | null,
    adminUrl: store?.shop_domain ? `https://${store.shop_domain}/admin/orders/${o.external_id}` : null,
    tags: String(raw.tags ?? "").split(",").map((x: string) => x.trim()).filter(Boolean),
    teamNote: (o.notice_note as string | null) || null,
    note: (raw.note as string | null) ?? null,
    customer: {
      name: fullName(raw.customer?.first_name, raw.customer?.last_name) ?? ship?.name ?? null,
      email, phone: (raw.phone ?? raw.customer?.phone ?? ship?.phone ?? null) as string | null,
      address: ship ? [ship.address1, ship.address2, [ship.city, ship.province_code, ship.zip].filter(Boolean).join(" "), ship.country_code].filter(Boolean).join(", ") : null,
      shipName: (ship?.name as string | null) ?? null,
    },
    items: ((raw.line_items ?? []) as any[]).map((li) => ({
      title: String(li.title ?? li.name ?? "—"), variant: (li.variant_title as string | null) ?? null, sku: (li.sku as string | null) ?? null,
      qty: Number(li.quantity ?? 0), price: Number(li.price ?? 0), refundedQty: refundedQty.get(String(li.id)) ?? 0,
      fulfillment: (li.fulfillment_status as string | null) ?? null,
    })),
    money: {
      currency: (o.currency ?? raw.currency ?? "USD") as string,
      subtotal: Number(raw.subtotal_price ?? 0), shipping: Number(raw.total_shipping_price_set?.shop_money?.amount ?? 0),
      discounts: Number(raw.total_discounts ?? 0), total: Number(raw.total_price ?? o.revenue ?? 0), refunded,
      financialStatus: o.shopify_financial_status as string | null, discountCodes: ((raw.discount_codes ?? []) as any[]).map((d) => d.code).filter(Boolean) as string[],
      gateway: ((raw.payment_gateway_names ?? []) as string[]).join(", ") || null,
    },
    shipping: {
      deliveryStatus: (legacyDelivered ? "delivered" : o.delivery_status) as string | null, carrier: (o.carrier ?? t?.carrier ?? null) as string | null,
      trackingCode: o.tracking_code as string | null, local,
      trackingUrl: (o.tracking_code ? buildTrackingUrl(integRes.data?.tracking_link_template, o.tracking_code) : null) ?? (o.tracking_url as string | null),
      history: ((o.tracking_code_history ?? []) as any[]).map((h) => ({ code: String(h?.code ?? ""), until: (h?.until as string | null) ?? null })).filter((h) => h.code),
      shippedAt: (o.shipped_at ?? t?.shipped_at ?? null) as string | null, deliveredAt: (o.delivered_at ?? t?.delivered_at ?? null) as string | null,
      problemAt: (o.problem_at ?? t?.problem_at ?? null) as string | null,
      lastEvent: cleanLabel(t?.last_event_label), lastEventAt: (t?.last_event_at as string | null) ?? null,
      eddFrom: (t?.edd_from as string | null) ?? null, eddTo: (t?.edd_to as string | null) ?? null,
      timeline, note: (o.logistics_note as string | null) ?? null, customerNotifiedAt: (o.customer_notified_at as string | null) ?? null,
    },
    supplier: {
      status: (legacy && o.payment_status !== "paid" ? "paid" : o.payment_status) as string | null, paidAt: (o.paid_at as string | null) ?? null, cost,
      batch: batchRes.data ? { number: (batchRes.data as any).batch_number as number, date: (batchRes.data as any).payment_date as string, total: Number((batchRes.data as any).total_amount ?? 0), orders: Number((batchRes.data as any).total_orders ?? 0) } : null,
      holdReleasedAt: (o.supplier_hold_released_at as string | null) ?? null,
      refunds: ((sRefunds ?? []) as any[]).map((r) => ({
        status: r.status as "pendente" | "confirmado", amount: Number(r.amount ?? 0), note: (r.note as string | null) ?? null,
        requestedAt: r.created_at as string, confirmedAt: (r.confirmed_at as string | null) ?? null,
        requestedBy: personName.get(r.requested_by) ?? null, confirmedBy: r.confirmed_by ? personName.get(r.confirmed_by) ?? null : null,
      })),
    },
    disputes: ((disputesRes.data ?? []) as any[]).map((d) => ({ type: d.type as string, status: d.status as string | null, reason: d.reason as string | null, amount: Number(d.amount ?? 0), initiatedAt: d.initiated_at as string, dueBy: d.evidence_due_by as string | null, finalizedOn: d.finalized_on as string | null })),
    alert: followRes.data ? {
      status: (followRes.data as any).status as string, step: Number((followRes.data as any).dunning_step ?? 0), lastAt: (followRes.data as any).dunning_last_at as string | null,
      stopReason: (followRes.data as any).dunning_stop_reason as string | null, recoveredAmount: (followRes.data as any).recovered_amount as number | null,
      recoveredAt: (followRes.data as any).recovered_at as string | null, recoveryOrder: (followRes.data as any).recovery_order_name as string | null,
      excluded: !!(followRes.data as any).excluded_at,
    } : null,
    conversations: ((convRes.data ?? []) as any[]).map((c) => ({ id: c.id as string, subject: c.subject as string | null, status: c.status as string | null, lastAt: c.last_message_at as string | null, messages: Number(c.message_count ?? 0) })),
  };
}

export const getOrderDetail = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    assertAccess(context);
    return loadOrderDetail(context.ownerId, data.id, context.supabase);
  });

// Nota da equipe do pedido (shop_orders.notice_note — a mesma do Rastreamento/Notificações).
export const updateOrderNote = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid(), note: z.string().max(1000) }).parse(d))
  .handler(async ({ data, context }) => {
    assertAccess(context);
    const note = data.note.trim() || null;
    const { error } = await supabaseAdmin.from("shop_orders").update({ notice_note: note })
      .eq("user_id", context.ownerId).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true, note };
  });
