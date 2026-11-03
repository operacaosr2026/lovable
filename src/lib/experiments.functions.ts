import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { BASELINE_KEYS } from "@/lib/experiment-metrics";

// Aba Campanhas do produto (a tabela segue "experiments", do tempo da aba
// Testes). Os status são editáveis (um conjunto por workspace). Preencher a
// data de início gera o registro "Teste" no diário da campanha, com a data
// escrita (tipo criado se faltar); as que têm aprendizado escrito formam a
// visão Aprendizados da página Produtos.

export const METRICS = ["cpa", "roas", "ctr", "cvr", "aov", "other"] as const;
export const STATUS_COLORS = ["slate", "sky", "violet", "amber", "orange", "emerald", "rose"] as const;

export type Metric = (typeof METRICS)[number];
export type StatusColor = (typeof STATUS_COLORS)[number];
export type CampaignStatus = { id: string; name: string; color: StatusColor };
// Opção de "O que está testando" (editável no formulário da campanha).
export type CampaignKind = { id: string; name: string };

// Os ids são os das campanhas criadas antes das opções editáveis.
export const DEFAULT_KINDS: CampaignKind[] = [
  { id: "creative", name: "Criativo" }, { id: "campaign", name: "Tipo de campanha" }, { id: "placement", name: "Posicionamento" },
  { id: "page", name: "Página" }, { id: "offer", name: "Oferta / preço" }, { id: "other", name: "Outro" },
];
export const kindName = (kinds: CampaignKind[], id: string) => kinds.find((k) => k.id === id)?.name ?? "—";
export const METRIC_LABEL: Record<Metric, string> = {
  cpa: "Custo por compra (CPA)", roas: "ROAS", ctr: "CTR", cvr: "Conversão da página", aov: "Ticket médio", other: "Outra",
};
// Os ids "idea", "running" e "done" são os das campanhas criadas antes dos status editáveis.
export const DEFAULT_STATUSES: CampaignStatus[] = [
  { id: "running", name: "Testando", color: "sky" },
  { id: "idea", name: "Ideias", color: "slate" },
  { id: "done", name: "Concluído", color: "emerald" },
];

export type Experiment = {
  id: string; product_id: string; shop_id: string | null; campaign_id: string | null; campaign_name: string | null;
  baseline: Record<string, number>; tags: string[]; summary: Record<string, string | boolean>; kind: string; title: string; hypothesis: string;
  control: string; variant: string; metric: Metric; stop_rule: string; budget: number | null;
  status: string; learning: string; started_at: string | null; ended_at: string | null;
  created_at: string; updated_at: string;
};
export type Learning = Experiment & { product: { id: string; name: string; main_image_url: string | null } | null };

const COLS = "id,product_id,shop_id,campaign_id,campaign_name,baseline,tags,summary,kind,title,hypothesis,control,variant,metric,stop_rule,budget,status,learning,started_at,ended_at,created_at,updated_at";

const Fields = z.object({
  shop_id: z.string().uuid().nullable(),
  campaign_id: z.string().regex(/^\d{1,30}$/).nullable(),
  baseline: z.record(z.enum(BASELINE_KEYS as [string, ...string[]]), z.number().finite()),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).transform((t) => [...new Set(t)]),
  summary: z.record(z.string().max(60), z.union([z.string().max(4000), z.boolean()])),
  kind: z.string().min(1).max(40),
  title: z.string().trim().min(1).max(160),
  hypothesis: z.string().trim().max(2000),
  control: z.string().trim().max(1000),
  variant: z.string().trim().max(1000),
  metric: z.enum(METRICS),
  stop_rule: z.string().trim().max(1000),
  budget: z.number().nonnegative().max(1e9).nullable(),
  status: z.string().min(1).max(40),
  learning: z.string().trim().max(4000),
  started_at: z.string().date().nullable(),
  ended_at: z.string().date().nullable(),
});

async function assertProduct(ownerId: string, productId: string) {
  const { data } = await supabaseAdmin.from("products").select("id").eq("id", productId).eq("user_id", ownerId).maybeSingle();
  if (!data) throw new Error("Produto não encontrado");
}

// A campanha do teste sai das campanhas ligadas ao produto (aba Vendas); o
// nome é guardado junto pra aparecer mesmo se a ligação for desfeita.
async function campaignName(ownerId: string, productId: string, campaignId: string | null | undefined) {
  if (!campaignId) return null;
  const { data } = await supabaseAdmin.from("product_ad_campaigns").select("campaign_name")
    .eq("user_id", ownerId).eq("product_id", productId).eq("campaign_id", campaignId).maybeSingle();
  if (!data) throw new Error("Campanha não está ligada a este produto");
  return data.campaign_name ?? campaignId;
}

async function assertShop(ownerId: string, shopId: string | null | undefined) {
  if (!shopId) return;
  const { data } = await supabaseAdmin.from("shopify_stores").select("id").eq("id", shopId).eq("user_id", ownerId).maybeSingle();
  if (!data) throw new Error("Loja não encontrada");
}

