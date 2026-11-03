import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Aba Inteligência › Esteira de Testes do produto: a lista de testes é uma só
// por workspace (igual em todos os produtos), editada em Configurações ›
// Templates › Esteira de testes; o ✓ de cada item é por produto.

export type PipelineItem = { id: string; text: string };

const Item = z.object({ id: z.string().regex(/^[a-z0-9_-]{1,40}$/), text: z.string().trim().min(1).max(300) });

async function assertProduct(ownerId: string, productId: string) {
  const { data } = await supabaseAdmin.from("products").select("id").eq("id", productId).eq("user_id", ownerId).maybeSingle();
  if (!data) throw new Error("Produto não encontrado");
}

export const getTestPipelineItems = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    const { data, error } = await supabaseAdmin.from("test_pipeline_templates").select("items").eq("user_id", context.ownerId).maybeSingle();
    if (error) throw new Error(error.message);
    return (data?.items ?? []) as PipelineItem[];
  });

export const getTestPipeline = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ product_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { ownerId } = context;
    await assertProduct(ownerId, data.product_id);
    const [tpl, checks] = await Promise.all([
      supabaseAdmin.from("test_pipeline_templates").select("items").eq("user_id", ownerId).maybeSingle(),
      supabaseAdmin.from("product_test_pipeline_checks").select("item_id,checked_at").eq("user_id", ownerId).eq("product_id", data.product_id),
    ]);
    if (tpl.error) throw new Error(tpl.error.message);
    if (checks.error) throw new Error(checks.error.message);
    return {
      items: (tpl.data?.items ?? []) as PipelineItem[],
      checked: Object.fromEntries((checks.data ?? []).map((c) => [c.item_id, c.checked_at])) as Record<string, string>,
    };
  });

export const saveTestPipelineItems = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ items: z.array(Item).max(200) }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await supabaseAdmin.from("test_pipeline_templates").upsert(
      { user_id: context.ownerId, items: data.items, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setTestPipelineCheck = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ product_id: z.string().uuid(), item_id: Item.shape.id, checked: z.boolean() }).parse(d))
  .handler(async ({ context, data }) => {
    const { ownerId } = context;
    await assertProduct(ownerId, data.product_id);
    const { error } = data.checked
      ? await supabaseAdmin.from("product_test_pipeline_checks").upsert(
        { user_id: ownerId, product_id: data.product_id, item_id: data.item_id, checked_at: new Date().toISOString() },
        { onConflict: "product_id,item_id" },
      )
      : await supabaseAdmin.from("product_test_pipeline_checks").delete()
        .eq("user_id", ownerId).eq("product_id", data.product_id).eq("item_id", data.item_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
