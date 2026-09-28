// Tipos de notificação (sino + push no celular). Cada aviso do sino é
// identificado por uma `key` com prefixo (ex.: "meta_token:<shop_id>"); o
// prefixo diz o tipo. O admin libera os tipos por membro em Configurações >
// Membros (seções nt_*, dentro de "Notificações"); cada pessoa liga/desliga os
// seus em Configurações > Notificações. Usado no servidor e na tela.

export const NOTIFICATION_CATEGORIES = [
  { key: "nt_meta", label: "Meta", desc: "Token da Meta vencendo e conta de anúncio com erro", prefixes: ["meta_token:", "meta_account:"] },
  { key: "nt_shopify", label: "Shopify", desc: "Sincronização com erro, reembolsos e acesso negado", prefixes: ["shopify_sync:", "shopify_refunds:", "shopify_access:"] },
  { key: "nt_disputas", label: "Disputas", desc: "Chargeback e inquiry aguardando resposta", prefixes: ["dispute:"] },
  { key: "nt_rastreio", label: "Rastreio", desc: "Track123 com erro ou sem atualizar", prefixes: ["track123:"] },
  { key: "nt_atendimento", label: "Atendimento", desc: "Zoho Mail com erro ou parado", prefixes: ["zoho_mail:"] },
  { key: "nt_tarefas", label: "Tarefas", desc: "Tarefa concluída", prefixes: ["task_done:"] },
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number]["key"];
export const NOTIFICATION_CATEGORY_KEYS = NOTIFICATION_CATEGORIES.map((c) => c.key) as NotificationCategory[];

// Tipo de um aviso pela key; null = aviso sem tipo (aparece pra quem tem o sino).
export function categoryOfKey(key: string): NotificationCategory | null {
  return NOTIFICATION_CATEGORIES.find((c) => c.prefixes.some((p) => key.startsWith(p)))?.key ?? null;
}

// Tipos que a pessoa pode receber: admin, todos; membro, os liberados (e só
// se tiver o sino — seção "notificacoes").
export function allowedCategories(role: string, permissions: { section: string }[]): Set<NotificationCategory> {
  if (role === "admin") return new Set(NOTIFICATION_CATEGORY_KEYS);
  if (!permissions.some((p) => p.section === "notificacoes")) return new Set();
  return new Set(NOTIFICATION_CATEGORY_KEYS.filter((k) => permissions.some((p) => p.section === k)));
}
