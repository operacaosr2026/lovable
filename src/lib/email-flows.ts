import { z } from "zod";

// Notificações › Fluxos — regras usadas pela tela e pelo servidor.

// Situação do envio do pedido (mesma leitura da aba Avisos de atraso, mais entregue/devolvido).
export const FLOW_DELIVERY = [
  { key: "sem_envio", label: "Ainda não enviado" },
  { key: "transito", label: "Em trânsito" },
  { key: "problema", label: "Problema" },
  { key: "esperando_cliente", label: "Esperando cliente" },
  { key: "entregue", label: "Entregue" },
  { key: "devolvido", label: "Devolvido" },
] as const;
export type FlowDelivery = (typeof FLOW_DELIVERY)[number]["key"];

// Status de pagamento da Shopify.
export const FLOW_FINANCIAL = [
  { key: "paid", label: "Pago" },
  { key: "partially_refunded", label: "Reembolso parcial" },
  { key: "refunded", label: "Reembolsado" },
  { key: "pending", label: "Pendente" },
] as const;

// Quando a pessoa sai da sequência sozinha (escolhido por fluxo). Pedido
// cancelado sempre sai.
export const FLOW_STOP_RULES = [
  { key: "respondeu", label: "Cliente respondeu", hint: "Chegou e-mail dele no Atendimento depois que entrou" },
  { key: "entregue", label: "Pedido entregue", hint: "Bom pra fluxo de atraso; não use em pós-entrega" },
  { key: "reembolsado", label: "Reembolsado", hint: "Reembolso total ou parcial na Shopify" },
  { key: "chargeback", label: "Abriu chargeback", hint: "Chargeback ou inquiry no pedido" },
] as const;
export type FlowStopRule = (typeof FLOW_STOP_RULES)[number]["key"];

export const flowFiltersSchema = z.object({
  shopIds: z.array(z.string().uuid()).max(50).default([]),
  // Data da compra: "há X a Y dias" (anda com o tempo, bom pro contínuo) ou um período fixo.
  purchase: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("dias"), min: z.number().int().min(0).max(365).nullable(), max: z.number().int().min(0).max(365).nullable() }),
    z.object({ kind: z.literal("periodo"), from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable() }),
  ]).default({ kind: "dias", min: null, max: null }),
  delivery: z.array(z.enum(FLOW_DELIVERY.map((d) => d.key) as [FlowDelivery, ...FlowDelivery[]])).default([]),
  // Só vale com "Entregue" marcado: entregue há X a Y dias.
  deliveredMin: z.number().int().min(0).max(365).nullable().default(null),
  deliveredMax: z.number().int().min(0).max(365).nullable().default(null),
  financial: z.array(z.string().max(40)).max(10).default([]),
  dispute: z.enum(["qualquer", "sem", "com"]).default("qualquer"),
  support: z.enum(["qualquer", "sem", "com"]).default("qualquer"),
  product: z.string().trim().max(120).default(""),
  minValue: z.number().min(0).max(100_000).nullable().default(null),
  maxValue: z.number().min(0).max(100_000).nullable().default(null),
});
export type FlowFilters = z.infer<typeof flowFiltersSchema>;
export const EMPTY_FILTERS: FlowFilters = flowFiltersSchema.parse({});

export const flowStepSchema = z.discriminatedUnion("type", [
  z.object({ id: z.string().max(40), type: z.literal("email"), subject: z.string().trim().min(1).max(300), body: z.string().trim().min(1).max(20_000) }),
  z.object({ id: z.string().max(40), type: z.literal("esperar"), amount: z.number().int().min(1).max(365), unit: z.enum(["horas", "dias"]) }),
]);
export type FlowStep = z.infer<typeof flowStepSchema>;

export const waitMs = (s: Extract<FlowStep, { type: "esperar" }>) => s.amount * (s.unit === "horas" ? 3_600_000 : 86_400_000);

// "3 e-mails em 7 dias"
export function stepsSummary(steps: FlowStep[]) {
  const emails = steps.filter((s) => s.type === "email").length;
  const ms = steps.reduce((t, s) => t + (s.type === "esperar" ? waitMs(s) : 0), 0);
  const span = !ms ? "" : ms % 86_400_000 === 0 ? ` em ${ms / 86_400_000} ${ms === 86_400_000 ? "dia" : "dias"}` : ` em ${Math.round(ms / 3_600_000)} h`;
  return `${emails} ${emails === 1 ? "e-mail" : "e-mails"}${span}`;
}
