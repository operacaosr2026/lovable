import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listJournalPages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ shop_ids: z.array(z.string().uuid()).nullable().optional() }).optional().parse(d) ?? {},
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    let q = supabase
      .from("journal_pages")
      .select("id,parent_id,title,icon,position,updated_at,is_favorite,last_opened_at,shop_id")
      .eq("user_id", userId);
    const shopIds = (data as any)?.shop_ids;
    q = shopIds && shopIds.length > 0 ? q.in("shop_id", shopIds) : q.is("shop_id", null);
    const { data: rows, error } = await q
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return { pages: rows ?? [] };
  });

export const getJournalPage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: row, error } = await context.supabase
      .from("journal_pages").select("*").eq("id", data.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (row) {
      await context.supabase
        .from("journal_pages")
        .update({ last_opened_at: new Date().toISOString() })
        .eq("id", data.id);
    }
    return { page: row };
  });

export const createJournalPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    parent_id: z.string().uuid().nullable().optional(),
    title: z.string().max(200).optional(),
    shop_id: z.string().uuid().nullable().optional(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const parentId = data.parent_id ?? null;
    const shopId = data.shop_id ?? null;
    let q = supabase.from("journal_pages").select("position").eq("user_id", userId);
    q = parentId === null ? q.is("parent_id", null) : q.eq("parent_id", parentId);
    q = shopId === null ? q.is("shop_id", null) : q.eq("shop_id", shopId);
    const { data: siblings } = await q.order("position", { ascending: false }).limit(1);
    const nextPos = (siblings?.[0]?.position ?? -1) + 1;
    const { data: row, error } = await supabase.from("journal_pages").insert({
      user_id: userId,
      parent_id: parentId,
      shop_id: shopId,
      title: data.title ?? "Sem título",
      content: "",
      position: nextPos,
    }).select().single();
    if (error) throw new Error(error.message);
    return { page: row };
  });

export const updateJournalPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    id: z.string().uuid(),
    title: z.string().max(200).optional(),
    content: z.string().max(200000).optional(),
    icon: z.string().max(8).nullable().optional(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const patch: { title?: string; content?: string; icon?: string | null } = {};
    if (data.title !== undefined) patch.title = data.title;
    if (data.content !== undefined) patch.content = data.content;
    if (data.icon !== undefined) patch.icon = data.icon;
    const { error } = await context.supabase
      .from("journal_pages").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteJournalPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("journal_pages").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const toggleJournalFavorite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid(), value: z.boolean() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("journal_pages").update({ is_favorite: data.value }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const moveJournalPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    id: z.string().uuid(),
    parent_id: z.string().uuid().nullable(),
    position: z.number().int().min(0).optional(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    if (data.parent_id) {
      const { data: all } = await supabase
        .from("journal_pages").select("id,parent_id").eq("user_id", userId);
      const descendants = new Set<string>([data.id]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const r of all ?? []) {
          if (r.parent_id && descendants.has(r.parent_id) && !descendants.has(r.id)) {
            descendants.add(r.id); changed = true;
          }
        }
      }
      if (descendants.has(data.parent_id)) {
        throw new Error("Não é possível mover uma página para dentro de si mesma.");
      }
    }
    // Get current page's shop_id to scope position computation
    const { data: cur } = await supabase
      .from("journal_pages").select("shop_id").eq("id", data.id).maybeSingle();
    const shopId = (cur as any)?.shop_id ?? null;
    let position = data.position;
    if (position === undefined) {
      const pId = data.parent_id;
      let sq = supabase.from("journal_pages").select("position").eq("user_id", userId);
      sq = pId === null ? sq.is("parent_id", null) : sq.eq("parent_id", pId);
      sq = shopId === null ? sq.is("shop_id", null) : sq.eq("shop_id", shopId);
      const { data: siblings } = await sq.order("position", { ascending: false }).limit(1);
      position = (siblings?.[0]?.position ?? -1) + 1;
    }
    const { error } = await supabase
      .from("journal_pages")
      .update({ parent_id: data.parent_id, position })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
