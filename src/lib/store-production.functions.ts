import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  KINDS, PRODUCTION_BUCKET, PRODUCTION_KINDS, applyPreset, assertTarget, db, filesPrefix, loadFields, loadPresets, safeFileName,
} from "@/lib/store-production.server";

export type {
  ProductionField, ProductionFieldType, ProductionKind, ProductionPreset, TemplatePolicy, TemplateTask,
} from "@/lib/store-production.server";
export type ChecklistItem = { id: string; text: string; done: boolean };
export type ProductionTask = {
  id: string; title: string; description: string | null; assignee_id: string | null;
  due_date: string | null; done: boolean; checklist: ChecklistItem[]; position: number;
};
export type ProductionFile = { id: string; name: string; size: number; mime: string | null; created_at: string };
export type ProductionPolicy = { id: string; title: string; content: string };

// kind: "store" (Banco de Lojas) ou "product" (Produtos); target_id: id da
// loja ou do produto.
const Kind = z.enum(PRODUCTION_KINDS);
const TargetInput = z.object({ kind: Kind, target_id: z.string().uuid() });
const ByIdInput = z.object({ kind: Kind, id: z.string().uuid() });

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
  type: z.enum(["text", "link", "email", "currency"]),
})).max(50);

const PresetInput = z.object({
  id: z.string().uuid().optional(),
  scope: Kind,
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
  .inputValidator((d) => z.object({ kind: Kind }).parse(d))
  .handler(async ({ context, data }) => {
    const [fields, presets, files] = await Promise.all([
      loadFields(context.ownerId, data.kind),
      loadPresets(context.ownerId, data.kind),
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
  .inputValidator((d) => z.object({ kind: Kind, fields: FieldsInput }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await db(KINDS[data.kind].fields)
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
    // Acessos e políticas só existem no template de loja.
    if (row.scope === "product") { row.credentials = []; row.policies = []; }
    if (row.is_default) {
      let q = supabaseAdmin.from("store_production_presets").update({ is_default: false })
        .eq("user_id", ownerId).eq("scope", row.scope).eq("is_default", true);
      if (id) q = q.neq("id", id);
      const { error } = await q;
      if (error) throw new Error(error.message);
    }
    if (id) {
      const { scope: _scope, ...patch } = row;
      const { error } = await supabaseAdmin.from("store_production_presets").update(patch).eq("id", id).eq("user_id", ownerId);
      if (error) throw new Error(error.message);
      return { id };
    }
    const { count } = await supabaseAdmin.from("store_production_presets").select("id", { count: "exact", head: true })
      .eq("user_id", ownerId).eq("scope", row.scope);
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
  .inputValidator((d) => TargetInput.extend({ preset_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await assertTarget(data.kind, context.ownerId, data.target_id);
    await applyPreset(data.kind, context.ownerId, data.target_id, data.preset_id);
    return { ok: true };
  });

// ── Loja / produto ──

export const getProduction = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => TargetInput.parse(d))
  .handler(async ({ context, data }) => {
    const ownerId = context.ownerId;
    const K = KINDS[data.kind];
    const [fields, presets, prod, tasks, files, policies] = await Promise.all([
      loadFields(ownerId, data.kind),
      loadPresets(ownerId, data.kind),
      db(K.values).select("values").eq("user_id", ownerId).eq(K.key, data.target_id).maybeSingle(),
      db(K.tasks).select("id,title,description,assignee_id,due_date,done,checklist,position")
        .eq("user_id", ownerId).eq(K.key, data.target_id)
        .order("position", { ascending: true }).order("created_at", { ascending: true }),
      db(K.files).select("id,name,size,mime,created_at")
        .eq("user_id", ownerId).eq(K.key, data.target_id)
        .order("created_at", { ascending: false }),
      db(K.policies).select("id,title,content")
        .eq("user_id", ownerId).eq(K.key, data.target_id)
        .order("position", { ascending: true }).order("created_at", { ascending: true }),
    ]);
    if (tasks.error) throw new Error(tasks.error.message);
    if (files.error) throw new Error(files.error.message);
    if (policies.error) throw new Error(policies.error.message);
    return {
      fields,
      presets: presets.map((p) => ({ id: p.id, name: p.name, is_default: p.is_default })),
      values: (prod.data?.values ?? {}) as Record<string, string>,
      tasks: (tasks.data ?? []) as ProductionTask[],
      files: (files.data ?? []) as ProductionFile[],
      policies: (policies.data ?? []) as ProductionPolicy[],
    };
  });

export const setProductionValue = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => TargetInput.extend({
    field_id: z.string().min(1).max(60),
    value: z.string().max(2000),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const K = KINDS[data.kind];
    await assertTarget(data.kind, context.ownerId, data.target_id);
    const { data: row } = await db(K.values).select("values").eq(K.key, data.target_id).maybeSingle();
    const values = { ...((row?.values ?? {}) as Record<string, string>), [data.field_id]: data.value };
    const { error } = await db(K.values)
      .upsert({ [K.key]: data.target_id, user_id: context.ownerId, values }, { onConflict: K.key });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const createProductionTask = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => TargetInput.extend({ title: z.string().trim().min(1).max(200) }).parse(d))
  .handler(async ({ context, data }) => {
    const K = KINDS[data.kind];
    await assertTarget(data.kind, context.ownerId, data.target_id);
    const { count } = await db(K.tasks).select("id", { count: "exact", head: true })
      .eq("user_id", context.ownerId).eq(K.key, data.target_id);
    const { error } = await db(K.tasks).insert({
      user_id: context.ownerId, [K.key]: data.target_id, title: data.title, position: count ?? 0,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateProductionTask = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => ByIdInput.extend({
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
    const { error } = await db(KINDS[data.kind].tasks)
      .update(data.patch).eq("id", data.id).eq("user_id", context.ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteProductionTask = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => ByIdInput.parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await db(KINDS[data.kind].tasks)
      .delete().eq("id", data.id).eq("user_id", context.ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Etapas concluídas / total por loja ou produto — barrinha no card do quadro.
// Só os com produção em andamento (alguma etapa aberta).
export const listProductionProgress = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ kind: Kind }).parse(d ?? { kind: "store" }))
  .handler(async ({ context, data }) => {
    const K = KINDS[data.kind];
    const { data: rows, error } = await db(K.tasks).select(`${K.key},done`).eq("user_id", context.ownerId);
    if (error) throw new Error(error.message);
    const byTarget: Record<string, { done: number; total: number }> = {};
    for (const t of (rows ?? []) as Record<string, any>[]) {
      const p = (byTarget[t[K.key]] ??= { done: 0, total: 0 });
      p.total++;
      if (t.done) p.done++;
    }
    for (const id of Object.keys(byTarget)) if (byTarget[id].done === byTarget[id].total) delete byTarget[id];
    return byTarget;
  });

// ── Políticas ──

export const saveProductionPolicy = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => TargetInput.extend({
    id: z.string().uuid().optional(),
    title: z.string().trim().min(1).max(100),
    content: z.string().max(100000),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const K = KINDS[data.kind];
    if (data.id) {
      const { error } = await db(K.policies)
        .update({ title: data.title, content: data.content })
        .eq("id", data.id).eq("user_id", context.ownerId);
      if (error) throw new Error(error.message);
      return { ok: true };
    }
    await assertTarget(data.kind, context.ownerId, data.target_id);
    const { count } = await db(K.policies).select("id", { count: "exact", head: true })
      .eq("user_id", context.ownerId).eq(K.key, data.target_id);
    const { error } = await db(K.policies).insert({
      user_id: context.ownerId, [K.key]: data.target_id,
      title: data.title, content: data.content, position: count ?? 0,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteProductionPolicy = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => ByIdInput.parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await db(KINDS[data.kind].policies)
      .delete().eq("id", data.id).eq("user_id", context.ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── Arquivos ──

export const createProductionUpload = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => TargetInput.extend({ name: z.string().min(1).max(255) }).parse(d))
  .handler(async ({ context, data }) => {
    await assertTarget(data.kind, context.ownerId, data.target_id);
    const path = `${filesPrefix(data.kind, context.ownerId, data.target_id)}${crypto.randomUUID()}-${safeFileName(data.name)}`;
    const { data: signed, error } = await supabaseAdmin.storage.from(PRODUCTION_BUCKET).createSignedUploadUrl(path);
    if (error || !signed) throw new Error(error?.message ?? "Não foi possível preparar o envio");
    return { path, token: signed.token };
  });

export const registerProductionFile = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => TargetInput.extend({
    path: z.string().min(1).max(500),
    name: z.string().min(1).max(255),
    size: z.number().int().min(0),
    mime: z.string().max(200).nullable(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    if (!data.path.startsWith(filesPrefix(data.kind, context.ownerId, data.target_id))) throw new Error("Caminho inválido");
    const K = KINDS[data.kind];
    const { error } = await db(K.files).insert({
      [K.key]: data.target_id, path: data.path, name: data.name, size: data.size, mime: data.mime,
      user_id: context.ownerId, uploaded_by: context.userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getProductionFileUrl = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => ByIdInput.parse(d))
  .handler(async ({ context, data }) => {
    const { data: file } = await db(KINDS[data.kind].files).select("path,name")
      .eq("id", data.id).eq("user_id", context.ownerId).maybeSingle();
    if (!file) throw new Error("Arquivo não encontrado");
    const { data: signed, error } = await supabaseAdmin.storage.from(PRODUCTION_BUCKET)
      .createSignedUrl(file.path, 60, { download: file.name });
    if (error || !signed) throw new Error(error?.message ?? "Não foi possível gerar o link");
    return { url: signed.signedUrl };
  });

export const deleteProductionFile = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => ByIdInput.parse(d))
  .handler(async ({ context, data }) => {
    const table = KINDS[data.kind].files;
    const { data: file } = await db(table).select("path")
      .eq("id", data.id).eq("user_id", context.ownerId).maybeSingle();
    if (!file) return { ok: true };
    await supabaseAdmin.storage.from(PRODUCTION_BUCKET).remove([file.path]);
    const { error } = await db(table).delete().eq("id", data.id).eq("user_id", context.ownerId);
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
