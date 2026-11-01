import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { BASELINE_KEYS } from "@/lib/experiment-metrics";

// Aba Testes do produto. Iniciar e concluir um teste gera registro no Diário
// (tipos "Teste" e "Aprendizado", criados se faltarem); os concluídos formam
// a visão Aprendizados da página Produtos.

export const KINDS = ["creative", "campaign", "placement", "page", "offer", "other"] as const;
export const METRICS = ["cpa", "roas", "ctr", "cvr", "aov", "other"] as const;
export const STATUSES = ["idea", "running", "done"] as const;
export const RESULTS = ["won", "lost", "tie"] as const;

export type Kind = (typeof KINDS)[number];
export type Metric = (typeof METRICS)[number];
export type Status = (typeof STATUSES)[number];
export type Result = (typeof RESULTS)[number];

export const KIND_LABEL: Record<Kind, string> = {
  creative: "Criativo", campaign: "Tipo de campanha", placement: "Posicionamento", page: "Página", offer: "Oferta / preço", other: "Outro",
};
export const METRIC_LABEL: Record<Metric, string> = {
  cpa: "Custo por compra (CPA)", roas: "ROAS", ctr: "CTR", cvr: "Conversão da página", aov: "Ticket médio", other: "Outra",
};
export const STATUS_LABEL: Record<Status, string> = { idea: "Ideias", running: "Testando", done: "Concluído" };
export const RESULT_LABEL: Record<Result, string> = { won: "Validado", tie: "Inconclusivo", lost: "Rejeitado" };

export type Experiment = {
  id: string; product_id: string; shop_id: string | null; campaign_id: string | null; campaign_name: string | null;
  baseline: Record<string, number>; kind: Kind; title: string; hypothesis: string;
  control: string; variant: string; metric: Metric; stop_rule: string; budget: number | null;
  status: Status; result: Result | null; learning: string; started_at: string | null; ended_at: string | null;
  created_at: string; updated_at: string;
};
export type Learning = Experiment & { product: { id: string; name: string; main_image_url: string | null } | null };

const COLS = "id,product_id,shop_id,campaign_id,campaign_name,baseline,kind,title,hypothesis,control,variant,metric,stop_rule,budget,status,result,learning,started_at,ended_at,created_at,updated_at";
const today = () => new Date().toISOString().slice(0, 10);

