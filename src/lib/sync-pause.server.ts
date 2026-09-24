import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Lojas Shopify que estão numa coluna do Banco de Lojas com "Pausar
// sincronização" ligado (ex.: Em Hold, Com Retenção, Cemitério). Os crons e o
// sino de notificações pulam essas lojas. Se a coluna sync_paused ainda não
// existir no banco (migration não rodada) ou a consulta falhar, não pausa nada —
// melhor seguir sincronizando do que parar tudo por engano.
export async function getPausedShopifyStoreIds(ownerId?: string): Promise<Set<string>> {
  let colsQuery = supabaseAdmin.from("store_board_columns").select("id").eq("sync_paused", true);
  if (ownerId) colsQuery = colsQuery.eq("user_id", ownerId);
  const { data: cols, error } = await colsQuery;
  if (error || !cols?.length) return new Set();

  const { data: stores, error: storesError } = await supabaseAdmin
    .from("shopify_stores").select("id").in("board_column_id", cols.map((c) => c.id));
  if (storesError) return new Set();
  return new Set((stores ?? []).map((s) => s.id as string));
}
