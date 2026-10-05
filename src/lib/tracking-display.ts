// Como o rastreio aparece pro cliente na página pública: a marca é sempre a
// Voultie (uma URL pra todas as lojas) e nada pode indicar que o pacote vem da
// China — sem texto em chinês, sem alfândega, sem aeroporto/companhia aérea,
// sem local fora dos EUA.
export const TRACKING_BRAND = { name: "Voultie", logo: "/voultie-logo.png" };

export type DisplayEvent = { at: string | null; description: string; location: string | null };
export type DisplayStep = { label: string; at: string | null };

// Qualquer caractere fora do ASCII (chinês, ou texto corrompido como "预报订�…").
const NON_ASCII = /[^\x20-\x7E]/;
const HIDDEN_EVENT = new RegExp([
  "custom", "clearance", "import", "export", "duty", "tax",
  "china", "chinese", "\\bcn\\b", "shenzhen", "shanghai", "guangzhou", "dongguan", "yiwu", "hangzhou", "hong ?kong", "beijing", "ningbo", "xiamen",
  "origin country", "country of origin", "\\borigin\\b", "starting port", "departure port", "port of departure",
  "airline", "airport", "flight", "air ?way ?bill", "\\bawb\\b", "\\bmawb\\b",
  "international", "abroad", "overseas",
].join("|"), "i");

const US_STATES = new Set("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC PR".split(" "));

// Só mostra local que é claramente nos EUA ("Phoenix,AZ", "MA, US"); o resto some.
function usLocation(loc: string | null | undefined): string | null {
  const s = (loc ?? "").trim();
  if (!s || NON_ASCII.test(s) || HIDDEN_EVENT.test(s)) return null;
  const parts = s.split(/\s*,\s*/).filter(Boolean);
  const last = parts[parts.length - 1]?.toUpperCase();
  const country = last === "US" || last === "USA" || last === "UNITED STATES";
  const rest = country ? parts.slice(0, -1) : parts;
  const state = rest[rest.length - 1]?.toUpperCase();
  if (state && US_STATES.has(state)) return rest.map((p, i) => (i === rest.length - 1 ? p.toUpperCase() : p)).join(", ");
  return null;
}

// "MA, US, Parcel has been delivered." → tira o prefixo de local do texto.
const stripLocationPrefix = (d: string) => d.replace(/^([A-Za-z .]+,\s*)?(US|USA)\s*,\s*/i, "").trim();

export function sanitizeEvents(events: DisplayEvent[]): DisplayEvent[] {
  const seen = new Set<string>();
  const out: DisplayEvent[] = [];
  for (const e of events) {
    const description = stripLocationPrefix(String(e.description ?? "").trim());
    if (!description || NON_ASCII.test(description) || HIDDEN_EVENT.test(description)) continue;
    const location = usLocation(e.location);
    // Mesmo texto no mesmo lugar ("Shipment information received" e "…received.") = repetido.
    const key = `${location}|${description.toLowerCase().replace(/[.\s]+$/, "")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ at: e.at, description: description.charAt(0).toUpperCase() + description.slice(1), location });
  }
  return out.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
}

const INFO_ONLY = /information received|info received|label created|pre-shipment|electronic information|order created|shipment information/i;
const OUT_FOR_DELIVERY = /out for delivery/i;
const DELIVERED = /^delivered\b|has been delivered|\bdelivered,/i;

// Etapas: Ordered · Order Ready · In Transit · Out for Delivery · Delivered,
// com a data de quando cada uma aconteceu — pelos eventos já filtrados, pra data
// nunca vir de um evento que o cliente não vê.
export function buildSteps(opts: { orderedAt: string | null; deliveredAt: string | null; status: string | null; events: DisplayEvent[] }) {
  const asc = sanitizeEvents(opts.events).filter((e) => e.at).sort((a, b) => a.at!.localeCompare(b.at!));
  const first = (re?: RegExp, not?: RegExp) => asc.find((e) => (!re || re.test(e.description)) && (!not || !not.test(e.description)))?.at ?? null;
  const ready = first();
  const transit = first(undefined, INFO_ONLY);
  const ofd = first(OUT_FOR_DELIVERY);
  const delivered = opts.deliveredAt ?? first(DELIVERED);
  const steps: DisplayStep[] = [
    { label: "Ordered", at: opts.orderedAt },
    { label: "Order Ready", at: ready },
    { label: "In Transit", at: transit },
    { label: "Out for Delivery", at: ofd },
    { label: "Delivered", at: delivered },
  ];
  const byStatus: Record<string, number> = {
    InfoReceived: 1, NotFound: 1, InTransit: 2, Exception: 2, Expired: 2,
    OutForDelivery: 3, AvailableForPickup: 3, DeliveryFailure: 3, Delivered: 4,
  };
  // Etapa atual: a mais adiantada entre o status e as datas que já existem.
  let current = opts.status ? byStatus[opts.status] ?? 0 : 0;
  steps.forEach((s, i) => { if (s.at && i > current) current = i; });
  if (delivered) current = 4;
  return { steps, current };
}
