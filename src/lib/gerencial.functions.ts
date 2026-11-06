import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext, type WorkspacePermission, type WorkspaceRole } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { selectAll } from "@/lib/select-all";
import { addDaysIso, isoTodayUS } from "@/lib/timezone";
import { companyShopIdsForMonth, listCompanyGoalsFor, monthEndOf } from "@/lib/company-goals.server";
import { computeAccumulatedLucroServer } from "@/lib/lg-overview.functions";
import { getRefundAlertSettings, productBreakdown, refundAnalytics } from "@/lib/support-refund-analytics.server";
import { supportKpisFor } from "@/lib/atendimento.functions";
import { personNames } from "@/lib/support-approval.server";
import { needsAttention } from "@/lib/logistics-kpis";
import { refundReasonLabel } from "@/lib/refund-reasons";
import { HANDOFF_DAYS, NOT_POSTED_DAYS, situationCarrierLabel, trackingSituations } from "@/lib/tracking-situations.server";

// Gerencial › Resultado e Alertas: a operação do mês, com as mesmas contas de
// Metas, Dashboard, Análise de reembolsos, Chargebacks e Rastreamento:
//  - lucro e as partes dele (mesma conta de Metas/Dashboard), meta e projeção, por grupo;
//  - depois da venda: taxa de reembolso pela data do pedido (= Análise de
//    reembolsos), chargebacks abertos no mês, motivos e produtos que mais custam;
//  - entrega dos pedidos vendidos no mês;
//  - alertas: o que precisa de decisão agora (inclui tarefas atrasadas e
//    conversas sem resposta, do Atendimento).
// Mês atual comparado com o mês anterior inteiro (fechado).

type Ctx = { ownerId: string; role: WorkspaceRole; permissions: WorkspacePermission[] };
const canView = (c: Ctx) => c.role === "admin" || c.permissions.some((p) => p.section === "gerencial");

