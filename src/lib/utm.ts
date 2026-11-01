// Padrão de UTM dos anúncios: "nome|id" em campanha, conjunto e anúncio. O
// nome é pra leitura; o id (depois do último "|") é o que casa pedido e
// Clarity com a Meta, porque não muda quando a campanha é renomeada.
export const STANDARD_URL_TAGS =
  "utm_source=facebook&utm_campaign={{campaign.name}}|{{campaign.id}}&utm_medium={{adset.name}}|{{adset.id}}&utm_content={{ad.name}}|{{ad.id}}&utm_term={{placement}}";

// UTMs antigas (só nome, digitado à mão) voltam com id null.
export function splitUtm(value: string | null | undefined): { name: string; id: string | null } {
  const v = (value ?? "").trim();
  const i = v.lastIndexOf("|");
  if (i < 0) return { name: v, id: null };
  const id = v.slice(i + 1).trim();
  return { name: v.slice(0, i).trim(), id: /^\d+$/.test(id) ? id : null };
}
