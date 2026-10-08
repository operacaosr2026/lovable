import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  PRODUCTION_BUCKET, applyPresetToStore, loadFields, loadPresets, safeFileName,
} from "@/lib/store-production.server";

export type {
  ProductionField, ProductionFieldType, ProductionPreset, TemplatePolicy, TemplateTask,
} from "@/lib/store-production.server";
export type ChecklistItem = { id: string; text: string; done: boolean };
export type ProductionTask = {
  id: string; title: string; description: string | null; assignee_id: string | null;
  due_date: string | null; done: boolean; checklist: ChecklistItem[]; position: number;
};
export type ProductionFile = { id: string; name: string; size: number; mime: string | null; created_at: string };
export type ProductionPolicy = { id: string; title: string; content: string };

const StoreIdInput = z.object({ shopify_store_id: z.string().uuid() });

async function assertStore(ownerId: string, storeId: string) {
  const { data } = await supabaseAdmin.from("shopify_stores").select("id")
    .eq("id", storeId).eq("user_id", ownerId).maybeSingle();
  if (!data) throw new Error("Loja não encontrada");
}

async function assertAssignee(ownerId: string, assigneeId: string | null | undefined) {
  if (!assigneeId || assigneeId === ownerId) return;
  const { data } = await supabaseAdmin.from("workspace_members").select("member_id")
    .eq("owner_id", ownerId).eq("member_id", assigneeId).maybeSingle();
  if (!data) throw new Error("Responsável não faz parte deste workspace.");
}

// ── Templates ──

const FieldsInput = z.array(z.object({
  id: z.string().min(1).max(60),
  label: z.string().trim().min(1).max(100),
  type: z.enum(["text", "link", "email"]),
})).max(50);

const PresetInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(100),
  is_default: z.boolean(),
  values: z.record(z.string().min(1).max(60), z.string().max(2000)),
  tasks: z.array(z.object({
    id: z.string().min(1).max(60),
    title: z.string().trim().min(1).max(200),
    description: z.string().max(5000).nullable(),
    assignee_id: z.string().uuid().nullable(),
    checklist: z.array(z.object({ id: z.string().min(1).max(60), text: z.string().trim().min(1).max(300) })).max(100),
  })).max(50),
  credentials: z.array(z.string().trim().min(1).max(100)).max(30),
  policies: z.array(z.object({
    id: z.string().min(1).max(60),
    title: z.string().trim().min(1).max(100),
    content: z.string().max(100000),
  })).max(30),
});

async function assertPreset(ownerId: string, presetId: string) {
  const { data } = await supabaseAdmin.from("store_production_presets").select("id")
    .eq("id", presetId).eq("user_id", ownerId).maybeSingle();
  if (!data) throw new Error("Template não encontrado");
}

export const listProductionTemplates = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    const [fields, presets, files] = await Promise.all([
      loadFields(context.ownerId),
      loadPresets(context.ownerId),
      supabaseAdmin.from("store_production_preset_files").select("id,preset_id,name,size,mime,created_at")
        .eq("user_id", context.ownerId).order("created_at", { ascending: false }),
    ]);
    if (files.error) throw new Error(files.error.message);
    return {
      fields,
      presets: presets.map((p) => ({
        ...p,
        files: (files.data ?? []).filter((f) => f.preset_id === p.id) as ProductionFile[],
      })),
    };
  });

