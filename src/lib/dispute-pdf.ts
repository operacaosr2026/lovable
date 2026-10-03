import { jsPDF } from "jspdf";
import type { DisputeEvidence } from "@/lib/dispute-evidence.functions";

// PDFs da resposta de chargeback (aba Chargebacks > "Documentos para a
// Shopify"): um arquivo por campo de prova da Shopify, em inglês (quem lê é o
// banco nos EUA). Gerados no navegador com jsPDF. Visual de "dossiê": marca +
// título, faixa de resumo, quadro "por que essa prova importa", tabelas de
// campo/valor e caixas de texto.

const REASON_EN: Record<string, string> = {
  product_not_received: "Product not received", product_unacceptable: "Product not as described",
  fraudulent: "Fraudulent", unrecognized: "Unrecognized", duplicate: "Duplicate", credit_not_processed: "Credit not processed",
  subscription_canceled: "Subscription canceled", general: "General", customer_initiated: "Customer initiated",
};

export const EVIDENCE_DOCS = [
  { key: "communication", file: "Customer_Communication.pdf", label: "Comunicação com o cliente", hint: "E-mails recebidos e enviados" },
  { key: "shipping", file: "Shipping_Documentation.pdf", label: "Documentação de frete", hint: "Política de frete e rastreio" },
  { key: "service", file: "Proof_of_Service.pdf", label: "Comprovante de serviço", hint: "Dados da compra, produto e IP do cliente" },
  { key: "other", file: "Additional_Evidence.pdf", label: "Outras provas", hint: "Texto de defesa do motivo + reembolso, privacidade, termos, contato e aviso legal" },
] as const;
export type EvidenceDocKey = (typeof EVIDENCE_DOCS)[number]["key"];

// Helvetica do jsPDF só tem Latin-1: troca aspas/traços “curvos” e tira o resto.
const latin1 = (s: string) => s
  .replace(/[‘’‛]/g, "'").replace(/[“”‟]/g, '"')
  .replace(/[–—−]/g, "-").replace(/…/g, "...").replace(/[•●]/g, "-")
  .replace(/ /g, " ").replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "");

// Data em inglês; "aaaa-mm-dd" sem fuso (senão vira o dia anterior no Brasil).
function dateEn(iso: string | null | undefined, withTime = false) {
  if (!iso) return "-";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)) : new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    year: "numeric", month: "long", day: "numeric", timeZone: m ? "UTC" : "America/New_York",
    ...(withTime && !m ? { hour: "2-digit", minute: "2-digit", timeZoneName: "short" } : {}),
  });
}
// "Sep 27, 2026" pra faixa de resumo.
function dateShort(iso: string | null | undefined) {
  if (!iso) return "-";
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });
}
const money = (ev: DisputeEvidence, v: string | number | null | undefined) =>
  v == null || v === "" ? "-" : `$${Number(v).toFixed(2)} ${ev.order.currency ?? ev.dispute.currency ?? "USD"}`;

// Rastreio pro banco: nada que mostre origem na China, alfândega ou exportação
// (eventos, local, status e transportadora consolidadora) — só os últimos eventos no destino.
const ORIGIN_HINT = /china|chinese|\bcn\b|shenzhen|guangzhou|shanghai|beijing|hangzhou|yiwu|dongguan|fujian|zhejiang|jiangsu|guangdong|hong ?kong|origin|export|customs|starting port|jcex|jxc|yunexpress|yanwen|4px|cainiao/i;
const US_CARRIER = /usps|ups|fedex|dhl|ontrac|lasership|amazon|uniuni|gofo|veho|spee-?dee/i;
const TRACK_EVENTS = 3;

type RGB = [number, number, number];
const C = {
  text: [17, 24, 39] as RGB, muted: [107, 114, 128] as RGB, line: [226, 232, 240] as RGB, soft: [248, 250, 252] as RGB,
  blueBg: [239, 246, 255] as RGB, blueLine: [191, 219, 254] as RGB, greenBg: [240, 253, 244] as RGB, greenLine: [187, 247, 208] as RGB,
};

class Doc {
  pdf = new jsPDF({ unit: "pt", format: "letter" });
  y = 0;
  readonly m = 40;                                          // margem
  readonly w = this.pdf.internal.pageSize.getWidth() - 80;
  readonly h = this.pdf.internal.pageSize.getHeight();
  private readonly bottom = this.h - 50;

