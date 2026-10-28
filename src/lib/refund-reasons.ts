// Motivo do reembolso (escolha obrigatória no "Reembolsar" do Atendimento).
// Alimenta Atendimento › Aprovações › Análise e o alerta de reembolso alto.

export const REFUND_REASONS = [
  { key: "tamanho", label: "Tamanho / não serviu" },
  { key: "produto_errado", label: "Produto errado (fornecedor)" },
  { key: "defeito", label: "Defeito / qualidade" },
  { key: "nao_chegou", label: "Não chegou / extraviado" },
  { key: "alfandega", label: "Retido na alfândega" },
  { key: "demora_entrega", label: "Demora na entrega" },
  { key: "chargeback", label: "Possível chargeback" },
  { key: "arrependimento", label: "Arrependimento / desistiu" },
  { key: "outro", label: "Outro" },
] as const;

export type RefundReason = (typeof REFUND_REASONS)[number]["key"];
export const REFUND_REASON_KEYS = REFUND_REASONS.map((r) => r.key) as [RefundReason, ...RefundReason[]];

export function refundReasonLabel(key: string | null | undefined) {
  if (!key) return "Sem motivo";
  return REFUND_REASONS.find((r) => r.key === key)?.label ?? key;
}
