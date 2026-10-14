import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { ProductionField } from "@/lib/store-production.server";

// Aba Concorrentes do produto: um quadro por concorrente. O quadro copia os
// campos do template na criação e passa a ter os próprios — editar o template
// não mexe nos quadros que já existem.

export type CompetitorTemplate = { id: string; name: string; fields: ProductionField[]; is_default: boolean };
export type Competitor = {
  id: string; name: string; fields: ProductionField[]; values: Record<string, string>; position: number; updated_at: string;
};

const db = (table: string) => (supabaseAdmin as any).from(table);

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
      fields = tpl.fields ?? [];
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
