import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { DEFAULT_TEMPLATES, fromOldLevels, type NamingTemplates } from "@/lib/naming";

// Modelo de nomes por workspace (Configurações › Templates › Nomenclatura).
// Fica em naming_templates.levels como { v: 2, campaign, adset, ad } (texto com
// códigos); o formato antigo (lista de campos + separador) é convertido ao ler.

const Text = z.string().trim().max(300).refine((s) => !s.includes("|"), "Não use | no nome (ele separa nome e id na UTM)");
const TemplateInput = z.object({ campaign: Text, adset: Text, ad: Text });

export const getNamingTemplate = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }): Promise<NamingTemplates> => {
    const { data, error } = await supabaseAdmin.from("naming_templates").select("separator,levels").eq("user_id", context.ownerId).maybeSingle();
    if (error) throw new Error(error.message);
    const levels = (data?.levels ?? null) as any;
    if (!levels) return DEFAULT_TEMPLATES;
    if (levels.v === 2) return { campaign: levels.campaign ?? "", adset: levels.adset ?? "", ad: levels.ad ?? "" };
    return fromOldLevels(data!.separator, levels);
  });

export const saveNamingTemplate = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => TemplateInput.parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await supabaseAdmin.from("naming_templates").upsert(
      { user_id: context.ownerId, separator: "-", levels: { v: 2, ...data }, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });
