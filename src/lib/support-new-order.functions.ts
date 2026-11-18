import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { shopifyGql } from "@/lib/chargeback-recovery.server";
import { assertSupportAccess as assertAccess, personName, type SupportCtx as Ctx } from "@/lib/support-approval.server";

// Atendimento › Pedidos › Gerar pedido: cliente que não conseguiu fechar a
// compra no site (ex.: carrinho que não deixa tirar um item). A equipe monta o
// pedido com os dados dela e a Shopify cria um rascunho com link de pagamento
// (checkout da própria loja). O link vai na resposta; quando ela paga, vira
// pedido normal e entra pelo sync como qualquer outro. Cliente paga → sem
// aprovação.

export const NEW_ORDER_TAG = "pedido-atendimento";

export type NewOrderVariant = { id: string; title: string; sku: string | null; available: boolean; price: number };
export type NewOrderProduct = { id: string; title: string; image: string | null; variants: NewOrderVariant[]; sold?: number };

const PRODUCT_FIELDS = `id title status featuredMedia { preview { image { url } } }
  variants(first: 100) { nodes { id title sku availableForSale price } }`;

const toProduct = (p: any): NewOrderProduct => ({
  id: p.id, title: p.title, image: p.featuredMedia?.preview?.image?.url ?? null,
  variants: ((p.variants?.nodes ?? []) as any[]).map((v) => ({
    id: v.id, title: v.title, sku: v.sku || null, available: !!v.availableForSale, price: Number(v.price ?? 0),
  })),
});

async function assertShop(ownerId: string, shopId: string) {
  const { data } = await supabaseAdmin.from("shops").select("id,name").eq("id", shopId).eq("user_id", ownerId).maybeSingle();
  if (!data) throw new Error("Loja não encontrada");
  return data as { id: string; name: string };
}

// Catálogo ativo da loja (até 250), mais vendidos dos últimos 60 dias primeiro —
// a equipe nem sempre sabe o nome do produto; o filtro por nome é feito na tela.
export const listNewOrderProducts = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ shopId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    assertAccess(context as Ctx);
    await assertShop(context.ownerId, data.shopId);
    const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
    const [res, sales] = await Promise.all([
      shopifyGql(data.shopId, `{
        products(first: 250, query: "status:active", sortKey: UPDATED_AT, reverse: true) { nodes { ${PRODUCT_FIELDS} } }
      }`, {}),
      supabaseAdmin.from("shop_orders").select("items:raw->line_items")
        .eq("user_id", context.ownerId).eq("shop_id", data.shopId).gte("created_at_shopify", since).limit(3000),
    ]);
    const sold = new Map<string, number>();
    for (const o of (sales.data ?? []) as { items: any[] | null }[]) {
      for (const l of o.items ?? []) {
        if (l?.product_id) sold.set(`gid://shopify/Product/${l.product_id}`, (sold.get(`gid://shopify/Product/${l.product_id}`) ?? 0) + Number(l.quantity ?? 1));
      }
    }
    const products = ((res?.products?.nodes ?? []) as any[]).map((p) => ({ ...toProduct(p), sold: sold.get(p.id) ?? 0 }));
    // Estável: empate (inclusive 0 vendas) mantém a ordem da Shopify (atualizado por último).
    return products.map((p, i) => ({ p, i })).sort((a, b) => b.p.sold - a.p.sold || a.i - b.i).map(({ p }) => p);
  });

const AddressInput = z.object({
  address1: z.string().trim().min(1).max(200),
  address2: z.string().trim().max(200).nullable(),
  city: z.string().trim().min(1).max(100),
  province_code: z.string().trim().max(10).nullable(),
  zip: z.string().trim().min(1).max(20),
  country_code: z.string().trim().length(2),
});
export type NewOrderAddress = z.infer<typeof AddressInput>;

export const createSupportOrder = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    shopId: z.string().uuid(),
    conversationId: z.string().uuid().nullable(),
    email: z.string().trim().email().max(200),
    firstName: z.string().trim().max(100).nullable(),
    lastName: z.string().trim().max(100).nullable(),
    phone: z.string().trim().max(40).nullable(),
    items: z.array(z.object({
      variant_id: z.string().regex(/^gid:\/\/shopify\/ProductVariant\/\d+$/),
      quantity: z.number().int().min(1).max(20),
    })).min(1).max(20),
    // Frete cobrado no link (0 = sem frete). O checkout do rascunho não calcula
    // frete sozinho: o que vai aqui é o que a cliente paga.
    shipping: z.number().min(0).max(1000),
    discountPercent: z.number().min(0).max(100),
    // null = a cliente preenche o endereço no checkout.
    address: AddressInput.nullable(),
    note: z.string().trim().max(1000).nullable(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    assertAccess(ctx);
    const shop = await assertShop(ctx.ownerId, data.shopId);
    const who = await personName(ctx.userId);

    let currency = "USD";
    if (data.shipping > 0) {
      const s = await shopifyGql(data.shopId, `{ shop { currencyCode } }`, {});
      currency = s?.shop?.currencyCode ?? currency;
    }
    const name = { firstName: data.firstName || null, lastName: data.lastName || null };
    const address = data.address ? {
      ...name, address1: data.address.address1, address2: data.address.address2 || null, city: data.address.city,
      provinceCode: data.address.province_code || null, zip: data.address.zip, countryCode: data.address.country_code.toUpperCase(),
      phone: data.phone || null,
    } : undefined;

    const out = (await shopifyGql(data.shopId, `mutation SupportOrderDraft($input: DraftOrderInput!) {
      draftOrderCreate(input: $input) { draftOrder { id name invoiceUrl totalPriceSet { shopMoney { amount currencyCode } } } userErrors { field message } }
    }`, {
      input: {
        email: data.email,
        phone: data.phone || undefined,
        shippingAddress: address,
        billingAddress: address,
        lineItems: data.items.map((i) => ({ variantId: i.variant_id, quantity: i.quantity })),
        appliedDiscount: data.discountPercent > 0
          ? { valueType: "PERCENTAGE", value: data.discountPercent, title: "Atendimento" } : undefined,
        shippingLine: data.shipping > 0
          ? { title: "Shipping", priceWithCurrency: { amount: data.shipping.toFixed(2), currencyCode: currency } } : undefined,
        tags: [NEW_ORDER_TAG],
        note: `Pedido montado pelo atendimento (${who}) no SRX Growth.${data.note ? ` Obs.: ${data.note}` : ""}`,
      },
    }))?.draftOrderCreate;
    if (out?.userErrors?.length) throw new Error(out.userErrors.map((e: any) => e.message).join("; ").slice(0, 200));
    const d = out?.draftOrder;
    if (!d?.invoiceUrl) throw new Error("A Shopify não devolveu o link de pagamento");

    // Nome da cliente na conversa (formulário de contato às vezes chega sem).
    if (data.conversationId) {
      const full = [data.firstName, data.lastName].filter(Boolean).join(" ");
      if (full) await supabaseAdmin.from("support_conversations").update({ customer_name: full })
        .eq("id", data.conversationId).eq("owner_id", ctx.ownerId).is("customer_name", null);
    }
    return {
      store: shop.name, draftName: d.name as string, invoiceUrl: d.invoiceUrl as string,
      total: Number(d.totalPriceSet?.shopMoney?.amount ?? 0), currency: (d.totalPriceSet?.shopMoney?.currencyCode as string) ?? currency,
    };
  });
