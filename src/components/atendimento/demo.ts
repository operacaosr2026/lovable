import { createContext, useContext } from "react";
import { useServerFn } from "@tanstack/react-start";
import type { SupportConversation, SupportMessage, SupportStatus } from "@/lib/atendimento.functions";

// Modo demonstração do Atendimento (/atendimento?demo=1): um "backend" em
// memória com clientes e e-mails fictícios que responde às mesmas chamadas das
// server functions. Nada vai pro banco nem pro Zoho; recarregar a página zera.

export const DemoContext = createContext(false);
export const useIsDemo = () => useContext(DemoContext);

export function isDemoUrl() {
  return typeof window !== "undefined" && new URLSearchParams(window.location.search).get("demo") === "1";
}

// Troca a server function pela versão em memória quando está em modo demo.
export function useSupportFn<F extends (...args: any[]) => Promise<any>>(fn: F, name: DemoFnName): (...args: any[]) => ReturnType<F> {
  const demo = useIsDemo();
  const real = useServerFn(fn as any);
  return (demo ? demoApi[name] : real) as any;
}

// ─── Dados ────────────────────────────────────────────────────────────────────

const OWN = "suporte@srxstore.com";
const now = Date.now();
const ago = (min: number) => new Date(now - min * 60_000).toISOString();
const H = 60, D = 24 * 60;

type Seed = {
  email: string; name: string; status: SupportStatus; favorite?: boolean; tags?: string[]; note?: string;
  msgs: { dir: "in" | "out"; at: number; subject: string; body: string; read?: boolean; attachments?: { name: string; size: number }[] }[];
};

const p = (...lines: string[]) => lines.map((l) => (l ? `<p>${l}</p>` : "")).join("");
const quote = (who: string, body: string) =>
  `<div class="gmail_quote"><div>Em ${who} escreveu:</div><blockquote style="border-left:1px solid #ccc;padding-left:8px;margin-left:4px">${body}</blockquote></div>`;

const SEEDS: Seed[] = [
  {
    email: "camila.lopes@email.com", name: "Camila Lopes", status: "em_atendimento", favorite: true,
    tags: ["Cliente recorrente", "Walkesty", "VIP"],
    note: "Cliente VIP — já comprou 5 vezes. Priorizar.",
    msgs: [
      { dir: "in", at: 26 * H, subject: "Status do meu pedido #4532", body: p("Olá, gostaria de saber qual o status do meu pedido #4532?", "Ele foi pago dia 15/09 e ainda não recebi atualização.", "Podem me informar, por favor?", "Att,<br>Camila") },
      { dir: "out", at: 25 * H, subject: "Re: Status do meu pedido #4532", body: p("Olá Camila!", "Tudo bem?", "Já verifiquei aqui e o seu pedido #4532 foi enviado hoje e já está em transporte.", "O código de rastreio é: <b>TR123456789BR</b>.", "Qualquer dúvida, estou à disposição! 😊", "Atenciosamente,<br>Equipe SRX") },
      { dir: "in", at: 18, subject: "Re: Status do meu pedido #4532", read: false, body: p("Oi! Obrigada pelo retorno.", "Olhei o rastreio e está parado em \"objeto postado\" há 2 dias. É normal?", "Preciso do produto até sexta 🙏") + quote("25/09/2026, Equipe SRX &lt;suporte@srxstore.com&gt;", p("Olá Camila! Já verifiquei aqui e o seu pedido #4532 foi enviado hoje...")) },
    ],
  },
  {
    email: "rafael.ferreira@gmail.com", name: "Rafael Ferreira", status: "em_atendimento",
    msgs: [{ dir: "in", at: 95, subject: "Dúvida sobre troca", read: false, body: p("Boa tarde!", "Recebi o tênis mas ficou pequeno. Preciso trocar o produto por um número maior, como faço?", "Pedido #4519.", "Obrigado,<br>Rafael") }],
  },
  {
    email: "joao.oliveira@outlook.com", name: "João Oliveira", status: "em_atendimento", tags: ["Reembolso"],
    msgs: [
      { dir: "in", at: 6 * D, subject: "Reembolso", body: p("Olá, cancelei o pedido #4401 e gostaria do reembolso.") },
      { dir: "out", at: 6 * D - 3 * H, subject: "Re: Reembolso", body: p("Olá João, o reembolso foi solicitado e cai em até 7 dias úteis no cartão.", "Atenciosamente,<br>Equipe SRX") },
      { dir: "in", at: 3 * H + 12, subject: "Re: Reembolso", read: false, body: p("Ainda não recebi o reembolso, já passou uma semana. Podem me ajudar?") },
    ],
  },
  {
    email: "mariana.alves@yahoo.com.br", name: "Mariana Alves", status: "aguardando_cliente", tags: ["Defeito"],
    msgs: [
      { dir: "in", at: 5 * H, subject: "Produto chegou com defeito", body: p("Oi, a bolsa chegou com a alça descosturada. Segue foto.", "Pedido #4498."), attachments: [{ name: "foto-bolsa.jpg", size: 1_840_000 }] },
      { dir: "out", at: 4 * H, subject: "Re: Produto chegou com defeito", body: p("Oi Mariana, sentimos muito! Podemos enviar uma nova ou fazer o reembolso total — qual prefere?", "Atenciosamente,<br>Equipe SRX") },
    ],
  },
  {
    email: "emily.johnson@gmail.com", name: "Emily Johnson", status: "aguardando_cliente", tags: ["Nordhaus"],
    msgs: [
      { dir: "in", at: D + 4 * H, subject: "Where is my order #1087?", body: p("Hi, I ordered 10 days ago and tracking hasn't updated. Can you check?", "Thanks, Emily") },
      { dir: "out", at: D + 2 * H, subject: "Re: Where is my order #1087?", body: p("Hi Emily! Your package cleared customs yesterday and should arrive in 3–5 business days.", "Best,<br>SRX Support") },
    ],
  },
  {
    email: "sarah.wilson@hotmail.com", name: "Sarah Wilson", status: "em_atendimento", favorite: true, tags: ["Nordhaus", "Troca"],
    msgs: [{ dir: "in", at: 7 * H, subject: "Wrong size received", read: false, body: p("Hello, I ordered a size M but received an XL. How can I get the right one?", "Order #1102."), attachments: [{ name: "label.png", size: 420_000 }, { name: "invoice.pdf", size: 96_000 }] }],
  },
  {
    email: "ana.costa@gmail.com", name: "Ana Costa", status: "em_atendimento", tags: ["Walkesty"],
    msgs: [{ dir: "in", at: 9 * H, subject: "Cupom não funcionou", body: p("O cupom PRIMAVERA10 não aplicou o desconto no checkout. Ainda consigo usar?") }],
  },
  {
    email: "lucas.martins@gmail.com", name: "Lucas Martins", status: "resolvido",
    msgs: [
      { dir: "in", at: 2 * D, subject: "Endereço errado no pedido", body: p("Coloquei o número da casa errado no pedido #4510, é 245 e não 254.") },
      { dir: "out", at: 2 * D - 40, subject: "Re: Endereço errado no pedido", body: p("Pronto Lucas, endereço corrigido antes do envio!", "Atenciosamente,<br>Equipe SRX") },
    ],
  },
  {
    email: "michael.brown@icloud.com", name: "Michael Brown", status: "resolvido", tags: ["Cancelamento"],
    msgs: [
      { dir: "in", at: 3 * D, subject: "Cancel my order", body: p("Please cancel order #1079, I bought it by mistake.") },
      { dir: "out", at: 3 * D - 2 * H, subject: "Re: Cancel my order", body: p("Done, Michael — order cancelled and refunded.", "Best,<br>SRX Support") },
      { dir: "in", at: 3 * D - 3 * H, subject: "Re: Cancel my order", body: p("Thank you so much!") },
    ],
  },
  {
    email: "pedro.rocha@uol.com.br", name: "Pedro Rocha", status: "resolvido",
    msgs: [
      { dir: "in", at: 4 * D, subject: "Nota fiscal", body: p("Poderiam me enviar a nota fiscal do pedido #4455?") },
      { dir: "out", at: 4 * D - 5 * H, subject: "Re: Nota fiscal", body: p("Claro Pedro, segue em anexo.", "Atenciosamente,<br>Equipe SRX"), attachments: [{ name: "NF-4455.pdf", size: 180_000 }] },
    ],
  },
  {
    email: "carla.mendes@gmail.com", name: "Carla Mendes", status: "resolvido", tags: ["Elogio"],
    msgs: [{ dir: "in", at: 5 * D, subject: "Elogio 😊", body: p("Só passando pra dizer que amei o produto e a entrega foi super rápida. Parabéns!") }],
  },
  {
    email: "noreply@shopify.com", name: "Shopify", status: "resolvido",
    msgs: [{ dir: "in", at: 6 * D, subject: "Seu repasse de US$ 3.482,10 foi enviado", body: p("O repasse da loja Walkesty foi enviado para a sua conta bancária.") }],
  },
];

type Store = { conversations: SupportConversation[]; messages: (SupportMessage & { conversation_id: string })[]; signature: string; signatureEnabled: boolean; tags: string[] };

let seq = 0;
const uid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

function buildStore(): Store {
  const conversations: SupportConversation[] = [];
  const messages: Store["messages"] = [];
  for (const s of SEEDS) {
    const id = uid();
    const msgs = s.msgs.map((m) => ({
      id: uid(), conversation_id: id, message_id: String(1_700_000_000_000 + seq), folder_id: "1",
      direction: m.dir, from_email: m.dir === "in" ? s.email : OWN, from_name: m.dir === "in" ? s.name : null,
      to_emails: m.dir === "in" ? OWN : s.email, subject: m.subject,
      summary: m.body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 140),
      sent_at: ago(m.at), is_read: m.dir === "out" || m.read !== false, has_attachment: !!m.attachments?.length,
      content_html: m.body, attachments: (m.attachments ?? []).map((a, i) => ({ id: String(i + 1), ...a })),
    }));
    messages.push(...msgs);
    conversations.push({
      id, customer_email: s.email, customer_name: s.name, subject: null, summary: null,
      last_message_at: null, last_inbound_at: null, last_outbound_at: null, message_count: 0, unread_count: 0,
      status: s.status, favorite: !!s.favorite, tags: s.tags ?? [], note: s.note ?? null,
      resolved_at: s.status === "resolvido" ? ago(s.msgs[s.msgs.length - 1].at - 30) : null,
    });
  }
  const store = { conversations, messages, signature: "Atenciosamente,\n{nome}\nEquipe de Atendimento SRX", signatureEnabled: true, tags: ["Reembolso", "Defeito", "Troca", "Rastreamento"] };
  store.conversations.forEach((c) => recompute(store, c));
  return store;
}

function recompute(store: Store, c: SupportConversation) {
  const list = store.messages.filter((m) => m.conversation_id === c.id).sort((a, b) => a.sent_at.localeCompare(b.sent_at));
  const last = list[list.length - 1];
  c.subject = last?.subject ?? null;
  c.summary = last?.summary ?? null;
  c.last_message_at = last?.sent_at ?? null;
  c.last_inbound_at = [...list].reverse().find((m) => m.direction === "in")?.sent_at ?? null;
  c.last_outbound_at = [...list].reverse().find((m) => m.direction === "out")?.sent_at ?? null;
  c.message_count = list.length;
  c.unread_count = list.filter((m) => m.direction === "in" && !m.is_read).length;
}

let store: Store | null = null;
const db = () => (store ??= buildStore());
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const wait = (ms = 250) => new Promise((r) => setTimeout(r, ms));

// Pedidos fictícios por cliente (painel da direita).
const ORDERS: Record<string, { n: number; currency: string; store: string; values: number[] }> = {
  "camila.lopes@email.com": { n: 4532, currency: "BRL", store: "Walkesty", values: [289.9, 159.9, 349.9, 199.9, 234.9] },
  "rafael.ferreira@gmail.com": { n: 4519, currency: "BRL", store: "Walkesty", values: [399.9] },
  "joao.oliveira@outlook.com": { n: 4401, currency: "BRL", store: "Walkesty", values: [179.9, 129.9] },
  "mariana.alves@yahoo.com.br": { n: 4498, currency: "BRL", store: "Walkesty", values: [459.0] },
  "emily.johnson@gmail.com": { n: 1087, currency: "USD", store: "Nordhaus", values: [89.99, 64.5, 120] },
  "sarah.wilson@hotmail.com": { n: 1102, currency: "USD", store: "Nordhaus", values: [74.9] },
  "lucas.martins@gmail.com": { n: 4510, currency: "BRL", store: "Walkesty", values: [219.9] },
  "michael.brown@icloud.com": { n: 1079, currency: "USD", store: "Nordhaus", values: [49.9] },
  "pedro.rocha@uol.com.br": { n: 4455, currency: "BRL", store: "Walkesty", values: [599.9, 99.9] },
  "carla.mendes@gmail.com": { n: 4470, currency: "BRL", store: "Walkesty", values: [149.9] },
};

// ─── API falsa (mesmos nomes/formatos das server functions) ───────────────────

