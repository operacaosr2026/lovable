// Último evento do rastreio em português, só pras telas internas (Pedidos,
// Chargebacks, Notificações, Gerencial). A página de rastreio do cliente
// continua em inglês (tracking-display.ts). Entra o texto já limpo
// (sanitizeEvents/cleanLabel); texto que não casar com nada fica como veio.

// Nomes neutros que o sanitizeEvents gera (EVENT_REWRITES, CN_NEUTRAL,
// CN_US_PHRASES, TRANSIT_VARIANTS). Chave em minúsculas, sem ponto final.
const EXACT: Record<string, string> = {
  "processing complete – released for delivery": "Liberado para entrega",
  "shipment being processed – no action needed": "Em processamento no destino",
  "in transit to local facility": "Em trânsito para a unidade local",
  "shipment in transit": "Em trânsito",
  "package moving through carrier network": "Em movimento na rede da transportadora",
  "shipment on the way": "A caminho",
  "shipment departed sorting hub": "Saiu do centro de triagem",
  "arrived at regional hub": "Chegou ao centro regional",
  "returned to sender": "Devolvido ao remetente",
  "handed over to local carrier": "Repassado à transportadora local",
  "departure rescheduled": "Partida reagendada",
  "received at distribution center": "Recebido no centro de distribuição",
  "departed facility": "Saiu da unidade",
  "package received by carrier": "Recebido pela transportadora",
  "shipment processed for departure": "Processado para a partida",
  "shipment cleared for departure": "Liberado para a partida",
  "handed over to transport partner": "Entregue ao parceiro de transporte",
  "accepted by transport partner": "Aceito pelo parceiro de transporte",
  "delivery attempted": "Tentativa de entrega",
  "delivered": "Entregue",
  "out for delivery": "Saiu para entrega",
  "departed sorting facility": "Saiu do centro de triagem",
  "arrived at sorting facility": "Chegou ao centro de triagem",
  "received at sorting center": "Recebido no centro de triagem",
  "arrived at local post office": "Chegou à agência local",
  "arrived at destination facility": "Chegou à unidade de destino",
  "available for pickup": "Disponível para retirada",
  "awaiting departure": "Aguardando partida",
  "shipment sealed for transport": "Lacrado para transporte",
  "shipment submitted for departure processing": "Enviado para o processamento de saída",
  "package sorted": "Pacote separado",
  "dispatched to next facility": "Despachado para a próxima unidade",
};

// Onde foi entregue ("Delivered, Front Door/Porch", "Position: Mailroom",
// "(Recipient's garage)"…).
const DELIVERED_WHERE: [RegExp, string][] = [
  [/original sender/i, "ao remetente"],
  [/parcel locker|locker/i, "armário de encomendas"],
  [/mailbox/i, "caixa de correio"],
  [/front desk|reception|receptionist|mail ?room|lobby/i, "recepção/portaria"],
  [/garage|other door|back door|side door|alternate location/i, "outra porta/garagem"],
  [/front door|porch|door\/yard/i, "porta da frente"],
  [/post office|picked up at usps|delivered to agent/i, "retirado na agência"],
  [/pudo/i, "ponto de retirada"],
  [/left with individual|personally|meet customer|received by recipient/i, "em mãos"],
  [/safe drop|secured location/i, "local seguro"],
];

const PATTERNS: [RegExp, string][] = [
  [/out for delivery/i, "Saiu para entrega"],
  [/delivery attempt|投递失败/i, "Tentativa de entrega"],
  [/information (has been )?(received|sent)|electronic (cargo )?information|parcel data received|label created|order information/i, "Informações do envio recebidas"],
  [/arrived at (the )?destination country/i, "Chegou ao país de destino"],
  [/arrived at (the )?destination hub/i, "Chegou ao centro de destino"],
  [/arrived at (the )?delivery point/i, "Chegou ao ponto de entrega"],
  [/arrived at airport/i, "No aeroporto, aguardando partida"],
  [/arrived at (usps |gofo )?(facility|regional hub)|arrival scan|arrives at the processing center/i, "Chegou à unidade de triagem"],
  [/departed (usps |gofo )?(facility|regional hub)|leave the operation center|departed from sort facility|gateway transit out/i, "Saiu da unidade de triagem"],
  [/departed from (the )?origin(al)? country|departure from the starting port/i, "Saiu do país de origem"],
  [/in transit to next facility/i, "Em trânsito para a próxima unidade"],
  [/in transit to local post office/i, "Em trânsito para a agência local"],
  [/picked up by shipping partner|shipment picked up/i, "Coletado pela transportadora"],
  [/processed through facility|in processing at transit facility/i, "Processado na unidade"],
  [/received item, in normal transportation/i, "Recebido, em transporte normal"],
  [/flight has landed/i, "Voo pousou"],
  [/flight has departed/i, "Voo partiu"],
  [/ministry of agriculture/i, "Retido na inspeção do Ministério da Agricultura"],
  [/destination country customs clearance begins/i, "Início do desembaraço no destino"],
  [/export customs declaration/i, "Declaração de exportação"],
  [/released by customs at origin|customs released from origin/i, "Liberado pela alfândega na origem"],
  [/processing delay/i, "Atraso no processamento"],
  [/order cancelled|order canceled/i, "Envio cancelado"],
  [/incorrect address/i, "Endereço incorreto"],
];

export function trackingEventPt(text: string | null | undefined): string | null {
  if (!text) return text ?? null;
  const t = text.trim();
  const key = t.toLowerCase().replace(/[.\s]+$/, "");
  if (EXACT[key]) return EXACT[key];
  if (/^delivered\b|has been delivered/i.test(t) && !/^delivered to (local|the local)/i.test(t)) {
    const where = DELIVERED_WHERE.find(([re]) => re.test(t))?.[1];
    if (where === "ao remetente") return "Devolvido ao remetente";
    return where ? `Entregue – ${where}` : "Entregue";
  }
  return PATTERNS.find(([re]) => re.test(t))?.[1] ?? t;
}
