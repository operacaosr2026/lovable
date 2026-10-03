import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { fetchWithRetry } from "@/lib/http";
import { emailText } from "@/lib/support-ai.server";
import type { DisputeEvidence } from "@/lib/dispute-evidence.functions";

// Lógica das provas de chargeback (só servidor): junta os dados pros PDFs.
// Os createServerFn ficam em dispute-evidence.functions.ts.

// Nome fantasia das lojas nos documentos (o mesmo em todas; o site muda por loja).
const BRAND_NAME = "Voultie";


const htmlText = (html: string | null | undefined, limit = 20_000) =>
  html ? emailText(html, limit).replace(/\n?(On|Em|Na)\b[^\n]{0,200}\b(wrote|escreveu):[\s\S]*$/i, "").trim() : "";
const addressLines = (a: any): string[] => (a ? [
  [a.first_name, a.last_name].filter(Boolean).join(" ") || a.name,
  a.company, a.address1, a.address2,
  [a.city, a.province_code ?? a.province, a.zip].filter(Boolean).join(", "),
  a.country, a.phone,
].filter((x) => x && String(x).trim()) as string[] : []);

async function shopify(domain: string, token: string, path: string) {
  const res = await fetchWithRetry(`https://${domain}/admin/api/2024-10/${path}`, { headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" } });
  return res.ok ? res.json() : null;
}
async function shopifyGql(domain: string, token: string, query: string, variables: Record<string, unknown>) {
  const res = await fetchWithRetry(`https://${domain}/admin/api/2024-10/graphql.json`, {
    method: "POST", headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }),
  });
  return res.ok ? (await res.json())?.data : null;
}