const r2 = (n: number) => Math.round(n * 100) / 100;
const DAY = 86_400_000;
const prevMonthOf = (monthStart: string) => {
  const d = new Date(`${monthStart}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 10);
};

// Avisos do sino que são "algo fora do combinado no sistema" e vão pros Alertas.
// (Aprovação de troca/reembolso e chargeback têm lugar próprio — não entram.)
// Pagamento ao fornecedor só é marcado no sistema (lotes) a partir de 01/09/2026:
// os pedidos de 23–31/08 foram pagos por fora (confirmado pela operação em
// 05/11/2026) e não entram no alerta de "despachado sem pagamento".
const SUPPLIER_PAYMENT_TRACKED_SINCE = "2026-09-01";
const SUPPLIER_PAYMENT_GRACE_DAYS = 15;

const SYSTEM_NOTICE_PREFIXES = ["meta_token:", "meta_payment:", "meta_account:", "meta_campaign:", "shopify_sync:", "shopify_access:", "zoho_mail:", "system:", "product_missing:", "stuck:", "cron:"];

// key: identifica o alerta pra "Desconsiderar" (tabela gerencial_alert_dismissals,
// vale no mês escolhido pra toda a equipe).
export type GerencialAlert = {
  key: string;
  kind: "meta" | "prejuizo" | "chargeback" | "produto" | "reembolso" | "entrega" | "tarefa" | "atendimento" | "inteligencia" | "alfandega" | "lote" | "sistema";
  level: "critico" | "atencao"; title: string; detail: string; link: string; action: string; metric: string; metricLabel: string;
  /** Dica da Inteligência: índice dela na análise — "Ver análise" abre a gaveta ali mesmo. */
  tipIndex?: number;
};

export const getGerencial = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    if (!canView(ctx)) throw new Error("Sem acesso ao Gerencial");
    return buildGerencial(ctx, data);
  });

// Críticos do mês atual (menu lateral): guardados em gerencial_alert_cache —
// a conta é pesada, então refaz no máximo a cada 15 min (ou quando o Gerencial
// abre). Desconta os desconsiderados na hora.
export const gerencialCriticalCount = createServerOnlyFn(async (ctx: Ctx): Promise<number> => {
  const month = isoTodayUS().slice(0, 7);
  const { data: cache } = await supabaseAdmin.from("gerencial_alert_cache").select("critical_keys,computed_at")
    .eq("owner_id", ctx.ownerId).eq("month", month).maybeSingle();
  let keys = (cache?.critical_keys ?? []) as string[];
  if (!cache || Date.now() - Date.parse(cache.computed_at) > 15 * 60_000) {
    const g = await buildGerencial(ctx, { month });
    keys = [...g.alerts, ...g.dismissedAlerts].filter((a) => a.level === "critico").map((a) => a.key);
  }
  if (!keys.length) return 0;
  const { data: dismissed } = await supabaseAdmin.from("gerencial_alert_dismissals").select("alert_key")
    .eq("owner_id", ctx.ownerId).eq("month", month);
  const off = new Set((dismissed ?? []).map((r) => r.alert_key as string));
  return keys.filter((k) => !off.has(k)).length;
});

const buildGerencial = createServerOnlyFn(async (ctx: Ctx, data: { month: string }) => {
  {
    const { ownerId } = ctx;
    const today = isoTodayUS();
    const from = `${data.month}-01`;
    const to = monthEndOf(from) < today ? monthEndOf(from) : today;
    const current = from === `${today.slice(0, 7)}-01`;
    const prevFrom = prevMonthOf(from), prevTo = monthEndOf(prevFrom);

    const [shopIds, prevShopIds] = await Promise.all([companyShopIdsForMonth(ownerId, from), companyShopIdsForMonth(ownerId, prevFrom)]);
    const empty = { data: [] as any[] };
    const [lucro, lucroPrev, goals, refunds, refundsPrev, cardsRes, disputesRes, openDisputesRes, ordersRes, tasksRes, alertSettings, intelRes, support, trackingRes] = await Promise.all([
      shopIds.length ? computeAccumulatedLucroServer(supabaseAdmin, ownerId, shopIds, from, to) : null,
      prevShopIds.length ? computeAccumulatedLucroServer(supabaseAdmin, ownerId, prevShopIds, prevFrom, prevTo) : null,
      listCompanyGoalsFor(ownerId).catch(() => []),
      refundAnalytics(ownerId, from, to),
      refundAnalytics(ownerId, prevFrom, prevTo),
      supabaseAdmin.from("lg_card_shops").select("card_id,shop_id,lg_cards!inner(user_id,name,status)")
        .eq("lg_cards.user_id", ownerId).eq("lg_cards.status", "ativo"),
      shopIds.length
        ? selectAll<any>(supabaseAdmin.from("shop_order_disputes").select("status,amount,initiated_at")
            .eq("user_id", ownerId).in("shop_id", shopIds).eq("type", "chargeback")
            .gte("initiated_at", `${from}T00:00:00Z`).lte("initiated_at", `${to}T23:59:59Z`))
        : empty,
      shopIds.length
        ? supabaseAdmin.from("shop_order_disputes").select("id,amount,evidence_due_by").eq("user_id", ownerId)
            .in("shop_id", shopIds).eq("status", "needs_response")
        : empty,
      shopIds.length
        ? selectAll<any>(supabaseAdmin.from("shop_orders").select("shop_id,order_date,delivery_status,shipped_at,delivered_at,kpi_excluded")
            .eq("user_id", ownerId).in("shop_id", shopIds).gte("order_date", from).lte("order_date", to))
        : empty,
      selectAll<any>(supabaseAdmin.from("tasks").select("id,title,status,due_date,assignee_id,completed_at").eq("user_id", ownerId)),
      getRefundAlertSettings(ownerId),
      // Dicas da Inteligência (análise mais recente) ainda sem decisão.
      supabaseAdmin.from("consultant_reports").select("id,result,tips_status").eq("user_id", ownerId)
        .order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supportKpisFor(ownerId, data.month).catch((e) => { console.error("gerencial support", e); return null; }),
      // Avisos em aberto do sino: rastreio (alfândega, lote parado) e os de
      // sistema (integração caída, produto sem cadastro, rotina parada…).
      current
        ? supabaseAdmin.from("app_notifications").select("key,level,title,body,link").eq("user_id", ownerId)
            .is("resolved_at", null).in("level", ["error", "warning"])
            .or(["track123:", ...SYSTEM_NOTICE_PREFIXES].map((p) => `key.like.${p}%`).join(","))
            .order("created_at", { ascending: true })
        : empty,
    ]);

    // ── 1. Resultado ─────────────────────────────────────────────────────────
    const goal = (goals as any[]).find((g) => g.month === from) ?? null;
    const cards = new Map<string, { name: string; shops: string[] }>();
    for (const r of (cardsRes.data ?? []) as any[]) {
      if (!shopIds.includes(r.shop_id)) continue;
      const c = cards.get(r.card_id) ?? { name: r.lg_cards?.name ?? "Grupo", shops: [] as string[] };
      c.shops.push(r.shop_id);
      cards.set(r.card_id, c);
    }
    const weekFrom = addDaysIso(today, -7), weekTo = addDaysIso(today, -1);
    const byGroup = await Promise.all([...cards].map(async ([id, c]) => {
      const [m, week] = await Promise.all([
        computeAccumulatedLucroServer(supabaseAdmin, ownerId, c.shops, from, to),
        current ? computeAccumulatedLucroServer(supabaseAdmin, ownerId, c.shops, weekFrom, weekTo) : null,
      ]);
      return {
        id, name: c.name, shops: c.shops.length, pedidos: m.pedidos, faturamento: r2(m.faturamentoBruto), lucro: r2(m.lucro),
        margem: m.faturamentoBruto > 0 ? m.lucro / m.faturamentoBruto : null, lucro7d: week ? r2(week.lucro) : null,
      };
    }));
    const resumo = (l: typeof lucro) => l && ({
      faturamento: r2(l.faturamentoBruto), lucro: r2(l.lucro), pedidos: l.pedidos,
      margem: l.faturamentoBruto > 0 ? l.lucro / l.faturamentoBruto : null,
      custo: r2(l.custo), anuncios: r2(l.anuncios), taxas: r2(l.taxas), reembolsos: r2(l.reembolsos), chargebacks: r2(l.chargebacks),
      cpa: l.pedidos ? r2(l.anuncios / l.pedidos) : null,
    });

    // ── 2. Perdas depois da venda ────────────────────────────────────────────
    const sum = (xs: { amount: number }[]) => r2(xs.reduce((s, x) => s + x.amount, 0));
    const refundStats = (a: typeof refunds) => {
      const refunded = new Set(a.events.map((e) => e.orderId)).size;
      return { valor: sum(a.events), pedidos: refunded, taxa: a.orders ? refunded / a.orders : null };
    };
    const inMonth = (d: any, f: string, t: string) => d.initiated_at && d.initiated_at.slice(0, 10) >= f && d.initiated_at.slice(0, 10) <= t;
    const cbStats = (f: string, t: string) => {
      const list = ((disputesRes.data ?? []) as any[]).filter((d) => inMonth(d, f, t));
      const by = (st: string[]) => list.filter((d) => st.includes(d.status));
      const amt = (xs: any[]) => r2(xs.reduce((s, d) => s + Number(d.amount ?? 0), 0));
      return {
        abertos: list.length, valor: amt(list),
        perdidos: by(["lost"]).length, valorPerdido: amt(by(["lost"])),
        ganhos: by(["won"]).length, evitados: by(["prevented"]).length,
        emAndamento: by(["needs_response", "under_review"]).length,
      };
    };
    const disputifier = refunds.events.filter((e) => e.source === "disputifier");
    const reasons = new Map<string, { count: number; amount: number }>();
    for (const e of refunds.events) {
      const k = e.reason ?? (e.source === "shopify" ? "fora_app" : "sem");
      const x = reasons.get(k) ?? { count: 0, amount: 0 };
      x.count++; x.amount += e.amount;
      reasons.set(k, x);
    }
    const products = productBreakdown(refunds);
    const cb = cbStats(from, to);
    const rf = refundStats(refunds), rfPrev = refundStats(refundsPrev);
    const perdas = {
      reembolsos: rf, reembolsosPrev: rfPrev,
      chargebacks: cb,
      disputifier: { count: disputifier.length },
      topMotivos: [...reasons].map(([k, x]) => ({ key: k, label: k === "fora_app" ? "Direto na Shopify (sem motivo)" : k === "sem" ? "Sem motivo" : refundReasonLabel(k), count: x.count, amount: r2(x.amount) }))
        .sort((a, b) => b.amount - a.amount).slice(0, 5),
      topProdutos: [...products].sort((a, b) => b.amount - a.amount).slice(0, 5)
        .map((p) => ({ name: p.name, image: p.image, amount: p.amount, units: p.units, sold: p.sold, rate: p.rate })),
    };

    // ── 3. Entrega ──────────────────────────────────────────────
    const now = Date.now();
    const orders = (ordersRes.data ?? []) as any[];
    const delivered = orders.filter((o) => o.delivery_status === "delivered" && o.delivered_at && !o.kpi_excluded);
    const daysToDeliver = delivered.map((o) => (Date.parse(o.delivered_at) - Date.parse(`${o.order_date}T12:00:00Z`)) / DAY).filter((d) => d >= 0);
    const entrega = {
      pedidos: orders.length,
      entregues: orders.filter((o) => o.delivery_status === "delivered").length,
      emTransito: orders.filter((o) => o.delivery_status === "shipped" || o.delivery_status === "in_transit").length,
      semEnvio: orders.filter((o) => !o.delivery_status || o.delivery_status === "pending_shipment").length,
      problema: orders.filter((o) => o.delivery_status === "problem" || o.delivery_status === "returned").length,
      atencao: orders.filter((o) => needsAttention(o, now)).length,
      diasMedios: daysToDeliver.length ? daysToDeliver.reduce((s, d) => s + d, 0) / daysToDeliver.length : null,
      ate20dias: daysToDeliver.length ? daysToDeliver.filter((d) => d <= 20).length / daysToDeliver.length : null,
    };

    // ── 4. Equipe ────────────────────────────────────────────────────────────
    const tasks = (tasksRes.data ?? []) as any[];
    const overdue = tasks.filter((t) => t.status !== "concluida" && t.due_date && t.due_date < today);
    const doneInMonth = tasks.filter((t) => t.status === "concluida" && t.completed_at && t.completed_at.slice(0, 10) >= from && t.completed_at.slice(0, 10) <= to);
    const names = await personNames(tasks.map((t) => t.assignee_id));
    const people = new Map<string, { atrasadas: number; concluidas: number }>();
    const person = (id: string | null) => {
      const k = id ?? "";
      const x = people.get(k) ?? { atrasadas: 0, concluidas: 0 };
      people.set(k, x);
      return x;
    };
    for (const t of overdue) person(t.assignee_id).atrasadas++;
    for (const t of doneInMonth) person(t.assignee_id).concluidas++;
    const c = support?.cards;
    const equipe = {
      atendimento: c ? {
        conversas: c.total.value, conversasPrev: c.total.prev,
        primeiraRespostaMin: c.firstResponse.value == null ? null : Math.round(c.firstResponse.value / 60_000),
        primeiraRespostaPrevMin: c.firstResponse.prev == null ? null : Math.round(c.firstResponse.prev / 60_000),
        resolucaoMin: c.resolution.value == null ? null : Math.round(c.resolution.value / 60_000),
        taxaResolucao: c.rate.value, emAberto: c.open.value, abertoMais36h: c.open.over36h,
        metaPrimeiraRespostaMin: support!.goals.firstResponseMin, metaResolucaoMin: support!.goals.resolutionMin,
        contatosPor100: support!.extra?.contactRate.value ?? null,
      } : null,
      tarefas: {
        atrasadas: overdue.length, concluidas: doneInMonth.length,
        porPessoa: [...people].map(([id, x]) => ({ name: id ? names.get(id) ?? "Membro" : "Sem responsável", ...x }))
          .filter((x) => x.atrasadas || x.concluidas).sort((a, b) => b.atrasadas - a.atrasadas || b.concluidas - a.concluidas),
      },
      aprovacaoHoras: refunds.approvalHours,
    };

    // ── 5. Alertas ───────────────────────────────────────────────────────────
    // metric: o número que resume o alerta (vai em destaque no card).
    const alerts: GerencialAlert[] = [];
    const pl = (n: number, one: string, many: string) => (n === 1 ? one : many);
    if (current && goal && goal.projecao != null && goal.projecao < goal.meta) {
      alerts.push({ key: "meta", kind: "meta", level: "critico", title: "Meta do mês em risco", link: "/gerencial?tab=metas", action: "Ver metas",
        detail: `No ritmo atual o mês fecha abaixo da meta de ${usd(goal.meta)}.`,
        metric: usd(goal.projecao), metricLabel: "projeção do mês" });
    }
    for (const g of byGroup) {
      if (g.lucro7d != null && g.lucro7d < 0) {
        alerts.push({ key: `prejuizo:${g.id}`, kind: "prejuizo", level: "critico", title: `${g.name} no prejuízo`, link: `/shops/lojas-grupos/${g.id}`, action: "Abrir grupo",
          detail: `Lucro de ${weekFrom.slice(8)}/${weekFrom.slice(5, 7)} a ${weekTo.slice(8)}/${weekTo.slice(5, 7)} (últimos 7 dias fechados).`,
          metric: usd(g.lucro7d), metricLabel: "últimos 7 dias" });
      }
    }
    const dueSoon = ((openDisputesRes.data ?? []) as any[]).filter((d) => d.evidence_due_by && Date.parse(d.evidence_due_by) - now < 3 * DAY);
    if (dueSoon.length) {
      alerts.push({ key: "chargeback", kind: "chargeback", level: "critico", title: `${pl(dueSoon.length, "Chargeback", "Chargebacks")} com prazo acabando`, link: "/chargebacks", action: "Responder",
        detail: `${usd(dueSoon.reduce((s, d) => s + Number(d.amount ?? 0), 0))} em disputa. Sem resposta em até 3 dias, perde automático.`,
        metric: String(dueSoon.length), metricLabel: pl(dueSoon.length, "disputa", "disputas") });
    }
    if (alertSettings.enabled) {
      const over = products.filter((p) => p.rate != null && p.sold >= alertSettings.product_min_sold && p.rate * 100 > alertSettings.product_rate_limit)
        .sort((x, y) => (y.rate ?? 0) - (x.rate ?? 0));
      if (over.length) {
        alerts.push({ key: "produto", kind: "produto", level: "atencao", title: `${pl(over.length, "Produto", "Produtos")} com reembolso acima de ${alertSettings.product_rate_limit}%`, link: "/gerencial?tab=reembolsos", action: "Ver análise",
          detail: over.slice(0, 3).map((p) => `${p.name} (${Math.round((p.rate ?? 0) * 100)}%)`).join(", "),
          metric: `${Math.round((over[0].rate ?? 0) * 100)}%`, metricLabel: over.length === 1 ? "das vendas" : `pior de ${over.length}` });
      }
    }
    const stuck = [...refunds.events, ...refundsPrev.events].filter((e) => e.status === "pendente" && (e.pendingDays ?? 0) >= alertSettings.pending_days);
    if (stuck.length) {
      alerts.push({ key: "reembolso", kind: "reembolso", level: "atencao", title: "Reembolso parado na Shopify", link: "/gerencial?tab=reembolsos", action: "Ver análise",
        detail: `${usd(sum(stuck))} ainda não concluído há ${alertSettings.pending_days}+ dias.`,
        metric: String(stuck.length), metricLabel: pl(stuck.length, "reembolso", "reembolsos") });
    }
    // Rastreio: todo pedido em aberto (até 180 dias), não só os do mês.
    const sit = await trackingSituations(ownerId, shopIds, now);
    if (sit.reenvioEntregue.length) {
      const n = sit.reenvioEntregue.length;
      alerts.push({ key: "rastreio:reenvio_entregue", kind: "entrega", level: "critico", title: `${pl(n, "Reenvio", "Reenvios")} que talvez não precisava`, link: "", action: "Ver rastreio",
        detail: `O pacote antigo foi entregue e o reenvio ainda não: ${sit.reenvioEntregue.map((o) => o.order_number).join(", ")}. Veja se dá pra cancelar o reenvio.`,
        metric: String(n), metricLabel: pl(n, "pedido", "pedidos") });
    }
    if (sit.cliente.length) {
      const n = sit.cliente.length;
      alerts.push({ key: "rastreio:cliente", kind: "entrega", level: "critico", title: "Endereço errado, devolvido ou falha na entrega", link: "", action: "Ver rastreio",
        detail: `${sit.cliente.map((o) => o.order_number).join(", ")}. Fale com o cliente (confirmar endereço) ou decida o reenvio antes de virar chargeback.`,
        metric: String(n), metricLabel: pl(n, "pedido", "pedidos") });
    }
    for (const [carrier, list] of [...sit.naoPostado.entries()].sort((a, b) => b[1].length - a[1].length)) {
      const n = list.length;
      const oldest = list.map((o) => o._events[0]?.ts ?? now).reduce((m, v) => Math.min(m, v), now);
      const dias = Math.floor((now - oldest) / DAY);
      alerts.push({ key: `rastreio:nao_postado:${carrier}`, kind: "lote", level: dias >= 10 ? "critico" : "atencao",
        title: `${situationCarrierLabel(carrier)}: ${pl(n, "pacote não postado", "pacotes não postados")}`, link: "", action: "Ver rastreio",
        detail: `Código gerado e só o aviso de etiqueta há ${NOT_POSTED_DAYS}+ dias (o mais antigo há ${dias} dias) — o fornecedor não despachou. Cobre o fornecedor.`,
        metric: String(n), metricLabel: pl(n, "pedido", "pedidos") });
    }
    if (sit.repassado.length) {
      const n = sit.repassado.length;
      alerts.push({ key: "rastreio:repassado", kind: "lote", level: "atencao", title: "Repassado à transportadora local e parou", link: "", action: "Ver rastreio",
        detail: `"Delivered to local carrier" há ${HANDOFF_DAYS}+ dias sem outro evento. O pacote está com a transportadora dos EUA — peça o código local ao fornecedor.`,
        metric: String(n), metricLabel: pl(n, "pedido", "pedidos") });
    }
    if (sit.entrega.length) {
      const n = sit.entrega.length;
      alerts.push({ key: "entrega", kind: "entrega", level: "atencao", title: "Pedidos precisando de atenção na entrega", link: "", action: "Ver rastreio",
        detail: "Sem envio há 3+ dias úteis, parado no rastreio há 5+ dias, com problema ou sem entrega depois de 20 dias — todos os pedidos em aberto, não só os do mês.",
        metric: String(n), metricLabel: "em aberto" });
    }
    // Fora do combinado: o sistema caiu num padrão e alguém precisa acertar.
    for (const [pfx, list] of sit.transportadoraNova) {
      alerts.push({ key: `fora:transportadora:${pfx}`, kind: "sistema", level: "atencao", title: `Transportadora não cadastrada: códigos ${pfx}…`, link: "", action: "Ver pedidos",
        detail: `${list.length} pedido(s) com código que não é de nenhuma transportadora conhecida (${list.slice(0, 5).map((o) => o.order_number).join(", ")}). Hoje caem em "Outras" na aba Transportadoras — me peça pra cadastrar.`,
        metric: String(list.length), metricLabel: pl(list.length, "pedido", "pedidos") });
    }
    if (sit.semEvento.length) {
      const n = sit.semEvento.length;
      alerts.push({ key: "fora:sem_evento", kind: "sistema", level: "atencao", title: "Rastreio cadastrado que não traz nenhum evento", link: "", action: "Ver pedidos",
        detail: "Cadastrado no 17track há 3+ dias e nenhum evento — código errado, transportadora não reconhecida ou o 17track não acha. Confira o código.",
        metric: String(n), metricLabel: pl(n, "pedido", "pedidos") });
    }
    if (sit.localNova.length) {
      const n = sit.localNova.length;
      alerts.push({ key: "fora:local", kind: "sistema", level: "atencao", title: "Transportadora local não reconhecida", link: "", action: "Ver pedidos",
        detail: `Repassado à transportadora local dos EUA e os eventos não batem com nenhuma conhecida (${sit.localNova.slice(0, 5).map((o) => o.order_number).join(", ")}). Fica como "Não reconhecida" no Rastreamento local — me mande um código pra cadastrar.`,
        metric: String(n), metricLabel: pl(n, "pedido", "pedidos") });
    }
    if (sit.statusDiverge.length) {
      const n = sit.statusDiverge.length;
      alerts.push({ key: "fora:status", kind: "sistema", level: "atencao", title: "Rastreio diz entregue e o pedido não", link: "", action: "Ver pedidos",
        detail: `O rastreio tem evento de entrega há 1+ dia e o pedido não está como entregue (${sit.statusDiverge.slice(0, 5).map((o) => o.order_number).join(", ")}). Status marcado à mão ou regra de entrega não reconheceu.`,
        metric: String(n), metricLabel: pl(n, "pedido", "pedidos") });
    }
    if (current && shopIds.length) {
      // Despachado sem pagamento ao fornecedor: tem rastreio, o cliente pagou e o
      // pedido não entrou em nenhum lote de pagamento depois de 15 dias.
      const { data: unpaid } = await supabaseAdmin.from("shop_orders").select("order_number,shopify_financial_status,cancelled:raw->>cancelled_at")
        .eq("user_id", ownerId).in("shop_id", shopIds).eq("payment_status", "pending").not("tracking_code", "is", null).neq("tracking_code", "")
        .gte("order_date", SUPPLIER_PAYMENT_TRACKED_SINCE).lte("order_date", addDaysIso(today, -SUPPLIER_PAYMENT_GRACE_DAYS));
      // Reembolsado inteiro ou cancelado sai (pode nem ter ido pro fornecedor).
      const list = ((unpaid ?? []) as any[]).filter((o) => !o.cancelled && !["refunded", "voided"].includes(String(o.shopify_financial_status ?? "")));
      if (list.length) {
        alerts.push({ key: `fora:sem_pagamento:${list.map((o) => o.order_number).sort().join(",")}`.slice(0, 200), kind: "sistema", level: "atencao",
          title: `${pl(list.length, "Pedido despachado", "Pedidos despachados")} sem pagamento ao fornecedor marcado`, link: "/shops/lojas-grupos", action: "Acertar",
          detail: `${list.map((o) => o.order_number).join(", ")} — tem rastreio há ${SUPPLIER_PAYMENT_GRACE_DAYS}+ dias e não está em nenhum lote de pagamento. Se já pagou, marque no lote do fornecedor; se não, é conta em aberto.`,
          metric: String(list.length), metricLabel: pl(list.length, "pedido", "pedidos") });
      }
    }
    if (current) {
      // Loja ativa num lugar e não no outro: coluna "Ativas" do Banco de Lojas ×
      // cards ativos de Lojas e Grupos (cada tela conta uma). Só loja com pedido
      // nos últimos 60 dias (a Matriz, sem pedido, não aparece).
      const [cols, sales] = await Promise.all([
        supabaseAdmin.from("store_board_columns").select("id,name").eq("user_id", ownerId),
        supabaseAdmin.from("shop_orders").select("shop_id").eq("user_id", ownerId).gte("order_date", addDaysIso(today, -60)).limit(5000),
      ]);
      const activeCols = (cols.data ?? []).filter((c: any) => /^ativ/i.test(String(c.name).trim())).map((c: any) => c.id);
      const { data: boardShops } = activeCols.length
        ? await supabaseAdmin.from("shops").select("id,name,shopify_stores!inner(board_column_id)").eq("user_id", ownerId).eq("archived", false).in("shopify_stores.board_column_id", activeCols)
        : { data: [] as any[] };
      const selling = new Set((sales.data ?? []).map((r: any) => r.shop_id as string));
      const board = new Map(((boardShops ?? []) as any[]).map((r) => [r.id as string, r.name as string]));
      const cardSet = new Set(shopIds);
      const { data: cardNames } = cardSet.size ? await supabaseAdmin.from("shops").select("id,name").in("id", [...cardSet]) : { data: [] as any[] };
      const onlyBoard = [...board].filter(([id]) => !cardSet.has(id) && selling.has(id)).map(([, n]) => n);
      const onlyCard = ((cardNames ?? []) as any[]).filter((r) => !board.has(r.id) && selling.has(r.id)).map((r) => r.name as string);
      if (onlyBoard.length || onlyCard.length) {
        alerts.push({ key: `fora:lojas:${[...onlyBoard, ...onlyCard].sort().join("|")}`.slice(0, 200), kind: "sistema", level: "atencao",
          title: "Loja ativa num lugar e não no outro", link: "/shops/banco-de-lojas", action: "Acertar",
          detail: [onlyBoard.length ? `Na coluna Ativas do Banco de Lojas, mas fora de card ativo em Lojas e Grupos: ${onlyBoard.join(", ")}.` : "",
            onlyCard.length ? `Em card ativo de Lojas e Grupos, mas fora da coluna Ativas: ${onlyCard.join(", ")}.` : "",
            "Resultado/Metas contam pelos cards; Transportadoras e Produtos pela coluna Ativas."].filter(Boolean).join(" "),
          metric: String(onlyBoard.length + onlyCard.length), metricLabel: "loja(s)" });
      }
    }
    if (sit.semFase.length) {
      const n = sit.semFase.length;
      alerts.push({ key: "rastreio:sem_fase", kind: "lote", level: "atencao", title: `${pl(n, "Texto", "Textos")} de rastreio sem fase`, link: "/settings/rastreamento?tab=textos&filtro=sem_regra", action: "Classificar",
        detail: `Nenhuma regra reconhece (ex.: "${sit.semFase[0].example.slice(0, 60)}"). Até escolher a fase, prazos e alfândega das transportadoras podem sair errados.`,
        metric: String(n), metricLabel: pl(n, "texto", "textos") });
    }
    if (overdue.length) {
      alerts.push({ key: "tarefa", kind: "tarefa", level: "atencao", title: `${pl(overdue.length, "Tarefa atrasada", "Tarefas atrasadas")}`, link: "/tarefas", action: "Ver tarefas",
        detail: equipe.tarefas.porPessoa.filter((p) => p.atrasadas).slice(0, 3).map((p) => `${p.name}: ${p.atrasadas}`).join(" · "),
        metric: String(overdue.length), metricLabel: pl(overdue.length, "tarefa", "tarefas") });
    }
    if (equipe.atendimento?.abertoMais36h) {
      const n = equipe.atendimento.abertoMais36h;
      alerts.push({ key: "atendimento", kind: "atendimento", level: "atencao", title: "Cliente sem resposta há mais de 36h", link: "/atendimento", action: "Abrir Atendimento",
        detail: "Cliente esperando é o caminho mais curto pro chargeback.",
        metric: String(n), metricLabel: pl(n, "conversa", "conversas") });
    }

    // Rastreio: cada aviso aberto de alfândega / lote parado vira um alerta
    // (alfândega = crítico). Some sozinho quando o aviso resolve no sino.
    // Lote parado em que todo pedido já está numa situação específica (ex.: não
    // postado) não repete o mesmo problema em outro alerta.
    const specificNums = new Set([...sit.cliente, ...sit.repassado, ...sit.reenvioEntregue, ...[...sit.naoPostado.values()].flat()].map((o) => String(o.order_number)));
    for (const n of (trackingRes.data ?? []) as any[]) {
      const k = String(n.key);
      // Sistema: integração caída, produto sem cadastro, rotina parada, sync do
      // rastreio com erro (track123:<loja>)…
      if (!k.startsWith("track123:alfandega:") && !k.startsWith("track123:lote:")) {
        alerts.push({ key: k, kind: "sistema", level: n.level === "error" ? "critico" : "atencao", title: String(n.title),
          detail: String(n.body ?? ""), link: String(n.link ?? "/notificacoes"), action: "Acertar", metric: "", metricLabel: "" });
        continue;
      }
      const alfandega = k.startsWith("track123:alfandega:");
      const nums = String(n.body ?? "").match(/#[A-Za-z0-9-]+/g) ?? [];
      if (!alfandega && nums.length && nums.every((x) => specificNums.has(x))) continue;
      const qtd = Number(String(n.title).match(/(\d+)\s+pacote/)?.[1] ?? 0);
      alerts.push({
        key: String(n.key), kind: alfandega ? "alfandega" : "lote", level: alfandega || n.level === "error" ? "critico" : "atencao",
        title: String(n.title), detail: String(n.body ?? ""), link: String(n.link ?? "/shops/lojas-grupos"), action: "Ver rastreio",
        metric: qtd ? String(qtd) : "—", metricLabel: pl(qtd, "pacote parado", "pacotes parados"),
      });
    }

    // Inteligência: cada dica sem decisão vira um alerta (crítico/alto = crítico).
    const PRIO = { critico: 0, alto: 1, medio: 2, baixo: 3, oportunidade: 4 } as Record<string, number>;
    const intel = intelRes.data as any;
    const tipsStatus = (intel?.tips_status ?? {}) as Record<string, unknown>;
    const tips = ((intel?.result?.dicas ?? []) as any[]).map((t, i) => ({ ...t, _index: i })).filter((t) => !tipsStatus[String(t._index)])
      .sort((x, y) => (PRIO[x.prioridade ?? "medio"] ?? 2) - (PRIO[y.prioridade ?? "medio"] ?? 2));
    for (const t of tips) {
      const valor = Number(t.valor_envolvido ?? 0);
      alerts.push({
        key: `inteligencia:${String(t.titulo ?? "")}`, kind: "inteligencia", level: t.prioridade === "critico" || t.prioridade === "alto" ? "critico" : "atencao",
        title: String(t.titulo ?? "Dica da Inteligência"), detail: String(t.frase ?? t.evidencia_principal ?? ""),
        link: `/inteligencia?dica=${t._index}`, action: "Ver análise", tipIndex: t._index,
        metric: valor > 0 ? usd(valor) : t.prioridade === "oportunidade" ? "Oportunidade" : "Dica",
        metricLabel: valor > 0 ? (t.valor_rotulo ?? (t.valor_tipo === "estimado" ? "estimado" : "envolvido")) : `Inteligência${t.categoria ? ` · ${t.categoria}` : ""}`,
      });
    }

    const { data: dismissedRows } = await supabaseAdmin.from("gerencial_alert_dismissals").select("alert_key")
      .eq("owner_id", ownerId).eq("month", data.month);
    const dismissedKeys = new Set((dismissedRows ?? []).map((r) => r.alert_key as string));
    if (current) {
      await supabaseAdmin.from("gerencial_alert_cache").upsert({
        owner_id: ownerId, month: data.month, computed_at: new Date().toISOString(),
        critical_keys: alerts.filter((a) => a.level === "critico").map((a) => a.key),
      });
    }

    return {
      month: data.month, from, to, current, prevMonth: prevFrom.slice(0, 7),
      resultado: {
        atual: resumo(lucro), anterior: resumo(lucroPrev),
        meta: goal ? { meta: goal.meta, realizado: goal.realizado, projecao: goal.projecao, status: goal.status } : null,
        byGroup,
      },
      perdas, entrega,
      alerts: alerts.filter((a) => !dismissedKeys.has(a.key)),
      dismissedAlerts: alerts.filter((a) => dismissedKeys.has(a.key)),
    };
  }
});

// Desconsiderar (ou trazer de volta) um alerta no mês.
export const dismissGerencialAlert = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), key: z.string().min(1).max(300), undo: z.boolean().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx & { userId: string };
    if (!canView(ctx)) throw new Error("Sem acesso ao Gerencial");
    const q = supabaseAdmin.from("gerencial_alert_dismissals");
    const { error } = data.undo
      ? await q.delete().eq("owner_id", ctx.ownerId).eq("month", data.month).eq("alert_key", data.key)
      : await q.upsert({ owner_id: ctx.ownerId, month: data.month, alert_key: data.key, dismissed_by: ctx.userId, dismissed_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

function usd(v: number) {
  return `US$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
