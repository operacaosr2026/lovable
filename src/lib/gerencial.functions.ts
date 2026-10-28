import { createServerFn } from "@tanstack/react-start";
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

export type GerencialAlert = {
  kind: "meta" | "prejuizo" | "chargeback" | "produto" | "reembolso" | "entrega" | "tarefa" | "atendimento";
  level: "critico" | "atencao"; title: string; detail: string; link: string; action: string; metric: string; metricLabel: string;
};

export const getGerencial = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    if (!canView(ctx)) throw new Error("Sem acesso ao Gerencial");
    const { ownerId } = ctx;
    const today = isoTodayUS();
    const from = `${data.month}-01`;
    const to = monthEndOf(from) < today ? monthEndOf(from) : today;
    const current = from === `${today.slice(0, 7)}-01`;
    const prevFrom = prevMonthOf(from), prevTo = monthEndOf(prevFrom);

    const [shopIds, prevShopIds] = await Promise.all([companyShopIdsForMonth(ownerId, from), companyShopIdsForMonth(ownerId, prevFrom)]);
    const empty = { data: [] as any[] };
    const [lucro, lucroPrev, goals, refunds, refundsPrev, cardsRes, disputesRes, openDisputesRes, ordersRes, tasksRes, alertSettings, support] = await Promise.all([
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
      supportKpisFor(ownerId, data.month).catch((e) => { console.error("gerencial support", e); return null; }),
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
      alerts.push({ kind: "meta", level: "critico", title: "Meta do mês em risco", link: "/gerencial?tab=metas", action: "Ver metas",
        detail: `No ritmo atual o mês fecha abaixo da meta de ${usd(goal.meta)}.`,
        metric: usd(goal.projecao), metricLabel: "projeção do mês" });
    }
    for (const g of byGroup) {
      if (g.lucro7d != null && g.lucro7d < 0) {
        alerts.push({ kind: "prejuizo", level: "critico", title: `${g.name} no prejuízo`, link: `/shops/lojas-grupos/${g.id}`, action: "Abrir grupo",
          detail: `Lucro de ${weekFrom.slice(8)}/${weekFrom.slice(5, 7)} a ${weekTo.slice(8)}/${weekTo.slice(5, 7)} (últimos 7 dias fechados).`,
          metric: usd(g.lucro7d), metricLabel: "últimos 7 dias" });
      }
    }
    const dueSoon = ((openDisputesRes.data ?? []) as any[]).filter((d) => d.evidence_due_by && Date.parse(d.evidence_due_by) - now < 3 * DAY);
    if (dueSoon.length) {
      alerts.push({ kind: "chargeback", level: "critico", title: `${pl(dueSoon.length, "Chargeback", "Chargebacks")} com prazo acabando`, link: "/chargebacks", action: "Responder",
        detail: `${usd(dueSoon.reduce((s, d) => s + Number(d.amount ?? 0), 0))} em disputa. Sem resposta em até 3 dias, perde automático.`,
        metric: String(dueSoon.length), metricLabel: pl(dueSoon.length, "disputa", "disputas") });
    }
    if (alertSettings.enabled) {
      const over = products.filter((p) => p.rate != null && p.sold >= alertSettings.product_min_sold && p.rate * 100 > alertSettings.product_rate_limit)
        .sort((x, y) => (y.rate ?? 0) - (x.rate ?? 0));
      if (over.length) {
        alerts.push({ kind: "produto", level: "atencao", title: `${pl(over.length, "Produto", "Produtos")} com reembolso acima de ${alertSettings.product_rate_limit}%`, link: "/gerencial?tab=reembolsos", action: "Ver análise",
          detail: over.slice(0, 3).map((p) => `${p.name} (${Math.round((p.rate ?? 0) * 100)}%)`).join(", "),
          metric: `${Math.round((over[0].rate ?? 0) * 100)}%`, metricLabel: over.length === 1 ? "das vendas" : `pior de ${over.length}` });
      }
    }
    const stuck = [...refunds.events, ...refundsPrev.events].filter((e) => e.status === "pendente" && (e.pendingDays ?? 0) >= alertSettings.pending_days);
    if (stuck.length) {
      alerts.push({ kind: "reembolso", level: "atencao", title: "Reembolso parado na Shopify", link: "/gerencial?tab=reembolsos", action: "Ver análise",
        detail: `${usd(sum(stuck))} ainda não concluído há ${alertSettings.pending_days}+ dias.`,
        metric: String(stuck.length), metricLabel: pl(stuck.length, "reembolso", "reembolsos") });
    }
    if (entrega.atencao) {
      alerts.push({ kind: "entrega", level: "atencao", title: "Pedidos precisando de atenção na entrega", link: "/shops/lojas-grupos", action: "Ver rastreio",
        detail: "Sem envio há 3+ dias úteis, parado no rastreio há 5+ dias, com problema ou sem entrega depois de 20 dias.",
        metric: String(entrega.atencao), metricLabel: `de ${entrega.pedidos} do mês` });
    }
    if (overdue.length) {
      alerts.push({ kind: "tarefa", level: "atencao", title: `${pl(overdue.length, "Tarefa atrasada", "Tarefas atrasadas")}`, link: "/tarefas", action: "Ver tarefas",
        detail: equipe.tarefas.porPessoa.filter((p) => p.atrasadas).slice(0, 3).map((p) => `${p.name}: ${p.atrasadas}`).join(" · "),
        metric: String(overdue.length), metricLabel: pl(overdue.length, "tarefa", "tarefas") });
    }
    if (equipe.atendimento?.abertoMais36h) {
      const n = equipe.atendimento.abertoMais36h;
      alerts.push({ kind: "atendimento", level: "atencao", title: "Cliente sem resposta há mais de 36h", link: "/atendimento", action: "Abrir Atendimento",
        detail: "Cliente esperando é o caminho mais curto pro chargeback.",
        metric: String(n), metricLabel: pl(n, "conversa", "conversas") });
    }

    return {
      month: data.month, from, to, current, prevMonth: prevFrom.slice(0, 7),
      resultado: {
        atual: resumo(lucro), anterior: resumo(lucroPrev),
        meta: goal ? { meta: goal.meta, realizado: goal.realizado, projecao: goal.projecao, status: goal.status } : null,
        byGroup,
      },
      perdas, entrega, alerts,
    };
  });

function usd(v: number) {
  return `US$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