export const saveProductionFields = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ fields: FieldsInput }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await supabaseAdmin.from("store_production_templates")
      .upsert({ user_id: context.ownerId, fields: data.fields }, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const saveProductionPreset = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => PresetInput.parse(d))
  .handler(async ({ context, data }) => {
    const ownerId = context.ownerId;
    for (const a of new Set(data.tasks.map((t) => t.assignee_id))) await assertAssignee(ownerId, a);
    const { id, ...row } = data;
    if (row.is_default) {
      let q = supabaseAdmin.from("store_production_presets").update({ is_default: false })
        .eq("user_id", ownerId).eq("is_default", true);
      if (id) q = q.neq("id", id);
      const { error } = await q;
      if (error) throw new Error(error.message);
    }
    if (id) {
      const { error } = await supabaseAdmin.from("store_production_presets").update(row).eq("id", id).eq("user_id", ownerId);
      if (error) throw new Error(error.message);
      return { id };
    }
    const { count } = await supabaseAdmin.from("store_production_presets").select("id", { count: "exact", head: true })
      .eq("user_id", ownerId);
    const { data: created, error } = await supabaseAdmin.from("store_production_presets")
      .insert({ ...row, user_id: ownerId, position: count ?? 0 }).select("id").single();
    if (error) throw new Error(error.message);
    return { id: created.id as string };
  });

export const deleteProductionPreset = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: files } = await supabaseAdmin.from("store_production_preset_files").select("path")
      .eq("user_id", context.ownerId).eq("preset_id", data.id);
    if (files?.length) await supabaseAdmin.storage.from(PRODUCTION_BUCKET).remove(files.map((f) => f.path));
    const { error } = await supabaseAdmin.from("store_production_presets")
      .delete().eq("id", data.id).eq("user_id", context.ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const applyProductionTemplate = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ shopify_store_id: z.string().uuid(), preset_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await assertStore(context.ownerId, data.shopify_store_id);
    await applyPresetToStore(context.ownerId, data.shopify_store_id, data.preset_id);
    return { ok: true };
  });

// ── Loja ──

export const getStoreProduction = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => StoreIdInput.parse(d))
  .handler(async ({ context, data }) => {
    const ownerId = context.ownerId;
    const [fields, presets, prod, tasks, files, policies] = await Promise.all([
      loadFields(ownerId),
      loadPresets(ownerId),
      supabaseAdmin.from("store_production").select("values")
        .eq("user_id", ownerId).eq("shopify_store_id", data.shopify_store_id).maybeSingle(),
      supabaseAdmin.from("store_production_tasks")
        .select("id,title,description,assignee_id,due_date,done,checklist,position")
        .eq("user_id", ownerId).eq("shopify_store_id", data.shopify_store_id)
        .order("position", { ascending: true }).order("created_at", { ascending: true }),
      supabaseAdmin.from("store_production_files").select("id,name,size,mime,created_at")
        .eq("user_id", ownerId).eq("shopify_store_id", data.shopify_store_id)
        .order("created_at", { ascending: false }),
      supabaseAdmin.from("store_production_policies").select("id,title,content")
        .eq("user_id", ownerId).eq("shopify_store_id", data.shopify_store_id)
        .order("position", { ascending: true }).order("created_at", { ascending: true }),
    ]);
    if (tasks.error) throw new Error(tasks.error.message);
    if (files.error) throw new Error(files.error.message);
    if (policies.error) throw new Error(policies.error.message);
    return {
      fields,
      presets: presets.map((p) => ({ id: p.id, name: p.name, is_default: p.is_default })),
      values: (prod.data?.values ?? {}) as Record<string, string>,
      tasks: (tasks.data ?? []) as unknown as ProductionTask[],
      files: (files.data ?? []) as ProductionFile[],
      policies: (policies.data ?? []) as ProductionPolicy[],
    };
  });

