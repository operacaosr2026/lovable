import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Nomenclatura de campanha, conjunto e anúncio: um template por workspace
// (Configurações › Templates › Nomenclatura). O gerador fica no produto.

export const NAMING_LEVELS = ["campaign", "adset", "ad"] as const;
export type NamingLevel = (typeof NAMING_LEVELS)[number];
export const LEVEL_LABEL: Record<NamingLevel, string> = { campaign: "Campanha", adset: "Conjunto", ad: "Anúncio" };

export type NamingField = { id: string; label: string; options: string[] };
export type NamingTemplate = { separator: string; levels: Record<NamingLevel, NamingField[]> };

const f = (id: string, label: string, options: string[] = []): NamingField => ({ id, label, options });
export const DEFAULT_NAMING: NamingTemplate = {
  separator: "_",
  levels: {
    campaign: [f("loja", "Loja"), f("produto", "Produto"), f("estrutura", "Estrutura", ["ABO", "CBO", "ASC"]), f("data", "Data")],
    adset: [f("publico", "Público"), f("posicionamento", "Posicionamento", ["ADV", "FEED", "REELS"]), f("pagina", "Página")],
    ad: [f("criativo", "Criativo"), f("formato", "Formato", ["VID", "IMG", "CAR"]), f("angulo", "Ângulo")],
  },
};

const FieldInput = z.object({
  id: z.string().min(1).max(60),
  label: z.string().trim().min(1).max(60),
  options: z.array(z.string().trim().min(1).max(60)).max(100),
});
const TemplateInput = z.object({
  // "|" separa nome e id na UTM; não pode ser separador.
  separator: z.string().min(1).max(3).refine((s) => !s.includes("|"), "O separador não pode ter |"),
  levels: z.object({ campaign: z.array(FieldInput).max(20), adset: z.array(FieldInput).max(20), ad: z.array(FieldInput).max(20) }),
});

export const getNamingTemplate = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }): Promise<NamingTemplate> => {
    const { data, error } = await supabaseAdmin.from("naming_templates").select("separator,levels").eq("user_id", context.ownerId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return DEFAULT_NAMING;
    const levels = (data.levels ?? {}) as Partial<Record<NamingLevel, NamingField[]>>;
    return {
      separator: data.separator,
      levels: { campaign: levels.campaign ?? [], adset: levels.adset ?? [], ad: levels.ad ?? [] },
    };
  });

export const saveNamingTemplate = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => TemplateInput.parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await supabaseAdmin.from("naming_templates").upsert(
      { user_id: context.ownerId, separator: data.separator, levels: data.levels, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });
