// Tempo real nas telas: o servidor manda um SINAL curto (sem dados) pelo
// Supabase Realtime Broadcast no canal do workspace; as telas abertas escutam
// (useRealtimeSync) e recarregam só as consultas afetadas. Não usamos
// "postgres_changes" na tabela de pedidos porque o sync de 10 em 10 min
// regrava ~900 pedidos por rodada — seriam milhares de mensagens com o pedido
// inteiro, estourando a cota do Realtime e o egress.
export type RealtimeEvent = "orders" | "tasks" | "notifications";

export const realtimeChannel = (ownerId: string) => `ws-${ownerId}`;

// Nunca lança nem atrasa quem chamou por mais de ~3s: o sinal é conveniência,
// a próxima atualização periódica da tela cobre se ele se perder.
export async function broadcast(ownerId: string, event: RealtimeEvent, payload: Record<string, unknown> = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !ownerId) return;
  try {
    await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
      body: JSON.stringify({ messages: [{ topic: realtimeChannel(ownerId), event, payload }] }),
      signal: AbortSignal.timeout(3_000),
    });
  } catch {
    // ignora
  }
}
