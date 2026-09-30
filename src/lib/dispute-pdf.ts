import { jsPDF } from "jspdf";
import type { DisputeEvidence } from "@/lib/dispute-evidence.functions";

// PDFs da resposta de chargeback (aba Chargebacks > "Documentos para a
// Shopify"): um arquivo por tipo de prova, em inglês (quem lê é o banco nos EUA).
// Gerados no navegador com jsPDF.

const REASON_EN: Record<string, string> = {
  product_not_received: "Product not received", product_unacceptable: "Product unacceptable / not as described",
  fraudulent: "Fraudulent", unrecognized: "Unrecognized", duplicate: "Duplicate", credit_not_processed: "Credit not processed",
  subscription_canceled: "Subscription canceled", general: "General", customer_initiated: "Customer initiated",
};

export const EVIDENCE_DOCS = [
  { key: "shipping", file: "Shipping_Documentation.pdf", label: "Comprovante de envio / rastreio" },
  { key: "communication", file: "Customer_Communication.pdf", label: "Comunicação com o cliente" },
  { key: "product", file: "Product_Description.pdf", label: "Descrição do produto" },
  { key: "order", file: "Order_Details.pdf", label: "Dados da compra" },
  { key: "policy", file: "Refund_Policy.pdf", label: "Política de reembolso / troca" },
  { key: "rebuttal", file: "Rebuttal_Letter.pdf", label: "Texto de defesa" },
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
  image(dataUrl: string, maxW = 200, maxH = 200) {
    const props = this.pdf.getImageProperties(dataUrl);
    const k = Math.min(maxW / props.width, maxH / props.height, 1);
    const w = props.width * k, h = props.height * k;
    this.ensure(h + 10);
    this.pdf.addImage(dataUrl, "JPEG", this.m, this.y, w, h);
    this.y += h + 10;
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

// Foto → JPEG (via canvas) pra caber no PDF; sem permissão de acesso (CORS), fica sem foto.
async function imageAsJpeg(url: string): Promise<string | null> {
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise<void>((ok, fail) => { img.onload = () => ok(); img.onerror = () => fail(new Error("img")); img.src = url; });
    const scale = Math.min(1, 900 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.85);
  } catch { return null; }
}

function shipping(ev: DisputeEvidence) {
  const d = new Doc(ev, "Shipping Documentation");
  d.section("Shipment");
  d.kv("Carrier", ev.shipping.carrier);
  d.kv("Tracking number", ev.shipping.trackingNumber);
  d.kv("Tracking link", ev.shipping.trackingUrl);
  d.kv("Shipped on", dateEn(ev.shipping.shippedAt));
  d.kv("Current status", ev.shipping.status);
  if (ev.shipping.deliveredAt) d.kv("Delivered on", dateEn(ev.shipping.deliveredAt, true));
  d.section("Shipping address");
  d.para(ev.order.shippingAddress.join("\n") || "-");
  d.section(`Tracking history (${ev.shipping.events.length} events, most recent first)`);
  if (!ev.shipping.events.length) d.para("No carrier events available.", { color: 110 });
  for (const e of ev.shipping.events) {
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
  if (!ev.communications.length) {
    d.para(`We have no record of the customer contacting our support team (${ev.store.supportEmail ?? "store support"}) about this order before or after filing the dispute. The customer was able to reach us at any time through the contact information published on our store.`);
    return d;
  }
  for (const m of ev.communications) {
    d.section(`${m.direction === "in" ? "From customer" : "From store"} - ${dateEn(m.sentAt, true)}`);
    d.kv("From", m.from); d.kv("To", m.to); d.kv("Subject", m.subject);
    d.para(m.body, { gap: 10 });
    d.rule();
  }
  return d;
}

async function product(ev: DisputeEvidence) {
  const d = new Doc(ev, "Product Description");
  for (let i = 0; i < ev.order.items.length; i++) {
    const it = ev.order.items[i];
    const p = ev.products[i];
    d.section(p?.title ?? it.title);
    const img = p?.imageUrl ? await imageAsJpeg(p.imageUrl) : null;
    if (img) d.image(img, 220, 220);
    d.kv("Variant / size", it.variant);
    d.kv("Quantity", String(it.quantity));
    d.kv("Price", it.price ? `${ev.order.currency ?? "USD"} ${it.price}` : null);
    d.kv("SKU", it.sku);
    if (p?.productType) d.kv("Product type", p.productType);
    if (p?.description) { d.y += 4; d.para(p.description); }
    d.rule();
  }
  if (ev.store.domain) d.para(`The product is sold as described on our store (${ev.store.domain}). The item shipped matches the product, variant and quantity purchased.`, { color: 60 });
  return d;
}

function order(ev: DisputeEvidence) {
  const d = new Doc(ev, "Order Details");
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
  return d;
}

function policy(ev: DisputeEvidence) {
  const d = new Doc(ev, "Refund and Shipping Policy");
  if (ev.store.domain) d.para(`The following policies are published on our store (${ev.store.domain}) and were available to the customer at the time of purchase.`, { color: 60, gap: 10 });
  if (!ev.policies.length) d.para("No policy text available.", { color: 110 });
  for (const p of ev.policies) { d.section(p.title); d.para(p.body, { size: 9.5, gap: 12 }); }
  return d;
}

function rebuttal(ev: DisputeEvidence, text: string) {
  const d = new Doc(ev, "Dispute Response");
  d.para(text, { gap: 12 });
  d.para(`${ev.store.name}${ev.store.supportEmail ? ` - ${ev.store.supportEmail}` : ""}`, { color: 60 });
  return d;
}

// Gera e baixa um documento. O de defesa usa o texto (revisado) passado aqui.
export async function downloadEvidenceDoc(key: EvidenceDocKey, ev: DisputeEvidence, rebuttalText?: string) {
  const file = EVIDENCE_DOCS.find((x) => x.key === key)!.file;
  const doc = key === "shipping" ? shipping(ev)
    : key === "communication" ? communication(ev)
    : key === "product" ? await product(ev)
    : key === "order" ? order(ev)
    : key === "policy" ? policy(ev)
    : rebuttal(ev, rebuttalText ?? "");
  doc.save(`${(ev.order.number ?? "order").replace(/^#/, "")}_${file}`);
}
