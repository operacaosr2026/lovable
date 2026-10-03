import { jsPDF } from "jspdf";
import type { DisputeEvidence } from "@/lib/dispute-evidence.functions";

// PDFs da resposta de chargeback (aba Chargebacks > "Documentos para a
// Shopify"): um arquivo por campo de prova da Shopify, em inglês (quem lê é o
// banco nos EUA). Gerados no navegador com jsPDF.

const REASON_EN: Record<string, string> = {
  product_not_received: "Product not received", product_unacceptable: "Product unacceptable / not as described",
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
  .replace(/ /g, " ").replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "");

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

// Rastreio pro banco: nada que mostre origem na China, alfândega ou exportação
// (eventos, local e transportadora consolidadora) — só os últimos eventos no destino.
const ORIGIN_HINT = /china|chinese|cn|shenzhen|guangzhou|shanghai|beijing|hangzhou|yiwu|dongguan|fujian|zhejiang|jiangsu|guangdong|hong ?kong|origin|export|customs|starting port|jcex|jxc|yunexpress|yanwen|4px|cainiao/i;
const US_CARRIER = /usps|ups|fedex|dhl|ontrac|lasership|amazon|uniuni|gofo|veho|spee-?dee/i;
const TRACK_EVENTS = 3;

class Doc {
  pdf = new jsPDF({ unit: "pt", format: "letter" });
  y = 0;
  readonly m = 54;                       // margem
  readonly w = this.pdf.internal.pageSize.getWidth() - 108;
  readonly h = this.pdf.internal.pageSize.getHeight();

  constructor(private ev: DisputeEvidence, private title: string) { this.header(); }

  private header() {
    const { pdf, ev } = this;
    pdf.setFont("helvetica", "bold").setFontSize(16).setTextColor(20);
    pdf.text(latin1(this.title), this.m, 64);
    pdf.setFont("helvetica", "normal").setFontSize(9.5).setTextColor(90);
    const sub = [
      ev.store.name + (ev.store.domain ? ` (${ev.store.domain})` : ""),
      `Order ${ev.order.number ?? "-"}`,
      `Dispute: ${REASON_EN[ev.dispute.reason ?? ""] ?? ev.dispute.reason ?? "-"}`,
      `${ev.dispute.currency ?? "USD"} ${ev.dispute.amount.toFixed(2)}`,
    ].join("  |  ");
    pdf.text(latin1(sub), this.m, 80);
    pdf.setDrawColor(220).setLineWidth(0.8).line(this.m, 90, this.m + this.w, 90);
    this.y = 112;
  }
  private ensure(space: number) {
    if (this.y + space <= this.h - 60) return;
    this.pdf.addPage();
    this.y = 64;
  }
  section(text: string) {
    this.ensure(40);
    this.y += 6;
    this.pdf.setFont("helvetica", "bold").setFontSize(12).setTextColor(20).text(latin1(text), this.m, this.y);
    this.y += 16;
  }
  kv(label: string, value: string | null | undefined) {
    const v = latin1(value && String(value).trim() ? String(value) : "-");
    const lines = this.pdf.setFont("helvetica", "normal").setFontSize(10).splitTextToSize(v, this.w - 150) as string[];
    this.ensure(lines.length * 13 + 4);
    this.pdf.setFont("helvetica", "bold").setFontSize(10).setTextColor(70).text(latin1(label), this.m, this.y);
    this.pdf.setFont("helvetica", "normal").setTextColor(20).text(lines, this.m + 150, this.y);
    this.y += lines.length * 13 + 4;
  }
  para(text: string, opts: { size?: number; color?: number; gap?: number } = {}) {
    const size = opts.size ?? 10;
    const lines = this.pdf.setFont("helvetica", "normal").setFontSize(size).splitTextToSize(latin1(text), this.w) as string[];
    this.pdf.setTextColor(opts.color ?? 20);
    for (const line of lines) {
      this.ensure(size + 4);
      this.pdf.text(line, this.m, this.y);
      this.y += size + 3.5;
    }
    this.y += opts.gap ?? 6;
  }
  rule() {
    this.ensure(14);
    this.pdf.setDrawColor(230).setLineWidth(0.6).line(this.m, this.y, this.m + this.w, this.y);
    this.y += 12;
  }
  save(file: string) {
    const pages = this.pdf.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      this.pdf.setPage(i);
      this.pdf.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(140);
      this.pdf.text(latin1(`${this.ev.store.name} - Order ${this.ev.order.number ?? ""} - Page ${i} of ${pages}`), this.m, this.h - 30);
    }
    this.pdf.save(file);
  }
}

