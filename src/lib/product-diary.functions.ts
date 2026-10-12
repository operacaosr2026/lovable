import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Aba Diário do produto. Tipos de nota são do workspace; "Alteração" é fixo
// (is_system) e alimenta "Última alteração" no topo do diário.

export const DIARY_COLORS = ["gray", "blue", "amber", "purple", "green", "red"] as const;
export type DiaryColor = (typeof DIARY_COLORS)[number];
export type DiaryNoteType = { id: string; name: string; color: DiaryColor; position: number; is_system: boolean };
export type DiaryEntry = {
  id: string; note_type_id: string | null; author_id: string | null; content: string;
  image_urls: string[]; created_at: string; edited_at: string | null;
};

const db = (table: string) => (supabaseAdmin as any).from(table);
const ImageUrls = z.array(z.string().url().max(4000)).max(20);

async function assertProduct(ownerId: string, productId: string) {
  const { data } = await supabaseAdmin.from("products").select("id").eq("id", productId).eq("user_id", ownerId).maybeSingle();
  if (!data) throw new Error("Produto não encontrado");
}

async function loadNoteTypes(ownerId: string): Promise<DiaryNoteType[]> {
  const read = () => db("product_diary_note_types").select("id,name,color,position,is_system")
    .eq("user_id", ownerId).order("position", { ascending: true }).order("created_at", { ascending: true });
  let { data, error } = await read();
  if (error) throw new Error(error.message);
  if (!(data ?? []).some((t: any) => t.is_system)) {
    // Índice único parcial segura duas abas abrindo ao mesmo tempo.
    await db("product_diary_note_types").insert({ user_id: ownerId, name: "Alteração", color: "blue", position: -1, is_system: true });
    ({ data, error } = await read());
    if (error) throw new Error(error.message);
  }
  return (data ?? []) as DiaryNoteType[];
}

export const getProductDiary = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ product_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { ownerId } = context;
    await assertProduct(ownerId, data.product_id);
    const [noteTypes, entries, focus] = await Promise.all([
      loadNoteTypes(ownerId),
      db("product_diary_entries").select("id,note_type_id,author_id,content,image_urls,created_at,edited_at")
        .eq("user_id", ownerId).eq("product_id", data.product_id).order("created_at", { ascending: false }),
      db("product_diary_focus").select("current_test").eq("product_id", data.product_id).maybeSingle(),
    ]);
    if (entries.error) throw new Error(entries.error.message);
    return {
      noteTypes,
      entries: (entries.data ?? []) as DiaryEntry[],
      currentTest: (focus.data?.current_test ?? null) as string | null,
    };
  });

export const saveProductDiaryFocus = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ product_id: z.string().uuid(), current_test: z.string().max(2000).nullable() }).parse(d))
  .handler(async ({ context, data }) => {
    await assertProduct(context.ownerId, data.product_id);
    const { error } = await db("product_diary_focus").upsert(
      { product_id: data.product_id, user_id: context.ownerId, current_test: data.current_test, updated_at: new Date().toISOString() },
      { onConflict: "product_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

async function assertNoteType(ownerId: string, id: string | null | undefined) {
  if (!id) return;
  const { data } = await db("product_diary_note_types").select("id").eq("id", id).eq("user_id", ownerId).maybeSingle();
  if (!data) throw new Error("Tipo de nota não encontrado");
}

export const addProductDiaryEntry = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    product_id: z.string().uuid(),
    content: z.string().trim().min(1).max(10000),
    note_type_id: z.string().uuid().nullable(),
    image_urls: ImageUrls,
  }).parse(d))
  .handler(async ({ context, data }) => {
    await assertProduct(context.ownerId, data.product_id);
    await assertNoteType(context.ownerId, data.note_type_id);
    const { error } = await db("product_diary_entries").insert({ ...data, user_id: context.ownerId, author_id: context.userId });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateProductDiaryEntry = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    id: z.string().uuid(),
    content: z.string().trim().min(1).max(10000).optional(),
    note_type_id: z.string().uuid().nullable().optional(),
    image_urls: ImageUrls.optional(),
    created_at: z.string().datetime({ offset: true }).optional(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { id, ...patch } = data;
    await assertNoteType(context.ownerId, patch.note_type_id);
    const { error } = await db("product_diary_entries")
      .update({ ...patch, ...(patch.content !== undefined || patch.image_urls !== undefined ? { edited_at: new Date().toISOString() } : {}) })
      .eq("id", id).eq("user_id", context.ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteProductDiaryEntry = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await db("product_diary_entries").delete().eq("id", data.id).eq("user_id", context.ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── Tipos de nota ──

export const createDiaryNoteType = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ name: z.string().trim().min(1).max(40), color: z.enum(DIARY_COLORS) }).parse(d))
  .handler(async ({ context, data }) => {
    const { count } = await db("product_diary_note_types").select("id", { count: "exact", head: true }).eq("user_id", context.ownerId);
    const { error } = await db("product_diary_note_types").insert({ ...data, user_id: context.ownerId, position: count ?? 0 });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateDiaryNoteType = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(40).optional(),
    color: z.enum(DIARY_COLORS).optional(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { id, ...patch } = data;
    const { error } = await db("product_diary_note_types").update(patch)
      .eq("id", id).eq("user_id", context.ownerId).eq("is_system", false);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteDiaryNoteType = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await db("product_diary_note_types").delete()
      .eq("id", data.id).eq("user_id", context.ownerId).eq("is_system", false);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
