import { isoDateUS } from "@/lib/timezone";

// Como o rastreio aparece pro cliente na página pública: a marca é sempre a
// Voultie (uma URL pra todas as lojas) e nada pode indicar que o pacote vem da
// China — sem texto em chinês, sem alfândega, sem aeroporto/companhia aérea,
// sem local fora dos EUA.
export const TRACKING_BRAND = { name: "Voultie", logo: "/voultie-logo.png" };

// generic: evento que não pode aparecer como veio (chinês, alfândega, aeroporto…)
// e entrou só como "em trânsito".
export type DisplayEvent = { at: string | null; description: string; location: string | null; generic?: boolean };
export type DisplayStep = { label: string; at: string | null };

// Qualquer caractere fora do ASCII (chinês, ou texto corrompido como "预报订�…").
const NON_ASCII = /[^\x20-\x7E]/;
// Palavras que escondem o evento (viram "em trânsito"). Exportadas pra aba
// Configurações › Rastreamento mostrar as regras.
export const HIDDEN_WORDS = [
  "custom", "clearance", "import", "export", "duty", "tax",
  "china", "chinese", "\\bcn\\b", "shenzhen", "shanghai", "guangzhou", "dongguan", "yiwu", "hangzhou", "hong ?kong", "beijing", "ningbo", "xiamen",
  "origin country", "country of origin", "\\borigin\\b", "starting port", "departure port", "port of departure",
  "airline", "airport", "flight", "air ?way ?bill", "\\bawb\\b", "\\bmawb\\b",
  "international", "abroad", "overseas",
];
const HIDDEN_EVENT = new RegExp(HIDDEN_WORDS.join("|"), "i");

const US_STATES = new Set("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC PR".split(" "));

// Local nos EUA ("Phoenix,AZ", "MA, US", "US, TX 76051"). isUS diz se o lugar é
// nos EUA mesmo sem estado ("US"); display é o que aparece (sem CEP), só com estado.
// Também usada em "Recent deliveries" (public-tracking.server.ts) pra validar a cidade.
export function usPlace(loc: string | null | undefined): { isUS: boolean; display: string | null } {
  // Centro da USPS ("ANAHEIM CA DISTRIBUTION CENTER", "BATON ROUGE LA PROCESSING
  // CENTER") e "Chicago IL" sem vírgula → "ANAHEIM, CA"; "US ALMO,KY" → "ALMO, KY".
  const s = (loc ?? "").trim()
    .replace(/\s+(network\s+)?(distribution|processing|sort(ing)?)\s+(center|facility)$/i, "")
    .replace(/^US\s+(?=[^,，]+[,，])/i, "")
    .replace(/^([^,，]+?)\s+([A-Za-z]{2})$/, (m, city, st) => (US_STATES.has(st.toUpperCase()) ? `${city}, ${st}` : m));
  if (!s || HIDDEN_EVENT.test(s)) return { isUS: false, display: null };
  const tokens = s.split(/\s*[,，]\s*/).map((t) => t.replace(/\s*\d{5}(-\d{4})?$/, "").trim()).filter(Boolean);
  if (tokens.some((t) => NON_ASCII.test(t))) return { isUS: false, display: null };
  const isCountry = (t: string) => /^(US|USA|UNITED STATES)$/i.test(t);
  const hasCountry = tokens.some(isCountry);
  const rest = tokens.filter((t) => !isCountry(t));
  const state = rest[rest.length - 1]?.toUpperCase();
  if (state && US_STATES.has(state)) {
    return { isUS: true, display: rest.map((p, i) => (i === rest.length - 1 ? p.toUpperCase() : p)).join(", ") };
  }
  return { isUS: hasCountry && rest.length === 0, display: null };
}

// Correios chineses (China Post/EMS) mandam tudo em chinês, inclusive o que já
// acontece nos EUA ("邮件到达处理中心【US Texas US， TX 76051】"). Só as frases
// de movimentação dentro dos EUA são traduzidas; o resto (alfândega, aeroporto,
// partida, qualquer coisa na China) continua escondido.
export const CN_HIDDEN = /海关|清关|机场|航班|启运|出口|进口|中国|国际|抵达|离开.*国|直封|交航|运抵/;
export const CN_US_PHRASES: [RegExp, string][] = [
  [/投递失败|未妥投|无法投递|投递不成功/, "Delivery attempted"],
  [/妥投|已签收|签收/, "Delivered"],
  [/(派送|投递)中|正在(派送|投递)|安排投递|开始投递|出门投递/, "Out for delivery"],
  [/离开处理中心|离开.*中心/, "Departed sorting facility"],
  [/到达处理中心|到达.*中心/, "Arrived at sorting facility"],
];
// Local escrito dentro do texto: "【US Texas US， TX 76051】".
const bracketPlace = (d: string) => d.match(/【([^】]*)】/)?.[1]?.replace(/^US\s+\w+\s+/i, "") ?? null;

