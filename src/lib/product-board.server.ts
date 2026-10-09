import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Primeiro status da esteira de Produtos — destino de produto criado sem status.
export async function firstProductColumnId(ownerId: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from("product_board_columns").select("id")
    .eq("user_id", ownerId).order("position", { ascending: true }).limit(1).maybeSingle();
  return data?.id ?? null;
}