async function loadStatuses(ownerId: string): Promise<CampaignStatus[]> {
  const { data, error } = await supabaseAdmin.from("campaign_status_templates").select("statuses").eq("user_id", ownerId).maybeSingle();
  if (error) throw new Error(error.message);
  const list = (data?.statuses ?? []) as CampaignStatus[];
  return list.length ? list.map(({ id, name, color }) => ({ id, name, color })) : DEFAULT_STATUSES;
}

async function loadKinds(ownerId: string): Promise<CampaignKind[]> {
  const { data, error } = await supabaseAdmin.from("campaign_kind_templates").select("kinds").eq("user_id", ownerId).maybeSingle();
  if (error) throw new Error(error.message);
  const list = (data?.kinds ?? []) as CampaignKind[];
  return list.length ? list : DEFAULT_KINDS;
}

function assertStatus(statuses: CampaignStatus[], id: string | undefined) {
  if (id !== undefined && !statuses.some((s) => s.id === id)) throw new Error("Status não existe mais; recarregue a página");
}



// ── Diário ──

async function diaryTypeId(ownerId: string, name: string, color: string) {
  const { data } = await supabaseAdmin.from("product_diary_note_types").select("id")
    .eq("user_id", ownerId).ilike("name", name).limit(1).maybeSingle();
  if (data) return data.id;
  const { count } = await supabaseAdmin.from("product_diary_note_types").select("id", { count: "exact", head: true }).eq("user_id", ownerId);
  const { data: created } = await supabaseAdmin.from("product_diary_note_types")
    .insert({ user_id: ownerId, name, color, position: count ?? 0 }).select("id").single();
  return created?.id ?? null;
}

function startNote(e: Experiment, kinds: CampaignKind[]) {
  return [
    `${START_PREFIX}${e.title} (${kindName(kinds, e.kind)})`,
    e.hypothesis && `Hipótese: ${e.hypothesis}`,
    (e.control || e.variant) && `${e.control || "Atual"} → ${e.variant || "Variação"}`,
    `Métrica: ${METRIC_LABEL[e.metric]}`,
    e.stop_rule && `Regra de parada: ${e.stop_rule}`,
  ].filter(Boolean).join("\n");
}

const START_PREFIX = "Campanha no ar: ";

// Registro "Teste" no diário da campanha, datado no dia de início escrito.
// Mudar a data move o registro; apagar a data apaga o registro.
// Falha aqui não desfaz a mudança: o diário é consequência, não condição.
async function syncStartNote(ownerId: string, userId: string, e: Experiment, prevStarted: string | null) {
  if (e.started_at === prevStarted) return;
  try {
    const { data: existing } = await supabaseAdmin.from("product_diary_entries").select("id")
      .eq("user_id", ownerId).eq("experiment_id", e.id).like("content", `${START_PREFIX}%`).limit(1).maybeSingle();
    if (!e.started_at) {
      if (existing) await supabaseAdmin.from("product_diary_entries").delete().eq("id", existing.id);
      return;
    }
    const created_at = `${e.started_at}T12:00:00Z`;
    if (existing) {
      await supabaseAdmin.from("product_diary_entries").update({ created_at }).eq("id", existing.id);
      return;
    }
    const [note_type_id, kinds] = await Promise.all([diaryTypeId(ownerId, "Teste", "purple"), loadKinds(ownerId)]);
    await supabaseAdmin.from("product_diary_entries").insert({
      user_id: ownerId, product_id: e.product_id, experiment_id: e.id, author_id: userId, note_type_id,
      content: startNote(e, kinds).slice(0, 10000), created_at,
    });
  } catch (err) {
    console.error("[experiments] diário:", err);
  }
}

// ── Campanhas do produto ──

export const listProductExperiments = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ product_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { ownerId } = context;
    await assertProduct(ownerId, data.product_id);
    const [rows, shops, campaigns, tagRows, statuses, kinds] = await Promise.all([
      supabaseAdmin.from("experiments").select(COLS).eq("user_id", ownerId).eq("product_id", data.product_id).order("created_at", { ascending: false }),
      supabaseAdmin.from("shopify_stores").select("id,name,shop_domain").eq("user_id", ownerId).eq("is_placeholder", false).order("name"),
      supabaseAdmin.from("product_ad_campaigns").select("campaign_id,campaign_name").eq("user_id", ownerId).eq("product_id", data.product_id),
      // Tags usadas em qualquer produto, pra sugerir ao digitar.
      supabaseAdmin.from("experiments").select("tags").eq("user_id", ownerId).filter("tags", "neq", "{}"),
      loadStatuses(ownerId),
      loadKinds(ownerId),
    ]);
    if (rows.error) throw new Error(rows.error.message);
    if (shops.error) throw new Error(shops.error.message);
    return {
      statuses,
      kinds,
      experiments: (rows.data ?? []) as Experiment[],
      shops: (shops.data ?? []).map((s) => ({ id: s.id, name: s.name || s.shop_domain || "Loja" })),
      campaigns: (campaigns.data ?? []).map((c) => ({ id: c.campaign_id, name: c.campaign_name || c.campaign_id })),
      allTags: [...new Set((tagRows.data ?? []).flatMap((r) => r.tags as string[]))].sort((a, b) => a.localeCompare(b)),
    };
  });

