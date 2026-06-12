import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";

export const PRODUCT_STATUSES = ["ativo", "teste", "escala", "pausado", "arquivado"] as const;
export const CREATIVE_STATUSES = ["lancar", "validacao", "aprovado", "rejeitado"] as const;

const ProductInput = z.object({
  name: z.string().trim().min(1).max(160),
  niche: z.string().trim().max(80).nullable().optional(),
  supplier: z.string().trim().max(160).nullable().optional(),
  cost: z.number().nonnegative().default(0),
  sale_price: z.number().nonnegative().default(0),
  description: z.string().max(4000).nullable().optional(),
  status: z.enum(PRODUCT_STATUSES).default("ativo"),
  main_image_url: z.string().max(2_000_000).nullable().optional(),
});

// ---------- products ----------
export const listProducts = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    const { data: rows, error } = await context.supabase
      .from("products").select("*").eq("user_id", context.ownerId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const ids = (rows ?? []).map((r: any) => r.id);
    let pricingMap: Record<string, any> = {};
    if (ids.length) {
      const { data: pr } = await context.supabase.from("product_pricing").select("*").in("product_id", ids);
      pricingMap = Object.fromEntries((pr ?? []).map((p: any) => [p.product_id, p]));
    }
    return {
      products: (rows ?? []).map((r: any) => {
        const p = pricingMap[r.id];
        const fixedPct = p ? Number(p.iof_pct ?? 0) + Number(p.payments_pct ?? 0) + Number(p.dom_pagamentos_pct ?? 0) + Number(p.retorno_chargeback_pct ?? 0) + Number(p.imposto_pct ?? 0) : 0;
        const mktPct = p ? Number(p.marketing_pct ?? 0) : 0;
        const sale = Number(r.sale_price ?? 0);
        const cost = Number(r.cost ?? 0);
        const fixed = sale * (fixedPct / 100);
        const cpa = sale * (mktPct / 100);
        const profit = sale - cost - fixed - cpa;
        return { ...r, est_profit: profit };
      }),
    };
  });

export const getProduct = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: product, error } = await context.supabase
      .from("products").select("*").eq("id", data.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!product) throw new Error("Produto não encontrado");
    const { data: pricing } = await context.supabase
      .from("product_pricing").select("*").eq("product_id", data.id).maybeSingle();
    return { product, pricing: pricing ?? null };
  });

export const createProduct = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => ProductInput.parse(d))
  .handler(async ({ context, data }) => {
    const { data: row, error } = await context.supabase.from("products").insert({
      user_id: context.ownerId,
      name: data.name,
      niche: data.niche ?? null,
      supplier: data.supplier ?? null,
      cost: data.cost,
      sale_price: data.sale_price,
      description: data.description ?? null,
      status: data.status,
      main_image_url: data.main_image_url ?? null,
    }).select().single();
    if (error) throw new Error(error.message);
    // create empty pricing row
    await context.supabase.from("product_pricing").insert({ product_id: row.id, user_id: context.ownerId });
    return { product: row };
  });

