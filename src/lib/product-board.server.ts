import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Pipeline } from "@/lib/product-pipelines";

export const COLS = "id,name,position,color";

const DEFAULT_COLUMNS: Record<Pipeline, { name: string; color: string }[]> = {
  mineracao: [
    { name: "Encontrados", color: "sky" }, { name: "Em análise", color: "amber" },
    { name: "Aprovados", color: "emerald" }, { name: "Descartados", color: "slate" },
  ],
  producao: [
    { name: "Na fila", color: "slate" }, { name: "Fornecedor e custo", color: "orange" },
    { name: "Página e criativos", color: "violet" }, { name: "Pronto pra testar", color: "emerald" },
  ],
  validacao: [
    { name: "Ativo", color: "emerald" }, { name: "Teste", color: "blue" }, { name: "Escala", color: "amber" },
    { name: "Pausado", color: "orange" }, { name: "Arquivado", color: "slate" },
  ],
  escala: [{ name: "Escala", color: "amber" }],
};


// Primeiro status da esteira de Produtos — destino de produto criado sem status.
export async function firstProductColumnId(ownerId: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from("product_board_columns").select("id")
    .eq("user_id", ownerId).eq("pipeline", "validacao").order("position", { ascending: true }).limit(1).maybeSingle();
  return data?.id ?? null;
}

async function firstColumnId(ownerId: string, pipeline: Pipeline): Promise<string> {
  const { data } = await supabaseAdmin.from("product_board_columns").select("id")
    .eq("user_id", ownerId).eq("pipeline", pipeline).order("position", { ascending: true }).limit(1).maybeSingle();
  if (data) return data.id;
  const created = await ensureColumns(ownerId, pipeline);
  return created[0].id;
}

export async function ensureColumns(ownerId: string, pipeline: Pipeline) {
  const { data, error } = await supabaseAdmin.from("product_board_columns").select(COLS)
    .eq("user_id", ownerId).eq("pipeline", pipeline).order("position", { ascending: true });
  if (error) throw new Error(error.message);
  if ((data ?? []).length > 0) return data!;

  const { data: created, error: createErr } = await supabaseAdmin.from("product_board_columns")
    .insert(DEFAULT_COLUMNS[pipeline].map((c, i) => ({ user_id: ownerId, ...c, pipeline, position: i })))
    .select(COLS).order("position", { ascending: true });
  if (createErr) throw new Error(createErr.message);
  return created ?? [];
}

// Coloca o produto no começo (1ª coluna, no fim da fila) de uma esteira.
// Se ele já está nessa esteira, fica onde está.
export async function placeInPipeline(ownerId: string, productId: string, pipeline: Pipeline, columnId?: string) {
  if (columnId) {
    const { data: c } = await supabaseAdmin.from("product_board_columns").select("id")
      .eq("id", columnId).eq("user_id", ownerId).eq("pipeline", pipeline).maybeSingle();
    if (!c) throw new Error("Coluna não encontrada.");
  }
  const col = columnId ?? await firstColumnId(ownerId, pipeline);
  if (pipeline === "validacao") {
    const { data: p } = await supabaseAdmin.from("products").select("board_column_id").eq("id", productId).maybeSingle();
    if (p?.board_column_id) return;
    const { count } = await supabaseAdmin.from("products").select("id", { count: "exact", head: true })
      .eq("user_id", ownerId).eq("board_column_id", col);
    await supabaseAdmin.from("products").update({ board_column_id: col, board_position: count ?? 0 }).eq("id", productId);
    return;
  }
  const { data: existing } = await supabaseAdmin.from("product_pipeline_items").select("product_id")
    .eq("product_id", productId).eq("pipeline", pipeline).maybeSingle();
  if (existing) return;
  const { count } = await supabaseAdmin.from("product_pipeline_items").select("product_id", { count: "exact", head: true })
    .eq("user_id", ownerId).eq("column_id", col);
  const { error } = await supabaseAdmin.from("product_pipeline_items")
    .insert({ product_id: productId, pipeline, column_id: col, position: count ?? 0, user_id: ownerId });
  if (error) throw new Error(error.message);
}