export const setProductionValue = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    shopify_store_id: z.string().uuid(),
    field_id: z.string().min(1).max(60),
    value: z.string().max(2000),
  }).parse(d))
  .handler(async ({ context, data }) => {
    await assertStore(context.ownerId, data.shopify_store_id);
    const { data: row } = await supabaseAdmin.from("store_production").select("values")
      .eq("shopify_store_id", data.shopify_store_id).maybeSingle();
    const values = { ...((row?.values ?? {}) as Record<string, string>), [data.field_id]: data.value };
    const { error } = await supabaseAdmin.from("store_production")
      .upsert({ shopify_store_id: data.shopify_store_id, user_id: context.ownerId, values }, { onConflict: "shopify_store_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const createProductionTask = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    shopify_store_id: z.string().uuid(),
    title: z.string().trim().min(1).max(200),
  }).parse(d))
  .handler(async ({ context, data }) => {
    await assertStore(context.ownerId, data.shopify_store_id);
    const { count } = await supabaseAdmin.from("store_production_tasks").select("id", { count: "exact", head: true })
      .eq("user_id", context.ownerId).eq("shopify_store_id", data.shopify_store_id);
    const { error } = await supabaseAdmin.from("store_production_tasks").insert({
      user_id: context.ownerId, shopify_store_id: data.shopify_store_id, title: data.title, position: count ?? 0,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateProductionTask = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    id: z.string().uuid(),
    patch: z.object({
      title: z.string().trim().min(1).max(200).optional(),
      description: z.string().max(5000).nullable().optional(),
      assignee_id: z.string().uuid().nullable().optional(),
      due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      done: z.boolean().optional(),
      checklist: z.array(z.object({
        id: z.string().min(1).max(60), text: z.string().trim().min(1).max(300), done: z.boolean(),
      })).max(100).optional(),
    }),
  }).parse(d))
  .handler(async ({ context, data }) => {
    await assertAssignee(context.ownerId, data.patch.assignee_id);
    const { error } = await supabaseAdmin.from("store_production_tasks")
      .update(data.patch).eq("id", data.id).eq("user_id", context.ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteProductionTask = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await supabaseAdmin.from("store_production_tasks")
      .delete().eq("id", data.id).eq("user_id", context.ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Etapas concluídas / total por loja — barrinha no card do quadro. Só lojas
// com produção em andamento (alguma etapa aberta).
export const listProductionProgress = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    const { data, error } = await supabaseAdmin.from("store_production_tasks")
      .select("shopify_store_id,done").eq("user_id", context.ownerId);
    if (error) throw new Error(error.message);
    const byStore: Record<string, { done: number; total: number }> = {};
    for (const t of data ?? []) {
      const p = (byStore[t.shopify_store_id] ??= { done: 0, total: 0 });
      p.total++;
      if (t.done) p.done++;
    }
    for (const id of Object.keys(byStore)) if (byStore[id].done === byStore[id].total) delete byStore[id];
    return byStore;
  });

// ── Políticas ──

export const saveProductionPolicy = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    id: z.string().uuid().optional(),
    shopify_store_id: z.string().uuid(),
    title: z.string().trim().min(1).max(100),
    content: z.string().max(100000),
  }).parse(d))
  .handler(async ({ context, data }) => {
    if (data.id) {
      const { error } = await supabaseAdmin.from("store_production_policies")
        .update({ title: data.title, content: data.content })
        .eq("id", data.id).eq("user_id", context.ownerId);
      if (error) throw new Error(error.message);
      return { ok: true };
    }
    await assertStore(context.ownerId, data.shopify_store_id);
    const { count } = await supabaseAdmin.from("store_production_policies").select("id", { count: "exact", head: true })
      .eq("user_id", context.ownerId).eq("shopify_store_id", data.shopify_store_id);
    const { error } = await supabaseAdmin.from("store_production_policies").insert({
      user_id: context.ownerId, shopify_store_id: data.shopify_store_id,
      title: data.title, content: data.content, position: count ?? 0,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteProductionPolicy = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await supabaseAdmin.from("store_production_policies")
      .delete().eq("id", data.id).eq("user_id", context.ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── Arquivos ──

export const createProductionUpload = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ shopify_store_id: z.string().uuid(), name: z.string().min(1).max(255) }).parse(d))
  .handler(async ({ context, data }) => {
    await assertStore(context.ownerId, data.shopify_store_id);
    const path = `${context.ownerId}/${data.shopify_store_id}/${crypto.randomUUID()}-${safeFileName(data.name)}`;
    const { data: signed, error } = await supabaseAdmin.storage.from(PRODUCTION_BUCKET).createSignedUploadUrl(path);
    if (error || !signed) throw new Error(error?.message ?? "Não foi possível preparar o envio");
    return { path, token: signed.token };
  });

export const registerProductionFile = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    shopify_store_id: z.string().uuid(),
    path: z.string().min(1).max(500),
    name: z.string().min(1).max(255),
    size: z.number().int().min(0),
    mime: z.string().max(200).nullable(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    if (!data.path.startsWith(`${context.ownerId}/${data.shopify_store_id}/`)) throw new Error("Caminho inválido");
    const { error } = await supabaseAdmin.from("store_production_files").insert({
      ...data, user_id: context.ownerId, uploaded_by: context.userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getProductionFileUrl = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: file } = await supabaseAdmin.from("store_production_files").select("path,name")
      .eq("id", data.id).eq("user_id", context.ownerId).maybeSingle();
    if (!file) throw new Error("Arquivo não encontrado");
    const { data: signed, error } = await supabaseAdmin.storage.from(PRODUCTION_BUCKET)
      .createSignedUrl(file.path, 60, { download: file.name });
    if (error || !signed) throw new Error(error?.message ?? "Não foi possível gerar o link");
    return { url: signed.signedUrl };
  });

export const deleteProductionFile = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: file } = await supabaseAdmin.from("store_production_files").select("path")
      .eq("id", data.id).eq("user_id", context.ownerId).maybeSingle();
    if (!file) return { ok: true };
    await supabaseAdmin.storage.from(PRODUCTION_BUCKET).remove([file.path]);
    const { error } = await supabaseAdmin.from("store_production_files").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── Arquivos do template ──

export const createPresetUpload = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ preset_id: z.string().uuid(), name: z.string().min(1).max(255) }).parse(d))
  .handler(async ({ context, data }) => {
    await assertPreset(context.ownerId, data.preset_id);
    const path = `${context.ownerId}/presets/${data.preset_id}/${crypto.randomUUID()}-${safeFileName(data.name)}`;
    const { data: signed, error } = await supabaseAdmin.storage.from(PRODUCTION_BUCKET).createSignedUploadUrl(path);
    if (error || !signed) throw new Error(error?.message ?? "Não foi possível preparar o envio");
    return { path, token: signed.token };
  });

