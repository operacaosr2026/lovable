// Tipos e textos dos Alertas de chargeback usados no cliente e no servidor.

export const ALERT_STATUSES = ["a_contatar", "contatado", "recuperado", "sem_retorno", "nao_recuperavel"] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

export type AlertRow = {
  shopId: string; shopName: string; orderExternalId: string; orderNumber: string | null; orderDate: string | null;
  network: string; refundedAt: string | null; refundedAmount: number; currency: string; note: string | null;
  customerName: string | null; customerFirstName: string | null; customerEmail: string | null; product: string | null;
  deliveryStatus: string | null; deliveredAt: string | null; trackingCode: string | null; trackingUrl: string | null;
  lastEvent: string | null; conversationId: string | null;
  status: AlertStatus; recoveredAmount: number | null; followupNote: string | null; followupAt: string | null;
  dunningStep: number; dunningLastAt: string | null; dunningPaused: boolean; dunningStopReason: string | null;
  dunningStartedAt: string | null; repliedAt: string | null; repliedStep: number | null; recoveredAt: string | null; recoveredStep: number | null;
};

// Sequência de cobrança: days do 1º = dias depois da entrega; dos demais = dias depois do anterior.
export type DunningStep = { subject: string; body: string; days: number };
export type ChargebackSettings = { dunningEnabled: boolean; dunningSteps: DunningStep[]; dunningFinalWaitDays: number };
export const DEFAULT_CHARGEBACK_SETTINGS: ChargebackSettings = { dunningEnabled: false, dunningSteps: [], dunningFinalWaitDays: 7 };

export const DUNNING_VARS = [
  ["{nome}", "Primeiro nome do cliente"],
  ["{nome_completo}", "Nome completo do cliente"],
  ["{pedido}", "Número do pedido (#WK1137)"],
  ["{produto}", "Produto(s) do pedido"],
  ["{valor}", "Valor reembolsado ($99.90)"],
  ["{data_pedido}", "Data da compra"],
  ["{data_reembolso}", "Data do reembolso"],
  ["{data_entrega}", "Data da entrega"],
  ["{codigo_rastreio}", "Código de rastreio"],
  ["{link_rastreio}", "Link do rastreio"],
] as const;

// Datas em inglês (os clientes são dos EUA): "September 26, 2026".
function usDate(iso: string | null) {
  if (!iso) return "";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" });
}

export function dunningVars(r: AlertRow): Record<string, string> {
  return {
    "{nome}": r.customerFirstName ?? r.customerName ?? "",
    "{nome_completo}": r.customerName ?? "",
    "{pedido}": r.orderNumber ?? `#${r.orderExternalId}`,
    "{produto}": r.product ?? "",
    "{valor}": `$${r.refundedAmount.toFixed(2)}`,
    "{data_pedido}": usDate(r.orderDate),
    "{data_reembolso}": usDate(r.refundedAt),
    "{data_entrega}": usDate(r.deliveredAt),
    "{codigo_rastreio}": r.trackingCode ?? "",
    "{link_rastreio}": r.trackingUrl ?? "",
  };
}

export function renderDunning(text: string, vars: Record<string, string>) {
  return text.replace(/\{[a-z_]+\}/gi, (m) => vars[m.toLowerCase()] ?? m);
}

// Texto do e-mail → HTML. Formatação no estilo WhatsApp: *negrito* (ou **negrito**)
// e _itálico_. Links viram clicáveis (e não são formatados por dentro).
function escHtml(t: string) {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
// Marcador só vale colado no texto e com espaço/pontuação em volta (não pega
// "5*3" nem nomes_com_underline).
const B2 = /(^|[\s(["'])\*\*(\S(?:[^*\n]*?\S)?)\*\*(?=$|[\s.,!?;:)\]"'])/g;
const B1 = /(^|[\s(["'])\*(\S(?:[^*\n]*?\S)?)\*(?=$|[\s.,!?;:)\]"'])/g;
const IT = /(^|[\s(["'])_(\S(?:[^_\n]*?\S)?)_(?=$|[\s.,!?;:)\]"'])/g;
function inlineFormat(t: string) {
  return t.replace(B2, "$1<b>$2</b>").replace(B1, "$1<b>$2</b>").replace(IT, "$1<i>$2</i>");
}
// Links: [texto](https://…) vira o texto clicável; endereço solto também vira link.
// Os links saem do texto antes da formatação (o * e _ de dentro da URL não contam)
// e voltam no fim — assim *[texto](url)* fica em negrito.
const MD_LINK = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;
const BARE_URL = /https?:\/\/[^\s<]+/g;
export function dunningTextToHtml(text: string) {
  const links: string[] = [];
  const hold = (html: string) => `\u0000${links.push(html) - 1}\u0000`;
  const withLinks = text
    .replace(MD_LINK, (_, label: string, url: string) => hold(`<a href="${escHtml(url)}">${inlineFormat(escHtml(label))}</a>`))
    .replace(BARE_URL, (url) => hold(`<a href="${escHtml(url)}">${escHtml(url)}</a>`));
  const html = inlineFormat(escHtml(withLinks)).replace(/\u0000(\d+)\u0000/g, (_, n) => links[Number(n)]);
  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">${html.replace(/\r?\n/g, "<br>")}</div>`;
}
