// Transportadora local dos EUA (última milha) de cada pacote, pelo jeito dos
// eventos do rastreio — o 17track não manda o nome dela. Regras:
//  - GOFO: "GOFO" no texto ou o telefone dela (+1 949 688-6032);
//  - USPS: "USPS" / "Arrived at Post Office", (só eventos dela — aviso de etiqueta e número reservado não contam);
//    o código local (misc_info.local_number do 17track) vem na USPS e no YunTu
//    (TRF0… da Transfly ou TYHZ…); o da GOFO (GFUS…) vem do site dela
//    (gofo.server.ts); as sem nome não têm;
//  - Sem nome (juntas, a pedido do usuário em 05/11/2026 — o rastreio não diz
//    quem é): eventos traduzidos "(中文:…)" (Linden NJ, Montebello CA);
//    "Parcel received by in JFK01/ORD/NJC…"; trecho dos EUA do ZS/China Post
//    em chinês ("【US …】");
//  - "Delivered to local carrier", liberado na alfândega ou "In transit to local
//    Post Office" (JCEX) e nenhum evento da local: aguardando transportadora local;
//  - repassado, com eventos depois e nenhum padrão acima: não reconhecida (avisar).
// Início do trecho local = evento de repasse, ou o 1º evento com o padrão.

export const LOCAL_CARRIERS = [
  { key: "USPS", label: "USPS" },
  { key: "GOFO", label: "GOFO Express" },
  { key: "SEM_NOME", label: "Sem nome", hint: "a transportadora não aparece no rastreio" },
  { key: "NAO_RECONHECIDA", label: "Não reconhecida", hint: "repassado, mas os eventos não batem com nenhuma conhecida" },
  { key: "AGUARDANDO", label: "Aguardando transportadora local", hint: "liberado na alfândega / repassado, sem evento dela ainda" },
] as const;
export type LocalCarrierKey = (typeof LOCAL_CARRIERS)[number]["key"];
export const localCarrierLabel = (k: string) => LOCAL_CARRIERS.find((c) => c.key === k)?.label ?? k;
export const localCarrierHint = (k: string) => (LOCAL_CARRIERS.find((c) => c.key === k) as any)?.hint as string | undefined;

export const HANDOFF = /^delivered to (local )?carrier|handed over to (the )?(local|last[- ]mile)/i;
export const GOFO_EVENT = /GOFO|949 688-6032/i;
const SIGS: [LocalCarrierKey, RegExp][] = [
  ["GOFO", GOFO_EVENT],
  // "In transit to local Post Office" é da JCEX antes de repassar (vem antes da
  // GOFO também) — não é USPS.
  ["USPS", /\bUSPS\b|(arrived at|picked up at) post office/i],
  ["SEM_NOME", /^Parcel (received by|departed from facility|is out for delivery|has been delivered)/i],
  ["SEM_NOME", /\(中文:\s*[^)\s]|^Delivered\. Position:/i],   // "(中文:)" vazio é lixo, não conta
  // Centro de distribuição / entrega nos EUA (alfândega "邮件到达【美国】海关" não conta).
  ["SEM_NOME", /(处理中心|投递|妥投)【(US|美国)|【(US|美国)[^】]*】\s*(已妥投|出门投递|投递)/],
];
// USPS: 92…–95… (22+ dígitos), às vezes com "420"+CEP na frente (código de 30).
const USPS_NUMBER = /^(?:420\d{5}(?:\d{4})?)?(9[2-5]\d{18,24})$/;
const uspsCore = (n: string) => n.match(USPS_NUMBER)?.[1] ?? null;

export type LocalLeg = { key: LocalCarrierKey; startTs: number; deliveredTs: number | null };

const US_SIDE = new Set<string>(["chegada_eua", "alfandega_entrada", "alfandega_saida"]);
// JCEX avisa que vai repassar ("In transit to local Post Office") — ainda não
// está com a local. ("In transit to local facility" do YunTu sai com o pacote
// ainda na China: não conta.)
const PRE_LOCAL = /^in transit to local post office/i;
const PRE_INFO = /pre-?shipment|label (created|prepared)|awaiting item|shipment information received|electronic (cargo )?information/i;

