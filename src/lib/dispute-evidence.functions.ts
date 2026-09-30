import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { collectEvidence, writeRebuttal } from "@/lib/dispute-evidence.server";

// Aba Chargebacks > "Documentos para a Shopify": junta as provas de uma disputa
// (envio/rastreio, conversa com o cliente, produto, dados da compra, políticas
// da loja) pra virar 6 PDFs em inglês (quem lê é o banco nos EUA) e um texto de
// defesa escrito pela IA com base só nesses fatos. A lógica fica em
// dispute-evidence.server.ts (só servidor).

export type DisputeEvidence = {
  store: { name: string; domain: string | null; supportEmail: string | null };
  dispute: { reason: string | null; type: string; amount: number; currency: string | null; initiatedAt: string; evidenceDueBy: string | null; status: string | null };
  order: {
    number: string | null; createdAt: string | null; total: string | null; currency: string | null;
    customerName: string | null; email: string | null; phone: string | null; ip: string | null; userAgent: string | null;
    shippingAddress: string[]; billingAddress: string[];
    items: { title: string; variant: string | null; quantity: number; price: string | null; sku: string | null; productId: string | null }[];
  };
  shipping: {
    carrier: string | null; trackingNumber: string | null; trackingUrl: string | null; shippedAt: string | null;
    status: string | null; deliveredAt: string | null;
    events: { time: string | null; description: string; location: string | null }[];
  };
  payment: { method: string | null; last4: string | null; avs: string | null; cvv: string | null; riskLevel: string | null; riskFacts: { description: string; sentiment: string }[] };
  products: { title: string; description: string | null; imageUrl: string | null; productType: string | null }[];
  communications: { sentAt: string; direction: "in" | "out"; from: string | null; to: string | null; subject: string | null; body: string }[];
  policies: { title: string; body: string }[];
  limited: boolean;   // pedido antigo (fora do sistema): menos dados disponíveis
};

type Ctx = { role: string; ownerId: string; permissions: { section: string }[] };
function assertAccess(ctx: Ctx) {
  if (ctx.role !== "admin" && !ctx.permissions.some((p) => p.section === "chargebacks")) throw new Error("Sem acesso a Chargebacks");
}

export const getDisputeEvidence = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ disputeId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    assertAccess(context);
    return collectEvidence(context.ownerId, data.disputeId);
  });

export const draftDisputeRebuttal = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ disputeId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    assertAccess(context);
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("Texto de defesa indisponível: falta a chave da IA (ANTHROPIC_API_KEY)");
    const ev = await collectEvidence(context.ownerId, data.disputeId);
    return { text: await writeRebuttal(ev) };
  });
