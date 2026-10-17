import { isoDateUS } from "@/lib/timezone";

// Como o rastreio aparece pro cliente na página pública: a marca é sempre a
// Voultie (uma URL pra todas as lojas) e nada pode indicar que o pacote vem da
// China — sem texto em chinês, sem alfândega, sem aeroporto/companhia aérea,
// sem local fora dos EUA.
export const TRACKING_BRAND = { name: "Voultie", logo: "/voultie-logo.png" };

// generic: evento que não pode aparecer como veio (chinês, alfândega, aeroporto…)
// e entrou só como "em trânsito".
// more: outros eventos da mesma leitura (mesmo minuto) e entregas repetidas —
// a página mostra o principal e um "+" pra abrir os outros.
export type DisplayEvent = { at: string | null; description: string; location: string | null; generic?: boolean; more?: DisplayEvent[] };
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

// Estados (e DC/territórios) por extenso, em inglês como o resto da página:
// "CA" sozinho (sem cidade) aparece como "California".
export const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
  DE: "Delaware", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan",
  MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire",
  NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
  OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia",
  WI: "Wisconsin", WY: "Wyoming", DC: "District of Columbia",
  AS: "American Samoa", GU: "Guam", MP: "Northern Mariana Islands", PR: "Puerto Rico", VI: "U.S. Virgin Islands",
};
const STATE_BY_NAME = new Map(Object.entries(STATE_NAMES).map(([abbr, name]) => [name.toLowerCase(), abbr]));
// Nome do estado no fim do local (depois de espaço/vírgula, ou o local inteiro).
const STATE_NAME_RE = new RegExp(`(^|\\s+|\\s*[,，]\\s*)(${[...STATE_BY_NAME.keys()].sort((a, b) => b.length - a.length).map((n) => n.replace(/\./g, "\\.").replace(/ /g, "\\s+")).join("|")})$`, "i");
const US_STATES = new Set(Object.keys(STATE_NAMES));

