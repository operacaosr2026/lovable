import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getPausedShopifyStoreIds } from "@/lib/sync-pause.server";
import { broadcast } from "@/lib/realtime.server";

export type NotificationLevel = "info" | "warning" | "error";
type NotificationInput = { level: NotificationLevel; title: string; body?: string | null; link?: string | null };

// Chaves geradas por refreshSystemNotifications (recalculadas a cada leitura).
// Outras chaves — ex.: "shopify_refunds:" — são abertas/fechadas por quem
// detecta o problema na hora (ver raiseNotification/resolveNotification).
const MANAGED_PREFIXES = ["meta_token:", "meta_account:", "shopify_sync:", "track123:", "dispute:"];

const TRACK123_STALE_HOURS = 4;   // cron roda de hora em hora

// Motivos de disputa da Shopify Payments em português.
const DISPUTE_REASON_PT: Record<string, string> = {
  product_unacceptable: "produto diferente do anunciado ou com defeito",
  product_not_received: "produto não recebido",
  fraudulent: "compra não autorizada (fraude)",
  unrecognized: "cobrança não reconhecida",
  duplicate: "cobrança duplicada",
  subscription_canceled: "assinatura cancelada",
  credit_not_processed: "reembolso não processado",
  incorrect_account_details: "dados de conta incorretos",
  insufficient_funds: "saldo insuficiente",
  bank_cannot_process: "banco não conseguiu processar",
  debit_not_authorized: "débito não autorizado",
  customer_initiated: "aberta pelo cliente",
  general: "motivo geral",
  noncompliant: "não conformidade",
};
const META_TOKEN_WARN_DAYS = 7;

// Abre (ou reabre, se estava resolvida) a notificação do problema `key`. Se ela
// já está aberta, só atualiza o texto — sem voltar a ficar "não lida" nem
// reaparecer se o usuário já tinha dispensado.
export async function raiseNotification(ownerId: string, key: string, n: NotificationInput) {
  const { data: existing } = await supabaseAdmin.from("app_notifications")
    .select("id,resolved_at").eq("user_id", ownerId).eq("key", key).maybeSingle();
  const now = new Date().toISOString();
  const fields = { level: n.level, title: n.title, body: n.body ?? null, link: n.link ?? null, updated_at: now };
  if (!existing) {
    // Duas chamadas simultâneas podem tentar inserir a mesma chave — o índice
    // único barra a segunda, e tudo bem.
    await supabaseAdmin.from("app_notifications").insert({ user_id: ownerId, key, ...fields });
    await broadcast(ownerId, "notifications");
  } else if (existing.resolved_at) {
    await supabaseAdmin.from("app_notifications")
      .update({ ...fields, created_at: now, resolved_at: null, read_at: null, dismissed_at: null })
      .eq("id", existing.id);
    await broadcast(ownerId, "notifications");
  } else {
    await supabaseAdmin.from("app_notifications").update(fields).eq("id", existing.id);
  }
}

export async function resolveNotification(ownerId: string, key: string) {
  const { data: resolved } = await supabaseAdmin.from("app_notifications")
    .update({ resolved_at: new Date().toISOString() })
    .eq("user_id", ownerId).eq("key", key).is("resolved_at", null)
    .select("key");
  if (resolved?.length) {
    await completeLinkedTasks(ownerId, [key]);
    await broadcast(ownerId, "notifications");
  }
}

// Tarefa criada a partir de uma notificação (tasks.source_key) é concluída
// sozinha quando o problema dela é resolvido — ex.: disputa respondida.
export async function completeLinkedTasks(ownerId: string, keys: string[]) {
  if (!keys.length) return;
  const { data: done } = await supabaseAdmin.from("tasks")
    .update({ status: "concluida", completed_at: new Date().toISOString() })
    .eq("user_id", ownerId).in("source_key", keys).neq("status", "concluida")
    .select("id");
  if (done?.length) await broadcast(ownerId, "tasks");
}

function hoursSince(iso: string | null | undefined): number {
  if (!iso) return Infinity;
  return (Date.now() - Date.parse(iso)) / 3_600_000;
}