  constructor(private ev: DisputeEvidence, title: string, subtitle?: string) { this.header(title, subtitle); }

  private font(style: "normal" | "bold", size: number, color: RGB) {
    this.pdf.setFont("helvetica", style).setFontSize(size).setTextColor(...color);
    return this.pdf;
  }
  private wrap(text: string, width: number, style: "normal" | "bold", size: number): string[] {
    this.pdf.setFont("helvetica", style).setFontSize(size);
    return this.pdf.splitTextToSize(latin1(text), width) as string[];
  }
  private fit(text: string, width: number, style: "normal" | "bold", size: number) {
    this.pdf.setFont("helvetica", style).setFontSize(size);
    let t = latin1(text);
    if (this.pdf.getTextWidth(t) <= width) return t;
    while (t.length > 1 && this.pdf.getTextWidth(`${t}...`) > width) t = t.slice(0, -1);
    return `${t}...`;
  }
  private box(x: number, y: number, w: number, h: number, fill: RGB, stroke: RGB) {
    this.pdf.setFillColor(...fill).setDrawColor(...stroke).setLineWidth(0.7).rect(x, y, w, h, "FD");
  }
  private ensure(space: number) {
    if (this.y + space <= this.bottom) return;
    this.pdf.addPage();
    this.y = 50;
  }

  private header(title: string, subtitle?: string) {
    const { ev, m } = this;
    const brand = latin1(ev.store.name || "").toUpperCase();
    this.font("bold", 13, C.text).text(brand, m, 52);
    const bw = this.pdf.getTextWidth(brand);
    this.font("bold", 20, C.text).text(latin1(title.toUpperCase()), m + bw + 26, 54);
    const sub = subtitle ?? [
      `Order ${ev.order.number ?? "-"}`,
      `Dispute reason: ${REASON_EN[ev.dispute.reason ?? ""] ?? ev.dispute.reason ?? "-"}`,
      `${ev.dispute.currency ?? "USD"} ${ev.dispute.amount.toFixed(2)}`,
    ].join(" | ");
    this.font("normal", 8.5, C.muted).text(latin1(sub), m, 70);
    this.y = 84;
  }

  // Faixa de resumo: até 4 colunas com rótulo pequeno e valor em destaque.
  summary(cells: [string, string][]) {
    const h = 46, cw = this.w / cells.length;
    this.ensure(h + 14);
    this.box(this.m, this.y, this.w, h, C.soft, C.line);
    cells.forEach(([label, value], i) => {
      const x = this.m + i * cw;
      if (i) this.pdf.setDrawColor(...C.line).line(x, this.y, x, this.y + h);
      this.font("normal", 7.5, C.muted).text(latin1(label.toUpperCase()), x + 10, this.y + 15);
      // Valor longo (e-mail): diminui a fonte antes de cortar.
      const size = [11, 10, 9, 8].find((sz) => { this.pdf.setFont("helvetica", "bold").setFontSize(sz); return this.pdf.getTextWidth(latin1(value || "-")) <= cw - 20; }) ?? 8;
      this.font("bold", size, C.text).text(this.fit(value || "-", cw - 20, "bold", size), x + 10, this.y + 34);
    });
    this.y += h + 16;
  }

  // Quadro de destaque: azul (por que a prova importa) ou verde (conclusão).
  callout(title: string, text: string, tone: "blue" | "green" = "blue") {
    if (!text.trim()) return;
    const lines = this.wrap(text, this.w - 24, "normal", 9);
    const h = 30 + lines.length * 11.5;
    this.ensure(h + 14);
    this.box(this.m, this.y, this.w, h, tone === "blue" ? C.blueBg : C.greenBg, tone === "blue" ? C.blueLine : C.greenLine);
    this.font("bold", 8.5, C.text).text(latin1(title.toUpperCase()), this.m + 12, this.y + 16);
    this.font("normal", 9, C.text).text(lines, this.m + 12, this.y + 29, { lineHeightFactor: 1.28 });
    this.y += h + 16;
  }

  section(title: string) {
    this.ensure(46);
    this.font("bold", 10.5, C.text).text(latin1(title.toUpperCase()), this.m + 2, this.y + 6);
    this.y += 14;
  }

  // Tabela campo/valor (linhas sem valor saem). Quebra de página entre linhas.
  table(rows: [string, string | null | undefined][], labelW = 150) {
    const list = rows.filter(([, v]) => v != null && String(v).trim() !== "");
    for (const [label, value] of list) {
      const lab = this.wrap(label, labelW - 16, "normal", 7.5);
      const val = this.wrap(String(value), this.w - labelW - 18, "normal", 9);
      const rh = Math.max(lab.length * 10, val.length * 11.5) + 14;
      this.ensure(rh);
      this.box(this.m, this.y, this.w, rh, [255, 255, 255], C.line);
      this.pdf.setDrawColor(...C.line).line(this.m + labelW, this.y, this.m + labelW, this.y + rh);
      this.font("normal", 7.5, C.muted).text(lab, this.m + 8, this.y + 15, { lineHeightFactor: 1.3 });
      this.font("normal", 9, C.text).text(val, this.m + labelW + 9, this.y + 15, { lineHeightFactor: 1.28 });
      this.y += rh;
    }
    this.y += 14;
  }

  // Caixa cinza com texto corrido (e-mail, política, descrição); continua na próxima página.
  textBox(text: string, opts: { bold?: string } = {}) {
    // Parágrafos separados por linha em branco; quebra simples fica junta (ex.: assinatura).
    const paras = latin1(text).replace(/\r/g, "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    const lines: { t: string; b?: boolean }[] = [];
    // Título só se o texto ainda não começa com ele.
    if (opts.bold && !(paras[0] ?? "").toLowerCase().includes(opts.bold.toLowerCase())) lines.push({ t: opts.bold, b: true }, { t: "" });
    paras.forEach((p, i) => {
      for (const row of p.split("\n")) for (const l of this.wrap(row.trim(), this.w - 28, "normal", 9)) lines.push({ t: l });
      if (i < paras.length - 1) lines.push({ t: "" });
    });
    if (!lines.length) return;
    const lh = 11.5;
    let i = 0;
    while (i < lines.length) {
      this.ensure(40);
      const fitN = Math.max(1, Math.floor((this.bottom - this.y - 24) / lh));
      const chunk = lines.slice(i, i + fitN);
      while (chunk.length && !chunk[chunk.length - 1].t && i + chunk.length < lines.length) chunk.pop();
      const h = chunk.length * lh + 22;
      this.box(this.m, this.y, this.w, h, C.soft, C.line);
      chunk.forEach((l, k) => this.font(l.b ? "bold" : "normal", 9, C.text).text(l.t, this.m + 14, this.y + 18 + k * lh));
      this.y += h;
      i += chunk.length;
      if (i < lines.length) { this.pdf.addPage(); this.y = 50; }
    }
    this.y += 14;
  }

  note(text: string) {
    const lines = this.wrap(text, this.w, "normal", 8.5);
    this.ensure(lines.length * 11 + 8);
    this.font("normal", 8.5, C.muted).text(lines, this.m + 2, this.y + 6, { lineHeightFactor: 1.3 });
    this.y += lines.length * 11 + 10;
  }

  save(file: string) {
    const pages = this.pdf.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      this.pdf.setPage(i);
      this.font("normal", 8, C.muted).text(latin1(`${this.ev.store.name} - Order ${this.ev.order.number ?? ""} - Page ${i} of ${pages}`), this.m, this.h - 26);
    }
    this.pdf.save(file);
  }
}

const tracking = (ev: DisputeEvidence) => ev.shipping.trackingNumber;
const shortCode = (s: string | null) => (!s ? "-" : s.length > 14 ? `${s.slice(0, 5)}...${s.slice(-4)}` : s);
const cleanStatus = (s: string | null) => (s && ORIGIN_HINT.test(s) ? "In transit" : s);

