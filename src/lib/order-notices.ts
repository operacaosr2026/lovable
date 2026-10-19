// Aba Notificações — regras usadas pela tela e pelo servidor.

// Fila de envio: 1 e-mail a cada 3 minutos por workspace (20/hora — o Zoho
// limita 50–500 e-mails externos por hora, contando os do Atendimento).
export const NOTICE_INTERVAL_MIN = 3;

// Pedido entra na lista a partir de 5 dias da compra e sai depois de 180.
export const NOTICE_MIN_DAYS = 5;
export const NOTICE_MAX_DAYS = 180;

// Etapas por dias desde a compra. Chargeback de "produto não recebido" abre,
// na mediana, 20 dias depois da compra (metade entre 14 e 29 — out/2026).
export const NOTICE_STAGES = [
  { key: "5", label: "5 a 9 dias", hint: "Antes do pico de chargebacks", from: 5, to: 9 },
  { key: "10", label: "10 a 20 dias", hint: "Começam os chargebacks", from: 10, to: 20 },
  { key: "21", label: "21 a 29 dias", hint: "Pico de chargebacks", from: 21, to: 29 },
  { key: "30", label: "30 dias ou mais", hint: "Muito atrasado", from: 30, to: Infinity },
] as const;
export type NoticeStageKey = (typeof NOTICE_STAGES)[number]["key"];
export const stageOf = (days: number): NoticeStageKey | null =>
  NOTICE_STAGES.find((s) => days >= s.from && days <= s.to)?.key ?? null;

// Número do pedido como o cliente vê (#1234).
export const customerOrderNumber = (n: string) => (n.startsWith("#") ? n : `#${n}`);

// {nome} = primeiro nome, {pedido} = nº do pedido, {rastreio} = link de rastreio.
export function renderNotice(text: string, vars: { nome: string; pedido: string; rastreio: string }) {
  return text
    .replace(/\{nome\}/gi, vars.nome)
    .replace(/\{pedido\}/gi, customerOrderNumber(vars.pedido))
    .replace(/\{rastreio\}/gi, vars.rastreio)
    .replace(/^(Hi|Hello|Dear) ,/m, "$1,");
}
