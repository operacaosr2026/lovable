import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import type { ProductionField } from "@/lib/store-production.server";

// Aba Concorrentes do produto: um quadro por concorrente. O quadro copia os
// campos do template na criação e passa a ter os próprios — editar o template
// não mexe nos quadros que já existem.

export type CompetitorTemplate = { id: string; name: string; fields: ProductionField[]; is_default: boolean };
export type Competitor = {
  id: string; name: string; fields: ProductionField[]; values: Record<string, string>; position: number; updated_at: string;
};

const db = <T extends keyof Database["public"]["Tables"]>(table: T) => supabaseAdmin.from(table);

const FieldsInput = z.array(z.object({
  id: z.string().min(1).max(60),
  label: z.string().trim().min(1).max(100),
  type: z.enum(["text", "longtext", "link", "email", "currency"]),
})).max(50);

async function assertProduct(ownerId: string, productId: string) {
  const { data } = await supabaseAdmin.from("products").select("id").eq("id", productId).eq("user_id", ownerId).maybeSingle();
  if (!data) throw new Error("Produto não encontrado");
}

async function loadTemplates(ownerId: string): Promise<CompetitorTemplate[]> {
  const { data, error } = await db("competitor_templates").select("id,name,fields,is_default")
    .eq("user_id", ownerId).order("position", { ascending: true }).order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as CompetitorTemplate[];
}

// ── Templates ──

export const listCompetitorTemplates = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => loadTemplates(context.ownerId));

export const saveCompetitorTemplate = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(100),
    fields: FieldsInput,
    is_default: z.boolean(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const ownerId = context.ownerId;
    const { id, ...row } = data;
    if (row.is_default) {
      let q = db("competitor_templates").update({ is_default: false }).eq("user_id", ownerId).eq("is_default", true);
      if (id) q = q.neq("id", id);
      const { error } = await q;
      if (error) throw new Error(error.message);
    }
    if (id) {
      const { error } = await db("competitor_templates").update(row).eq("id", id).eq("user_id", ownerId);
      if (error) throw new Error(error.message);
      return { id };
    }
    const { count } = await db("competitor_templates").select("id", { count: "exact", head: true }).eq("user_id", ownerId);
    const { data: created, error } = await db("competitor_templates")
      .insert({ ...row, user_id: ownerId, position: count ?? 0 }).select("id").single();
    if (error) throw new Error(error.message);
    return { id: created.id as string };
  });

export const deleteCompetitorTemplate = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await db("competitor_templates").delete().eq("id", data.id).eq("user_id", context.ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── Quadros ──

export const getProductCompetitors = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ product_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { ownerId } = context;
    await assertProduct(ownerId, data.product_id);
    const [templates, rows] = await Promise.all([
      loadTemplates(ownerId),
      db("product_competitors").select("id,name,fields,values,position,updated_at")
        .eq("user_id", ownerId).eq("product_id", data.product_id)
        .order("position", { ascending: true }).order("created_at", { ascending: true }),
    ]);
    if (rows.error) throw new Error(rows.error.message);
    return { templates, competitors: (rows.data ?? []) as Competitor[] };
  });

export const createCompetitor = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    product_id: z.string().uuid(),
    template_id: z.string().uuid().nullable(),
    name: z.string().trim().max(160),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { ownerId } = context;
    await assertProduct(ownerId, data.product_id);
    let fields: ProductionField[] = [];
    if (data.template_id) {
      const { data: tpl } = await db("competitor_templates").select("fields")
        .eq("id", data.template_id).eq("user_id", ownerId).maybeSingle();
      if (!tpl) throw new Error("Template não encontrado");
      fields = (tpl.fields ?? []) as unknown as ProductionField[];
    }
    const { count } = await db("product_competitors").select("id", { count: "exact", head: true })
      .eq("user_id", ownerId).eq("product_id", data.product_id);
    const { data: row, error } = await db("product_competitors").insert({
      user_id: ownerId, product_id: data.product_id, name: data.name, fields, position: count ?? 0,
    }).select("id,name,fields,values,position,updated_at").single();
    if (error) throw new Error(error.message);
    return row as Competitor;
  });

