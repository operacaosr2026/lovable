import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type ProductionFieldType = "text" | "link" | "email" | "currency";
export type ProductionField = { id: string; label: string; type: ProductionFieldType };
export type TemplateChecklistItem = { id: string; text: string };
export type TemplateTask = {
  id: string; title: string; description: string | null; assignee_id: string | null; checklist: TemplateChecklistItem[];
};
export type TemplatePolicy = { id: string; title: string; content: string };
export type ProductionPreset = {
  id: string; name: string; is_default: boolean;
  values: Record<string, string>; tasks: TemplateTask[]; credentials: string[]; policies: TemplatePolicy[];
};

export const PRODUCTION_BUCKET = "store-production";

// Produção existe pra loja (Banco de Lojas) e pra produto (Produtos): mesmas
// regras, tabelas separadas. Templates (store_production_presets) separados
// pelo scope; acessos (store_credentials) só existem na loja.
export type ProductionKind = "store" | "product";
export const PRODUCTION_KINDS = ["store", "product"] as const;

export const KINDS = {
  store: {
    owner: "shopify_stores", key: "shopify_store_id", fields: "store_production_templates",
    values: "store_production", tasks: "store_production_tasks", files: "store_production_files", policies: "store_production_policies",
    notFound: "Loja não encontrada",
  },
  product: {
    owner: "products", key: "product_id", fields: "product_production_templates",
    values: "product_production", tasks: "product_production_tasks", files: "product_production_files", policies: "product_production_policies",
    notFound: "Produto não encontrado",
  },
} as const;

// Nomes de tabela variam por tipo — o cliente tipado não aceita união.
export const db = (table: string) => (supabaseAdmin as any).from(table);

export const filesPrefix = (kind: ProductionKind, ownerId: string, targetId: string) =>
  kind === "store" ? `${ownerId}/${targetId}/` : `${ownerId}/products/${targetId}/`;

export async function assertTarget(kind: ProductionKind, ownerId: string, targetId: string) {
  const { data } = await db(KINDS[kind].owner).select("id").eq("id", targetId).eq("user_id", ownerId).maybeSingle();
  if (!data) throw new Error(KINDS[kind].notFound);
}

// Ficha inicial (campos que já eram usados no ClickUp) — vale até o dono
// salvar a própria.
const DEFAULT_PRODUCT_FIELDS: ProductionField[] = [
  { id: "link_fornecedor", label: "Link do fornecedor", type: "link" },
  { id: "link_pagina", label: "Link da página do produto", type: "link" },
  { id: "pasta_criativos", label: "Pasta de criativos", type: "link" },
];
export const DEFAULT_FIELDS: ProductionField[] = [
  { id: "email_contato", label: "E-mail de contato", type: "email" },
  { id: "telefone", label: "Telefone", type: "text" },
  { id: "moeda", label: "Moeda", type: "text" },
  { id: "fuso", label: "Fuso horário", type: "text" },
  { id: "prefixo", label: "Prefixo", type: "text" },
  { id: "dominio", label: "Domínio", type: "link" },
  { id: "email_suporte", label: "E-mail de suporte", type: "email" },
  { id: "mapa_mental", label: "Mapa mental", type: "link" },
];

export async function loadFields(ownerId: string, kind: ProductionKind = "store"): Promise<ProductionField[]> {
  const { data } = await db(KINDS[kind].fields).select("fields").eq("user_id", ownerId).maybeSingle();
  if (!data) return kind === "store" ? DEFAULT_FIELDS : DEFAULT_PRODUCT_FIELDS;
  return (data.fields as ProductionField[]) ?? [];
}

const toPreset = (r: any): ProductionPreset => ({
  id: r.id,
  name: r.name,
  is_default: r.is_default,
  values: (r.values ?? {}) as Record<string, string>,
  tasks: ((r.tasks ?? []) as TemplateTask[]).map((t) => ({ ...t, assignee_id: t.assignee_id ?? null })),
  credentials: (r.credentials ?? []) as string[],
  policies: (r.policies ?? []) as TemplatePolicy[],
});

export const safeFileName = (name: string) =>
  name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w.-]+/g, "_").slice(-120);

export async function loadPresets(ownerId: string, kind: ProductionKind = "store"): Promise<ProductionPreset[]> {
  const { data, error } = await supabaseAdmin.from("store_production_presets")
    .select("id,name,is_default,values,tasks,credentials,policies")
    .eq("user_id", ownerId).eq("scope", kind)
    .order("position", { ascending: true }).order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map(toPreset);
}

