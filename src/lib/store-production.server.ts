import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type ProductionFieldType = "text" | "link" | "email";
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

// Ficha inicial (campos que já eram usados no ClickUp) — vale até o dono
// salvar a própria.
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

export async function loadFields(ownerId: string): Promise<ProductionField[]> {
  const { data } = await supabaseAdmin.from("store_production_templates")
    .select("fields").eq("user_id", ownerId).maybeSingle();
  if (!data) return DEFAULT_FIELDS;
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

export async function loadPresets(ownerId: string): Promise<ProductionPreset[]> {
  const { data, error } = await supabaseAdmin.from("store_production_presets")
    .select("id,name,is_default,values,tasks,credentials,policies")
    .eq("user_id", ownerId)
    .order("position", { ascending: true }).order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map(toPreset);
}

// Aplica o template na loja sem apagar nada: preenche só campos vazios,
// adiciona etapas, acessos, políticas e arquivos que a loja ainda não tem
// (pelo nome).
// Sem presetId usa o template padrão (loja nova do quadro).
export async function applyPresetToStore(ownerId: string, storeId: string, presetId?: string) {
  let q = supabaseAdmin.from("store_production_presets")
    .select("id,name,is_default,values,tasks,credentials,policies").eq("user_id", ownerId);
  q = presetId ? q.eq("id", presetId) : q.eq("is_default", true);
  const { data: row } = await q.maybeSingle();
  if (!row) {
    if (presetId) throw new Error("Template não encontrado");
    return;
  }
  const tpl = toPreset(row);

  const filled = Object.entries(tpl.values).filter(([, v]) => v.trim());
  if (filled.length > 0) {
    const { data: prod } = await supabaseAdmin.from("store_production").select("values")
      .eq("shopify_store_id", storeId).maybeSingle();
    const current = (prod?.values ?? {}) as Record<string, string>;
    const values = { ...current };
    for (const [k, v] of filled) if (!current[k]?.trim()) values[k] = v;
    const { error } = await supabaseAdmin.from("store_production")
      .upsert({ shopify_store_id: storeId, user_id: ownerId, values }, { onConflict: "shopify_store_id" });
    if (error) throw new Error(error.message);
  }

  if (tpl.tasks.length > 0) {
    const [{ data: existing }, { data: members }] = await Promise.all([
      supabaseAdmin.from("store_production_tasks").select("title")
        .eq("user_id", ownerId).eq("shopify_store_id", storeId),
      supabaseAdmin.from("workspace_members").select("member_id").eq("owner_id", ownerId),
    ]);
    // Responsável que saiu do workspace fica em branco.
    const allowed = new Set([ownerId, ...(members ?? []).map((m) => m.member_id as string)]);
    const have = new Set((existing ?? []).map((t) => t.title.trim().toLowerCase()));
    const start = (existing ?? []).length;
    const rows = tpl.tasks.filter((t) => !have.has(t.title.trim().toLowerCase())).map((t, i) => ({
      user_id: ownerId,
      shopify_store_id: storeId,
      title: t.title,
      description: t.description,
      assignee_id: t.assignee_id && allowed.has(t.assignee_id) ? t.assignee_id : null,
      checklist: t.checklist.map((c) => ({ id: crypto.randomUUID(), text: c.text, done: false })),
      position: start + i,
    }));
    if (rows.length > 0) {
      const { error } = await supabaseAdmin.from("store_production_tasks").insert(rows);
      if (error) throw new Error(error.message);
    }
  }

  if (tpl.credentials.length > 0) {
    const { data: existing } = await supabaseAdmin.from("store_credentials").select("label")
      .eq("user_id", ownerId).eq("shopify_store_id", storeId);
    const have = new Set((existing ?? []).map((c) => c.label.toLowerCase()));
    const start = (existing ?? []).length;
    const rows = tpl.credentials.filter((l) => !have.has(l.toLowerCase()))
      .map((label, i) => ({ user_id: ownerId, shopify_store_id: storeId, label, value: "", position: start + i }));
    if (rows.length > 0) {
      const { error } = await supabaseAdmin.from("store_credentials").insert(rows);
      if (error) throw new Error(error.message);
    }
  }

  if (tpl.policies.length > 0) {
    const { data: existing } = await supabaseAdmin.from("store_production_policies").select("title")
      .eq("user_id", ownerId).eq("shopify_store_id", storeId);
    const have = new Set((existing ?? []).map((p) => p.title.trim().toLowerCase()));
    const start = (existing ?? []).length;
    const rows = tpl.policies.filter((p) => !have.has(p.title.trim().toLowerCase())).map((p, i) => ({
      user_id: ownerId, shopify_store_id: storeId, title: p.title, content: p.content, position: start + i,
    }));
    if (rows.length > 0) {
      const { error } = await supabaseAdmin.from("store_production_policies").insert(rows);
      if (error) throw new Error(error.message);
    }
  }

  const { data: files } = await supabaseAdmin.from("store_production_preset_files")
    .select("name,path,size,mime").eq("user_id", ownerId).eq("preset_id", tpl.id);
  if (files && files.length > 0) {
    const { data: existing } = await supabaseAdmin.from("store_production_files").select("name")
      .eq("user_id", ownerId).eq("shopify_store_id", storeId);
    const have = new Set((existing ?? []).map((f) => f.name.toLowerCase()));
    const bucket = supabaseAdmin.storage.from(PRODUCTION_BUCKET);
    for (const f of files.filter((f) => !have.has(f.name.toLowerCase()))) {
      const path = `${ownerId}/${storeId}/${crypto.randomUUID()}-${safeFileName(f.name)}`;
      const { error: copyError } = await bucket.copy(f.path, path);
      if (copyError) throw new Error(`${f.name}: ${copyError.message}`);
      const { error } = await supabaseAdmin.from("store_production_files").insert({
        user_id: ownerId, shopify_store_id: storeId, name: f.name, path, size: f.size, mime: f.mime,
      });
      if (error) throw new Error(error.message);
    }
  }
}
