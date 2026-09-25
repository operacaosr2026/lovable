import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Auditoria: registra ações de usuário que gravam algo pelo servidor (chamado
// pelo middleware global auditMiddleware, depois que a ação deu certo).

// Leituras, automáticos e ruído — não entram na auditoria.
const SKIP = new Set([
  "listLogisticsOrders", "listKanbanColumns", "getMetaAdsIntegration", "getMetaAdsMetrics",
  "getTrack123Integrations", "recordLogin", "recomputeRange", "recomputeDay", "markNotificationsRead",
  "syncShopifyOrders", "syncShopifyPaymentsFees", "syncMetaAdsSpend", "syncMetaAdsActivities",
  "syncShopifyVisitors", "syncOrderPaymentTasks", "syncShopifyPayouts", "syncTrack123ForShops",
  "seedKanbanColumns", "testMetaAdsConnection", "testTrack123Sync", "createMetaOAuthUrl",
]);

const LABELS: Record<string, string> = {
  acceptInvitation: "Aceitou convite", addLgCardNoteAttachment: "Anexou arquivo em nota do Diário",
  addProductImage: "Adicionou imagem de produto", addProductTemplate: "Adicionou template de produto",
  addSopComment: "Comentou em SOP", addStoreRevenue: "Registrou faturamento de loja", addTaskComment: "Comentou em tarefa",
  clearManualOverride: "Removeu ajuste manual do Caixa", completeShopRoutine: "Concluiu rotina de loja",
  connectMetaAdAccount: "Conectou conta de anúncios Meta", connectShopifyStore: "Conectou loja Shopify",
  createBoardColumn: "Criou coluna no Banco de Lojas", createCashCategory: "Criou categoria do Caixa",
  createCashEntry: "Criou lançamento no Caixa", createConsolidatedCashEntry: "Criou lançamento no Caixa (geral)",
  createCreative: "Criou criativo", createKanbanColumn: "Criou coluna de kanban", createLgCard: "Criou grupo",
  createLgCardGoal: "Criou meta de grupo", createLgCardNote: "Criou nota no Diário", createPlaceholderStore: "Criou loja (rascunho)",
  createProduct: "Criou produto", createProject: "Criou projeto", createProjectNote: "Criou nota de projeto",
  createProjectTask: "Criou tarefa de projeto", createShop: "Criou loja", createShopRoutine: "Criou rotina de loja",
  createShopTask: "Criou tarefa", createSimulatedAdEstimate: "Criou estimativa de anúncio (simulador)",
  createSimulatedExpense: "Criou despesa simulada", createSopEdge: "Ligou etapas de SOP", createSopProcess: "Criou SOP",
  createSopStep: "Criou etapa de SOP", createTask: "Criou tarefa", createTaskFromNotification: "Criou tarefa a partir de aviso",
  deleteBoardColumn: "Apagou coluna do Banco de Lojas", deleteCashCategory: "Apagou categoria do Caixa",
  deleteCashEntry: "Apagou lançamento do Caixa", deleteCashImport: "Apagou importação do Caixa",
  deleteCompanyGoal: "Apagou meta do mês", deleteConsolidatedCashEntry: "Apagou lançamento do Caixa (geral)",
  deleteCreative: "Apagou criativo", deleteGratitude: "Apagou gratidão", deleteGratitudeEntry: "Apagou gratidão",
  deleteKanbanColumn: "Apagou coluna de kanban", deleteLgCard: "Apagou grupo", deleteLgCardNote: "Apagou nota do Diário",
  deleteLgCardNoteAttachment: "Apagou anexo de nota do Diário", deleteOrders: "Apagou pedidos", deleteProduct: "Apagou produto",
  deleteProductImage: "Apagou imagem de produto", deleteProductTemplate: "Apagou template de produto", deleteProject: "Apagou projeto",
  deleteProjectAttachment: "Apagou anexo de projeto", deleteProjectNote: "Apagou nota de projeto",
  deleteProjectTask: "Apagou tarefa de projeto", deleteShop: "Apagou loja", deleteShopRoutine: "Apagou rotina de loja",
  deleteShopTask: "Apagou tarefa", deleteShopifyStore: "Desconectou loja Shopify",
  deleteSimulatedAdEstimate: "Apagou estimativa de anúncio (simulador)", deleteSimulatedExpense: "Apagou despesa simulada",
  deleteSopComment: "Apagou comentário de SOP", deleteSopEdge: "Desligou etapas de SOP", deleteSopProcess: "Apagou SOP",
  deleteSopStep: "Apagou etapa de SOP", deleteTask: "Apagou tarefa", deleteTaskAttachment: "Apagou anexo de tarefa",
  deleteTaskComment: "Apagou comentário de tarefa", disconnectMeta: "Desconectou Meta Ads",
  disconnectMetaAdAccount: "Desconectou conta de anúncios Meta", dismissAllNotifications: "Limpou os avisos do sino",
  dismissNotification: "Dispensou aviso do sino", duplicateCreative: "Duplicou criativo", duplicateProject: "Duplicou projeto",
  duplicateSopProcess: "Duplicou SOP", finalizeLgCardGoal: "Finalizou meta de grupo", importShopifyPayouts: "Importou repasses da Shopify",
  inviteMember: "Convidou membro", markOrdersPaid: "Marcou pedidos como pagos", markOrdersShipped: "Marcou pedidos como enviados",
  moveBoardStores: "Moveu lojas no Banco de Lojas", registerProjectAttachment: "Anexou arquivo em projeto",
  registerTaskAttachment: "Anexou arquivo em tarefa", renameBoardColumn: "Renomeou coluna do Banco de Lojas",
  renameCashCategory: "Renomeou categoria do Caixa", renameShopifyStore: "Renomeou loja Shopify",
  reorderBoardColumns: "Reordenou colunas do Banco de Lojas", reorderKanbanColumns: "Reordenou colunas de kanban",
  reorderProjectTasks: "Reordenou tarefas de projeto", reorderShopTasks: "Reordenou tarefas", resetShopCash: "Resetou o Caixa",
  revokeInvitation: "Cancelou convite", revokeMember: "Removeu membro", saveGratitudeEntry: "Salvou gratidão",
  saveLgCurrencyRates: "Alterou cotação de moeda", saveMetaCampaigns: "Alterou campanhas Meta consideradas",
  setBoardColumnExcludedFromCaixa: "Alterou coluna do Banco de Lojas (fora do Caixa)",
  setBoardColumnFeatures: "Alterou o que a coluna do Banco de Lojas mostra",
  setBoardColumnSyncPaused: "Pausou/retomou sincronização de coluna", setMainImage: "Definiu imagem principal de produto",
  setManualOverride: "Ajustou lançamento do Caixa manualmente", setOpeningBalance: "Alterou saldo inicial do Caixa",
  setPayoutLagDays: "Alterou prazo de repasse manual", setStoreBoardNote: "Editou nota de loja no Banco de Lojas",
  setWeekendRule: "Alterou regra de fim de semana do Caixa", startShopifyOAuth: "Iniciou conexão com a Shopify",
  undoOrderPayment: "Desfez pagamento de pedidos", updateBatchPaymentDate: "Alterou data de pagamento de lote",
  updateCashEntry: "Editou lançamento do Caixa", updateConsolidatedCashEntry: "Editou lançamento do Caixa (geral)",
  updateCreative: "Editou criativo", updateGratitude: "Editou gratidão", updateKanbanColumn: "Editou coluna de kanban",
  updateLgCard: "Editou grupo", updateLgCardGoal: "Editou meta de grupo", updateLgCardMatriz: "Alterou loja matriz do grupo",
  updateLgCardNote: "Editou nota do Diário", updateLgCardShopConfig: "Alterou prazos da loja no grupo",
  updateMemberPermissions: "Alterou permissões de membro", updateOrderLogistics: "Editou rastreio de pedido",
  updateProduct: "Editou produto", updateProject: "Editou projeto", updateProjectTask: "Editou tarefa de projeto",
  updateShop: "Editou loja", updateShopRoutine: "Editou rotina de loja", updateShopTask: "Editou tarefa",
  updateSimulatedAdEstimate: "Editou estimativa de anúncio (simulador)", updateSimulatedExpense: "Editou despesa simulada",
  updateSopProcess: "Editou SOP", updateSopStep: "Editou etapa de SOP", updateTask: "Editou tarefa",
  updateUnitCost: "Alterou custo unitário", upsertCompanyGoal: "Definiu meta do mês", upsertGratitude: "Salvou gratidão",
  upsertMetaAdsIntegration: "Alterou integração Meta Ads", upsertOrderSettings: "Alterou configurações de pedidos da loja",
  upsertPricing: "Alterou precificação", upsertTrack123Integration: "Alterou integração Track123",
};

export function shouldAudit(name: string) { return !SKIP.has(name); }

// Dados enviados, sem senha/token, sem códigos internos (ids — lista de ids
// vira só a contagem) e com textos/listas longos cortados.
const SECRET_KEY = /pass|token|secret|api_?key|authorization/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DROP = Symbol("drop");
function sanitize(v: unknown, depth = 0): unknown {
  if (v == null || typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "string") {
    if (UUID.test(v)) return DROP;
    return v.length > 500 ? `${v.slice(0, 500)}…` : v;
  }
  if (depth > 4) return "…";
  if (Array.isArray(v)) {
    if (v.length && v.every((x) => typeof x === "string" && UUID.test(x))) return v.length;
    const head = v.slice(0, 20).map((x) => sanitize(x, depth + 1)).filter((x) => x !== DROP);
    return v.length > 20 ? [...head, `… +${v.length - 20} itens`] : head;
  }
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (SECRET_KEY.test(k)) { out[k] = "[oculto]"; continue; }
      const clean = sanitize(val, depth + 1);
      if (clean !== DROP) out[k] = clean;
    }
    return out;
  }
  return String(v);
}

// O token já foi validado pela própria ação (só registramos depois que ela deu
// certo), então aqui basta ler quem é do conteúdo dele.
function actorFromAuthHeader(auth: string | null): { id: string; email: string | null } | null {
  if (!auth?.startsWith("Bearer ")) return null;
  try {
    const payload = JSON.parse(Buffer.from(auth.slice(7).split(".")[1], "base64url").toString("utf8"));
    return payload?.sub ? { id: String(payload.sub), email: payload.email ?? null } : null;
  } catch { return null; }
}

async function ownerOf(userId: string): Promise<string> {
  const { data: role } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", userId).maybeSingle();
  if (role?.role !== "member") return userId;
  const { data: link } = await supabaseAdmin.from("workspace_members").select("owner_id").eq("member_id", userId).maybeSingle();
  return link?.owner_id ?? userId;
}

export async function recordAudit(name: string, data: unknown, authHeader: string | null) {
  const actor = actorFromAuthHeader(authHeader);
  if (!actor) return; // ação sem usuário (crons, webhooks) não entra
  const ownerId = await ownerOf(actor.id);
  const { error } = await supabaseAdmin.from("audit_log").insert({
    owner_id: ownerId,
    actor_id: actor.id,
    actor_email: actor.email,
    action: name,
    label: LABELS[name] ?? name,
    data: (() => {
      const clean = sanitize(data);
      return clean === DROP || (clean && typeof clean === "object" && !Object.keys(clean).length) ? null : clean;
    })() as any,
  });
  if (error) console.error("audit_log insert", name, error.message);
}

// Mais de 1 ano sai (job diário).
export async function purgeOldAudit() {
  const cutoff = new Date(Date.now() - 365 * 24 * 60 * 60_000).toISOString();
  const { error } = await supabaseAdmin.from("audit_log").delete().lt("created_at", cutoff);
  if (error) console.error("audit purge", error.message);
  return { ok: !error };
}