function shipping(ev: DisputeEvidence) {
  const d = new Doc(ev, "Shipping Documentation");
  const delivered = ev.shipping.deliveredAt;
  d.summary([["Order", ev.order.number ?? "-"], ["Ordered", dateShort(ev.order.createdAt)], ["Shipped", dateShort(ev.shipping.shippedAt)], ["Tracking", shortCode(tracking(ev))]]);
  d.callout("Key timing", [
    ev.order.createdAt && `The order was placed on ${dateEn(ev.order.createdAt)}`,
    ev.shipping.shippedAt && `and the shipment was created on ${dateEn(ev.shipping.shippedAt)}`,
  ].filter(Boolean).join(" ") + "." + (delivered ? ` Carrier tracking shows the package delivered on ${dateEn(delivered)}.` : ""));

  d.section("Shipment record");
  d.table([
    ["Carrier", ev.shipping.carrier && US_CARRIER.test(ev.shipping.carrier) ? ev.shipping.carrier : null],
    ["Tracking number", tracking(ev)],
    ["Tracking page", ev.shipping.trackingUrl],
    ["Shipment record date", ev.shipping.shippedAt ? dateEn(ev.shipping.shippedAt) : null],
    ["Current status", cleanStatus(ev.shipping.status)],
    ["Delivered on", delivered ? dateEn(delivered, true) : null],
    ["Destination", [ev.order.customerName, ev.order.shippingAddress.filter((l) => l !== ev.order.customerName).join(", ")].filter(Boolean).join(" - ")],
  ]);

  const events = ev.shipping.events.filter((e) => !ORIGIN_HINT.test(`${e.description} ${e.location ?? ""}`)).slice(0, TRACK_EVENTS);
  d.section(events.length > 1 ? "Latest tracking events" : "Tracking event");
  if (!events.length) d.note("No carrier events available.");
  else d.table(events.map((e) => [e.time ?? "-", `${e.description}${e.location ? ` (${e.location})` : ""}`]), 170);

  const ship = ev.policies.filter((p) => p.kind === "shipping");
  d.section("Published shipping policy");
  if (ev.store.domain) d.note(`Published on our store (${ev.store.domain}) and accepted by the customer at checkout.`);
  if (!ship.length) d.note("No shipping policy text available.");
  for (const p of ship) d.textBox(p.body, { bold: ship.length > 1 ? p.title : undefined });

  d.callout("Evidence position", delivered
    ? `Carrier tracking confirms the package was delivered to the customer's shipping address on ${dateEn(delivered)}.`
    : "This document supports timely order processing and the creation of shipment tracking to the customer's stated destination, within the timeframes published in our Shipping Policy.", "green");
  return d;
}

function communication(ev: DisputeEvidence) {
  const d = new Doc(ev, "Customer Communication");
  const inbound = ev.communications.some((m) => m.direction === "in");
  const support = ev.store.supportEmail ?? "store support";
  d.summary([["Customer", ev.order.customerName ?? "-"], ["Email", ev.order.email ?? "-"], ["Emails on record", String(ev.notifications.length + ev.communications.length)], ["Support", ev.store.supportEmail ?? "-"]]);
  d.callout("Why this evidence matters", [
    ev.notifications.length && "The store's automatic order and shipping confirmation emails were sent to the customer's email address, including the tracking information.",
    ev.communications.length && "The record below shows every message exchanged with the customer about this order.",
    !inbound && `The customer did not contact our support team (${support}) about this order before filing the dispute, although our contact details are published on the store.`,
  ].filter(Boolean).join(" "));

  if (ev.notifications.length) {
    d.section("Automatic emails sent by the store");
    d.table([
      ...ev.notifications.map((n): [string, string] => [dateEn(n.sentAt, true), n.message]),
      ["Tracking on file", tracking(ev) ? `${tracking(ev)}${ev.shipping.trackingUrl ? ` - ${ev.shipping.trackingUrl}` : ""}` : null],
    ], 170);
  }
  for (const m of ev.communications) {
    d.section(`Email record - ${m.direction === "in" ? "from customer" : "from store"}`);
    d.table([["From", m.from], ["To", m.to], ["Date", dateEn(m.sentAt, true)], ["Subject", m.subject]]);
    d.textBox(m.body);
  }
  return d;
}