export const updateCompetitor = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    id: z.string().uuid(),
    patch: z.object({
      name: z.string().trim().max(160).optional(),
      fields: FieldsInput.optional(),
      values: z.record(z.string().min(1).max(60), z.string().max(5000)).optional(),
      position: z.number().int().optional(),
    }),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await db("product_competitors").update(data.patch).eq("id", data.id).eq("user_id", context.ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteCompetitor = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await db("product_competitors").delete().eq("id", data.id).eq("user_id", context.ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── Página Concorrentes ──
// Todos os concorrentes da conta (com ou sem produto). Cadastro direto pela
// página: só nome + link da Biblioteca de anúncios, produto opcional.

export const AD_LIBRARY_FIELD: ProductionField = { id: "biblioteca_anuncios", label: "Biblioteca de anúncios", type: "link" };

export type CompetitorListItem = Competitor & {
  product_id: string | null;
  product: { id: string; name: string; main_image_url: string | null } | null;
  created_at: string;
};

export const listAllCompetitors = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    const { ownerId } = context;
    const [rows, products] = await Promise.all([
      db("product_competitors").select("id,name,fields,values,position,updated_at,created_at,product_id")
        .eq("user_id", ownerId).order("created_at", { ascending: false }),
      db("products").select("id,name,main_image_url").eq("user_id", ownerId).eq("archived", false).order("name"),
    ]);
    if (rows.error) throw new Error(rows.error.message);
    if (products.error) throw new Error(products.error.message);
    const byId = new Map((products.data ?? []).map((p) => [p.id, p]));
    const missing = [...new Set((rows.data ?? []).map((r) => r.product_id).filter((id): id is string => !!id && !byId.has(id)))];
    if (missing.length) {
      const { data } = await db("products").select("id,name,main_image_url").eq("user_id", ownerId).in("id", missing);
      for (const p of data ?? []) byId.set(p.id, p);
    }
    return {
      products: products.data ?? [],
      competitors: (rows.data ?? []).map((r) => ({
        ...r, product: r.product_id ? byId.get(r.product_id) ?? null : null,
      })) as unknown as CompetitorListItem[],
    };
  });

export const addCompetitor = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    name: z.string().trim().min(1).max(160),
    ad_library: z.string().trim().max(5000),
    product_id: z.string().uuid().nullable(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { ownerId } = context;
    let position = 0;
    if (data.product_id) {
      await assertProduct(ownerId, data.product_id);
      const { count } = await db("product_competitors").select("id", { count: "exact", head: true })
        .eq("user_id", ownerId).eq("product_id", data.product_id);
      position = count ?? 0;
    }
    const { data: row, error } = await db("product_competitors").insert({
      user_id: ownerId, product_id: data.product_id, name: data.name, position,
      fields: [AD_LIBRARY_FIELD], values: data.ad_library ? { [AD_LIBRARY_FIELD.id]: data.ad_library } : {},
    }).select("id").single();
    if (error) throw new Error(error.message);
    return { id: row.id as string };
  });

// Edição pela página: nome, link da Biblioteca e produto. O campo da
// Biblioteca entra no quadro se ele ainda não tiver.
export const editCompetitor = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(160).optional(),
    ad_library: z.string().trim().max(5000).optional(),
    product_id: z.string().uuid().nullable().optional(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { ownerId } = context;
    const { data: cur } = await db("product_competitors").select("fields,values,product_id")
      .eq("id", data.id).eq("user_id", ownerId).maybeSingle();
    if (!cur) throw new Error("Concorrente não encontrado");
    const patch: Database["public"]["Tables"]["product_competitors"]["Update"] = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.ad_library !== undefined) {
      const fields = (cur.fields ?? []) as unknown as ProductionField[];
      if (!fields.some((f) => f.id === AD_LIBRARY_FIELD.id)) patch.fields = [...fields, AD_LIBRARY_FIELD];
      patch.values = { ...((cur.values ?? {}) as Record<string, string>), [AD_LIBRARY_FIELD.id]: data.ad_library };
    }
    if (data.product_id !== undefined && data.product_id !== cur.product_id) {
      patch.product_id = data.product_id;
      if (data.product_id) {
        await assertProduct(ownerId, data.product_id);
        const { count } = await db("product_competitors").select("id", { count: "exact", head: true })
          .eq("user_id", ownerId).eq("product_id", data.product_id);
        patch.position = count ?? 0;
      }
    }
    const { error } = await db("product_competitors").update(patch).eq("id", data.id).eq("user_id", ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
