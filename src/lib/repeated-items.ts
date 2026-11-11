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
    // Sem variant_id nem variant_title não dá pra saber se é a mesma cor/tamanho:
    // a linha conta sozinha (só entra com 2+ nela mesma) — nunca junta pelo título
    // (o #L6-1204, uma de cada cor, aparecia como "2x Samba" assim).
    const key = li?.variant_id ? `v:${li.variant_id}` : variant ? `t:${title}|${variant}` : `l:${by.size}`;
    const cur = by.get(key);
    if (cur) cur.qty += qty; else by.set(key, { title, variant, qty });
  }
  return [...by.values()].filter((i) => i.qty >= 2);
}

// Separado do fornecedor até o cliente confirmar: item repetido, não pago, sem
// rastreio e não liberado. Fora da fila de Pedidos e da previsão do Caixa.
export function onSupplierHold(o: { payment_status?: string | null; tracking_code?: string | null; supplier_hold_released_at?: string | null; line_items?: unknown }): boolean {
  return (o.payment_status ?? "pending") === "pending" && !o.tracking_code && !o.supplier_hold_released_at && repeatedItems(o.line_items).length > 0;
}

// Texto da variável {itens} do e-mail (inglês, como as outras mensagens).
export const repeatedItemsText = (items: RepeatedItem[]) =>
  items.map((i) => `• ${i.qty}x ${i.title}${i.variant ? ` — ${i.variant}` : ""}`).join("\n");

export const REPEATED_CONFIRM_TITLE = "Confirmar itens repetidos";
