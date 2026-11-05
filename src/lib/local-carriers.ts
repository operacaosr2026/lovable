// Transportadora local dos EUA (última milha) de cada pacote, pelo jeito dos
// eventos do rastreio — o 17track não manda o nome dela. Regras:
//  - GOFO: "GOFO" no texto ou o telefone dela (+1 949 688-6032);
//  - USPS: "USPS" / "POST OFFICE", ou código local no formato USPS (92…–95…);
//    o código local (misc_info.local_number do 17track) vem na USPS e no YunTu
//    (TRF0… da Transfly ou TYHZ…); o da GOFO (GFUS…) vem do site dela
//    (gofo.server.ts); as sem nome não têm;
//  - Sem nome (juntas, a pedido do usuário em 05/11/2026 — o rastreio não diz
//    quem é): eventos traduzidos "(中文:…)" (Linden NJ, Montebello CA);
//    "Parcel received by in JFK01/ORD/NJC…"; trecho dos EUA do ZS/China Post
//    em chinês ("【US …】");
//  - "Delivered to local carrier" e nenhum evento depois: aguardando o 1º evento;
//  - repassado, com eventos depois e nenhum padrão acima: não reconhecida (avisar).
// Início do trecho local = evento de repasse, ou o 1º evento com o padrão.

export const LOCAL_CARRIERS = [
  { key: "USPS", label: "USPS" },
  { key: "GOFO", label: "GOFO Express" },
  { key: "SEM_NOME", label: "Sem nome", hint: "a transportadora não aparece no rastreio" },
  { key: "NAO_RECONHECIDA", label: "Não reconhecida", hint: "repassado, mas os eventos não batem com nenhuma conhecida" },
  { key: "AGUARDANDO", label: "Aguardando 1º evento", hint: "“Delivered to local carrier” e nada depois" },
] as const;
export type LocalCarrierKey = (typeof LOCAL_CARRIERS)[number]["key"];
export const localCarrierLabel = (k: string) => LOCAL_CARRIERS.find((c) => c.key === k)?.label ?? k;
export const localCarrierHint = (k: string) => (LOCAL_CARRIERS.find((c) => c.key === k) as any)?.hint as string | undefined;

export const HANDOFF = /^delivered to (local )?carrier|handed over to (the )?(local|last[- ]mile)/i;
export const GOFO_EVENT = /GOFO|949 688-6032/i;
const SIGS: [LocalCarrierKey, RegExp][] = [
  ["GOFO", GOFO_EVENT],
  ["USPS", /\bUSPS\b|POST OFFICE/i],
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
    const first = leg.find((e) => re.test(e.d));
    if (first) return { key, startTs: h >= 0 ? asc[h].ts : first.ts, deliveredTs };
  }
  if (localNumber && USPS_NUMBER.test(localNumber)) return { key: "USPS", startTs: h >= 0 ? asc[h].ts : (leg[0]?.ts ?? 0), deliveredTs };
  if (h < 0) return null;
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