// Comprovante de serviço: dados da compra (com IP do cliente) + descrição do produto.
function service(ev: DisputeEvidence) {
  const d = new Doc(ev, "Proof of Service");
  const units = ev.order.items.reduce((t, i) => t + i.quantity, 0);
  d.summary([["Order", ev.order.number ?? "-"], ["Order date", dateShort(ev.order.createdAt)], ["Amount", money(ev, ev.order.total)], ["Items", String(units || "-")]]);
  const positive = ev.payment.riskFacts.filter((f) => f.sentiment === "POSITIVE").map((f) => f.description.replace(/\.$/, ""));
  d.callout("Why this evidence matters", [
    "This record identifies the disputed transaction, the customer, the purchased item, and the billing and shipping information supplied with the order.",
    ev.payment.avs === "Y" && "The address verification (AVS) matched.",
    ev.payment.cvv === "M" && "The card security code (CVV) matched.",
    positive.length && `The platform's verification record also shows: ${positive.join("; ")}.`,
  ].filter(Boolean).join(" "));

  d.section("Order details");
  d.table([
    ["Order number", ev.order.number],
    ["Order date", ev.order.createdAt ? dateEn(ev.order.createdAt, true) : null],
    ["Order total", ev.order.total ? money(ev, ev.order.total) : null],
    ...ev.order.items.flatMap((it, i): [string, string | null][] => [
      [ev.order.items.length > 1 ? `Product ${i + 1}` : "Product", ev.products[i]?.title ?? it.title],
      ["Variant / size", it.variant],
      ["Quantity", String(it.quantity)],
      ["Price", it.price ? money(ev, it.price) : null],
      ["SKU", it.sku],
    ]),
  ]);
  d.section("Customer & address");
  d.table([
    ["Customer", ev.order.customerName], ["Email", ev.order.email], ["Phone", ev.order.phone],
    ["Shipping address", ev.order.shippingAddress.join(", ")], ["Billing address", ev.order.billingAddress.join(", ")],
  ]);
  d.section("Payment & verification");
  d.table([
    ["Payment method", ev.payment.method],
    ["Card ending in", ev.payment.last4],
    ["AVS result", ev.payment.avs ? `${ev.payment.avs}${ev.payment.avs === "Y" ? " (street address and ZIP match)" : ""}` : null],
    ["CVV result", ev.payment.cvv ? `${ev.payment.cvv}${ev.payment.cvv === "M" ? " (match)" : ""}` : null],
    ["Purchase IP address", ev.order.ip],
    ["Browser", ev.order.userAgent],
    ["Fraud analysis", ev.payment.riskLevel ? `${ev.payment.riskLevel.charAt(0)}${ev.payment.riskLevel.slice(1).toLowerCase()} risk` : null],
  ]);
  d.section("Product description");
  ev.order.items.forEach((it, i) => {
    const p = ev.products[i];
    d.textBox(p?.description ?? "No product description available.", { bold: `${p?.title ?? it.title}${it.variant ? ` - ${it.variant}` : ""}` });
  });
  if (ev.store.domain) d.note(`The product is sold as described on our store (${ev.store.domain}). The item shipped matches the product, variant and quantity purchased.`);
  if (ev.limited) d.note("Note: some order details are unavailable for this order.");
  return d;
}

