// Modelo de nomes de campanha, conjunto e anúncio: texto livre com códigos
// {{assim}}. Os códigos conhecidos o sistema preenche ao publicar; os que a
// pessoa inventa viram caixinhas pra preencher na hora.

export const NAMING_LEVELS = ["campaign", "adset", "ad"] as const;
export type NamingLevel = (typeof NAMING_LEVELS)[number];
export type NamingTemplates = Record<NamingLevel, string>;

export const LEVEL_LABEL: Record<NamingLevel, string> = { campaign: "Campanha", adset: "Conjunto", ad: "Anúncio" };

export type NamingCode = { code: string; label: string; example: string; level: NamingLevel };

// level = onde o código nasce. Códigos de cima valem embaixo (o conjunto usa os
// da campanha; o anúncio usa todos). Os do anúncio também valem no conjunto e
// vêm do primeiro anúncio dele — útil no teste com 1 conjunto por criativo.
export const NAMING_CODES: NamingCode[] = [
  { level: "campaign", code: "produto", label: "Produto", example: "Bolsa Couro" },
  { level: "campaign", code: "loja", label: "Loja (card)", example: "Voultie" },
  { level: "campaign", code: "conta", label: "Conta de anúncio", example: "CA 01" },
  { level: "campaign", code: "estrutura", label: "CBO ou ABO", example: "CBO" },
  { level: "campaign", code: "orcamento", label: "Orçamento/dia", example: "50" },
  { level: "campaign", code: "data", label: "Data de início (dd/mm/aa)", example: "25/11/26" },
  { level: "campaign", code: "numero", label: "Nº da campanha do produto", example: "4" },
  { level: "adset", code: "paises", label: "Países", example: "US" },
  { level: "adset", code: "idade", label: "Idade", example: "18-65" },
  { level: "adset", code: "genero", label: "Gênero (H/M, vazio = todos)", example: "M" },
  { level: "adset", code: "numero_conjunto", label: "Nº do conjunto", example: "01" },
  { level: "ad", code: "nome_do_criativo", label: "Nome do criativo", example: "video-dor-costas" },
  { level: "ad", code: "pasta", label: "Pasta do criativo", example: "Preto" },
  { level: "ad", code: "formato", label: "Formato (VID/IMG/FLEX/CAR)", example: "VID" },
  { level: "ad", code: "pagina", label: "Página", example: "Voultie" },
  { level: "ad", code: "instagram", label: "Instagram", example: "voultie" },
  { level: "ad", code: "numero_anuncio", label: "Nº do anúncio", example: "01" },
];

const KNOWN = new Set(NAMING_CODES.map((c) => c.code));
const LEVEL_ORDER: Record<NamingLevel, number> = { campaign: 0, adset: 1, ad: 2 };

// Códigos que dá pra usar em cada nível (campanha não sabe de conjunto/anúncio).
export function codesFor(level: NamingLevel): NamingCode[] {
  return NAMING_CODES.filter((c) => level !== "campaign" || LEVEL_ORDER[c.level] === 0 || ["pagina", "instagram", "paises", "idade", "genero"].includes(c.code));
}

// Separador padrão entre os códigos.
export const NAMING_SEPARATOR = "_";

export const DEFAULT_TEMPLATES: NamingTemplates = {
  campaign: "{{produto}}_{{estrutura}}_{{data}}_#{{numero}}",
  adset: "{{paises}}_{{idade}}_{{numero_conjunto}}",
  ad: "{{nome_do_criativo}}_{{pasta}}_{{formato}}",
};

const CODE_RE = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;

export function normalizeCode(raw: string) {
  return raw.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export function codesIn(template: string): string[] {
  return [...new Set([...template.matchAll(CODE_RE)].map((m) => normalizeCode(m[1])))];
}

export function isKnownCode(code: string) {
  return KNOWN.has(code);
}

// Códigos inventados pela pessoa, nos 3 níveis, na ordem em que aparecem.
export function customCodes(t: NamingTemplates): string[] {
  return [...new Set(NAMING_LEVELS.flatMap((l) => codesIn(t[l])).filter((c) => !KNOWN.has(c)))];
}

export function codeLabel(code: string) {
  return NAMING_CODES.find((c) => c.code === code)?.label ?? code.replace(/_/g, " ").replace(/^./, (s) => s.toUpperCase());
}

const SEP = "[-_·/,]";

// Monta o nome: troca os códigos e limpa o que sobra quando um código fica
// vazio ("A -  - B" vira "A - B"). "|" sai porque separa nome e id na UTM.
export function renderName(template: string, values: Record<string, string | undefined>): string {
  let s = template.replace(CODE_RE, (_, raw) => String(values[normalizeCode(raw)] ?? "").replace(/\|/g, "-").trim());
  s = s.replace(/\|/g, "-");
  s = s.replace(new RegExp(`(\\s*${SEP}\\s*)(?:${SEP}\\s*)+`, "g"), "$1");
  s = s.replace(new RegExp(`^(?:\\s|${SEP})+|(?:\\s|${SEP})+$`, "g"), "");
  s = s.replace(/#(?=\s|$)/g, "").replace(/\s{2,}/g, " ").trim();
  return s.slice(0, 250);
}

export function exampleName(template: string, custom: Record<string, string> = {}) {
  const values: Record<string, string> = Object.fromEntries(NAMING_CODES.map((c) => [c.code, c.example]));
  for (const c of codesIn(template)) if (!KNOWN.has(c)) values[c] = custom[c] || codeLabel(c).toUpperCase();
  return renderName(template, values);
}

// Modelo antigo (campos em ordem + separador) vira texto com códigos.
const OLD_TO_CODE: Record<string, string> = { criativo: "nome_do_criativo", pagina: "pagina", loja: "loja", produto: "produto", estrutura: "estrutura", data: "data", formato: "formato" };
export function fromOldLevels(separator: string, levels: Partial<Record<NamingLevel, { id: string; label: string }[]>>): NamingTemplates {
  const conv = (fields: { id: string; label: string }[] = []) =>
    fields.map((f) => `{{${OLD_TO_CODE[f.id] ?? (normalizeCode(f.label) || f.id)}}}`).join(separator || NAMING_SEPARATOR);
  return { campaign: conv(levels.campaign), adset: conv(levels.adset), ad: conv(levels.ad) };
}

export const pad2 = (n: number) => String(n).padStart(2, "0");

export function fileBaseName(name: string) {
  return name.replace(/\.[a-z0-9]{2,5}$/i, "").trim();
}