// Local nos EUA ("Phoenix,AZ", "MA, US", "US, TX 76051"). isUS diz se o lugar é
// nos EUA mesmo sem estado ("US"); display é o que aparece (sem CEP), só com estado.
// Também usada em "Recent deliveries" (public-tracking.server.ts) pra validar a cidade.
export function usPlace(loc: string | null | undefined): { isUS: boolean; display: string | null } {
  // Centro da USPS ("ANAHEIM CA DISTRIBUTION CENTER", "BATON ROUGE LA PROCESSING
  // CENTER") e "Chicago IL" sem vírgula → "ANAHEIM, CA"; "US ALMO,KY" → "ALMO, KY".
  // Estado por extenso ("Scottsdale ARIZONA", "US LAKELAND FLORIDA") → sigla.
  const s = (loc ?? "").trim()
    .replace(/\s+(network\s+|package\s+)?(distribution|processing|logistics|sort(ing)?)\s+(center|facility)$/i, "")
    .replace(/^US\s+(?=[^,，\s])/i, "")
    .replace(STATE_NAME_RE, (_m, sep: string, name: string) => `${sep ? ", " : ""}${STATE_BY_NAME.get(name.toLowerCase().replace(/\s+/g, " "))}`)
    .replace(/^([^,，]+?)\s+([A-Za-z]{2})$/, (m, city, st) => (US_STATES.has(st.toUpperCase()) ? `${city}, ${st}` : m));
  if (!s || HIDDEN_EVENT.test(s)) return { isUS: false, display: null };
  const tokens = s.split(/\s*[,，]\s*/).map((t) => t.replace(/\s*\d{4,5}(-\d{4})?$/, "").trim()).filter(Boolean);
  if (tokens.some((t) => NON_ASCII.test(t))) return { isUS: false, display: null };
  const isCountry = (t: string) => /^(US|USA|UNITED STATES)$/i.test(t);
  const hasCountry = tokens.some(isCountry);
  const rest = tokens.filter((t) => !isCountry(t));
  const state = rest[rest.length - 1]?.toUpperCase();
  if (state && US_STATES.has(state)) {
    // Só o estado (sem cidade): por extenso.
    if (rest.length === 1) return { isUS: true, display: STATE_NAMES[state] };
    return { isUS: true, display: rest.map((p, i) => (i === rest.length - 1 ? p.toUpperCase() : titleCity(p))).join(", ") };
  }
  // "US, Columbia": é nos EUA, mas sem estado reconhecido não mostra local.
  return { isUS: hasCountry, display: null };
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
// Etapas do China Post (em chinês) com nome neutro, os mesmos de EVENT_REWRITES.
// Os nomes seguem a ordem real da entrega (recebido → separado → despachado →
// saiu do centro → liberado pra partir → aguardando partida → partiu → chegou
// → processando → liberado → centros nos EUA), pra a lista não "voltar etapa"
// (ex.: "prepared for dispatch" depois de já ter saído)
// — antes viravam todas "em trânsito" e o cliente via o mesmo texto 4-5 vezes
// seguidas (186 de 1.144 rastreios em 16/10/2026). Vale depois da tradução dos
// eventos nos EUA (translateUsEvent); local só nos EUA. O 1º que casar.
export const CN_NEUTRAL: [RegExp, string][] = [
  [/目的国清关完成|寄达地海关允许进口|进口海关.*放行/, "Processing complete – released for delivery"],
  [/清关异常/, "Shipment being processed – no action needed"],
  [/已妥投|妥投/, "Delivered"],
  [/安排投递|出门投递|(派送|投递)中/, "Out for delivery"],
  [/投递局/, "Arrived at local post office"],
  [/飞机进港/, "Arrived at regional hub"],
  [/到达寄达地/, "Arrived at destination facility"],
  [/到达境外经转局/, "Arrived at sorting facility"],
  [/已交承运商运输/, "Handed over to transport partner"],
  [/航空公司接收/, "Accepted by transport partner"],
  [/等待.*取件|待取件/, "Available for pickup"],
  [/延误|起飞/, "Awaiting departure"],
  [/出口海关.*放行|出口.*放行/, "Shipment cleared for departure"],
  [/送交境外进口海关|进口海关.*(留存|待验|扣留)/, "Shipment being processed – no action needed"],
  [/等待清关|清关中|海关查验/, "Shipment being processed – no action needed"],
  [/^抵达/, "Arrived at regional hub"],
  [/启运/, "Shipment departed sorting hub"],
  [/目的地转运/, "Handed over to local carrier"],
  [/出口清关完成/, "Shipment processed for departure"],
  [/出口直封/, "Shipment sealed for transport"],
  [/送交出口海关/, "Shipment submitted for departure processing"],
  [/交航/, "Handed over to transport partner"],
  [/已收取邮件/, "Package received by carrier"],
  [/完成分拣/, "Package sorted"],
  [/离开.*正在发往/, "Dispatched to next facility"],
  [/到达机场|等待航班/, "Awaiting departure"],
  [/到达处理中心|到达【.*互换局】/, "Arrived at sorting facility"],
  [/离开处理中心/, "Departed sorting facility"],
];

// Local escrito dentro do texto: "【US Texas US， TX 76051】".
// "US New York Brooklyn，NY，US" → "Brooklyn，NY，US": o estado por extenso do
// começo é o do cliente e pode ter duas palavras.
const BRACKET_STATE_RE = new RegExp(`^US\\s+(${[...STATE_BY_NAME.keys()].sort((a, b) => b.length - a.length)
  .map((n) => n.replace(/\./g, "\\.").replace(/ /g, "\\s+")).join("|")})\\s*`, "i");
const bracketPlace = (d: string) => d.match(/【([^】]*)】/)?.[1]?.replace(BRACKET_STATE_RE, "") ?? null;

function translateUsEvent(description: string, location: string | null): { description: string; place: { isUS: boolean; display: string | null } } | null {
  if (CN_HIDDEN.test(description)) return null;
  const fromLoc = usPlace(location);
  const fromText = usPlace(bracketPlace(description));
  const place = fromLoc.display ? fromLoc : fromText.display ? fromText : fromLoc.isUS ? fromLoc : fromText;
  if (!place.isUS) return null;
  const hit = CN_US_PHRASES.find(([re]) => re.test(description));
  return hit ? { description: hit[1], place } : null;
}

// Timeline gravada pelo sync do 17track (event_time_utc/event_detail/event_location).
export function rawEvents(timeline: any[] | null | undefined): DisplayEvent[] {
  return (timeline ?? []).map((e: any) => ({
    at: e?.event_time_utc ? `${String(e.event_time_utc).replace(" ", "T")}Z` : (e?.time_utc ?? null),
    description: String(e?.event_detail ?? e?.description ?? "").trim(),
    location: (e?.event_location || e?.location || null) as string | null,
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
  // Categoria que a USPS põe na frente ("On the Way, Arrived at USPS Facility",
  // "Preparing for Delivery, Arrived at Post Office", "USPS Awaiting Item, …"):
  // ela manda também a versão sem, no mesmo segundo.
  t = t.replace(/^(on the way|preparing for delivery|usps awaiting item|usps in possession of item)[,\s]+(?=\S)/i, "");
  return t;
}

// Texto todo em CAIXA ALTA ("ARRIVED AT USPS FACILITY") → normal ("Arrived at
// USPS facility"), mantendo siglas. Algumas transportadoras mandam cada evento
// em caixa alta e de novo normal — assim viram o mesmo e um some.
const KEEP_UPPER = new Set(["USPS", "UPS", "US", "USA", "GOFO", "DHL", "PO", "ID", "AM", "PM"]);
export function tidyCase(d: string): string {
  if (/[a-z]/.test(d) || !/[A-Z].*[A-Z]/.test(d)) return d;
  const out = d.toLowerCase().replace(/[a-z]+/g, (w) => (KEEP_UPPER.has(w.toUpperCase()) ? w.toUpperCase() : w));
  return out.charAt(0).toUpperCase() + out.slice(1);
}
// Cidade em CAIXA ALTA ("DANVILLE") → "Danville"; sigla do estado continua.
const titleCity = (t: string) => (/[a-z]/.test(t) ? t : t.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()));

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
  // Mais antigo primeiro: nos repetidos (e no "em trânsito" do dia) fica o 1º,
  // quando aconteceu de fato (a cópia que algumas transportadoras mandam horas
  // depois aparecia depois da entrega).
  const ordered = [...events].sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
  // Desde quando o pacote está nos EUA (chegada/alfândega no destino, ou evento
  // de verdade com local de estado americano) — vale cidade sem estado.
  // Evento sem texto ("(中文:)" com local nos EUA) não conta.
  const usSince = ordered.filter((e) => e.at && cleanEventText(e.description ?? "") && (US_ARRIVAL.test(e.description ?? "")
    || (usPlace(e.location).display && !INFO_ONLY.test(e.description ?? "")))).map((e) => e.at!).sort()[0];
  const place = (e: DisplayEvent) => usPlace(e.location).display ?? (usSince && e.at && e.at >= usSince ? cityOnly(e.location) : null);
  for (const e of ordered) {
    let description = tidyCase(cleanEventText(String(e.description ?? "").trim()));
    let location: string | null;
    const manual = description && overrides?.size ? overrides.get(eventTextKey(description)) : undefined;
    const cn = !manual && NON_ASCII.test(description) ? translateUsEvent(description, e.location) : null;
    const cnNeutral = !manual && !cn && NON_ASCII.test(description) ? CN_NEUTRAL.find(([re]) => re.test(description))?.[1] : undefined;
    if (manual) {
      description = manual;
      location = place(e);
    } else if (cn) {
      description = cn.description;
      location = cn.place.display ?? place(e);
    } else if (cnNeutral) {
      description = cnNeutral;
      location = place(e);
    } else if (!description) {
      continue;
    } else if (!NON_ASCII.test(description) && EVENT_REWRITES.some((r) => r.match.test(description))) {
      // Etapa real com nome neutro (voo, alfândega, repasse…): aparece no lugar
      // do "em trânsito" repetido, com o local só se for nos EUA.
      description = EVENT_REWRITES.find((r) => r.match.test(description))!.to;
      location = place(e);
    } else if (NON_ASCII.test(description) || HIDDEN_EVENT.test(description)) {
      // Não some (o cliente vê que o pacote está andando): vira "em trânsito",
      // sem local — um por dia, pra não encher o histórico de linhas iguais.
      const day = e.at ? isoDateUS(e.at) : "";
      if (seen.has(`generic|${day}`)) continue;
      seen.add(`generic|${day}`);
      out.push({ at: e.at, description: LOCAL_TRANSIT, location: null, generic: true });
      continue;
    } else {
      location = place(e);
    }
    out.push({ at: e.at, description: description.charAt(0).toUpperCase() + description.slice(1), location });
  }
  out.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));

  // Etapa que volta: evento mais antigo dizendo que o pacote estava numa etapa
  // MAIS adiantada que um mais novo sai. Algumas transportadoras publicam uma
  // sequência "prevista" (entregue à aérea → partiu → chegou → liberado, todos
  // com o mesmo minuto) dias antes da real, que repete tudo desde a liberação
  // de exportação (ex.: JCZ0907024181DH) — sem isso a lista volta etapa. Roda
  // antes de juntar os repetidos: a prevista tem os mesmos textos da real.
  let minRank = Infinity;
  for (let i = 0; i < out.length; i++) {
    const e = out[i];
    // "Nos EUA" aqui só com local americano: a sequência prevista "chega" antes
    // da hora e faria o armazém da China parecer evento nos EUA.
    const r = e.generic ? null : stageOf(e.description, !!e.location);
    // Manuseio na origem (armazém, triagem) nunca sai.
    if (r == null || r === 1) continue;
    // Evento nos EUA antes de o pacote sair da origem é da sequência prevista.
    if (r === 7) { if (minRank <= 3) out.splice(i--, 1); continue; }
    if (r > minRank) { out.splice(i--, 1); continue; }
    minRank = r;
  }
  // Mesmo texto no mesmo lugar ("Shipment information received" e "…received.")
  // = repetido: fica o 1º, quando aconteceu de fato (a cópia que algumas
  // transportadoras mandam horas depois aparecia depois da entrega). Marco de
  // saída/chegada/liberação repetido fica o mais novo (o da sequência real).
  const keyOf = (e: DisplayEvent) => `${(e.location ?? "").toLowerCase()}|${e.description.toLowerCase().replace(/[.\s]+$/, "")}`;
  const milestone = (e: DisplayEvent) => /transport partner/i.test(e.description) || [2, 3, 4, 5, 6].includes(stageOf(e.description, false) ?? -1);
  const pick = new Map<string, DisplayEvent>();
  for (const e of out) { if (e.generic) continue; const k = keyOf(e); if (!pick.has(k) || !milestone(e)) pick.set(k, e); }
  for (let i = 0; i < out.length; i++) if (!out[i].generic && pick.get(keyOf(out[i])) !== out[i]) out.splice(i--, 1);
  // "Em trânsito" de antes da etiqueta criada não faz sentido (é o aviso de
  // pré-postagem em chinês, ex. "预报订单信息已收到") — sai.
  const labelAt = out.filter((e) => !e.generic && e.at && INFO_ONLY.test(e.description)).map((e) => e.at!).sort()[0];
  // Vale até o 1º movimento real (inclusive no mesmo segundo do aviso, e entre
  // dois avisos: "order info received → em trânsito → label created").
  const firstMove = out.filter((e) => !e.generic && e.at && !INFO_ONLY.test(e.description)).map((e) => e.at!).sort()[0];
  const until = labelAt ? (firstMove && firstMove > labelAt ? firstMove : labelAt) : null;
  const kept = until ? out.filter((e) => !(e.generic && e.at && e.at <= until)) : out;
  // Vários eventos no mesmo minuto (a página mostra hora:minuto) = uma leitura
  // só com vários rótulos ("Parcel Departed" + "Picked Up", "Arrived at
  // facility" + "information received"): aparece um, o que mostra o pacote mais
  // adiantado (empate, o texto mais completo); os outros ficam no "+" dele.
  const minuteOf = (e: DisplayEvent) => (e.at ? isoMinute(e.at) : null);
  const byMin = new Map<string, DisplayEvent>();
  for (const e of kept) {
    const m = minuteOf(e);
    if (!m) continue;
    const cur = byMin.get(m);
    if (!cur || sameScanScore(e) > sameScanScore(cur) || (sameScanScore(e) === sameScanScore(cur) && e.description.length > cur.description.length)) byMin.set(m, e);
  }
  const moreOf = new Map<DisplayEvent, DisplayEvent[]>();
  const addMore = (main: DisplayEvent, e: DisplayEvent) => moreOf.set(main, [...(moreOf.get(main) ?? []), e]);
  for (let i = 0; i < kept.length; i++) {
    const m = minuteOf(kept[i]);
    const main = m ? byMin.get(m) : undefined;
    if (main && main !== kept[i]) { addMore(main, kept[i]); kept.splice(i--, 1); }
  }
  // Uma entrega à vista: algumas transportadoras mandam "Delivered" e horas
  // depois "Delivered. (Recipient's front door)" — aparece a 1ª (a hora de
  // verdade) e as outras ficam no "+" dela.
  const deliveries = kept.filter((e) => sameScanScore(e) === 9);
  const firstDelivery = deliveries[deliveries.length - 1];
  for (const e of deliveries.slice(0, -1)) { addMore(firstDelivery, e); for (const x of moreOf.get(e) ?? []) addMore(firstDelivery, x); kept.splice(kept.indexOf(e), 1); }
  for (let i = 0; i < kept.length; i++) {
    const more = moreOf.get(kept[i]);
    if (more?.length) kept[i] = { ...kept[i], more: more.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? "")) };
  }
  // "Em trânsito" em dias seguidos com o mesmo texto parece pacote parado: cada
  // um da sequência ganha um texto diferente (do mais antigo pro mais novo).
  for (let i = kept.length - 1, k = 0; i >= 0; i--) {
    if (!kept[i].generic) { k = 0; continue; }
    kept[i] = { ...kept[i], description: TRANSIT_VARIANTS[k++ % TRANSIT_VARIANTS.length] };
  }
  return kept;
}
export const LOCAL_TRANSIT = "In transit to local facility";
// "2026-09-08T16:41:17Z" → "2026-09-08T16:41" (o que a página mostra).
const isoMinute = (at: string) => { const d = new Date(at); return Number.isNaN(d.getTime()) ? at.slice(0, 16) : d.toISOString().slice(0, 16); };
// Quanto o texto mostra o pacote adiantado (pra escolher um entre eventos do
// mesmo segundo).
function sameScanScore(e: DisplayEvent): number {
  const d = e.description;
  if (e.generic) return 0;
  if (/^delivered\b(?!\s+to\b)|has been delivered/i.test(d)) return 9;
  if (/out for delivery/i.test(d)) return 8;
  if (/available for pickup|post office/i.test(d)) return 7;
  if (/departed|leave|left|dispatched|in transit|moving|on the way|handed over/i.test(d)) return 5;
  if (/arrived|arrival|received at|inbound|scan|accepted|processed|processing|sorted|outbound/i.test(d)) return 4;
  if (/picked up|received by carrier/i.test(d)) return 3;
  if (INFO_ONLY.test(d)) return 1;
  return 2;
}
// Etapa de cada texto mostrado, na ordem da entrega (usada pra tirar o que
// "volta etapa"). null = sem etapa (o "em trânsito" genérico e textos soltos).
// inUS: evento com local nos EUA ou depois da chegada — conta como etapa final.
const STAGES: [RegExp, number][] = [
  [/information received|info received|label created|order created|order received|electronic information|pre-shipment|preparing shipment|order info/i, 0],
  [/processing complete|released for delivery/i, 6],
  [/being processed/i, 5],
  [/arrived at regional hub|destination hub|destination facility/i, 4],
  [/departed sorting hub/i, 3],
  // Entrega à aérea vem antes ou depois da liberação, conforme a transportadora:
  // não decide ordem (fica como manuseio, que nunca sai).
  [/handed over to transport partner|accepted by transport partner/i, 1],
  [/for departure|sealed for transport|awaiting departure|departure rescheduled|airway bill|departure airport|flight/i, 2],
  [/handed over to local carrier|post office|postal service|usps|gofo|gateway|out for delivery|delivered|delivery|loaded on vehicle/i, 7],
  [/received by carrier|picked up|sorted|sorting|sort facility|warehouse|consignment|transit point|dispatched to next facility|inbound|outbound|processed through facility/i, 1],
];
export function stageOf(description: string, inUS: boolean): number | null {
  const hit = STAGES.find(([re]) => re.test(description))?.[1] ?? null;
  if (hit === 0 || hit == null) return null; // informação recebida vem fora de ordem às vezes — não tira nada por ela
  return inUS && hit < 7 && hit !== 5 && hit !== 6 ? (hit === 1 ? 7 : hit) : hit;
}
// Textos do "em trânsito" em sequência (o 1º é o de sempre).
export const TRANSIT_VARIANTS = [LOCAL_TRANSIT, "Shipment in transit", "Package moving through carrier network", "Shipment on the way"];
// Já chegou nos EUA: a partir daqui o local que vem só com a cidade ("Atlanta",
// "Los Angeles") aparece — antes disso pode ser cidade da China.
const US_ARRIVAL = /arrived at destination airport|shipment arrived at airport|clearance in progress|under clearance|at destination|import released|inbound into customs|^delivered to\b|抵达【US】|【美国】|目的国|目的地转运/i;
// Local que veio só com a cidade (sem estado): fica se não for da China/código.
function cityOnly(loc: string | null | undefined): string | null {
  const s = (loc ?? "").trim().replace(/\s*\d{5}(-\d{4})?$/, "").replace(/[,\s]+(US|USA)$/i, "").trim();
  // Nome de galpão/código ("USPS Facility", "ORD HUB", "EWR_JFK Warehouse",
  // "Delivery Location", "IND.H") não é cidade.
  if (!s || NON_ASCII.test(s) || HIDDEN_EVENT.test(s) || /^[A-Z]{3}$/.test(s) || /^(US|USA)$/i.test(s)
    || /facility|location|\bhub\b|warehouse|center|station|[_.]/i.test(s)) return null;
  return s;
}
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
  { match: /^(customs clearance to release|clearance processing completed at destination|import released|inbound out of customs)/i,
    from: ["Customs clearance to release", "Clearance processing completed at destination", "Import Released", "Inbound Out of Customs"], to: "Processing complete – released for delivery" },
  // Saída da origem: cada etapa com um nome diferente (o mesmo texto em
  // sequência parece pacote parado).
  { match: /^export customs clearance completed/i, from: ["Export customs clearance completed"], to: "Shipment processed for departure" },
  { match: /^(released by customs at origin|export released)/i, from: ["Released by customs at origin", "Export Released"], to: "Shipment cleared for departure" },
  { match: /^hand(ed)? over to airline/i, from: ["Hand over to airline"], to: "Handed over to transport partner" },
  // Devolução ao remetente não é entrega (antes aparecia "Delivered", #WV1294).
  { match: /^delivered,?\s+to\s+(the\s+)?original sender|^return(ed)? to sender/i, from: ["Delivered, To Original Sender", "Return to Sender"], to: "Returned to sender" },
  { match: /^delivered to\b/i, from: ["Delivered to local carrier"], to: "Handed over to local carrier" },
  // Atraso de voo, qualquer mês ("Flight delayed. Estimated departure: Nov.3").
  { match: /^flight delay/i, from: ["Flight delayed. Estimated departure: Oct.11", "flight delay"], to: "Departure rescheduled" },
  { match: /^parcel received by in [a-z]{3}\d*\.?$/i, from: ["Parcel received by in JFK01."], to: "Received at distribution center" },
  { match: /^parcel departed from facility\.?$/i, from: ["Parcel departed from Facility."], to: "Departed facility" },
  { match: /^acceptance\.?$/i, from: ["Acceptance"], to: "Package received by carrier" },
];

const INFO_ONLY = /information received|info received|label created|pre-shipment|electronic information|order created|order received|shipment information|preparing shipment/i;
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
