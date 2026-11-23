import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { BOARD_COLUMN_COLORS } from "@/lib/store-board.functions";

// Produto › Tráfego: esteiras de Criativos e de Títulos e Descrições.
// Colunas iguais em todos os produtos (traffic_board_columns, por workspace);
// card sem coluna aparece na primeira. Banco de textos por produto (product_copies):
// kind 'title' = título (headline), 'body' = descrição (a copy).

export const TRAFFIC_BOARDS = ["creatives", "copies"] as const;
export type TrafficBoard = (typeof TRAFFIC_BOARDS)[number];
export type TrafficColumn = { id: string; name: string; position: number; color: (typeof BOARD_COLUMN_COLORS)[number] | null };
export type CopyKind = "title" | "body";
export type ProductCopy = { id: string; product_id: string; kind: CopyKind; text: string; column_id: string | null; position: number; created_at: string };

const db = (table: string) => (supabaseAdmin as any).from(table);
const boardSchema = z.enum(TRAFFIC_BOARDS);

const DEFAULT_COLUMNS: Record<TrafficBoard, { name: string; color: TrafficColumn["color"] }[]> = {
  creatives: [
    { name: "Para lançar", color: "sky" },
    { name: "Em teste", color: "amber" },
    { name: "Bom", color: "emerald" },
    { name: "Matei", color: "rose" },
  ],
  copies: [
    { name: "Para testar", color: "sky" },
    { name: "Em teste", color: "amber" },
    { name: "Validado", color: "emerald" },
    { name: "Descartado", color: "rose" },
  ],
};
// Status antigo do criativo → coluna padrão (mesma ordem de DEFAULT_COLUMNS.creatives).
const STATUS_TO_INDEX: Record<string, number> = { lancar: 0, validacao: 1, aprovado: 2, rejeitado: 3 };

async function ensureColumns(ownerId: string, board: TrafficBoard): Promise<TrafficColumn[]> {
  const { data, error } = await db("traffic_board_columns").select("id,name,position,color")
    .eq("user_id", ownerId).eq("board", board).order("position", { ascending: true });
  if (error) throw new Error(error.message);
  if (data?.length) return data as TrafficColumn[];

  const { data: created, error: insErr } = await db("traffic_board_columns")
    .insert(DEFAULT_COLUMNS[board].map((c, i) => ({ user_id: ownerId, board, name: c.name, color: c.color, position: i })))
    .select("id,name,position,color");
  if (insErr) throw new Error(insErr.message);
  const cols = ((created ?? []) as TrafficColumn[]).sort((a, b) => a.position - b.position);

  // Primeira vez: cada criativo vai pra coluna do status que ele já tinha.
  if (board === "creatives") {
    for (const [status, idx] of Object.entries(STATUS_TO_INDEX)) {
      if (!cols[idx]) continue;
      await db("product_creatives").update({ board_column_id: cols[idx].id })
        .eq("user_id", ownerId).eq("status", status).is("board_column_id", null);
    }
  }
  return cols;
}

async function boardOfColumn(ownerId: string, id: string): Promise<TrafficBoard> {
  const { data } = await db("traffic_board_columns").select("board").eq("id", id).eq("user_id", ownerId).maybeSingle();
  if (!data) throw new Error("Coluna não encontrada.");
  return data.board as TrafficBoard;
}

// ── Colunas ──

export const listTrafficColumns = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ board: boardSchema }).parse(d))
  .handler(async ({ context, data }) => ensureColumns(context.ownerId, data.board));

export const createTrafficColumn = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ board: boardSchema, name: z.string().trim().min(1).max(60) }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: last } = await db("traffic_board_columns").select("position")
      .eq("user_id", context.ownerId).eq("board", data.board).order("position", { ascending: false }).limit(1).maybeSingle();
    const { data: row, error } = await db("traffic_board_columns")
      .insert({ user_id: context.ownerId, board: data.board, name: data.name, position: (last?.position ?? -1) + 1 })
      .select("id,name,position,color").single();
    if (error) throw new Error(error.message);
    return row as TrafficColumn;
  });

export const renameTrafficColumn = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid(), name: z.string().trim().min(1).max(60) }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await db("traffic_board_columns").update({ name: data.name }).eq("id", data.id).eq("user_id", context.ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setTrafficColumnColor = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid(), color: z.enum(BOARD_COLUMN_COLORS).nullable() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await db("traffic_board_columns").update({ color: data.color }).eq("id", data.id).eq("user_id", context.ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Só apaga coluna vazia em todos os produtos (as colunas valem pra todos).
export const deleteTrafficColumn = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const board = await boardOfColumn(context.ownerId, data.id);
    const { count } = board === "creatives"
      ? await db("product_creatives").select("id", { count: "exact", head: true }).eq("user_id", context.ownerId).eq("board_column_id", data.id)
      : await db("product_copies").select("id", { count: "exact", head: true }).eq("user_id", context.ownerId).eq("column_id", data.id);
    if (count) throw new Error(`Esta coluna tem ${count} item(ns) somando todos os produtos. Mova antes de excluir.`);
    const { count: total } = await db("traffic_board_columns").select("id", { count: "exact", head: true }).eq("user_id", context.ownerId).eq("board", board);
    if ((total ?? 0) <= 1) throw new Error("A esteira precisa de pelo menos uma coluna.");
    const { error } = await db("traffic_board_columns").delete().eq("id", data.id).eq("user_id", context.ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const reorderTrafficColumns = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ updates: z.array(z.object({ id: z.string().uuid(), position: z.number().int() })).max(50) }).parse(d))
  .handler(async ({ context, data }) => {
    for (const u of data.updates) {
      await db("traffic_board_columns").update({ position: u.position }).eq("id", u.id).eq("user_id", context.ownerId);
    }
    return { ok: true };
  });