function translateUsEvent(description: string, location: string | null): { description: string; place: { isUS: boolean; display: string | null } } | null {
  if (CN_HIDDEN.test(description)) return null;
  const fromLoc = usPlace(location);
  const fromText = usPlace(bracketPlace(description));
  const place = fromLoc.display ? fromLoc : fromText.display ? fromText : fromLoc.isUS ? fromLoc : fromText;
  if (!place.isUS) return null;
  const hit = CN_US_PHRASES.find(([re]) => re.test(description));
  return hit ? { description: hit[1], place } : null;
}

// Timeline gravada pelo sync (event_time_utc/event_detail) — e o formato antigo
// do Track123 (eventTimeZeroUTC/eventDetail), que ainda existe em pedidos antigos.
export function rawEvents(timeline: any[] | null | undefined): DisplayEvent[] {
  return (timeline ?? []).map((e: any) => ({
    at: e?.event_time_utc ? `${String(e.event_time_utc).replace(" ", "T")}Z` : (e?.eventTimeZeroUTC ?? e?.time_utc ?? null),
    description: String(e?.event_detail ?? e?.eventDetail ?? e?.description ?? "").trim(),
    location: (e?.event_location || e?.address || e?.location || null) as string | null,
  }));
}

// "MA, US, Parcel has been delivered." → tira o prefixo de local do texto; e a
// cópia "(中文:…)" que a transportadora repete no fim ("Delivered. Position: Front door(中文:…)").
const stripLocationPrefix = (d: string) => d.replace(/\s*[(（]中文[:：][^)）]*[)）]?\s*$/, "").replace(/^([A-Za-z .]+,\s*)?(US|USA)\s*,\s*/i, "").trim();

// Limpeza do texto antes das regras:
//  - texto colado duas vezes ("Shipment information received.Shipment information received.");
//  - frase longa da USPS depois de " -> " ("On the Way, Departed USPS Facility -> Your item
//    departed our USPS facility in … origin facility…") — o "origin" dela escondia o evento;
//  - contato da transportadora ("…For Delivery Issues & Tracking Support, Contact GOFO at +1 949…").
export function cleanEventText(d: string): string {
  let t = stripLocationPrefix(d).split(/\s+->\s+/)[0].replace(/[.,]?\s*for delivery issues\b.*$/i, "").trim();
  const half = t.length / 2;
  if (t.length >= 10 && Number.isInteger(half) && t.slice(0, half) === t.slice(half)) t = t.slice(0, half).trim();
  return t;
}

// Chave do texto pros textos trocados na mão (Configurações › Rastreamento ›
// Textos): sem maiúscula/minúscula, ponto final e números (datas, horários) —
// "Flight delayed. Estimated departure: Oct.11" e "…Oct.13" são o mesmo texto.
export function eventTextKey(d: string): string {
  return cleanEventText(d).toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").replace(/[.\s]+$/, "").trim();
}

// overrides: textos trocados na mão (chave = eventTextKey) — valem antes de
// qualquer outra regra; o local continua o que vem (só nos EUA).
export function sanitizeEvents(events: DisplayEvent[], overrides?: Map<string, string>): DisplayEvent[] {
  const seen = new Set<string>();
  const out: DisplayEvent[] = [];
  // Mais novo primeiro: nos repetidos (e no "em trânsito" do dia) fica o mais recente.
  const ordered = [...events].sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  for (const e of ordered) {
    let description = cleanEventText(String(e.description ?? "").trim());
    let location: string | null;
    const manual = description && overrides?.size ? overrides.get(eventTextKey(description)) : undefined;
    const cn = !manual && NON_ASCII.test(description) ? translateUsEvent(description, e.location) : null;
    if (manual) {
      description = manual;
      location = usPlace(e.location).display;
    } else if (cn) {
      description = cn.description;
      location = cn.place.display;
    } else if (!description) {
      continue;
    } else if (!NON_ASCII.test(description) && EVENT_REWRITES.some((r) => r.match.test(description))) {
      // Etapa real com nome neutro (voo, alfândega, repasse…): aparece no lugar
      // do "em trânsito" repetido, com o local só se for nos EUA.
      description = EVENT_REWRITES.find((r) => r.match.test(description))!.to;
      location = usPlace(e.location).display;
    } else if (NON_ASCII.test(description) || HIDDEN_EVENT.test(description)) {
      // Não some (o cliente vê que o pacote está andando): vira "em trânsito",
      // sem local — um por dia, pra não encher o histórico de linhas iguais.
      const day = e.at ? isoDateUS(e.at) : "";
      if (seen.has(`generic|${day}`)) continue;
      seen.add(`generic|${day}`);
      out.push({ at: e.at, description: LOCAL_TRANSIT, location: null, generic: true });
      continue;
    } else {
      location = usPlace(e.location).display;
    }
    // Mesmo texto no mesmo lugar ("Shipment information received" e "…received.") = repetido.
    const key = `${location}|${description.toLowerCase().replace(/[.\s]+$/, "")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ at: e.at, description: description.charAt(0).toUpperCase() + description.slice(1), location });
  }
  out.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  // "Em trânsito" de antes da etiqueta criada não faz sentido (é o aviso de
  // pré-postagem em chinês, ex. "预报订单信息已收到") — sai.
  const labelAt = out.filter((e) => !e.generic && e.at && INFO_ONLY.test(e.description)).map((e) => e.at!).sort()[0];
  return labelAt ? out.filter((e) => !(e.generic && e.at && e.at < labelAt)) : out;
}
export const LOCAL_TRANSIT = "In transit to local facility";
// Textos em inglês trocados antes de aparecer pro cliente (o 1º que casar).
// Etapas reais com nome neutro — continua verdade e não fala de voo/alfândega —
// pra o cliente não ver o mesmo "em trânsito" dias seguidos e achar que parou.
// Saída da origem fica separada da liberação no destino: "Export…"/"at origin"
// não é "released for delivery". `from` = exemplos reais (mostrados na aba
// Configurações › Rastreamento).
//  - "Delivered to local carrier" é repasse entre transportadoras, não entrega
//    — pro cliente não achar que já chegou;
//  - "Acceptance" = postagem (o correio recebeu o pacote).
export const EVENT_REWRITES: { match: RegExp; from: string[]; to: string }[] = [
  { match: /^departed from (the )?(airport of origin|origin country)|departure from the starting port|^in transit - departure\.?$/i,
    from: ["Departed from airport of Origin", "Departed from Origin Country", "Departure from the starting port"], to: "Shipment departed sorting hub" },
  { match: /arrived at destination airport|shipment arrived at airport/i,
    from: ["Arrived at destination airport", "Shipment arrived at airport"], to: "Arrived at regional hub" },
  { match: /^(customs clearance in progress|under clearance|started the customs clearance process at destination|inbound into customs)/i,
    from: ["Customs clearance in progress", "Under Clearance", "Started the customs clearance process at destination", "Inbound Into Customs"], to: "Shipment being processed – no action needed" },
  { match: /^(customs clearance to release|clearance processing completed at destination|import released)/i,
    from: ["Customs clearance to release", "Clearance processing completed at destination", "Import Released"], to: "Processing complete – released for delivery" },
  { match: /^delivered to\b/i, from: ["Delivered to local carrier"], to: "Handed over to local carrier" },
  { match: /^parcel received by in [a-z]{3}\d*\.?$/i, from: ["Parcel received by in JFK01."], to: "Received at distribution center" },
  { match: /^parcel departed from facility\.?$/i, from: ["Parcel departed from Facility."], to: "Departed facility" },
  { match: /^acceptance\.?$/i, from: ["Acceptance"], to: "Package received by carrier" },
];

const INFO_ONLY = /information received|info received|label created|pre-shipment|electronic information|order created|shipment information/i;
const OUT_FOR_DELIVERY = /out for delivery/i;
// Entrega ao cliente ("Delivered, Front Door", "Parcel has been delivered") —
// não "Delivered to local carrier" (repasse; na tela vira "Handed over to local carrier").
const DELIVERED = /^delivered\b(?!\s+to\b)|has been delivered/i;

// Etapas: Ordered · Order Ready · In Transit · Out for Delivery · Delivered,
// com a data de quando cada uma aconteceu — pelos eventos que o cliente vê.
export function buildSteps(opts: { orderedAt: string | null; deliveredAt: string | null; status: string | null; events: DisplayEvent[] }) {
  const asc = sanitizeEvents(opts.events).filter((e) => e.at).sort((a, b) => a.at!.localeCompare(b.at!));
  const first = (re?: RegExp, not?: RegExp) => asc.find((e) => (!re || re.test(e.description)) && (!not || !not.test(e.description)))?.at ?? null;
  const ready = first();
  const transit = first(undefined, INFO_ONLY);
  const ofd = first(OUT_FOR_DELIVERY);
  // A etapa "Delivered" só acende com entrega confirmada (status do rastreio ou
  // data de entrega no pedido) — nunca só porque um texto começa com "Delivered".
  const isDelivered = !!opts.deliveredAt || opts.status === "Delivered";
  const delivered = isDelivered ? opts.deliveredAt ?? first(DELIVERED) ?? asc[asc.length - 1]?.at ?? null : null;
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
  steps.forEach((s, i) => { if (s.at && i > current && i < 4) current = i; });
  if (isDelivered) current = 4;
  return { steps, current };
}

// Previsão de entrega: só a oficial da transportadora (não a estimada pela IA do
// 17track nem regra própria). O 17track marca a origem em `source`.
export type DisplayEdd = { from: string | null; to: string | null };
export function officialEdd(edd: { source: string | null; from: string | null; to: string | null } | null | undefined): DisplayEdd | null {
  if (!edd || !(edd.from || edd.to)) return null;
  if (!/official|carrier/i.test(edd.source ?? "")) return null;
  return { from: edd.from, to: edd.to };
}
