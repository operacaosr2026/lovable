import { raiseNotification, resolveNotification } from "@/lib/notifications.server";

// Erros de rotinas automáticas (sync, webhooks, jobs diários, IA…) que antes só
// iam pro log da Vercel: cada um vira um aviso "Erros do sistema" no sino, com
// chave própria ("system:<o que>:<id>") — o mesmo erro repetido atualiza o mesmo
// aviso, e quando a rotina volta a funcionar o aviso some (clearSystemError).
// Nunca lançam: avisar do erro não pode derrubar a rotina.

export const SYSTEM_PREFIX = "system:";

function errText(e: unknown) {
  const msg = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
  return String(msg ?? "Erro desconhecido").slice(0, 240);
}

export async function reportSystemError(
  ownerId: string | null | undefined, key: string, title: string, e: unknown, link: string | null = null,
) {
  if (!ownerId) return;
  try {
    await raiseNotification(ownerId, `${SYSTEM_PREFIX}${key}`, { level: "error", title, body: errText(e), link });
  } catch (err) {
    console.error("reportSystemError", key, err);
  }
}

export async function clearSystemError(ownerId: string | null | undefined, key: string) {
  if (!ownerId) return;
  try {
    await resolveNotification(ownerId, `${SYSTEM_PREFIX}${key}`);
  } catch (err) {
    console.error("clearSystemError", key, err);
  }
}

// Atalho pro padrão "roda; deu erro → avisa; deu certo → limpa o aviso".
export async function tracked<T>(
  ownerId: string | null | undefined, key: string, title: string, fn: () => Promise<T>, link: string | null = null,
): Promise<T | undefined> {
  try {
    const r = await fn();
    await clearSystemError(ownerId, key);
    return r;
  } catch (e) {
    console.error(key, e);
    await reportSystemError(ownerId, key, title, e, link);
    return undefined;
  }
}

// Nome da loja pro título do aviso (cache por instância da função).
const shopNames = new Map<string, string>();
export async function shopLabel(shopId: string | null | undefined): Promise<string> {
  if (!shopId) return "Loja";
  if (shopNames.has(shopId)) return shopNames.get(shopId)!;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.from("shops").select("name").eq("id", shopId).maybeSingle();
  const name = (data?.name as string | undefined) ?? "Loja";
  shopNames.set(shopId, name);
  return name;
}

// Rotina que caiu inteira (sem saber de qual workspace era o problema): avisa
// todos os donos de workspace.
async function allOwners(): Promise<string[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.from("shops").select("user_id");
  return [...new Set(((data ?? []) as { user_id: string }[]).map((r) => r.user_id))];
}
export async function reportSystemErrorAll(key: string, title: string, e: unknown) {
  try { for (const o of await allOwners()) await reportSystemError(o, key, title, e); }
  catch (err) { console.error("reportSystemErrorAll", key, err); }
}
export async function clearSystemErrorAll(key: string) {
  try { for (const o of await allOwners()) await clearSystemError(o, key); }
  catch (err) { console.error("clearSystemErrorAll", key, err); }
}

// Teto de páginas atingido (dado do período incompleto): avisa o dono da loja.
export function reportPaginationCap(fnName: string, domain: string) {
  void (async () => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data } = await supabaseAdmin.from("shopify_stores").select("user_id,name").eq("shop_domain", domain);
      for (const st of (data ?? []) as any[]) {
        await reportSystemError(st.user_id, `pagination:${domain}:${fnName}`, `Shopify: dado incompleto — ${st.name ?? domain}`,
          `${fnName} atingiu o limite de páginas antes de trazer tudo; o período pode estar incompleto.`);
      }
    } catch (err) { console.error("reportPaginationCap", err); }
  })();
}
