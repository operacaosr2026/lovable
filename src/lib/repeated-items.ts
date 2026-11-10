// Pedido com o MESMO item repetido (mesma variante — cor e tamanho — somando 2+
// unidades, numa linha só ou em várias). Itens diferentes do mesmo modelo (ex.:
// uma de cada cor) estão ok e não entram (decisão do usuário em 10/11/2026).
// Usado pra pedir confirmação ao cliente antes de despachar (Lojas e Grupos ›
// Pedidos → e-mail "Confirmar itens repetidos" pela fila de Notificações).

export type RepeatedItem = { title: string; variant: string | null; qty: number };

export function repeatedItems(lineItems: unknown): RepeatedItem[] {
  if (!Array.isArray(lineItems)) return [];
  const by = new Map<string, RepeatedItem>();
  for (const li of lineItems as any[]) {
    const qty = Number(li?.current_quantity ?? li?.quantity ?? 0);
    if (!(qty > 0)) continue;
    const title = String(li?.title ?? "").trim();
    const variant = String(li?.variant_title ?? "").trim() || null;
    const key = li?.variant_id ? `v:${li.variant_id}` : `t:${title}|${variant ?? ""}`;
    const cur = by.get(key);
    if (cur) cur.qty += qty; else by.set(key, { title, variant, qty });
  }
  return [...by.values()].filter((i) => i.qty >= 2);
}

// Texto da variável {itens} do e-mail (inglês, como as outras mensagens).
export const repeatedItemsText = (items: RepeatedItem[]) =>
  items.map((i) => `• ${i.qty}x ${i.title}${i.variant ? ` — ${i.variant}` : ""}`).join("\n");

export const REPEATED_CONFIRM_TITLE = "Confirmar itens repetidos";
