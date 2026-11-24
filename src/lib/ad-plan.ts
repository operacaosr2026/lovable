import { fileBaseName, pad2, renderName, type NamingTemplates } from "@/lib/naming";

// Árvore que vai pra Meta: campanha › conjuntos › anúncios, já com os nomes.
// Montada no navegador (pra mostrar a revisão) e enviada pronta pro servidor.

export type Distribution = "per_creative" | "together" | "single_ad";
export type MultiFormat = "flexible" | "carousel";
export type AdFormat = "single" | MultiFormat;

export type PlanCreative = { id: string; name: string; kind: "video" | "image"; folder?: string };
export type PlanAd = { key: string; name: string; format: AdFormat; creative_ids: string[] };
export type PlanAdset = { key: string; name: string; ads: PlanAd[] };
export type Plan = { campaign_name: string; adsets: PlanAdset[] };

export const MULTI_MIN = 2;
export const MULTI_MAX = 10;

export type PlanInput = {
  creatives: PlanCreative[];
  distribution: Distribution;
  multiFormat: MultiFormat;
  templates: NamingTemplates;
  // Códigos da campanha/conjunto/anúncio comuns a tudo (produto, data, páginas...) + os inventados.
  values: Record<string, string>;
  // Nomes editados à mão na revisão (chave do nó → nome).
  overrides?: Record<string, string>;
};

const FORMAT_CODE: Record<AdFormat, (c?: PlanCreative) => string> = {
  single: (c) => (c?.kind === "video" ? "VID" : "IMG"),
  flexible: () => "FLEX",
  carousel: () => "CAR",
};

export function buildPlan(input: PlanInput): Plan {
  const { creatives, distribution, multiFormat, templates, values, overrides = {} } = input;
  const pick = (key: string, auto: string) => (overrides[key]?.trim() ? overrides[key].trim() : auto);

  type Draft = { creatives: PlanCreative[]; format: AdFormat }[];
  const groups: Draft[] =
    distribution === "per_creative" ? creatives.map((c) => [{ creatives: [c], format: "single" as const }])
    : distribution === "together" ? (creatives.length ? [creatives.map((c) => ({ creatives: [c], format: "single" as const }))] : [])
    : creatives.length ? [[{ creatives, format: multiFormat }]] : [];

  const adValues = (ad: Draft[number], adIndex: number) => {
    const first = ad.creatives[0];
    return {
      nome_do_criativo: ad.creatives.length === 1 ? fileBaseName(first?.name ?? "") : ad.creatives.map((c) => fileBaseName(c.name)).join(" + ").slice(0, 120),
      formato: FORMAT_CODE[ad.format](first),
      // Vários criativos de pastas diferentes no mesmo anúncio: "Preto + Branco".
      pasta: [...new Set(ad.creatives.map((c) => c.folder).filter(Boolean))].join(" + "),
      numero_anuncio: pad2(adIndex + 1),
    };
  };

  const adsets: PlanAdset[] = groups.map((ads, si) => {
    const setKey = `s${si}`;
    const setValues = { ...values, numero_conjunto: pad2(si + 1), ...(ads[0] ? adValues(ads[0], 0) : {}) };
    return {
      key: setKey,
      name: pick(setKey, renderName(templates.adset, setValues) || `Conjunto ${pad2(si + 1)}`),
      ads: ads.map((ad, ai) => {
        const key = `${setKey}a${ai}`;
        const auto = renderName(templates.ad, { ...values, numero_conjunto: pad2(si + 1), ...adValues(ad, ai) });
        return { key, name: pick(key, auto || `Anúncio ${pad2(ai + 1)}`), format: ad.format, creative_ids: ad.creatives.map((c) => c.id) };
      }),
    };
  });

  return { campaign_name: pick("campaign", renderName(templates.campaign, values) || "Campanha"), adsets };
}