export const createExperiment = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => Fields.extend({ product_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { ownerId } = context;
    await assertProduct(ownerId, data.product_id);
    await assertShop(ownerId, data.shop_id);
    const statuses = await loadStatuses(ownerId);
    assertStatus(statuses, data.status);
    const campaign_name = await campaignName(ownerId, data.product_id, data.campaign_id);
    const { data: row, error } = await supabaseAdmin.from("experiments")
      .insert({ ...data, campaign_name, user_id: ownerId }).select(COLS).single();
    if (error) throw new Error(error.message);
    await syncStartNote(ownerId, context.userId, row as Experiment, null);
    return row as Experiment;
  });

export const updateExperiment = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => Fields.partial().extend({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { ownerId } = context;
    const { id, ...patch } = data;
    const { data: prev } = await supabaseAdmin.from("experiments").select("product_id,status,started_at,ended_at")
      .eq("id", id).eq("user_id", ownerId).maybeSingle();
    if (!prev) throw new Error("Campanha não encontrada");
    await assertShop(ownerId, patch.shop_id);
    const statuses = await loadStatuses(ownerId);
    assertStatus(statuses, patch.status);
    const extra = patch.campaign_id !== undefined ? { campaign_name: await campaignName(ownerId, prev.product_id, patch.campaign_id) } : {};
    const { data: row, error } = await supabaseAdmin.from("experiments")
      .update({ ...patch, ...extra }).eq("id", id).eq("user_id", ownerId).select(COLS).single();
    if (error) throw new Error(error.message);
    await syncStartNote(ownerId, context.userId, row as Experiment, prev.started_at);
    return row as Experiment;
  });

export const deleteExperiment = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await supabaseAdmin.from("experiments").delete().eq("id", data.id).eq("user_id", context.ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── Status ──

const StatusInput = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,40}$/),
  name: z.string().trim().min(1).max(40),
  color: z.enum(STATUS_COLORS),
});

// Campanhas num status que foi excluído vão pro primeiro da lista.
export const saveCampaignStatuses = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ statuses: z.array(StatusInput).min(1).max(20) }).parse(d))
  .handler(async ({ context, data }) => {
    const { ownerId } = context;
    const ids = data.statuses.map((s) => s.id);
    if (new Set(ids).size !== ids.length) throw new Error("Status repetido");
    const { error } = await supabaseAdmin.from("campaign_status_templates").upsert(
      { user_id: ownerId, statuses: data.statuses, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
    if (error) throw new Error(error.message);
    const { error: moveErr } = await supabaseAdmin.from("experiments").update({ status: ids[0] })
      .eq("user_id", ownerId).not("status", "in", `(${ids.join(",")})`);
    if (moveErr) throw new Error(moveErr.message);
    return { ok: true };
  });

// ── O que está testando ──

// Opção excluída não muda as campanhas que já a usam (aparecem com "—").
export const saveCampaignKinds = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    kinds: z.array(z.object({ id: z.string().regex(/^[a-z0-9_-]{1,40}$/), name: z.string().trim().min(1).max(40) })).min(1).max(40),
  }).parse(d))
  .handler(async ({ context, data }) => {
    if (new Set(data.kinds.map((k) => k.id)).size !== data.kinds.length) throw new Error("Opção repetida");
    const { error } = await supabaseAdmin.from("campaign_kind_templates").upsert(
      { user_id: context.ownerId, kinds: data.kinds, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── Aprendizados (todos os produtos) ──

export const listLearnings = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    const { ownerId } = context;
    const [statuses, kinds, { data, error }] = await Promise.all([
      loadStatuses(ownerId),
      loadKinds(ownerId),
      supabaseAdmin.from("experiments").select(COLS).eq("user_id", ownerId).neq("learning", "")
        .order("ended_at", { ascending: false, nullsFirst: false }).order("updated_at", { ascending: false }),
    ]);
    if (error) throw new Error(error.message);
    const ids = [...new Set((data ?? []).map((r) => r.product_id))];
    const { data: products } = ids.length
      ? await supabaseAdmin.from("products").select("id,name,main_image_url").eq("user_id", ownerId).in("id", ids)
      : { data: [] };
    const byId = new Map((products ?? []).map((p) => [p.id, p]));
    return { statuses, kinds, items: (data ?? []).map((r) => ({ ...r, product: byId.get(r.product_id) ?? null })) as Learning[] };
  });
