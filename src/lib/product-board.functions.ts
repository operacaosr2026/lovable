import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { BOARD_COLUMN_COLORS } from "@/lib/store-board.functions";
import { PIPELINES, type Pipeline } from "@/lib/product-pipelines";
import { COLS, ensureColumns, placeInPipeline } from "@/lib/product-board.server";

// Esteira de produtos: 3 esteiras (Mineração → Produção → Validação), cada uma
// com suas colunas. Validação = status do produto (products.board_column_id);
// Mineração e Produção usam product_pipeline_items (um lugar por esteira).
// Mesmas regras das colunas do Banco de Lojas (store-board.functions.ts).

const pipelineSchema = z.enum(PIPELINES);
const withPipeline = z.object({ pipeline: pipelineSchema.default("validacao") }).default({ pipeline: "validacao" });

async function pipelineOfColumn(ownerId: string, id: string): Promise<Pipeline> {
  const { data } = await supabaseAdmin.from("product_board_columns").select("pipeline")
    .eq("id", id).eq("user_id", ownerId).maybeSingle();
  if (!data) throw new Error("Coluna não encontrada.");
  return data.pipeline as Pipeline;
}

// Sem pipeline = Validação (status do produto).
export const listProductBoardColumns = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => withPipeline.parse(d))
  .handler(async ({ context, data }) => ensureColumns(context.ownerId, data.pipeline));

// Lugar de cada produto em cada esteira (produto → coluna/posição).
export const listPipelinePlacements = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    const [{ data: items, error }, { data: products, error: pErr }] = await Promise.all([
      supabaseAdmin.from("product_pipeline_items").select("product_id,pipeline,column_id,position").eq("user_id", context.ownerId),
      supabaseAdmin.from("products").select("id,board_column_id,board_position").eq("user_id", context.ownerId).not("board_column_id", "is", null),
    ]);
    if (error) throw new Error(error.message);
    if (pErr) throw new Error(pErr.message);
    const out: { product_id: string; pipeline: Pipeline; column_id: string; position: number }[] =
      (items ?? []).map((r: any) => ({ product_id: r.product_id, pipeline: r.pipeline, column_id: r.column_id, position: r.position }));
    for (const p of products ?? []) {
      out.push({ product_id: p.id, pipeline: "validacao", column_id: p.board_column_id!, position: p.board_position });
    }
    return out;
  });

export const createProductBoardColumn = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ name: z.string().trim().min(1).max(60), pipeline: pipelineSchema.default("validacao") }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: last } = await supabaseAdmin.from("product_board_columns").select("position")
      .eq("user_id", context.ownerId).eq("pipeline", data.pipeline).order("position", { ascending: false }).limit(1).maybeSingle();
    const { data: row, error } = await supabaseAdmin.from("product_board_columns")
      .insert({ user_id: context.ownerId, name: data.name, pipeline: data.pipeline, position: (last?.position ?? -1) + 1 })
      .select(COLS).single();
    if (error) throw new Error(error.message);
    return row;
  });

export const renameProductBoardColumn = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid(), name: z.string().trim().min(1).max(60) }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await supabaseAdmin.from("product_board_columns")
      .update({ name: data.name }).eq("id", data.id).eq("user_id", context.ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setProductBoardColumnColor = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid(), color: z.enum(BOARD_COLUMN_COLORS).nullable() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await supabaseAdmin.from("product_board_columns")
      .update({ color: data.color }).eq("id", data.id).eq("user_id", context.ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteProductBoardColumn = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const pipeline = await pipelineOfColumn(context.ownerId, data.id);
    const { count } = pipeline === "validacao"
      ? await supabaseAdmin.from("products").select("id", { count: "exact", head: true })
        .eq("user_id", context.ownerId).eq("board_column_id", data.id)
      : await supabaseAdmin.from("product_pipeline_items").select("product_id", { count: "exact", head: true })
        .eq("user_id", context.ownerId).eq("column_id", data.id);
    if ((count ?? 0) > 0) throw new Error("Mova ou remova os produtos desta coluna antes de excluí-la.");
    const { error } = await supabaseAdmin.from("product_board_columns")
      .delete().eq("id", data.id).eq("user_id", context.ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const reorderProductBoardColumns = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    updates: z.array(z.object({ id: z.string().uuid(), position: z.number().int() })).max(200),
  }).parse(d))
  .handler(async ({ context, data }) => {
    for (const u of data.updates) {
      await supabaseAdmin.from("product_board_columns")
        .update({ position: u.position }).eq("id", u.id).eq("user_id", context.ownerId);
    }
    return { ok: true };
  });

export const moveBoardProducts = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    pipeline: pipelineSchema.default("validacao"),
    updates: z.array(z.object({
      id: z.string().uuid(),
      board_column_id: z.string().uuid(),
      board_position: z.number().int(),
    })).max(1000),
  }).parse(d))
  .handler(async ({ context, data }) => {
    for (const u of data.updates) {
      if (data.pipeline === "validacao") {
        await supabaseAdmin.from("products")
          .update({ board_column_id: u.board_column_id, board_position: u.board_position })
          .eq("id", u.id).eq("user_id", context.ownerId);
      } else {
        await supabaseAdmin.from("product_pipeline_items")
          .upsert({ product_id: u.id, pipeline: data.pipeline, column_id: u.board_column_id, position: u.board_position, user_id: context.ownerId });
      }
    }
    return { ok: true };
  });

async function assertOwnProduct(ownerId: string, productId: string) {
  const { data } = await supabaseAdmin.from("products").select("id").eq("id", productId).eq("user_id", ownerId).maybeSingle();
  if (!data) throw new Error("Produto não encontrado.");
}

export const sendProductToPipeline = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid(), pipeline: pipelineSchema }).parse(d))
  .handler(async ({ context, data }) => {
    await assertOwnProduct(context.ownerId, data.id);
    await placeInPipeline(context.ownerId, data.id, data.pipeline);
    return { ok: true };
  });

// Tira da esteira sem apagar o produto (na Validação, fica sem status).
export const removeProductFromPipeline = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid(), pipeline: pipelineSchema }).parse(d))
  .handler(async ({ context, data }) => {
    await assertOwnProduct(context.ownerId, data.id);
    const { error } = data.pipeline === "validacao"
      ? await supabaseAdmin.from("products").update({ board_column_id: null }).eq("id", data.id)
      : await supabaseAdmin.from("product_pipeline_items").delete().eq("product_id", data.id).eq("pipeline", data.pipeline);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
