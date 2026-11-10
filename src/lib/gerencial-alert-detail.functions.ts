import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext, type WorkspacePermission, type WorkspaceRole } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { companyShopIdsForMonth } from "@/lib/company-goals.server";
import { trackingSituations, type SemFaseText } from "@/lib/tracking-situations.server";
import { isoTodayUS } from "@/lib/timezone";

// Gerencial › Alertas: gaveta dos alertas que não são de rastreio (chargeback,
// tarefas, atendimento, sem pagamento, lojas, textos sem fase…) — a lista do que
// dá pra resolver ali mesmo (pedido do usuário em 06/11/2026: "tentar ao máximo
// resolver pela gaveta"). Os de rastreio usam gerencial-alert-orders.

type Ctx = { ownerId: string; role: WorkspaceRole; permissions: WorkspacePermission[] };
const canView = (c: Ctx) => c.role === "admin" || c.permissions.some((p) => p.section === "gerencial");
const DAY = 86_400_000;
const ddmm = (iso: string | null | undefined) => (iso ? `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}` : "");
const usd = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export type AlertDetailItem = {
  id: string; title: string; sub?: string;
  href?: string;            // abrir (interno ou externo)
  taskId?: string;          // tarefa: dá pra concluir na gaveta
};
export type AlertDetail = { items: AlertDetailItem[]; texts?: SemFaseText[] };

async function cardByShop(ownerId: string) {
  const { data } = await supabaseAdmin.from("lg_card_shops").select("card_id,shop_id,lg_cards!inner(user_id,status)").eq("lg_cards.user_id", ownerId);
  const m = new Map<string, string>();
  for (const r of (data ?? []) as any[]) if (!m.has(r.shop_id) || r.lg_cards?.status === "ativo") m.set(r.shop_id, r.card_id);
  return m;
}