// ── Cards ──

const moveSchema = z.object({
  board: boardSchema,
  updates: z.array(z.object({ id: z.string().uuid(), column_id: z.string().uuid(), position: z.number().int() })).max(500),
});

export const moveTrafficCards = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => moveSchema.parse(d))
  .handler(async ({ context, data }) => {
    for (const u of data.updates) {
      const { error } = data.board === "creatives"
        ? await db("product_creatives").update({ board_column_id: u.column_id, board_position: u.position }).eq("id", u.id).eq("user_id", context.ownerId)
        : await db("product_copies").update({ column_id: u.column_id, position: u.position }).eq("id", u.id).eq("user_id", context.ownerId);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

// ── Banco de títulos e descrições ──

const kindSchema = z.enum(["title", "body"]);

async function assertProduct(ownerId: string, productId: string) {
  const { data } = await supabaseAdmin.from("products").select("id").eq("id", productId).eq("user_id", ownerId).maybeSingle();
  if (!data) throw new Error("Produto não encontrado");
}

export const listProductCopies = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ product_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: rows, error } = await db("product_copies").select("id,product_id,kind,text,column_id,position,created_at")
      .eq("user_id", context.ownerId).eq("product_id", data.product_id)
      .order("position", { ascending: true }).order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (rows ?? []) as ProductCopy[];
  });

export const createProductCopy = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    product_id: z.string().uuid(), kind: kindSchema, text: z.string().trim().min(1).max(5000), column_id: z.string().uuid().nullable().optional(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    await assertProduct(context.ownerId, data.product_id);
    const { data: row, error } = await db("product_copies").insert({
      user_id: context.ownerId, product_id: data.product_id, kind: data.kind, text: data.text, column_id: data.column_id ?? null, position: -Date.now() % 1_000_000_000,
    }).select("id,product_id,kind,text,column_id,position,created_at").single();
    if (error) throw new Error(error.message);
    return row as ProductCopy;
  });

export const updateProductCopy = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid(), kind: kindSchema.optional(), text: z.string().trim().min(1).max(5000).optional() }).parse(d))
  .handler(async ({ context, data }) => {
    const { id, ...patch } = data;
    const { error } = await db("product_copies").update(patch).eq("id", id).eq("user_id", context.ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteProductCopy = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await db("product_copies").delete().eq("id", data.id).eq("user_id", context.ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Outros produtos que têm textos (pra importar).
export const listCopySources = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ product_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: rows, error } = await db("product_copies").select("product_id,kind").eq("user_id", context.ownerId).neq("product_id", data.product_id);
    if (error) throw new Error(error.message);
    const counts = new Map<string, { titles: number; bodies: number }>();
    for (const r of (rows ?? []) as { product_id: string; kind: CopyKind }[]) {
      const c = counts.get(r.product_id) ?? { titles: 0, bodies: 0 };
      if (r.kind === "title") c.titles++; else c.bodies++;
      counts.set(r.product_id, c);
    }
    if (!counts.size) return [];
    const { data: products } = await supabaseAdmin.from("products").select("id,name,main_image_url").in("id", [...counts.keys()]);
    return ((products ?? []) as { id: string; name: string; main_image_url: string | null }[])
      .map((p) => ({ ...p, ...counts.get(p.id)! }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

// Copia textos escolhidos de outro produto pra este (vão pra primeira coluna; repetidos ficam de fora).
export const importProductCopies = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ product_id: z.string().uuid(), ids: z.array(z.string().uuid()).min(1).max(500) }).parse(d))
  .handler(async ({ context, data }) => {
    await assertProduct(context.ownerId, data.product_id);
    const [{ data: src }, { data: mine }] = await Promise.all([
      db("product_copies").select("kind,text").eq("user_id", context.ownerId).in("id", data.ids),
      db("product_copies").select("kind,text").eq("user_id", context.ownerId).eq("product_id", data.product_id),
    ]);
    const have = new Set(((mine ?? []) as any[]).map((r) => `${r.kind}|${r.text}`));
    const rows = ((src ?? []) as { kind: CopyKind; text: string }[])
      .filter((r) => !have.has(`${r.kind}|${r.text}`))
      .map((r, i) => ({ user_id: context.ownerId, product_id: data.product_id, kind: r.kind, text: r.text, column_id: null, position: i }));
    if (rows.length) {
      const { error } = await db("product_copies").insert(rows);
      if (error) throw new Error(error.message);
    }
    return { imported: rows.length, skipped: (src?.length ?? 0) - rows.length };
  });
