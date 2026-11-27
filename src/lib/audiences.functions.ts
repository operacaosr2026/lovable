import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext, type WorkspacePermission, type WorkspaceRole } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { selectAll } from "@/lib/select-all";
import { addDaysIso, isoTodayUS } from "@/lib/timezone";

// Gerencial › Públicos: clientes dos pedidos agrupados por pessoa (e-mail, ou
// telefone quando não tem e-mail), pra subir como público personalizado na
// Meta (base de lookalike, exclusão de quem já comprou) ou usar no e-mail.
// Pedido reembolsado/cancelado não conta como compra; quem teve reembolso ou
// chargeback fica marcado e sai da lista por padrão (vira a lista de exclusão).
// Não exportar valores/funções comuns daqui (só server fns e tipos): o arquivo
// importa client.server e quebraria o build da Vercel no cliente.

type Ctx = { ownerId: string; role: WorkspaceRole; permissions: WorkspacePermission[] };
const canView = (c: Ctx) => c.role === "admin" || c.permissions.some((p) => p.section === "gerencial");

const SEGMENTS = ["compradores", "recompra", "top", "problema"] as const;
export type AudienceSegment = (typeof SEGMENTS)[number];

export type AudienceRow = {
  email: string | null; phone: string | null; fn: string | null; ln: string | null;
  ct: string | null; st: string | null; zip: string | null; country: string | null;
  // Soma dos pedidos válidos (sem reembolso/cancelamento), em US$.
  value: number; orders: number; lastOrder: string; refund: boolean; chargeback: boolean; shops: string[];
};

const clean = (v: unknown) => {
  const s = String(v ?? "").trim();
  return s ? s : null;
};
// Telefone só com dígitos e com o código do país (formato que a Meta pede).
// Número dos EUA/Canadá com 10 dígitos ganha o 1 na frente.
function normPhone(raw: unknown, country: string | null): string | null {
  const d = String(raw ?? "").replace(/\D/g, "");
  if (d.length < 8) return null;
  if (d.length === 10 && (!country || country === "US" || country === "CA")) return `1${d}`;
  return d;
}

export const getCampaignAudience = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    shopId: z.string().uuid().nullable().optional(),
    // Dias pra trás pela data do pedido; null = desde o começo.
    days: z.number().int().min(1).max(3650).nullable().optional(),
    segment: z.enum(SEGMENTS).default("compradores"),
    // Tira quem teve reembolso ou chargeback (não vale em "problema").
    excludeProblems: z.boolean().default(true),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    if (!canView(ctx)) throw new Error("Sem acesso ao Gerencial");
    const { ownerId } = ctx;

    const { data: shops } = await supabaseAdmin.from("shops").select("id,name").eq("user_id", ownerId).order("name");
    const shopName = new Map(((shops ?? []) as any[]).map((s) => [s.id as string, s.name as string]));

    let q = supabaseAdmin.from("shop_orders")
      .select("id,shop_id,external_id,order_date,revenue,fin:shopify_financial_status,cancelled:raw->>cancelled_at,"
        + "email:raw->>email,cust_email:raw->customer->>email,phone:raw->>phone,cust_phone:raw->customer->>phone,"
        + "cust_fn:raw->customer->>first_name,cust_ln:raw->customer->>last_name,"
        + "ship_fn:raw->shipping_address->>first_name,ship_ln:raw->shipping_address->>last_name,ship_phone:raw->shipping_address->>phone,"
        + "ct:raw->shipping_address->>city,st:raw->shipping_address->>province_code,zip:raw->shipping_address->>zip,country:raw->shipping_address->>country_code")
      .eq("user_id", ownerId);
    if (data.shopId) q = q.eq("shop_id", data.shopId);
    if (data.days) q = q.gte("order_date", addDaysIso(isoTodayUS(), -data.days));
    const [{ data: orders, error }, { data: disputes }] = await Promise.all([
      selectAll<any>(q.order("id")),
      selectAll<{ shop_id: string; order_external_id: string | null }>(
        supabaseAdmin.from("shop_order_disputes").select("shop_id,order_external_id").eq("user_id", ownerId).eq("type", "chargeback")),
    ]);
    if (error) throw new Error(error.message);
    const cb = new Set((disputes ?? []).map((d) => `${d.shop_id}:${d.order_external_id}`));

    // Mais recente primeiro: nome/endereço/telefone vêm do último pedido da pessoa.
    const list = ((orders ?? []) as any[]).sort((a, b) => String(b.order_date ?? "").localeCompare(String(a.order_date ?? "")));
    const people = new Map<string, AudienceRow & { _shops: Set<string> }>();
    let noContact = 0;
    for (const o of list) {
      const country = clean(o.country)?.toUpperCase() ?? null;
      const email = clean(o.email ?? o.cust_email)?.toLowerCase() ?? null;
      const phone = normPhone(o.phone ?? o.cust_phone ?? o.ship_phone, country);
      const key = email ?? (phone ? `tel:${phone}` : null);
      if (!key) { noContact++; continue; }
      const refunded = ["refunded", "partially_refunded", "voided"].includes(o.fin ?? "") || !!o.cancelled;
      const chargeback = cb.has(`${o.shop_id}:${o.external_id}`);
      let p = people.get(key);
      if (!p) {
        p = {
          email, phone,
          fn: clean(o.cust_fn ?? o.ship_fn), ln: clean(o.cust_ln ?? o.ship_ln),
          ct: clean(o.ct), st: clean(o.st)?.toUpperCase() ?? null, zip: clean(o.zip), country,
          value: 0, orders: 0, lastOrder: o.order_date ?? "", refund: false, chargeback: false, shops: [], _shops: new Set(),
        };
        people.set(key, p);
      }
      if (!p.phone && phone) p.phone = phone;
      // Reembolso parcial: o cliente ficou com o pedido, mas teve problema — conta como problema.
      if (refunded) p.refund = true;
      if (chargeback) p.chargeback = true;
      if (!refunded && !chargeback) { p.orders++; p.value += Number(o.revenue ?? 0); }
      p._shops.add(shopName.get(o.shop_id) ?? "—");
    }

    const all = [...people.values()].map(({ _shops, ...p }) => ({ ...p, value: Math.round(p.value * 100) / 100, shops: [..._shops] }));
    const problem = (p: AudienceRow) => p.refund || p.chargeback;
    const buyers = all.filter((p) => p.orders > 0 && (!data.excludeProblems || !problem(p)));
    const bySegment: Record<AudienceSegment, AudienceRow[]> = {
      compradores: buyers,
      recompra: buyers.filter((p) => p.orders >= 2),
      // 20% que mais gastaram (mínimo 1 pessoa).
      top: buyers.length ? [...buyers].sort((a, b) => b.value - a.value).slice(0, Math.max(1, Math.ceil(buyers.length * 0.2))) : [],
      problema: all.filter(problem),
    };
    const counts = Object.fromEntries(SEGMENTS.map((s) => [s, bySegment[s].length])) as Record<AudienceSegment, number>;
    const rows = [...bySegment[data.segment]].sort((a, b) => b.value - a.value || b.lastOrder.localeCompare(a.lastOrder));

    return {
      rows,
      counts,
      stats: {
        people: rows.length,
        value: Math.round(rows.reduce((s, p) => s + p.value, 0) * 100) / 100,
        withEmail: rows.filter((p) => p.email).length,
        withPhone: rows.filter((p) => p.phone).length,
        totalCustomers: all.length,
        problems: all.filter(problem).length,
        noContact,
      },
      shops: ((shops ?? []) as any[]).map((s) => ({ id: s.id as string, name: s.name as string })),
    };
  });
