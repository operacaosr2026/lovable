import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Campos do Resumo da campanha (aba Campanhas do produto): um template por
// workspace, em Configurações › Templates › Campanhas. Os valores ficam em
// experiments.summary ({ field_id: texto | true/false }).

export const FIELD_TYPES = ["text", "long", "toggle", "select"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
export const FIELD_TYPE_LABEL: Record<FieldType, string> = { text: "Texto curto", long: "Texto longo", toggle: "Sim / não", select: "Opções" };

export type SummaryField = { id: string; label: string; type: FieldType; options: string[] };

const f = (id: string, label: string, type: FieldType, options: string[] = []): SummaryField => ({ id, label, type, options });
export const DEFAULT_SUMMARY_FIELDS: SummaryField[] = [
  f("criativos", "Criativos", "long"),
  f("botao", "Botão", "select", ["Comprar agora", "Saiba mais", "Pedir agora", "Ver mais"]),
  f("pagina", "Página", "text"),
  f("advantage", "Advantage+", "toggle"),
  f("publico", "Público", "text"),
  f("orcamento", "Orçamento diário", "text"),
];

const FieldInput = z.object({
  id: z.string().min(1).max(60),
  label: z.string().trim().min(1).max(60),
  type: z.enum(FIELD_TYPES),
  options: z.array(z.string().trim().min(1).max(60)).max(50),
});

export const getCampaignTemplate = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }): Promise<SummaryField[]> => {
    const { data, error } = await supabaseAdmin.from("campaign_summary_templates").select("fields").eq("user_id", context.ownerId).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? (data.fields as SummaryField[]) : DEFAULT_SUMMARY_FIELDS;
  });

export const saveCampaignTemplate = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ fields: z.array(FieldInput).max(30) }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await supabaseAdmin.from("campaign_summary_templates").upsert(
      { user_id: context.ownerId, fields: data.fields, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });
