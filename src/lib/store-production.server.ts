import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type ProductionFieldType = "text" | "link" | "email";
export type ProductionField = { id: string; label: string; type: ProductionFieldType };
export type TemplateChecklistItem = { id: string; text: string };
export type TemplateTask = { id: string; title: string; description: string | null; checklist: TemplateChecklistItem[] };
export type ProductionTemplate = { fields: ProductionField[]; tasks: TemplateTask[]; credentials: string[] };

export const PRODUCTION_BUCKET = "store-production";

const task = (id: string, title: string): TemplateTask => ({ id, title, description: null, checklist: [] });

// Modelo inicial (ficha e etapas que já eram usadas no ClickUp) — vale até o
// dono salvar o próprio modelo.
export const DEFAULT_TEMPLATE: ProductionTemplate = {
  fields: [
    { id: "email_contato", label: "E-mail de contato", type: "email" },
    { id: "telefone", label: "Telefone", type: "text" },
    { id: "moeda", label: "Moeda", type: "text" },
    { id: "fuso", label: "Fuso horário", type: "text" },
    { id: "prefixo", label: "Prefixo", type: "text" },
    { id: "dominio", label: "Domínio", type: "link" },
    { id: "email_suporte", label: "E-mail de suporte", type: "email" },
    { id: "mapa_mental", label: "Mapa mental", type: "link" },
  ],
  tasks: [
    task("criacao", "Criação da Loja"),
    task("config_iniciais", "Configurações Iniciais"),
    task("apps", "Instalar Aplicativos"),
    task("dominio", "Configurar Domínio"),
    task("produtos", "Importar Produtos"),
    task("config_finais", "Configurações Finais"),
  ],
  credentials: ["Aprodrop", "Conta GoDaddy"],
};

export async function loadTemplate(ownerId: string): Promise<ProductionTemplate> {
  const { data } = await supabaseAdmin.from("store_production_templates")
    .select("fields,tasks,credentials").eq("user_id", ownerId).maybeSingle();
  if (!data) return DEFAULT_TEMPLATE;
  return {
    fields: (data.fields as ProductionField[]) ?? [],
    tasks: (data.tasks as TemplateTask[]) ?? [],
    credentials: (data.credentials as string[]) ?? [],
  };
}

// Copia etapas (com checklist desmarcado) e acessos vazios do modelo pra loja.
// Não faz nada se a loja já tem etapas — nunca duplica.
export async function applyTemplateToStore(ownerId: string, storeId: string) {
  const { count } = await supabaseAdmin.from("store_production_tasks")
    .select("id", { count: "exact", head: true })
    .eq("user_id", ownerId).eq("shopify_store_id", storeId);
  if ((count ?? 0) > 0) return;

  const tpl = await loadTemplate(ownerId);
  if (tpl.tasks.length > 0) {
    const { error } = await supabaseAdmin.from("store_production_tasks").insert(tpl.tasks.map((t, i) => ({
      user_id: ownerId,
      shopify_store_id: storeId,
      title: t.title,
      description: t.description,
      checklist: t.checklist.map((c) => ({ id: crypto.randomUUID(), text: c.text, done: false })),
      position: i,
    })));
    if (error) throw new Error(error.message);
  }

  if (tpl.credentials.length > 0) {
    const { data: existing } = await supabaseAdmin.from("store_credentials").select("label,position")
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
}