const Fields = z.object({
  shop_id: z.string().uuid().nullable(),
  campaign_id: z.string().regex(/^\d{1,30}$/).nullable(),
  baseline: z.record(z.enum(BASELINE_KEYS as [string, ...string[]]), z.number().finite()),
  kind: z.enum(KINDS),
  title: z.string().trim().min(1).max(160),
  hypothesis: z.string().trim().max(2000),
  control: z.string().trim().max(1000),
  variant: z.string().trim().max(1000),
  metric: z.enum(METRICS),
  stop_rule: z.string().trim().max(1000),
  budget: z.number().nonnegative().max(1e9).nullable(),
  status: z.enum(STATUSES),
  result: z.enum(RESULTS).nullable(),
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

// Ao entrar em "Rodando" ou "Concluído" a data correspondente é preenchida se estiver vazia.
function withDates<T extends { status?: Status; started_at?: string | null; ended_at?: string | null }>(row: T, prev?: Pick<Experiment, "started_at" | "ended_at">): T {
  const out = { ...row };
  const started = out.started_at !== undefined ? out.started_at : prev?.started_at ?? null;
  const ended = out.ended_at !== undefined ? out.ended_at : prev?.ended_at ?? null;
  if ((out.status === "running" || out.status === "done") && !started) out.started_at = today();
  if (out.status === "done" && !ended) out.ended_at = today();
  return out;
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

function startNote(e: Experiment) {
  return [
    `Teste iniciado: ${e.title} (${KIND_LABEL[e.kind]})`,
    e.hypothesis && `Hipótese: ${e.hypothesis}`,
    (e.control || e.variant) && `${e.control || "Atual"} → ${e.variant || "Variação"}`,
    `Métrica: ${METRIC_LABEL[e.metric]}`,
    e.stop_rule && `Regra de parada: ${e.stop_rule}`,
  ].filter(Boolean).join("\n");
}

function resultNote(e: Experiment) {
  return [`Teste concluído: ${e.title} — ${e.result ? RESULT_LABEL[e.result] : "sem resultado"}`, e.learning].filter(Boolean).join("\n");
}

// Registro no Diário quando o teste entra em "Rodando" ou "Concluído". Falha
// aqui não desfaz o teste: o Diário é consequência, não condição.
async function logTransition(ownerId: string, userId: string, e: Experiment, prevStatus: Status | null) {
  const notes: { type: [string, string]; content: string }[] = [];
  if (e.status === "running" && prevStatus !== "running") notes.push({ type: ["Teste", "purple"], content: startNote(e) });
  if (e.status === "done" && prevStatus !== "done") notes.push({ type: ["Aprendizado", "green"], content: resultNote(e) });
  for (const n of notes) {
    try {
      const note_type_id = await diaryTypeId(ownerId, ...n.type);
      await supabaseAdmin.from("product_diary_entries").insert({
        user_id: ownerId, product_id: e.product_id, author_id: userId, note_type_id, content: n.content.slice(0, 10000),
      });
    } catch (err) {
      console.error("[experiments] diário:", err);
    }
  }
}

// ── Testes do produto ──

export const listProductExperiments = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ product_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { ownerId } = context;
    await assertProduct(ownerId, data.product_id);
    const [rows, shops, campaigns] = await Promise.all([
      supabaseAdmin.from("experiments").select(COLS).eq("user_id", ownerId).eq("product_id", data.product_id).order("created_at", { ascending: false }),
      supabaseAdmin.from("shopify_stores").select("id,name,shop_domain").eq("user_id", ownerId).eq("is_placeholder", false).order("name"),
      supabaseAdmin.from("product_ad_campaigns").select("campaign_id,campaign_name").eq("user_id", ownerId).eq("product_id", data.product_id),
    ]);
    if (rows.error) throw new Error(rows.error.message);
    if (shops.error) throw new Error(shops.error.message);
    return {
      experiments: (rows.data ?? []) as Experiment[],
      shops: (shops.data ?? []).map((s) => ({ id: s.id, name: s.name || s.shop_domain || "Loja" })),
      campaigns: (campaigns.data ?? []).map((c) => ({ id: c.campaign_id, name: c.campaign_name || c.campaign_id })),
    };
  });

export const createExperiment = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => Fields.extend({ product_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { ownerId } = context;
    await assertProduct(ownerId, data.product_id);
    await assertShop(ownerId, data.shop_id);
    const campaign_name = await campaignName(ownerId, data.product_id, data.campaign_id);
    const { data: row, error } = await supabaseAdmin.from("experiments")
      .insert({ ...withDates(data), campaign_name, user_id: ownerId }).select(COLS).single();
    if (error) throw new Error(error.message);
    await logTransition(ownerId, context.userId, row as Experiment, null);
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
    if (!prev) throw new Error("Teste não encontrado");
    await assertShop(ownerId, patch.shop_id);
    const extra = patch.campaign_id !== undefined ? { campaign_name: await campaignName(ownerId, prev.product_id, patch.campaign_id) } : {};
    const { data: row, error } = await supabaseAdmin.from("experiments")
      .update({ ...withDates(patch, prev), ...extra }).eq("id", id).eq("user_id", ownerId).select(COLS).single();
    if (error) throw new Error(error.message);
    await logTransition(ownerId, context.userId, row as Experiment, prev.status as Status);
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

// ── Aprendizados (todos os produtos) ──

export const listLearnings = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    const { ownerId } = context;
    const { data, error } = await supabaseAdmin.from("experiments").select(COLS)
      .eq("user_id", ownerId).eq("status", "done").not("result", "is", null).order("ended_at", { ascending: false });
    if (error) throw new Error(error.message);
    const ids = [...new Set((data ?? []).map((r) => r.product_id))];
    const { data: products } = ids.length
      ? await supabaseAdmin.from("products").select("id,name,main_image_url").eq("user_id", ownerId).in("id", ids)
      : { data: [] };
    const byId = new Map((products ?? []).map((p) => [p.id, p]));
    return (data ?? []).map((r) => ({ ...r, product: byId.get(r.product_id) ?? null })) as Learning[];
  });