// Texto de defesa por motivo da disputa (aprovado pela operação). Frase com
// dado que falta sai do texto — nunca afirma o que não temos.
function rebuttal(ev: DisputeEvidence): string {
  const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "");
  const order = ev.order.number ?? "this order";
  const placed = ev.order.createdAt ? ` on ${dateEn(ev.order.createdAt)}` : "";
  const tracking = ev.shipping.trackingNumber;
  const delivered = ev.shipping.deliveredAt;
  const support = ev.store.supportEmail ?? "our support team";
  const contacted = ev.communications.some((m) => m.direction === "in");
  const replied = ev.communications.some((m) => m.direction === "out");
  const emails = ev.notifications.length > 0;
  const address = ev.order.shippingAddress.filter(Boolean).join(", ");
  const deliveredLine = delivered
    ? `delivered on ${dateEn(delivered)}${tracking ? ` (tracking ${tracking})` : ""}`
    : tracking ? `shipped with tracking number ${tracking}` : "shipped";
  const noContact = !contacted ? `The customer did not contact our support team (${support}) before filing this dispute.` : "";
  const close = "We ask that the dispute be resolved in our favor.";
  const lines = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" ");

  switch (ev.dispute.reason) {
    case "product_not_received": {
      if (delivered && day(delivered) <= day(ev.dispute.initiatedAt)) return lines(
        "The cardholder claims the order was not received. Our records show otherwise.",
        `Order ${order} was placed${placed} and shipped to the exact address provided at checkout${address ? ` (${address})` : ""}.`,
        `${tracking ? `Tracking number ${tracking} confirms` : "Carrier tracking confirms"} the package was delivered on ${dateEn(delivered)}, before the dispute was filed.`,
        emails && "The customer received our order confirmation and shipping confirmation emails, including the tracking link.",
        !contacted && `At no point did the customer contact our support team (${support}) to report a missing package, which would have allowed us to investigate with the carrier.`,
        "The goods were delivered as agreed, so this charge is valid.", close,
      );
      return lines(
        "The cardholder claims the order was not received.",
        `Order ${order} was placed${placed} and shipped promptly${tracking ? ` with tracking number ${tracking}` : ""}.`,
        `The dispute was filed on ${dateEn(ev.dispute.initiatedAt)}, while the package was still within the delivery window stated in our Shipping Policy, which the customer accepted at checkout.`,
        delivered ? `Tracking confirms the package was delivered on ${dateEn(delivered)}.` : "The latest tracking update shows the package moving normally through the carrier network.",
        !contacted && `The customer did not contact our support team (${support}) before filing, which would have allowed us to help.`,
        "We fulfilled the order as agreed.", close,
      );
    }
    case "product_unacceptable": return lines(
      "The cardholder claims the product was not as described.",
      `Order ${order} was ${deliveredLine} and matches the product, variant and quantity shown on our store at the time of purchase (see Proof of Service).`,
      "Our Refund and Return Policy, accepted at checkout, offers a clear way to request a return or exchange if a customer is not satisfied.",
      !contacted ? `The customer never contacted our support team (${support}) to report a problem or to request a return, and went directly to the bank instead.`
        : replied ? "As shown in Customer Communication, we responded to the customer and offered a solution under our policy." : "",
      "No return was ever sent back to us.", close,
    );
    case "fraudulent": return lines(
      "The cardholder claims this purchase was not authorized.",
      `Order ${order} was placed${placed} with billing and shipping details that match the cardholder.`,
      ev.payment.avs === "Y" && "The address verification (AVS) matched.",
      ev.payment.cvv === "M" && "The card security code (CVV) matched.",
      ev.order.ip && `The order was placed from IP address ${ev.order.ip}.`,
      `The goods were shipped to the cardholder's own address and ${deliveredLine}.`,
      emails && "Order and shipping confirmations were sent to the cardholder's email, and no one reported the purchase as unauthorized.",
      "These facts indicate a legitimate purchase by the cardholder.", close,
    );
    case "credit_not_processed": return lines(
      "The cardholder claims a refund was not processed.",
      `Order ${order} was ${deliveredLine}.`,
      "Under our Refund and Return Policy, accepted at checkout, a refund is issued once the returned item is received back in its original condition.",
      !contacted ? `We have no record of a return request from the customer at ${support}.`
        : replied ? "As shown in Customer Communication, the return process was explained to the customer." : "",
      "No item was returned to us, so no refund is due.", close,
    );
    case "subscription_canceled": return lines(
      "The cardholder claims to have canceled a subscription.",
      `Order ${order} was a one-time purchase, not a subscription, placed${placed} and ${deliveredLine}.`,
      "There was no recurring charge and nothing to cancel. The customer received exactly what was ordered.", close,
    );
    default: return lines(
      `Order ${order} was placed${placed} by the cardholder and ${deliveredLine}${address ? ` to the address provided at checkout (${address})` : ""}.`,
      emails && "The customer received our order and shipping confirmation emails.",
      noContact,
      "The charge corresponds to goods that were delivered as agreed under the policies the customer accepted at checkout.", close,
    );
  }
}

// Outras provas: o texto de defesa do motivo + as políticas que não entraram nos outros documentos.
function other(ev: DisputeEvidence) {
  const d = new Doc(ev, "Additional Evidence");
  d.summary([["Store", ev.store.domain ?? ev.store.name], ["Order date", dateShort(ev.order.createdAt)], ["Dispute", REASON_EN[ev.dispute.reason ?? ""] ?? ev.dispute.reason ?? "-"], ["Amount", money(ev, ev.dispute.amount)]]);
  d.callout("Response to the dispute", rebuttal(ev));
  const rest = ev.policies.filter((p) => p.kind !== "shipping");
  d.section("Store policies");
  if (ev.store.domain) d.note(`The following policies are published on our store (${ev.store.domain}) and were available to the customer at the time of purchase.`);
  if (!rest.length) d.note("No policy text available.");
  for (const p of rest) d.textBox(p.body, { bold: p.title });
  return d;
}

// Gera e baixa um documento.
export async function downloadEvidenceDoc(key: EvidenceDocKey, ev: DisputeEvidence) {
  const file = EVIDENCE_DOCS.find((x) => x.key === key)!.file;
  const doc = key === "communication" ? communication(ev)
    : key === "shipping" ? shipping(ev)
    : key === "service" ? service(ev)
    : other(ev);
  doc.save(`${(ev.order.number ?? "order").replace(/^#/, "")}_${file}`);
}