function fmtDateBR(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

// Recalcula, a partir do que já está no banco, os problemas que precisam de
// atenção nas lojas ativas (automação ligada) do workspace. Só consultas no
// banco — nada de chamada externa —, então pode rodar a cada abertura do sino.
export async function refreshSystemNotifications(ownerId: string) {
  const { data: allSettings } = await supabaseAdmin.from("shop_order_settings")
    .select("shop_id,shopify_store_id").eq("user_id", ownerId).eq("automation_enabled", true);
  // Loja com sync pausado (coluna do Banco de Lojas) não gera aviso.
  const pausedStores = await getPausedShopifyStoreIds(ownerId);
  const settings = (allSettings ?? []).filter((s: any) => !s.shopify_store_id || !pausedStores.has(s.shopify_store_id));
  const activeShopIds = (settings ?? []).map((s: any) => s.shop_id as string);

  const want = new Map<string, NotificationInput>();

  if (activeShopIds.length) {
    const storeIds = Array.from(new Set((settings ?? []).map((s: any) => s.shopify_store_id).filter(Boolean))) as string[];
    const [shopsRes, cardLinksRes, tokensRes, accountsRes, storesRes, trackRes] = await Promise.all([
      supabaseAdmin.from("shops").select("id,name").in("id", activeShopIds),
      supabaseAdmin.from("lg_card_shops").select("card_id,shop_id,lg_cards!inner(user_id)")
        .in("shop_id", activeShopIds).eq("lg_cards.user_id", ownerId),
      supabaseAdmin.from("shop_meta_tokens").select("shop_id,token_expires_at")
        .eq("user_id", ownerId).in("shop_id", activeShopIds),
      supabaseAdmin.from("shop_meta_ad_accounts").select("shop_id,ad_account_id,account_name,last_sync_status,last_sync_error")
        .eq("user_id", ownerId).in("shop_id", activeShopIds).eq("enabled", true),
      storeIds.length
        ? supabaseAdmin.from("shopify_stores").select("id,name,shop_domain,last_sync_status,last_sync_error")
            .eq("user_id", ownerId).in("id", storeIds)
        : Promise.resolve({ data: [] as any[] }),
      supabaseAdmin.from("track123_integrations").select("shop_id,last_sync_at,last_sync_status,last_sync_error")
        .eq("user_id", ownerId).in("shop_id", activeShopIds).eq("enabled", true),
    ]);

    const shopName = new Map((shopsRes.data ?? []).map((s: any) => [s.id as string, s.name as string]));
    const cardByShop = new Map<string, string>();
    for (const l of (cardLinksRes.data ?? []) as any[]) if (!cardByShop.has(l.shop_id)) cardByShop.set(l.shop_id, l.card_id);
    const linkFor = (shopId: string, tab: string) => {
      const card = cardByShop.get(shopId);
      return card ? `/shops/lojas-grupos/${card}?tab=${tab}` : null;
    };
    const name = (shopId: string) => shopName.get(shopId) ?? "Loja";

    // Token da Meta: vence em ~60 dias e, vencido, o gasto com anúncios para de
    // entrar — o lucro fica maior que o real sem nenhum erro visível.
    const expiredMetaShops = new Set<string>();
    for (const t of (tokensRes.data ?? []) as any[]) {
      if (!t.token_expires_at) continue;
      const daysLeft = (Date.parse(t.token_expires_at) - Date.now()) / 86_400_000;
      if (daysLeft <= 0) {
        expiredMetaShops.add(t.shop_id);
        want.set(`meta_token:${t.shop_id}`, {
          level: "error",
          title: `Token da Meta expirado — ${name(t.shop_id)}`,
          body: "O gasto com anúncios parou de ser importado, então o lucro pode estar maior que o real. Reconecte a Meta em Integrações.",
          link: linkFor(t.shop_id, "integracoes"),
        });
      } else if (daysLeft <= META_TOKEN_WARN_DAYS) {
        const d = Math.ceil(daysLeft);
        want.set(`meta_token:${t.shop_id}`, {
          level: "warning",
          title: `Token da Meta vence em ${d} dia${d === 1 ? "" : "s"} — ${name(t.shop_id)}`,
          body: `Reconecte a Meta em Integrações até ${fmtDateBR(t.token_expires_at)} pra não parar de importar o gasto com anúncios.`,
          link: linkFor(t.shop_id, "integracoes"),
        });
      }
    }

    for (const a of (accountsRes.data ?? []) as any[]) {
      if (a.last_sync_status !== "error" || expiredMetaShops.has(a.shop_id)) continue;
      want.set(`meta_account:${a.shop_id}:${a.ad_account_id}`, {
        level: "error",
        title: `Meta Ads com erro — ${name(a.shop_id)} (${a.account_name ?? a.ad_account_id})`,
        body: String(a.last_sync_error ?? "Falha ao importar o gasto com anúncios.").slice(0, 240),
        link: linkFor(a.shop_id, "integracoes"),
      });
    }

    const shopByStore = new Map((settings ?? []).filter((s: any) => s.shopify_store_id).map((s: any) => [s.shopify_store_id as string, s.shop_id as string]));
    for (const st of (storesRes.data ?? []) as any[]) {
      if (st.last_sync_status !== "error") continue;
      const shopId = shopByStore.get(st.id);
      want.set(`shopify_sync:${st.id}`, {
        level: "error",
        title: `Shopify com erro de sincronização — ${st.name}`,
        body: String(st.last_sync_error ?? "Falha ao sincronizar com a Shopify.").slice(0, 240),
        link: shopId ? linkFor(shopId, "integracoes") : null,
      });
    }

    // Disputa (chargeback/inquiry) aguardando resposta: se passar do prazo sem
    // resposta, a Shopify decide contra a loja (inquiry vira chargeback,
    // chargeback é perdido). Some sozinha quando o status muda na Shopify
    // (sync completo de hora em hora).
    const { data: disputes } = await supabaseAdmin.from("shop_order_disputes")
      .select("shop_id,shopify_dispute_id,order_external_id,type,reason,amount,currency,evidence_due_by")
      .eq("user_id", ownerId).in("shop_id", activeShopIds).eq("status", "needs_response");
    if (disputes?.length) {
      const extIds = disputes.map((d: any) => d.order_external_id).filter(Boolean) as string[];
      const { data: orderRows } = extIds.length
        ? await supabaseAdmin.from("shop_orders").select("shop_id,external_id,order_number")
            .in("shop_id", activeShopIds).in("external_id", extIds)
        : { data: [] as any[] };
      const orderNumber = new Map((orderRows ?? []).map((o: any) => [`${o.shop_id}:${o.external_id}`, o.order_number as string]));
      const domainByShop = new Map<string, string>();
      for (const st of (storesRes.data ?? []) as any[]) {
        const shopId = (settings ?? []).find((s: any) => s.shopify_store_id === st.id)?.shop_id;
        if (shopId && st.shop_domain) domainByShop.set(shopId, st.shop_domain);
      }
      for (const d of disputes as any[]) {
        const num = orderNumber.get(`${d.shop_id}:${d.order_external_id}`);
        const isChargeback = d.type === "chargeback";
        const money = `${d.currency === "USD" || !d.currency ? "US$" : d.currency} ${Number(d.amount ?? 0).toFixed(2).replace(".", ",")}`;
        const due = d.evidence_due_by ? `responder até ${fmtDateBR(d.evidence_due_by)}` : "responda o quanto antes";
        const daysLeft = d.evidence_due_by ? (Date.parse(d.evidence_due_by) - Date.now()) / 86_400_000 : null;
        const domain = domainByShop.get(d.shop_id);
        want.set(`dispute:${d.shopify_dispute_id}`, {
          level: isChargeback || (daysLeft != null && daysLeft <= 3) ? "error" : "warning",
          title: `${isChargeback ? "Chargeback" : "Inquiry"} aguardando resposta — ${num ?? "pedido"} (${name(d.shop_id)})`,
          body: `${money} · ${DISPUTE_REASON_PT[d.reason] ?? d.reason ?? "sem motivo informado"} · ${due}. Responda pela página do pedido na Shopify.`,
          link: domain && d.order_external_id ? `https://${domain}/admin/orders/${d.order_external_id}` : null,
        });
      }
    }

    for (const t of (trackRes.data ?? []) as any[]) {
      const hrs = hoursSince(t.last_sync_at);
      if (t.last_sync_status === "error") {
        want.set(`track123:${t.shop_id}`, {
          level: "error",
          title: `Rastreio (Track123) com erro — ${name(t.shop_id)}`,
          body: String(t.last_sync_error ?? "Falha ao sincronizar rastreios.").slice(0, 240),
          link: linkFor(t.shop_id, "logistica"),
        });
      } else if (hrs > TRACK123_STALE_HOURS) {
        const h = Number.isFinite(hrs) ? Math.floor(hrs) : null;
        want.set(`track123:${t.shop_id}`, {
          level: "warning",
          title: `Rastreio sem atualizar${h != null ? ` há ${h}h` : ""} — ${name(t.shop_id)}`,
          body: "O Track123 não sincroniza essa loja há mais tempo que o normal; status de entrega podem estar desatualizados.",
          link: linkFor(t.shop_id, "logistica"),
        });
      }
    }
  }

  const { data: current } = await supabaseAdmin.from("app_notifications")
    .select("id,key,level,title,body,link,resolved_at")
    .eq("user_id", ownerId);
  const byKey = new Map((current ?? []).map((n: any) => [n.key as string, n]));
  const now = new Date().toISOString();

  for (const [key, n] of want) {
    const ex = byKey.get(key);
    const same = ex && !ex.resolved_at && ex.level === n.level && ex.title === n.title
      && (ex.body ?? null) === (n.body ?? null) && (ex.link ?? null) === (n.link ?? null);
    if (!same) await raiseNotification(ownerId, key, n);
  }

  const toResolve = (current ?? [])
    .filter((n: any) => !n.resolved_at && MANAGED_PREFIXES.some((p) => n.key.startsWith(p)) && !want.has(n.key));
  if (toResolve.length) {
    await supabaseAdmin.from("app_notifications").update({ resolved_at: now }).in("id", toResolve.map((n: any) => n.id as string));
    await broadcast(ownerId, "notifications");
    await completeLinkedTasks(ownerId, toResolve.map((n: any) => n.key as string));
  }
}