function shipping(ev: DisputeEvidence) {
  const d = new Doc(ev, "Shipping Documentation");
  const ship = ev.policies.filter((p) => p.kind === "shipping");
  d.section("Shipping policy");
  if (ev.store.domain) d.para(`Published on our store (${ev.store.domain}) and available to the customer at the time of purchase.`, { color: 60, gap: 8 });
  if (!ship.length) d.para("No shipping policy text available.", { color: 110 });
  for (const p of ship) { if (ship.length > 1) d.section(p.title); d.para(p.body, { size: 9.5, gap: 12 }); }
  d.rule();
  d.section("Shipment");
  if (ev.shipping.carrier && US_CARRIER.test(ev.shipping.carrier)) d.kv("Carrier", ev.shipping.carrier);
  d.kv("Tracking number", ev.shipping.trackingNumber);
  d.kv("Tracking link", ev.shipping.trackingUrl);
  d.kv("Shipped on", dateEn(ev.shipping.shippedAt));
  d.kv("Current status", ev.shipping.status);
  if (ev.shipping.deliveredAt) d.kv("Delivered on", dateEn(ev.shipping.deliveredAt, true));
  d.section("Shipping address");
  d.para(ev.order.shippingAddress.join("\n") || "-");
  const events = ev.shipping.events.filter((e) => !ORIGIN_HINT.test(`${e.description} ${e.location ?? ""}`)).slice(0, TRACK_EVENTS);
  d.section("Latest tracking events (most recent first)");
  if (!events.length) d.para("No carrier events available.", { color: 110 });
  for (const e of events) {
    d.para(`${e.time ?? "-"}${e.location ? `  |  ${e.location}` : ""}`, { size: 9, color: 110, gap: 0 });
    d.para(e.description, { gap: 8 });
  }
  return d;
}

function communication(ev: DisputeEvidence) {
  const d = new Doc(ev, "Customer Communication");
  d.kv("Customer", ev.order.customerName);
  d.kv("Customer email", ev.order.email);
  d.kv("Store support email", ev.store.supportEmail);
  d.rule();
  if (ev.notifications.length) {
    d.section("Automatic emails sent to the customer by the store (Shopify)");
    for (const n of ev.notifications) {
      d.para(dateEn(n.sentAt, true), { size: 9, color: 110, gap: 0 });
      d.para(n.message, { gap: 8 });
    }
    if (ev.shipping.trackingNumber) d.para(`Tracking number on file for this shipment: ${ev.shipping.trackingNumber}${ev.shipping.trackingUrl ? ` (${ev.shipping.trackingUrl})` : ""}.`, { color: 60, gap: 8 });
    d.rule();
  }
  if (!ev.communications.length) {
    d.para(`We have no record of the customer contacting our support team (${ev.store.supportEmail ?? "store support"}) about this order before or after filing the dispute. The customer was able to reach us at any time through the contact information published on our store.`);
    return d;
  }
  d.section("Conversations with our support team");
  for (const m of ev.communications) {
    d.section(`${m.direction === "in" ? "From customer" : "From store"} - ${dateEn(m.sentAt, true)}`);
    d.kv("From", m.from); d.kv("To", m.to); d.kv("Subject", m.subject);
    d.para(m.body, { gap: 10 });
    d.rule();
  }
  return d;
}