// evs: eventos do pacote (qualquer ordem). phaseOf: fase de cada texto
// (tracking-phases). Sem o evento de repasse, o trecho local começa depois da
// chegada nos EUA / alfândega — a "Sem nome" cria eventos "(中文:…)" ainda na
// China (Xangai, antes do voo) e o pacote parecia já estar com ela (#L4-1527).
// Sem chegada reconhecida, só vale GOFO/USPS (nunca aparecem na origem).
export function localLegOf(evs: { ts: number; d: string }[], localNumber: string | null, phaseOf: (d: string) => string | null): LocalLeg | null {
  const asc = [...evs].sort((a, b) => a.ts - b.ts);
  const h = asc.findIndex((e) => HANDOFF.test(e.d));
  const us = h >= 0 ? h : asc.findIndex((e) => US_SIDE.has(phaseOf(e.d) ?? ""));
  const leg = h >= 0 ? asc.slice(h + 1) : us >= 0 ? asc.slice(us + 1) : asc;
  const deliv = leg.find((e) => phaseOf(e.d) === "entregue");
  const deliveredTs = deliv ? deliv.ts : null;
  for (const [key, re] of SIGS) {
    if (key === "SEM_NOME" && h < 0 && us < 0) continue;
    // Aviso de etiqueta não conta: "Pre-Shipment Info Sent to USPS" / "Shipping
    // Label Created" saem com o pacote ainda na China (#L6-1036, YunTu).
    const first = leg.find((e) => re.test(e.d) && !PRE_INFO.test(e.d) && phaseOf(e.d) !== "aviso");
    if (first) return { key, startTs: h >= 0 ? asc[h].ts : first.ts, deliveredTs };
  }
  // Número USPS sozinho não prova nada: o 17track já manda reservado com o
  // pacote ainda na alfândega (#L6-1005). Só com evento da USPS (acima).
  if (h < 0) {
    // Liberado na alfândega (ou JCEX avisando o repasse) e nenhum evento da
    // transportadora local ainda: aguardando — pedido do usuário em 05/11/2026.
    // Entregue sem evento reconhecido fica de fora (não dá pra dizer quem foi).
    // Liberação só depois da chegada nos EUA ("Export customs clearance" é a da
    // China); e se o último evento é alfândega de novo (inspeção, "in progress"),
    // está preso lá — não aguardando a local.
    if (us < 0 || asc.some((e) => phaseOf(e.d) === "entregue")) return null;
    const pre = asc.findIndex((e, i) => i > us && (PRE_LOCAL.test(e.d) || phaseOf(e.d) === "alfandega_saida"));
    const lastPhase = phaseOf(asc[asc.length - 1].d);
    if (pre < 0 || lastPhase === "alfandega_entrada" || lastPhase === "chegada_eua") return null;
    return { key: "AGUARDANDO", startTs: asc[pre].ts, deliveredTs: null };
  }
  return { key: leg.length ? "NAO_RECONHECIDA" : "AGUARDANDO", startTs: asc[h].ts, deliveredTs };
}

// Link do código local: USPS e GOFO direto no site delas; Transfly (YunTu
// repassa pra ela) pelo 17track. Outro formato: sem link, só o código.
export function localTrackingUrl(n: string | null | undefined): string | null {
  if (!n) return null;
  const usps = uspsCore(n);
  if (usps) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${usps}`;
  if (/^GFUS/i.test(n)) return `https://www.gofo.com/us/track?searchID=${encodeURIComponent(n)}`;
  return `https://t.17track.net/en#nums=${encodeURIComponent(n)}`;
}
export const localNumberDisplay = (n: string) => uspsCore(n) ?? n;

// Já entregue e sem o código (pedido antigo do Track123, nunca cadastrado no
// 17track; ou transportadora que não manda): conta como código "0" — pedido do
// usuário em 05/11/2026, pra não parecer que falta algo. Só USPS/GOFO (as que
// têm código); só na tela, não grava — o sync segue buscando o real.
export const DELIVERED_NO_CODE = "0";
export const localNumberOrZero = (key: string | null | undefined, n: string | null, delivered: boolean) =>
  n ?? (delivered && (key === "USPS" || key === "GOFO") ? DELIVERED_NO_CODE : null);
