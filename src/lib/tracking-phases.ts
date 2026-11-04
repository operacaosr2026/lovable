import { eventTextKey } from "@/lib/tracking-display";

// Fase de cada texto do rastreio — base da conta do Gerencial › Transportadoras
// (carrier-stats.ts). A fase escolhida na mão em Configurações › Rastreamento ›
// Textos (tracking_phase_overrides) vale antes das regras automáticas daqui.
// Texto que nenhuma regra reconhece fica "sem regra" (null): aparece como erro
// nas duas telas pra alguém escolher a fase.
//
// Como cada fase entra na conta:
//  - aviso: nunca conta (pedido/etiqueta/dados eletrônicos/预报, evento vazio);
//  - postagem = 1º evento que não é aviso;
//  - chegada nos EUA = 1º "chegada_eua" ou "alfandega_entrada";
//  - alfândega: entrada = 1º "alfandega_entrada"; saída = 1º "alfandega_saida",
//    "movimento" ou "entregue" depois dela ("voo" e "chegada_eua" não tiram o
//    pacote da alfândega);
//  - entrega = 1º "entregue".

export const PHASES = [
  { key: "aviso", label: "Aviso (não conta)", hint: "Informação recebida, etiqueta criada, pedido enviado — o pacote ainda não andou" },
  { key: "movimento", label: "Movimento", hint: "Pacote andando: recebido, triagem, saiu do centro, em trânsito, saiu pra entrega…" },
  { key: "voo", label: "Voo / aeroporto", hint: "Aeroporto, voo, liberação de exportação — não tira o pacote da alfândega" },
  { key: "chegada_eua", label: "Chegada nos EUA", hint: "Chegou no aeroporto/hub de destino nos EUA" },
  { key: "alfandega_entrada", label: "Na alfândega dos EUA", hint: "Entrou ou está na alfândega do destino (inclui inspeção/erro)" },
  { key: "alfandega_saida", label: "Liberado da alfândega", hint: "Alfândega dos EUA liberou" },
  { key: "entregue", label: "Entregue", hint: "Entregue ao cliente" },
] as const;
export type Phase = (typeof PHASES)[number]["key"];
export const PHASE_KEYS = PHASES.map((p) => p.key) as [Phase, ...Phase[]];
export const phaseLabel = (p: Phase | null) => PHASES.find((x) => x.key === p)?.label ?? "Sem regra";

// Aviso de informação (não é o pacote andando).
const INFO_ONLY = /information (received|sent|has been)|info received|info sent|order info|order information|order (created|received)|label (created|prepared)|electronic (cargo )?information|cargo information|shipment information|pre-?shipment|preparing shipment|awaiting item|order cancel|预报|订单信息|电子信息/i;
// Evento sem texto de verdade ("(中文:)", vazio, só pontuação).
const isJunk = (d: string) => !/[a-z一-鿿]/i.test(d.replace(/中文/g, ""));
const DELIVERED = /^delivered\b|has been delivered|已妥投|delivered,/i;
// "Delivered to local carrier" é repasse; "To Original Sender" é devolução.
// "Delivered, Parcel Locker -> …delivered to a parcel locker" é entrega.
const NOT_DELIVERED = /^delivered to\b|original sender|returned to sender/i;
const CUSTOMS_OUT = /clearance (processing )?completed|clearance to release|import released|out of customs|customs released|released by customs(?! at origin)|清关完成|海关放行|已放行/i;
// Inspeção/erro na alfândega (海关查验, 清关异常) também é "dentro da alfândega".
const CUSTOMS_IN = /clearance (is )?in progress|under clearance|inbound into customs|started the customs clearance|customs inspection|clearance (exception|delay|abnormal)|海关查验|查验|清关异常|等待清关|到达【美国】海关|送交境外进口海关|进口海关/i;
const US_ARRIVAL = /arrived at destination airport|shipment arrived at airport|international flight has arrived|destination hub|import released|抵达【US】|目的国|目的地转运|到达寄达地|到达目的地/i;
const NOT_US_ARRIVAL = /投递局|post office|delivery station/i;
const FLIGHT = /customs|clearance|export|airport|flight|airline|航班|飞机|航空|海关|清关|启运/i;
const MOVE = /received|picked up|pickup|inbound|outbound|sort|depart|arriv|transit|facility|\bhub\b|warehouse|loaded|out for delivery|post office|delivery station|accept|processed|processing|scan|dispatch|hand(ed)? over|moving|on the way|left|leav|en route|available for pickup|attempt|exception|return|redelivery|address|no access|delivered to|delay|held|exchange office|operation center|transship|consignment|邮件|到达|离开|收取|揽收|投递|分拣|互换局|交|封|处理中心|派送|签收|转运|出门/i;

// Fase pelas regras (sem a escolha na mão). null = nenhuma regra reconhece.
export function autoPhase(d: string): Phase | null {
  if (isJunk(d) || INFO_ONLY.test(d)) return "aviso";
  if (DELIVERED.test(d) && !NOT_DELIVERED.test(d)) return "entregue";
  if (CUSTOMS_OUT.test(d)) return "alfandega_saida";
  if (CUSTOMS_IN.test(d)) return "alfandega_entrada";
  if (US_ARRIVAL.test(d) && !NOT_US_ARRIVAL.test(d)) return "chegada_eua";
  if (FLIGHT.test(d)) return "voo";
  if (MOVE.test(d)) return "movimento";
  return null;
}

// Fase com a escolha na mão por cima (chave = eventTextKey). Guarda o resultado
// por texto: o mesmo texto se repete milhares de vezes.
export function phaseResolver(overrides?: Map<string, Phase>) {
  const cache = new Map<string, Phase | null>();
  return (d: string): Phase | null => {
    let p = cache.get(d);
    if (p !== undefined) return p;
    p = overrides?.get(eventTextKey(d)) ?? autoPhase(d);
    cache.set(d, p);
    return p;
  };
}