export const getAlertDetail = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ key: z.string().min(1).max(300), month: z.string().regex(/^\d{4}-\d{2}$/) }).parse(d))
  .handler(async ({ data, context }): Promise<AlertDetail> => {
    const ctx = context as Ctx;
    if (!canView(ctx)) throw new Error("Sem acesso ao Gerencial");
    const { ownerId } = ctx;
    const now = Date.now();
    const key = data.key;

    if (key === "chargeback") {
      const shopIds = await companyShopIdsForMonth(ownerId, `${data.month}-01`);
      const { data: ds } = shopIds.length
        ? await supabaseAdmin.from("shop_order_disputes").select("id,shop_id,amount,evidence_due_by,reason,order_external_id")
            .eq("user_id", ownerId).in("shop_id", shopIds).eq("status", "needs_response")
        : { data: [] as any[] };
      const due = ((ds ?? []) as any[]).filter((d) => d.evidence_due_by && Date.parse(d.evidence_due_by) - now < 3 * DAY)
        .sort((a, b) => String(a.evidence_due_by).localeCompare(String(b.evidence_due_by)));
      const ext = due.map((d) => d.order_external_id).filter(Boolean);
      const [{ data: orders }, { data: shops }] = await Promise.all([
        ext.length ? supabaseAdmin.from("shop_orders").select("shop_id,external_id,order_number").eq("user_id", ownerId).in("external_id", ext) : Promise.resolve({ data: [] as any[] }),
        supabaseAdmin.from("shops").select("id,name,shopify_store_id").in("id", [...new Set(due.map((d) => d.shop_id))]),
      ]);
      const storeIds = ((shops ?? []) as any[]).map((s) => s.shopify_store_id).filter(Boolean);
      const { data: stores } = storeIds.length ? await supabaseAdmin.from("shopify_stores").select("id,shop_domain").in("id", storeIds) : { data: [] as any[] };
      const domainOf = new Map(((shops ?? []) as any[]).map((s) => [s.id, ((stores ?? []) as any[]).find((x) => x.id === s.shopify_store_id)?.shop_domain ?? null]));
      const nameOf = new Map(((shops ?? []) as any[]).map((s) => [s.id, s.name]));
      const numOf = new Map(((orders ?? []) as any[]).map((o) => [`${o.shop_id}:${o.external_id}`, o.order_number]));
      return {
        items: due.map((d) => {
          const left = Math.ceil((Date.parse(d.evidence_due_by) - now) / DAY);
          const domain = domainOf.get(d.shop_id);
          return {
            id: d.id, title: `${numOf.get(`${d.shop_id}:${d.order_external_id}`) ?? "Pedido"} · ${usd(Number(d.amount ?? 0))}`,
            sub: `${nameOf.get(d.shop_id) ?? ""} · prazo ${ddmm(d.evidence_due_by)} (${left <= 0 ? "hoje" : `${left} dia${left === 1 ? "" : "s"}`})${d.reason ? ` · ${String(d.reason).replace(/_/g, " ")}` : ""}`,
            href: domain && d.order_external_id ? `https://${domain}/admin/orders/${d.order_external_id}` : "/chargebacks",
          };
        }),
      };
    }

    if (key === "tarefa") {
      const today = isoTodayUS();
      const { data: tasks } = await supabaseAdmin.from("tasks").select("id,title,due_date,assignee_id,priority")
        .eq("user_id", ownerId).neq("status", "concluida").lt("due_date", today).order("due_date", { ascending: true });
      const ids = [...new Set(((tasks ?? []) as any[]).map((t) => t.assignee_id).filter(Boolean))];
      const { data: people } = ids.length ? await supabaseAdmin.from("profiles").select("id,full_name").in("id", ids) : { data: [] as any[] };
      const nameOf = new Map(((people ?? []) as any[]).map((p) => [p.id, p.full_name]));
      return {
        items: ((tasks ?? []) as any[]).map((t) => ({
          id: t.id, taskId: t.id, title: t.title,
          sub: `${t.assignee_id ? nameOf.get(t.assignee_id) ?? "Sem nome" : "Sem responsável"} · venceu ${ddmm(t.due_date)}`,
        })),
      };
    }

    if (key === "atendimento") {
      const { data: convs } = await supabaseAdmin.from("support_conversations").select("id,customer_name,customer_email,subject,last_inbound_at,last_outbound_at,status")
        .eq("owner_id", ownerId).neq("status", "resolvido").not("last_inbound_at", "is", null);
      const waiting = ((convs ?? []) as any[]).map((c) => {
        const li = Date.parse(c.last_inbound_at);
        const lo = c.last_outbound_at ? Date.parse(c.last_outbound_at) : 0;
        return { c, h: li > lo ? (now - li) / 3_600_000 : 0 };
      }).filter((x) => x.h > 36).sort((a, b) => b.h - a.h);
      return {
        items: waiting.map(({ c, h }) => ({
          id: c.id, title: c.customer_name || c.customer_email || "Cliente",
          sub: `${c.subject ? `${String(c.subject).slice(0, 80)} · ` : ""}esperando há ${h >= 48 ? `${Math.floor(h / 24)} dias` : `${Math.floor(h)}h`}`,
          href: `/atendimento?c=${c.id}`,
        })),
      };
    }

    if (key.startsWith("fora:sem_pagamento:")) {
      const nums = key.slice("fora:sem_pagamento:".length).split(",").filter(Boolean);
      const { data: orders } = nums.length
        ? await supabaseAdmin.from("shop_orders").select("id,order_number,order_date,shop_id,tracking_code").eq("user_id", ownerId).in("order_number", nums)
        : { data: [] as any[] };
      const [{ data: shops }, cards] = await Promise.all([
        supabaseAdmin.from("shops").select("id,name").in("id", [...new Set(((orders ?? []) as any[]).map((o) => o.shop_id))]),
        cardByShop(ownerId),
      ]);
      const nameOf = new Map(((shops ?? []) as any[]).map((s) => [s.id, s.name]));
      return {
        items: ((orders ?? []) as any[]).sort((a, b) => String(a.order_date).localeCompare(String(b.order_date))).map((o) => ({
          id: o.id, title: o.order_number,
          sub: `${nameOf.get(o.shop_id) ?? ""} · pedido ${ddmm(o.order_date)} · ${o.tracking_code ?? "sem rastreio"}`,
          href: cards.get(o.shop_id) ? `/shops/lojas-grupos/${cards.get(o.shop_id)}?tab=pedidos` : "/shops/lojas-grupos",
        })),
      };
    }

    if (key.startsWith("fora:lojas:")) {
      return { items: key.slice("fora:lojas:".length).split("|").filter(Boolean).map((n) => ({ id: n, title: n, href: "/shops/banco-de-lojas" })) };
    }

    if (key === "rastreio:sem_fase") {
      const sit = await trackingSituations(ownerId, await companyShopIdsForMonth(ownerId, `${data.month}-01`), now);
      return { items: [], texts: sit.semFase.slice(0, 50) };
    }

    return { items: [] };
  });