async function productSection(d: Doc, ev: DisputeEvidence) {
  d.section("Product description");
  for (let i = 0; i < ev.order.items.length; i++) {
    const it = ev.order.items[i];
    const p = ev.products[i];
    d.section(p?.title ?? it.title);
    d.kv("Variant / size", it.variant);
    d.kv("Quantity", String(it.quantity));
    d.kv("Price", it.price ? `${ev.order.currency ?? "USD"} ${it.price}` : null);
    d.kv("SKU", it.sku);
    if (p?.productType) d.kv("Product type", p.productType);
    if (p?.description) { d.y += 4; d.para(p.description); }
    d.rule();
  }
  if (ev.store.domain) d.para(`The product is sold as described on our store (${ev.store.domain}). The item shipped matches the product, variant and quantity purchased.`, { color: 60 });
}

// Comprovante de serviço: dados da compra (com IP do cliente) + descrição do produto.
async function service(ev: DisputeEvidence) {
  const d = new Doc(ev, "Proof of Service");
  d.section("Order");
  d.kv("Order number", ev.order.number);
  d.kv("Order date", dateEn(ev.order.createdAt, true));
  d.kv("Order total", ev.order.total ? `${ev.order.currency ?? "USD"} ${ev.order.total}` : null);
  d.kv("Items", ev.order.items.map((i) => `${i.quantity} x ${i.title}${i.variant ? ` (${i.variant})` : ""}`).join("\n"));
  d.section("Customer");
  d.kv("Name", ev.order.customerName);
  d.kv("Email", ev.order.email);
  d.kv("Phone", ev.order.phone);
  d.kv("Shipping address", ev.order.shippingAddress.join("\n"));
  d.kv("Billing address", ev.order.billingAddress.join("\n"));
  d.section("Payment and verification");
  d.kv("Payment method", ev.payment.method);
  d.kv("Card ending in", ev.payment.last4);
  d.kv("AVS result", ev.payment.avs ? `${ev.payment.avs}${ev.payment.avs === "Y" ? " (street address and ZIP match)" : ""}` : null);
  d.kv("CVV result", ev.payment.cvv ? `${ev.payment.cvv}${ev.payment.cvv === "M" ? " (match)" : ""}` : null);
  d.kv("Purchase IP address", ev.order.ip);
  d.kv("Browser", ev.order.userAgent);
  if (ev.payment.riskLevel) d.kv("Fraud analysis", `${ev.payment.riskLevel.charAt(0)}${ev.payment.riskLevel.slice(1).toLowerCase()} risk`);
  const positive = ev.payment.riskFacts.filter((f) => f.sentiment === "POSITIVE");
  if (positive.length) {
    d.section("Verification checks passed");
    for (const f of positive) d.para(`- ${f.description}`, { gap: 2 });
  }
  if (ev.limited) { d.y += 8; d.para("Note: some order details are unavailable for this order.", { size: 9, color: 110 }); }
  d.y += 6;
  d.rule();
  await productSection(d, ev);
  return d;
}

// Outras provas: as políticas escritas que não entraram nos outros documentos.
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
  d.section("Response to the dispute");
  d.para(rebuttal(ev), { gap: 12 });
  d.rule();
  const rest = ev.policies.filter((p) => p.kind !== "shipping");
  d.section("Store policies");
  if (ev.store.domain) d.para(`The following policies are published on our store (${ev.store.domain}) and were available to the customer at the time of purchase.`, { color: 60, gap: 10 });
  if (!rest.length) d.para("No policy text available.", { color: 110 });
  for (const p of rest) { d.section(p.title); d.para(p.body, { size: 9.5, gap: 12 }); }
  return d;
}

// Gera e baixa um documento.
export async function downloadEvidenceDoc(key: EvidenceDocKey, ev: DisputeEvidence) {
  const file = EVIDENCE_DOCS.find((x) => x.key === key)!.file;
  const doc = key === "communication" ? communication(ev)
    : key === "shipping" ? shipping(ev)
    : key === "service" ? await service(ev)
    : other(ev);
  doc.save(`${(ev.order.number ?? "order").replace(/^#/, "")}_${file}`);
}
