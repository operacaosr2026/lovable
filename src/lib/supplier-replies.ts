// Resposta do fornecedor sobre pedidos que cobramos (Gerencial › Alertas ›
// "Resposta do fornecedor"; tabela order_supplier_flags). Cada tipo/título vira
// um alerta próprio, e os pedidos saem dos outros alertas de rastreio enquanto
// o pacote não andar (evento novo depois da resposta) e o código for o mesmo.
// Pedido do usuário em 10/11/2026: registrar pela tela, sem mexer no código.

export const SUPPLIER_REPLY_KINDS = [
  { key: "sem_estoque", label: "Sem estoque", title: "Sem estoque no fornecedor", hint: "Não pode enviar por falta de estoque" },
  { key: "vai_postar", label: "Vai postar", title: "Fornecedor disse que vai postar", hint: "Prometeu despachar / já está despachando" },
  { key: "outro", label: "Outro", title: "", hint: "Você escreve o título do alerta" },
] as const;
export type SupplierReplyKind = (typeof SUPPLIER_REPLY_KINDS)[number]["key"];
export const SUPPLIER_REPLY_KEYS = SUPPLIER_REPLY_KINDS.map((k) => k.key) as [SupplierReplyKind, ...SupplierReplyKind[]];

export function supplierReplyTitle(kind: string, title: string | null | undefined): string {
  const t = String(title ?? "").trim();
  if (t) return t;
  return SUPPLIER_REPLY_KINDS.find((k) => k.key === kind)?.title || "Resposta do fornecedor";
}

// Chave do alerta: "sem estoque" mantém a chave antiga (resoluções/descartes já
// gravados); os outros, uma por tipo + título.
export function supplierReplyAlertKey(kind: string, title: string | null | undefined): string {
  if (kind === "sem_estoque") return "rastreio:sem_estoque";
  const slug = supplierReplyTitle(kind, title).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "resposta";
  return `fornecedor:${kind}:${slug}`;
}

export const isSupplierReplyAlert = (key: string) => key === "rastreio:sem_estoque" || key.startsWith("fornecedor:");
