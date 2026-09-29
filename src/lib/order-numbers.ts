// Números de pedido citados num texto (assunto/resumo de e-mail):
// "#L2-1131", "L4-1490", "#WV1346", "#1234". Devolve sem "#"; quem usa confere
// no banco (order_number = n ou "#n"), então candidato que não é pedido só não
// casa com nada.
export function orderNumbersInText(text: string | null | undefined): string[] {
  const t = text ?? "";
  const out = new Set<string>();
  for (const [, n] of t.matchAll(/#\s?([A-Za-z]{0,3}\d{0,2}-?\d{3,8})\b/g)) out.add(n.toUpperCase());
  for (const [, n] of t.matchAll(/\b([A-Za-z]{1,3}\d{0,2}-\d{3,8})\b/g)) out.add(n.toUpperCase());
  return [...out];
}

// Formas como o número pode estar gravado em shop_orders.order_number.
export const orderNumberVariants = (nums: string[]) => nums.flatMap((n) => [n, `#${n}`]);