export const registerPresetFile = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    preset_id: z.string().uuid(),
    path: z.string().min(1).max(500),
    name: z.string().min(1).max(255),
    size: z.number().int().min(0),
    mime: z.string().max(200).nullable(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    if (!data.path.startsWith(`${context.ownerId}/presets/${data.preset_id}/`)) throw new Error("Caminho inválido");
    const { error } = await supabaseAdmin.from("store_production_preset_files").insert({
      ...data, user_id: context.ownerId, uploaded_by: context.userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getPresetFileUrl = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: file } = await supabaseAdmin.from("store_production_preset_files").select("path,name")
      .eq("id", data.id).eq("user_id", context.ownerId).maybeSingle();
    if (!file) throw new Error("Arquivo não encontrado");
    const { data: signed, error } = await supabaseAdmin.storage.from(PRODUCTION_BUCKET)
      .createSignedUrl(file.path, 60, { download: file.name });
    if (error || !signed) throw new Error(error?.message ?? "Não foi possível gerar o link");
    return { url: signed.signedUrl };
  });

export const deletePresetFile = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: file } = await supabaseAdmin.from("store_production_preset_files").select("path")
      .eq("id", data.id).eq("user_id", context.ownerId).maybeSingle();
    if (!file) return { ok: true };
    await supabaseAdmin.storage.from(PRODUCTION_BUCKET).remove([file.path]);
    const { error } = await supabaseAdmin.from("store_production_preset_files").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
