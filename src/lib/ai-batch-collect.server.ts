import { collectBatches } from "@/lib/ai-batch.server";
import { applySupportEvalBatch, applyPlaybookBatch } from "@/lib/support-learning.server";
import { applyConsultantBatch } from "@/lib/consultant.server";

// A cada 5 min (zoho-mail-sync): lê os lotes de IA que ficaram prontos e grava
// os resultados (ver ai-batch.server.ts).
export async function collectAiBatches() {
  const out: Record<string, number | string> = {};
  for (const [kind, apply] of [
    ["support_eval", applySupportEvalBatch],
    ["support_playbook", applyPlaybookBatch],
    ["consultant", applyConsultantBatch],
  ] as const) {
    try { out[kind] = await collectBatches(kind, apply); }
    catch (e: any) { console.error("ai batch collect", kind, e); out[kind] = String(e?.message ?? e); }
  }
  return out;
}
