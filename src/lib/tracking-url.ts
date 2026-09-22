// Constrói a URL de rastreio a partir do template configurado por loja (ex:
// "https://minhaloja.com/apps/track123?nums=[CODE]"). Sem template, retorna
// null — quem chamar decide se cai pra outra fonte (ex: o que a Shopify manda).
export function buildTrackingUrl(template: string | null | undefined, trackingCode: string | null | undefined): string | null {
  if (!template || !trackingCode) return null;
  return template.replace("[CODE]", encodeURIComponent(trackingCode));
}