const demoApi = {
  getZohoStatus: async () => ({
    connected: true, email: OWN, displayName: "Equipe SRX", lastSyncAt: ago(1), lastSyncError: null,
    mailWebBase: "https://mail.zoho.com", redirectUri: `${window.location.origin}/api/public/zoho/callback`, isAdmin: true,
  }),
  syncSupportInbox: async () => { await wait(600); return { skipped: true }; },
  startZohoOAuth: async () => { throw new Error("Modo demonstração — saia do modo demo para conectar"); },
  disconnectZoho: async () => { throw new Error("Modo demonstração — nada foi desconectado"); },

  listSupportConversations: async ({ data }: { data: { from: string; to: string } }) => {
    await wait();
    const s = db();
    const conversations = s.conversations.filter((c) => c.last_message_at && c.last_message_at >= data.from && c.last_message_at <= data.to);
    const to = new Date(data.to).getTime();
    const waits: number[] = [];
    for (const c of s.conversations) {
      let pending: number | null = null;
      for (const m of s.messages.filter((x) => x.conversation_id === c.id).sort((a, b) => a.sent_at.localeCompare(b.sent_at))) {
        const t = new Date(m.sent_at).getTime();
        if (t < new Date(data.from).getTime()) continue;
        if (m.direction === "in") { if (pending == null) pending = t; } else if (pending != null) { if (pending <= to) waits.push(t - pending); pending = null; }
      }
    }
    return clone({
      conversations: conversations.sort((a, b) => (b.last_message_at ?? "").localeCompare(a.last_message_at ?? "")),
      kpis: {
        received: s.messages.filter((m) => m.direction === "in" && m.sent_at >= data.from && m.sent_at <= data.to).length,
        unread: s.conversations.filter((c) => c.unread_count > 0).length,
        inProgress: s.conversations.filter((c) => c.status === "em_atendimento").length,
        waiting: s.conversations.filter((c) => c.status === "aguardando_cliente").length,
        resolved: conversations.filter((c) => c.status === "resolvido").length,
        avgResponseMs: waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : null,
        responses: waits.length,
      },
    });
  },

  findEmailsByOrder: async ({ data }: { data: { q: string } }) => {
    const n = Number(data.q.replace("#", ""));
    return Object.entries(ORDERS).filter(([, o]) => o.values.some((_, i) => o.n - i * 7 === n)).map(([e]) => e);
  },

  getSupportConversation: async ({ data }: { data: { id: string } }) => {
    await wait(350);
    const s = db();
    const conversation = s.conversations.find((c) => c.id === data.id);
    if (!conversation) throw new Error("Conversa não encontrada");
    const messages = s.messages.filter((m) => m.conversation_id === data.id).sort((a, b) => a.sent_at.localeCompare(b.sent_at));
    return clone({ conversation, messages });
  },

  markConversationRead: async ({ data }: { data: { ids: string[]; read: boolean } }) => {
    const s = db();
    for (const id of data.ids) {
      const inbound = s.messages.filter((m) => m.conversation_id === id && m.direction === "in").sort((a, b) => b.sent_at.localeCompare(a.sent_at));
      if (data.read) inbound.forEach((m) => { m.is_read = true; });
      else if (inbound[0]) inbound[0].is_read = false;
      recompute(s, s.conversations.find((c) => c.id === id)!);
    }
    return { ok: true };
  },

  updateSupportConversations: async ({ data }: { data: { ids: string[]; patch: Partial<SupportConversation> } }) => {
    for (const c of db().conversations.filter((x) => data.ids.includes(x.id))) {
      Object.assign(c, data.patch);
      if (data.patch.status) c.resolved_at = data.patch.status === "resolvido" ? new Date().toISOString() : null;
    }
    return { ok: true };
  },

  uploadSupportAttachment: async ({ data }: { data: { fileName: string } }) => {
    await wait(400);
    return { storeName: "demo", attachmentPath: "/demo", attachmentName: data.fileName };
  },

  sendSupportReply: async ({ data }: { data: { conversationId: string; text: string; status: SupportStatus; signature: boolean; attachments?: { attachmentName: string }[] } }) => {
    await wait(700);
    const s = db();
    const c = s.conversations.find((x) => x.id === data.conversationId)!;
    const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>");
    let html = `<p>${esc(data.text)}</p>`;
    if (data.signature && s.signatureEnabled && s.signature.trim()) {
      html += `<p style="color:#666">${esc(s.signature.replace(/\{nome\}/gi, "Você"))}</p>`;
    }
    const base = c.subject ?? "";
    s.messages.push({
      id: uid(), conversation_id: c.id, message_id: String(Date.now()), folder_id: "2", direction: "out",
      from_email: OWN, from_name: null, to_emails: c.customer_email, subject: /^re:/i.test(base) ? base : `Re: ${base}`,
      summary: data.text.slice(0, 140), sent_at: new Date().toISOString(), is_read: true,
      has_attachment: !!data.attachments?.length, content_html: html,
      attachments: (data.attachments ?? []).map((a, i) => ({ id: String(i + 1), name: a.attachmentName, size: 0 })),
    });
    c.status = data.status;
    c.resolved_at = data.status === "resolvido" ? new Date().toISOString() : null;
    recompute(s, c);
    return { ok: true };
  },

  sendSupportNewMessage: async ({ data }: { data: { to: string; subject: string; text: string } }) => {
    await wait(700);
    const s = db();
    const email = data.to.toLowerCase();
    let c = s.conversations.find((x) => x.customer_email === email);
    if (!c) {
      c = {
        id: uid(), customer_email: email, customer_name: null, subject: null, summary: null, last_message_at: null,
        last_inbound_at: null, last_outbound_at: null, message_count: 0, unread_count: 0, status: "aguardando_cliente",
        favorite: false, tags: [], note: null, resolved_at: null,
      };
      s.conversations.push(c);
    }
    s.messages.push({
      id: uid(), conversation_id: c.id, message_id: String(Date.now()), folder_id: "2", direction: "out",
      from_email: OWN, from_name: null, to_emails: email, subject: data.subject, summary: data.text.slice(0, 140),
      sent_at: new Date().toISOString(), is_read: true, has_attachment: false,
      content_html: `<p>${data.text.replace(/</g, "&lt;").replace(/\n/g, "<br>")}</p>`, attachments: [],
    });
    c.status = "aguardando_cliente";
    recompute(s, c);
    return { conversationId: c.id };
  },

  getSupportCustomer: async ({ data }: { data: { email: string } }) => {
    await wait(300);
    const o = ORDERS[data.email.toLowerCase()];
    const conv = db().conversations.find((c) => c.customer_email === data.email.toLowerCase());
    if (!o) return { name: null, phone: null, firstOrderAt: null, ordersCount: 0, totals: {}, stores: [], orders: [] };
    const orders = o.values.map((v, i) => ({
      id: `${o.n}-${i}`, number: `#${o.n - i * 7}`, date: ago(i * 38 * D + 3 * D), revenue: v, currency: o.currency,
      store: o.store, financial: i === 0 && data.email.startsWith("joao") ? "refunded" : "paid",
      delivery: i === 0 ? "Em trânsito" : "Entregue",
      tracking: `TR${String(123456789 - i * 1111).padStart(9, "0")}${o.currency === "BRL" ? "BR" : "US"}`,
      trackingUrl: `https://${o.store.toLowerCase()}.com/apps/track123?nums=TR${String(123456789 - i * 1111).padStart(9, "0")}${o.currency === "BRL" ? "BR" : "US"}`, carrier: o.currency === "BRL" ? "Correios" : "USPS", cancelled: false,
    }));
    return {
      name: conv?.customer_name ?? null,
      phone: o.currency === "BRL" ? "+55 27 99999-1234" : "+1 (555) 201-4478",
      firstOrderAt: orders[orders.length - 1].date,
      ordersCount: orders.length,
      totals: { [o.currency]: o.values.reduce((a, b) => a + b, 0) },
      stores: [o.store],
      orders,
    };
  },

  getSupportSettings: async () => ({ signature: db().signature, signatureEnabled: db().signatureEnabled, tags: [...db().tags], senderName: "Você" }),
  saveSupportSettings: async ({ data }: { data: { signature?: string; signatureEnabled?: boolean; tags?: string[] } }) => {
    await wait();
    if (data.signature !== undefined) db().signature = data.signature;
    if (data.signatureEnabled !== undefined) db().signatureEnabled = data.signatureEnabled;
    if (data.tags) db().tags = [...data.tags];
    return { ok: true };
  },
  changeSupportTag: async ({ data }: { data: { from: string; to: string | null } }) => {
    await wait();
    const replace = (list: string[]) => [...new Set(list.flatMap((t) => (t === data.from ? (data.to ? [data.to] : []) : [t])))];
    db().tags = replace(db().tags);
    const hit = db().conversations.filter((c) => c.tags.includes(data.from));
    hit.forEach((c) => { c.tags = replace(c.tags); });
    return { conversations: hit.length };
  },
};

type DemoFnName = keyof typeof demoApi;
