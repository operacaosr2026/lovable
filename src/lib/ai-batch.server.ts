import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { withAiCredit } from "@/lib/ai-credit.server";

// IA em lote (Batch API da Anthropic): metade do preço, mesma IA — a resposta
// chega em minutos (até 24h) em vez de na hora. Usado no que não é urgente:
// comparação rascunho × equipe e manual do Atendimento, e o Consultor de segunda.
// O lote enviado fica em ai_batches; a cada 5 min (zoho-mail-sync) os prontos
// são lidos e aplicados (ai-batch-collect.server.ts).

export type BatchKind = "support_eval" | "support_playbook" | "consultant";
export type BatchRequest = { custom_id: string; params: Record<string, unknown> };
export type BatchRow = { id: string; owner_id: string; kind: BatchKind; batch_id: string; items: Record<string, any>; created_at: string };
export type BatchItemResult = { ok: true; message: Anthropic.Message } | { ok: false; error: string };

// Mesmos parâmetros da chamada direta, sem os que o lote não aceita (fallbacks/betas).
export function batchParams(p: { model: string; max_tokens: number; system: string; content: string; effort: string; schema: object }) {
  return {
    model: p.model, max_tokens: p.max_tokens, system: p.system,
    output_config: { effort: p.effort, format: { type: "json_schema", schema: p.schema } },
    messages: [{ role: "user", content: p.content }],
  };
}

export async function submitBatch(ownerId: string, kind: BatchKind, requests: BatchRequest[], items: Record<string, any> = {}) {
  if (!requests.length) return null;
  const client = new Anthropic();
  const b = await withAiCredit(() => client.messages.batches.create({ requests } as any));
  const { error } = await supabaseAdmin.from("ai_batches").insert({ owner_id: ownerId, kind, batch_id: b.id, items });
  if (error) {
    await client.messages.batches.cancel(b.id).catch(() => {});
    throw new Error(error.message);
  }
  return b.id;
}

export async function pendingBatches(kind: BatchKind, ownerId?: string) {
  let q = supabaseAdmin.from("ai_batches").select("id,owner_id,kind,batch_id,items,created_at").eq("kind", kind).eq("status", "processando");
  if (ownerId) q = q.eq("owner_id", ownerId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as BatchRow[];
}

// Lotes prontos: devolve o resultado de cada pedido (custom_id) e marca o lote
// como concluído depois que `apply` terminar. Lote expirado/cancelado: os
// pedidos sem resultado voltam como erro (quem chamou reenvia).
export async function collectBatches(kind: BatchKind, apply: (row: BatchRow, results: Map<string, BatchItemResult>) => Promise<void>) {
  const rows = await pendingBatches(kind);
  if (!rows.length) return 0;
  const client = new Anthropic();
  let done = 0;
  for (const row of rows) {
    const b = await client.messages.batches.retrieve(row.batch_id);
    if (b.processing_status !== "ended") continue;
    const results = new Map<string, BatchItemResult>();
    for await (const r of await client.messages.batches.results(row.batch_id)) {
      const res = r.result as any;
      if (res.type !== "succeeded") results.set(r.custom_id, { ok: false, error: res.type === "errored" ? String(res.error?.error?.message ?? res.error?.message ?? "erro") : res.type });
      else if (res.message.stop_reason === "refusal") results.set(r.custom_id, { ok: false, error: "a IA não quis responder" });
      else if (res.message.stop_reason === "max_tokens") results.set(r.custom_id, { ok: false, error: "resposta cortada (max_tokens)" });
      else results.set(r.custom_id, { ok: true, message: res.message });
    }
    try {
      await apply(row, results);
      await supabaseAdmin.from("ai_batches").update({ status: "concluido", done_at: new Date().toISOString() }).eq("id", row.id);
    } catch (e: any) {
      await supabaseAdmin.from("ai_batches").update({ status: "erro", error: String(e?.message ?? e).slice(0, 500), done_at: new Date().toISOString() }).eq("id", row.id);
    }
    done++;
  }
  return done;
}

export const batchJson = <T>(m: Anthropic.Message) =>
  JSON.parse(m.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("")) as T;