export async function collectEvidence(ownerId: string, disputeId: string): Promise<DisputeEvidence> {
  const { data: d } = await supabaseAdmin.from("shop_order_disputes")
    .select("id,shop_id,order_external_id,type,reason,amount,currency,initiated_at,evidence_due_by,status,order_snapshot")
    .eq("id", disputeId).eq("user_id", ownerId).maybeSingle();
  if (!d) throw new Error("Disputa não encontrada");

  const { data: set } = await supabaseAdmin.from("shop_order_settings").select("shopify_store_id").eq("shop_id", d.shop_id).maybeSingle();
  const { data: store } = set?.shopify_store_id
    ? await supabaseAdmin.from("shopify_stores").select("shop_domain,access_token").eq("id", set.shopify_store_id).maybeSingle()
    : { data: null };
  const domain = store?.shop_domain ?? null, token = store?.access_token ?? null;

  const { data: order } = d.order_external_id
    ? await supabaseAdmin.from("shop_orders").select("id,order_number,raw,tracking_code,tracking_url,shipped_at,delivered_at,delivery_status")
        .eq("user_id", ownerId).eq("shop_id", d.shop_id).eq("external_id", d.order_external_id).maybeSingle()
    : { data: null };
  const raw: any = order?.raw ?? null;
  const snap: any = !raw ? d.order_snapshot : null;

  // Loja, políticas, produtos e pagamento vêm da Shopify (falha = campo vazio).
  const [shopInfo, policiesRes, gql] = await Promise.all([
    domain && token ? shopify(domain, token, "shop.json?fields=name,domain,customer_email,email").catch(() => null) : null,
    domain && token ? shopify(domain, token, "policies.json").catch(() => null) : null,
    domain && token && d.order_external_id
      ? shopifyGql(domain, token, `query($id: ID!) { order(id: $id) { transactions(first: 5) { kind status gateway paymentDetails { __typename ... on CardPaymentDetails { company number avsResultCode cvvResultCode } } } events(first: 100, sortKey: CREATED_AT) { nodes { createdAt message ... on BasicEvent { action } } } } }`,
          { id: `gid://shopify/Order/${d.order_external_id}` }).catch(() => null)
      : null,
  ]);

  const items = raw
    ? ((raw.line_items ?? []) as any[]).map((li) => ({ title: li.title ?? li.name ?? "Item", variant: li.variant_title ?? null, quantity: Number(li.quantity ?? 1), price: li.price ?? null, sku: li.sku ?? null, productId: li.product_id ? String(li.product_id) : null }))
    : ((snap?.items ?? []) as any[]).map((li) => ({ title: li.title ?? "Item", variant: null, quantity: 1, price: null, sku: null, productId: null }));

  // Produtos: descrição e foto da Shopify; sem isso, a foto do cadastro de Produtos.
  const productIds = [...new Set(items.map((i) => i.productId).filter(Boolean))] as string[];
  const shopifyProducts = domain && token
    ? await Promise.all(productIds.map((id) => shopify(domain, token, `products/${id}.json?fields=title,body_html,image,product_type`).catch(() => null)))
    : [];
  const { data: catalog } = await supabaseAdmin.from("products").select("name,keywords,main_image_url").eq("user_id", ownerId);
  const catalogImage = (title: string) => {
    const t = title.toLowerCase();
    let best: { url: string; len: number } | null = null;
    for (const p of (catalog ?? []) as any[]) for (const c of [p.name, ...(p.keywords ?? [])]) {
      const k = String(c ?? "").trim().toLowerCase();
      if (k && p.main_image_url && t.includes(k) && (!best || k.length > best.len)) best = { url: p.main_image_url, len: k.length };
    }
    return best?.url ?? null;
  };
  const products = items.map((it) => {
    const sp = shopifyProducts[productIds.indexOf(it.productId ?? "")]?.product;
    const desc = htmlText(sp?.body_html, 4000);
    return { title: sp?.title ?? it.title, description: desc.length > 20 ? desc : null, imageUrl: sp?.image?.src ?? catalogImage(it.title), productType: sp?.product_type || null };
  });

  // Envio e rastreio.
  const { data: tracking } = order?.id
    ? await supabaseAdmin.from("shop_order_tracking").select("carrier,tracking_number,tracking_status,last_event_label,last_event_at,timeline").eq("order_id", order.id).maybeSingle()
    : { data: null };
  const fulfillment = ((raw?.fulfillments ?? []) as any[]).filter((f) => f.status !== "cancelled").at(-1);
  const events = ((tracking?.timeline ?? []) as any[]).map((e) => ({
    time: e.event_time_utc ? `${e.event_time_utc} UTC` : e.event_time ?? null,
    description: String(e.event_detail ?? e.description ?? "").trim(), location: e.event_location || null,
  })).filter((e) => e.description);
  if (!events.length && (tracking?.last_event_label || snap?.track?.lastLabel)) {
    events.push({ time: tracking?.last_event_at ?? snap?.track?.lastAt ?? null, description: tracking?.last_event_label ?? snap?.track?.lastLabel, location: null });
  }
  const delivered = order?.delivery_status === "delivered" || snap?.track?.status === "delivered";

  // Pagamento: cartão, AVS/CVV e a análise de risco da Shopify.
  const tx = ((gql?.order?.transactions ?? []) as any[]).find((t) => (t.kind === "SALE" || t.kind === "AUTHORIZATION") && t.status === "SUCCESS");
  const pd = tx?.paymentDetails;
  const { data: risk } = d.order_external_id
    ? await supabaseAdmin.from("shop_order_risks").select("risk_level,facts,payment_brand").eq("shop_id", d.shop_id).eq("order_external_id", d.order_external_id).maybeSingle()
    : { data: null };

  // Conversa com o cliente: e-mail do pedido + conversas que citam o número do pedido.
  const email = String(raw?.email ?? raw?.contact_email ?? raw?.customer?.email ?? snap?.email ?? "").toLowerCase() || null;
  const orderNumber: string | null = order?.order_number ?? raw?.name ?? snap?.name ?? null;
  const convIds = new Set<string>();
  if (email) {
    const { data: c } = await supabaseAdmin.from("support_conversations").select("id").eq("owner_id", ownerId).eq("customer_email", email);
    for (const x of c ?? []) convIds.add(x.id);
  }
  if (orderNumber) {
    const bare = orderNumber.replace(/^#/, "");
    const { data: c } = await supabaseAdmin.from("support_messages").select("conversation_id").eq("owner_id", ownerId).ilike("subject", `%${bare}%`).limit(50);
    for (const x of c ?? []) convIds.add(x.conversation_id);
  }
  const { data: msgs } = convIds.size
    ? await supabaseAdmin.from("support_messages").select("direction,from_email,from_name,to_emails,subject,sent_at,content_html,summary")
        .eq("owner_id", ownerId).in("conversation_id", [...convIds]).order("sent_at").limit(40)
    : { data: [] as any[] };

  // Todas as políticas publicadas: a de frete vai na Documentação de frete; as
  // demais (reembolso, privacidade, termos, contato, aviso legal) em Outras provas.
  const POLICY_ORDER = ["shipping", "refund", "return", "privacy", "terms", "contact", "legal"];
  const rank = (t: string) => { const i = POLICY_ORDER.findIndex((k) => t.includes(k)); return i < 0 ? 99 : i; };
  const policies = ((policiesRes?.policies ?? []) as any[])
    .map((p) => {
      const tag = `${p.handle ?? ""} ${p.title ?? ""}`.toLowerCase();
      return { title: String(p.title), body: htmlText(p.body, 12_000), kind: /shipping/.test(tag) ? "shipping" as const : "other" as const, rank: rank(tag) };
    })
    .filter((p) => p.body)
    .sort((a, b) => a.rank - b.rank)
    .map(({ rank: _r, ...p }) => p);

  // Site da própria loja (o que o cliente usa): o do link de rastreio configurado
  // em Integrações (walkesty.com, woovah.com…); o domínio principal da Shopify
  // pode ser o de outra marca. Nome = nome fantasia (BRAND_NAME).
  const { data: integ } = await supabaseAdmin.from("track123_integrations").select("tracking_link_template").eq("shop_id", d.shop_id).maybeSingle();
  let storeDomain: string | null = null;
  try { storeDomain = integ?.tracking_link_template ? new URL(integ.tracking_link_template.replace("[CODE]", "x")).hostname.replace(/^www\./, "") : null; } catch { /* modelo inválido */ }

  return {
    store: { name: BRAND_NAME, domain: storeDomain ?? shopInfo?.shop?.domain ?? domain, supportEmail: shopInfo?.shop?.customer_email ?? shopInfo?.shop?.email ?? null },
    dispute: { reason: d.reason, type: d.type, amount: Number(d.amount ?? 0), currency: d.currency, initiatedAt: d.initiated_at, evidenceDueBy: d.evidence_due_by, status: d.status },
    order: {
      number: orderNumber, createdAt: raw?.created_at ?? snap?.created_at ?? null, total: raw?.total_price ?? null, currency: raw?.currency ?? d.currency,
      customerName: raw ? [raw.customer?.first_name, raw.customer?.last_name].filter(Boolean).join(" ") || null : [snap?.first_name, snap?.last_name].filter(Boolean).join(" ") || null,
      email, phone: raw?.phone ?? raw?.customer?.phone ?? raw?.shipping_address?.phone ?? null,
      ip: raw?.browser_ip ?? raw?.client_details?.browser_ip ?? null, userAgent: raw?.client_details?.user_agent ?? null,
      shippingAddress: addressLines(raw?.shipping_address), billingAddress: addressLines(raw?.billing_address), items,
    },
    shipping: {
      carrier: tracking?.carrier ?? fulfillment?.tracking_company ?? null,
      trackingNumber: order?.tracking_code ?? tracking?.tracking_number ?? fulfillment?.tracking_number ?? snap?.tracking_number ?? null,
      trackingUrl: order?.tracking_url ?? fulfillment?.tracking_url ?? null,
      shippedAt: order?.shipped_at ?? fulfillment?.created_at ?? snap?.fulfilled_at ?? null,
      status: delivered ? "Delivered" : tracking?.tracking_status ?? (fulfillment ? "Shipped" : null),
      deliveredAt: order?.delivered_at ?? (snap?.track?.status === "delivered" ? snap.track.lastAt : null),
      events,
    },
    payment: {
      method: pd?.__typename === "CardPaymentDetails" ? pd.company ?? "Card" : risk?.payment_brand ?? (tx?.gateway ?? null),
      last4: pd?.number ? String(pd.number).replace(/\D/g, "").slice(-4) || null : null,
      avs: pd?.avsResultCode ?? null, cvv: pd?.cvvResultCode ?? null,
      riskLevel: risk?.risk_level ?? null, riskFacts: Array.isArray(risk?.facts) ? (risk!.facts as any[]) : [],
    },
    products,
    communications: ((msgs ?? []) as any[]).map((m) => ({
      sentAt: m.sent_at, direction: m.direction === "out" ? "out" as const : "in" as const,
      from: m.from_name ? `${m.from_name} <${m.from_email ?? ""}>` : m.from_email, to: m.to_emails, subject: m.subject,
      body: htmlText(m.content_html, 8000) || m.summary || "",
    })).filter((m) => m.body),
    // E-mails automáticos da Shopify ao cliente (confirmação do pedido, confirmação
    // de envio…): também são contato com o cliente. Vêm dos eventos do pedido.
    notifications: ((gql?.order?.events?.nodes ?? []) as any[])
      .filter((e) => e.action === "mail_sent" && e.message)
      .map((e) => ({ sentAt: String(e.createdAt), message: String(e.message).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() })),
    policies,
    limited: !raw,
  };
}