// Aplica o template na loja/produto sem apagar nada: preenche só campos
// vazios, adiciona etapas, acessos (só loja), políticas e arquivos que ainda
// não tem (pelo nome). Sem presetId usa o template padrão do tipo (loja nova
// do quadro, produto novo).
export async function applyPreset(kind: ProductionKind, ownerId: string, targetId: string, presetId?: string) {
  const K = KINDS[kind];
  let q = supabaseAdmin.from("store_production_presets")
    .select("id,name,is_default,values,tasks,credentials,policies").eq("user_id", ownerId).eq("scope", kind);
  q = presetId ? q.eq("id", presetId) : q.eq("is_default", true);
  const { data: row } = await q.maybeSingle();
  if (!row) {
    if (presetId) throw new Error("Template não encontrado");
    return;
  }
  const tpl = toPreset(row);

  const filled = Object.entries(tpl.values).filter(([, v]) => v.trim());
  if (filled.length > 0) {
    const { data: prod } = await db(K.values).select("values").eq(K.key, targetId).maybeSingle();
    const current = (prod?.values ?? {}) as Record<string, string>;
    const values = { ...current };
    for (const [k, v] of filled) if (!current[k]?.trim()) values[k] = v;
    const { error } = await db(K.values).upsert({ [K.key]: targetId, user_id: ownerId, values }, { onConflict: K.key });
    if (error) throw new Error(error.message);
  }

  if (tpl.tasks.length > 0) {
    const [{ data: existing }, { data: members }] = await Promise.all([
      db(K.tasks).select("title").eq("user_id", ownerId).eq(K.key, targetId),
      supabaseAdmin.from("workspace_members").select("member_id").eq("owner_id", ownerId),
    ]);
    // Responsável que saiu do workspace fica em branco.
    const allowed = new Set([ownerId, ...(members ?? []).map((m) => m.member_id as string)]);
    const have = new Set(((existing ?? []) as { title: string }[]).map((t) => t.title.trim().toLowerCase()));
    const start = (existing ?? []).length;
    const rows = tpl.tasks.filter((t) => !have.has(t.title.trim().toLowerCase())).map((t, i) => ({
      user_id: ownerId,
      [K.key]: targetId,
      title: t.title,
      description: t.description,
      assignee_id: t.assignee_id && allowed.has(t.assignee_id) ? t.assignee_id : null,
      checklist: t.checklist.map((c) => ({ id: crypto.randomUUID(), text: c.text, done: false })),
      position: start + i,
    }));
    if (rows.length > 0) {
      const { error } = await db(K.tasks).insert(rows);
      if (error) throw new Error(error.message);
    }
  }

  if (kind === "store" && tpl.credentials.length > 0) {
    const { data: existing } = await supabaseAdmin.from("store_credentials").select("label")
      .eq("user_id", ownerId).eq("shopify_store_id", targetId);
    const have = new Set((existing ?? []).map((c) => c.label.toLowerCase()));
    const start = (existing ?? []).length;
    const rows = tpl.credentials.filter((l) => !have.has(l.toLowerCase()))
      .map((label, i) => ({ user_id: ownerId, shopify_store_id: targetId, label, value: "", position: start + i }));
    if (rows.length > 0) {
      const { error } = await supabaseAdmin.from("store_credentials").insert(rows);
      if (error) throw new Error(error.message);
    }
  }

  if (tpl.policies.length > 0) {
    const { data: existing } = await db(K.policies).select("title").eq("user_id", ownerId).eq(K.key, targetId);
    const have = new Set(((existing ?? []) as { title: string }[]).map((p) => p.title.trim().toLowerCase()));
    const start = (existing ?? []).length;
    const rows = tpl.policies.filter((p) => !have.has(p.title.trim().toLowerCase())).map((p, i) => ({
      user_id: ownerId, [K.key]: targetId, title: p.title, content: p.content, position: start + i,
    }));
    if (rows.length > 0) {
      const { error } = await db(K.policies).insert(rows);
      if (error) throw new Error(error.message);
    }
  }

  const { data: files } = await supabaseAdmin.from("store_production_preset_files")
    .select("name,path,size,mime").eq("user_id", ownerId).eq("preset_id", tpl.id);
  if (files && files.length > 0) {
    const { data: existing } = await db(K.files).select("name").eq("user_id", ownerId).eq(K.key, targetId);
    const have = new Set(((existing ?? []) as { name: string }[]).map((f) => f.name.toLowerCase()));
    const bucket = supabaseAdmin.storage.from(PRODUCTION_BUCKET);
    for (const f of files.filter((f) => !have.has(f.name.toLowerCase()))) {
      const path = `${filesPrefix(kind, ownerId, targetId)}${crypto.randomUUID()}-${safeFileName(f.name)}`;
      const { error: copyError } = await bucket.copy(f.path, path);
      if (copyError) throw new Error(`${f.name}: ${copyError.message}`);
      const { error } = await db(K.files).insert({
        user_id: ownerId, [K.key]: targetId, name: f.name, path, size: f.size, mime: f.mime,
      });
      if (error) throw new Error(error.message);
    }
  }
}

export const applyPresetToStore = (ownerId: string, storeId: string, presetId?: string) =>
  applyPreset("store", ownerId, storeId, presetId);