export const updateProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    id: z.string().uuid(),
    patch: ProductInput.partial(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("products").update(data.patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("products").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- pricing ----------
const PricingInput = z.object({
  product_id: z.string().uuid(),
  iof_pct: z.number().min(0).max(1000).default(0),
  payments_pct: z.number().min(0).max(1000).default(0),
  dom_pagamentos_pct: z.number().min(0).max(1000).default(0),
  retorno_chargeback_pct: z.number().min(0).max(1000).default(0),
  imposto_pct: z.number().min(0).max(1000).default(0),
  marketing_pct: z.number().min(0).max(1000).default(0),
});

export const upsertPricing = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => PricingInput.parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("product_pricing").upsert({
      product_id: data.product_id,
      user_id: context.ownerId,
      iof_pct: data.iof_pct,
      payments_pct: data.payments_pct,
      dom_pagamentos_pct: data.dom_pagamentos_pct,
      retorno_chargeback_pct: data.retorno_chargeback_pct,
      imposto_pct: data.imposto_pct,
      marketing_pct: data.marketing_pct,
    }, { onConflict: "product_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- images ----------
export const listProductImages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ product_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: rows, error } = await context.supabase
      .from("product_images").select("*").eq("product_id", data.product_id)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return { images: rows ?? [] };
  });

export const addProductImage = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    product_id: z.string().uuid(),
    file_path: z.string().min(1).max(500),
    file_url: z.string().max(2_000_000).nullable().optional(),
    file_name: z.string().max(300).nullable().optional(),
    mime_type: z.string().max(120).nullable().optional(),
    size_bytes: z.number().int().nullable().optional(),
    set_main: z.boolean().optional(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: top } = await context.supabase
      .from("product_images").select("position").eq("product_id", data.product_id)
      .order("position", { ascending: false }).limit(1).maybeSingle();
    const position = (top?.position ?? 0) + 1;
    const { data: existing } = await context.supabase
      .from("product_images").select("id").eq("product_id", data.product_id).limit(1).maybeSingle();
    const isFirst = !existing;
    const setMain = data.set_main || isFirst;
    if (setMain) {
      await context.supabase.from("product_images").update({ is_main: false }).eq("product_id", data.product_id);
    }
    const { data: row, error } = await context.supabase.from("product_images").insert({
      user_id: context.ownerId,
      product_id: data.product_id,
      file_path: data.file_path,
      file_url: data.file_url ?? null,
      file_name: data.file_name ?? null,
      mime_type: data.mime_type ?? null,
      size_bytes: data.size_bytes ?? null,
      is_main: setMain,
      position,
    }).select().single();
    if (error) throw new Error(error.message);
    if (setMain && data.file_url) {
      await context.supabase.from("products").update({ main_image_url: data.file_url }).eq("id", data.product_id);
    }
    return { image: row };
  });

export const setMainImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: img } = await context.supabase.from("product_images").select("*").eq("id", data.id).maybeSingle();
    if (!img) throw new Error("Imagem não encontrada");
    await context.supabase.from("product_images").update({ is_main: false }).eq("product_id", img.product_id);
    await context.supabase.from("product_images").update({ is_main: true }).eq("id", data.id);
    if (img.file_url) {
      await context.supabase.from("products").update({ main_image_url: img.file_url }).eq("id", img.product_id);
    }
    return { ok: true };
  });

export const deleteProductImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: img } = await context.supabase.from("product_images").select("*").eq("id", data.id).maybeSingle();
    if (!img) return { ok: true };
    await context.supabase.storage.from("project-attachments").remove([img.file_path]);
    await context.supabase.from("product_images").delete().eq("id", data.id);
    if (img.is_main) {
      const { data: next } = await context.supabase.from("product_images").select("*")
        .eq("product_id", img.product_id).order("position", { ascending: true }).limit(1).maybeSingle();
      if (next) {
        await context.supabase.from("product_images").update({ is_main: true }).eq("id", next.id);
        await context.supabase.from("products").update({ main_image_url: next.file_url ?? null }).eq("id", img.product_id);
      } else {
        await context.supabase.from("products").update({ main_image_url: null }).eq("id", img.product_id);
      }
    }
    return { ok: true };
  });

// ---------- templates ----------
export const listProductTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ product_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: rows, error } = await context.supabase
      .from("product_templates").select("*").eq("product_id", data.product_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { templates: rows ?? [] };
  });

export const addProductTemplate = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    product_id: z.string().uuid(),
    kind: z.enum(["zip", "html", "json", "link", "file"]).default("file"),
    file_path: z.string().max(500).nullable().optional(),
    file_url: z.string().max(2_000_000).nullable().optional(),
    file_name: z.string().max(300).nullable().optional(),
    mime_type: z.string().max(120).nullable().optional(),
    size_bytes: z.number().int().nullable().optional(),
    pagefly_url: z.string().max(2000).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: row, error } = await context.supabase.from("product_templates").insert({
      user_id: context.ownerId,
      product_id: data.product_id,
      kind: data.kind,
      file_path: data.file_path ?? null,
      file_url: data.file_url ?? null,
      file_name: data.file_name ?? null,
      mime_type: data.mime_type ?? null,
      size_bytes: data.size_bytes ?? null,
      pagefly_url: data.pagefly_url ?? null,
      notes: data.notes ?? null,
    }).select().single();
    if (error) throw new Error(error.message);
    return { template: row };
  });

export const deleteProductTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: t } = await context.supabase.from("product_templates").select("file_path").eq("id", data.id).maybeSingle();
    if (t?.file_path) await context.supabase.storage.from("project-attachments").remove([t.file_path]);
    await context.supabase.from("product_templates").delete().eq("id", data.id);
    return { ok: true };
  });

// ---------- creatives ----------
const CreativeInput = z.object({
  product_id: z.string().uuid(),
  name: z.string().max(200).default(""),
  title: z.string().max(200).default(""),
  description: z.string().max(2000).nullable().optional(),
  titles: z.array(z.string().max(500)).max(50).optional(),
  descriptions: z.array(z.string().max(2000)).max(50).optional(),
  status: z.enum(CREATIVE_STATUSES).default("lancar"),
  media_url: z.string().max(2_000_000).nullable().optional(),
  media_path: z.string().max(500).nullable().optional(),
  media_kind: z.enum(["video", "image"]).nullable().optional(),
});

export const listCreatives = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ product_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: rows, error } = await context.supabase
      .from("product_creatives").select("*").eq("product_id", data.product_id)
      .order("position", { ascending: true })
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { creatives: rows ?? [] };
  });

export const createCreative = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => CreativeInput.parse(d))
  .handler(async ({ context, data }) => {
    const { data: top } = await context.supabase
      .from("product_creatives").select("position")
      .eq("product_id", data.product_id).eq("status", data.status)
      .order("position", { ascending: true }).limit(1).maybeSingle();
    const position = (top?.position ?? 0) - 1;
    const { data: row, error } = await context.supabase.from("product_creatives").insert({
      user_id: context.ownerId,
      product_id: data.product_id,
      name: data.name ?? "",
      title: data.title,
      description: data.description ?? null,
      titles: data.titles ?? [],
      descriptions: data.descriptions ?? [],
      status: data.status,
      media_url: data.media_url ?? null,
      media_path: data.media_path ?? null,
      media_kind: data.media_kind ?? null,
      position,
    }).select().single();
    if (error) throw new Error(error.message);
    return { creative: row };
  });

export const duplicateCreative = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: src, error: e1 } = await context.supabase
      .from("product_creatives").select("*").eq("id", data.id).maybeSingle();
    if (e1) throw new Error(e1.message);
    if (!src) throw new Error("Criativo não encontrado");
    const { data: top } = await context.supabase
      .from("product_creatives").select("position")
      .eq("product_id", src.product_id).eq("status", src.status)
      .order("position", { ascending: true }).limit(1).maybeSingle();
    const position = (top?.position ?? 0) - 1;
    const { data: row, error } = await context.supabase.from("product_creatives").insert({
      user_id: context.ownerId,
      product_id: src.product_id,
      name: src.name ? `${src.name} (cópia)` : (src.title ? `${src.title} (cópia)` : ""),
      title: src.title,
      description: src.description,
      titles: src.titles ?? [],
      descriptions: src.descriptions ?? [],
      status: src.status,
      media_url: src.media_url,
      media_path: src.media_path,
      media_kind: src.media_kind,
      position,
    }).select().single();
    if (error) throw new Error(error.message);
    return { creative: row };
  });

export const updateCreative = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    id: z.string().uuid(),
    patch: CreativeInput.partial().omit({ product_id: true }).extend({ position: z.number().optional() }),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("product_creatives").update(data.patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteCreative = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: c } = await context.supabase.from("product_creatives").select("media_path").eq("id", data.id).maybeSingle();
    if (c?.media_path) await context.supabase.storage.from("project-attachments").remove([c.media_path]);
    await context.supabase.from("product_creatives").delete().eq("id", data.id);
    return { ok: true };
  });
