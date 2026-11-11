import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext, type WorkspacePermission, type WorkspaceRole } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { selectAllIn } from "@/lib/select-all";
import { isoDateUS } from "@/lib/timezone";
import { SUPPLIER_REPLY_KEYS, supplierReplyTitle } from "@/lib/supplier-replies";

// Gerencial › Alertas › "Resposta do fornecedor": cola a mensagem do
// fornecedor, o sistema acha os pedidos (nº do pedido ou código de rastreio) e
// grava a resposta (order_supplier_flags) — vira um alerta próprio e os pedidos
// saem dos outros alertas até o pacote andar (ver supplier-replies.ts).

type Ctx = { ownerId: string; userId: string; role: WorkspaceRole; permissions: WorkspacePermission[] };
const canView = (c: Ctx) => c.role === "admin" || c.permissions.some((p) => p.section === "gerencial");

// Nº de pedido: "#L3-1133", "L6-1043", "#WV1250". Código: "JCZ1029038085DH",
// "YTTGJ8000181780LU", "TRF0116720021273" (letras + 8 ou mais dígitos).
const ORDER_RE = /#?\b([A-Z]{1,3}\d{0,2}-?\d{3,6})\b/gi;
const CODE_RE = /\b([A-Z]{2,6}\d{8,}[A-Z]{0,3})\b/gi;

export type ReplyOrder = {
  id: string; number: string; shop: string; code: string | null; orderDate: string;
  current: { title: string; note: string | null; at: string } | null;   // resposta que já tem
};

export const parseSupplierReply = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ text: z.string().max(20_000) }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    if (!canView(ctx)) throw new Error("Sem acesso ao Gerencial");
    return findSupplierReplyOrders(ctx.ownerId, data.text);
  });

export type SupplierReplyMatch = { orders: ReplyOrder[]; notFound: string[]; suggestedNote: string };

// Também usado pelo Assistente (chat), que cola a mensagem do fornecedor ali.
// Server-only: este arquivo também vai pro navegador (botão Gravar do chat).
export const findSupplierReplyOrders = createServerOnlyFn((ownerId: string, text: string) => findSupplierReplyOrdersImpl(ownerId, text));
async function findSupplierReplyOrdersImpl(ownerId: string, text: string): Promise<SupplierReplyMatch> {
    const ctx = { ownerId };
    const codes = [...new Set([...text.matchAll(CODE_RE)].map((m) => m[1].toUpperCase()))];
    const codeSet = new Set(codes);
    // Nº de pedido que não é um código de rastreio.
    const nums = [...new Set([...text.matchAll(ORDER_RE)].map((m) => m[1].toUpperCase()).filter((n) => !codeSet.has(n) && /[A-Z]/.test(n)))];
    const numVariants = [...new Set(nums.flatMap((n) => [`#${n}`, n]))];
    const since = isoDateUS(Date.now() - 365 * 86_400_000);
    const sel = "id,shop_id,order_number,order_date,tracking_code";
    const [byNum, byCode] = await Promise.all([
      selectAllIn<any>(numVariants, (c) => supabaseAdmin.from("shop_orders").select(sel).eq("user_id", ctx.ownerId).gte("order_date", since).in("order_number", c)),
      selectAllIn<any>(codes, (c) => supabaseAdmin.from("shop_orders").select(sel).eq("user_id", ctx.ownerId).gte("order_date", since).in("tracking_code", c)),
    ]);
    if (byNum.error) throw new Error(byNum.error.message);
    if (byCode.error) throw new Error(byCode.error.message);
    const found = new Map<string, any>();
    for (const o of [...byNum.data, ...byCode.data]) found.set(o.id, o);
    const list = [...found.values()];

    const ids = list.map((o) => o.id as string);
    const [{ data: shops }, flags] = await Promise.all([
      list.length ? supabaseAdmin.from("shops").select("id,name").in("id", [...new Set(list.map((o) => o.shop_id))]) : Promise.resolve({ data: [] as any[] }),
      selectAllIn<any>(ids, (c) => supabaseAdmin.from("order_supplier_flags").select("order_id,kind,title,note,flagged_at").eq("owner_id", ctx.ownerId).in("order_id", c)),
    ]);
    const shopName = new Map(((shops ?? []) as any[]).map((s) => [s.id, s.name]));
    const flagBy = new Map((flags.data ?? []).map((f: any) => [f.order_id, f]));

    // O que não achou: nº de pedido sem pedido e código sem pedido.
    const gotNums = new Set(list.map((o) => String(o.order_number ?? "").replace(/^#/, "").toUpperCase()));
    const gotCodes = new Set(list.map((o) => String(o.tracking_code ?? "").toUpperCase()));
    // Código de um pedido achado pelo número não conta como "não achado" (e vice-versa).
    const notFound = [
      ...nums.filter((n) => !gotNums.has(n)).map((n) => `#${n}`),
      ...codes.filter((c) => !gotCodes.has(c)),
    ];

    // Observação sugerida: as linhas da mensagem que não são lista de pedidos.
    // (sem o cabeçalho "Loja xxx - Loja 6" da mensagem copiada).
    const suggestedNote = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
      .filter((l) => !/^loja\b/i.test(l))
      .filter((l) => !(l.replace(CODE_RE, "").replace(ORDER_RE, "").replace(/[\s\-–—:#.,|/]+/g, "") === ""))
      .join(" ").slice(0, 500);

    return {
      orders: list.sort((a, b) => String(a.order_number).localeCompare(String(b.order_number), "pt-BR", { numeric: true })).map((o) => {
        const f: any = flagBy.get(o.id);
        return {
          id: o.id, number: String(o.order_number ?? ""), shop: shopName.get(o.shop_id) ?? "", code: o.tracking_code ?? null, orderDate: String(o.order_date).slice(0, 10),
          current: f ? { title: supplierReplyTitle(f.kind, f.title), note: f.note ?? null, at: f.flagged_at } : null,
        };
      }),
      notFound,
      suggestedNote,
    };
}

export const saveSupplierReply = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    orderIds: z.array(z.string().uuid()).min(1).max(200),
    kind: z.enum(SUPPLIER_REPLY_KEYS),
    title: z.string().trim().max(120).nullable().default(null),
    note: z.string().trim().max(1000).nullable().default(null),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    if (!canView(ctx)) throw new Error("Sem acesso ao Gerencial");
    if (data.kind === "outro" && !data.title) throw new Error("Escreva o título do alerta");
    const { data: orders, error: oErr } = await selectAllIn<any>(data.orderIds, (c) => supabaseAdmin.from("shop_orders")
      .select("id,tracking_code").eq("user_id", ctx.ownerId).in("id", c));
    if (oErr) throw new Error(oErr.message);
    if (!orders.length) throw new Error("Nenhum pedido encontrado");
    const at = new Date().toISOString();
    const { error } = await supabaseAdmin.from("order_supplier_flags").upsert(orders.map((o) => ({
      owner_id: ctx.ownerId, order_id: o.id, kind: data.kind, title: data.kind === "outro" ? data.title : null,
      note: data.note, tracking_code: String(o.tracking_code ?? "").trim(), flagged_by: ctx.userId, flagged_at: at,
    })), { onConflict: "owner_id,order_id" });
    if (error) throw new Error(error.message);
    return { saved: orders.length };
  });
