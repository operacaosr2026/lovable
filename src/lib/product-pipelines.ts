export const PIPELINES = ["mineracao", "producao", "validacao", "escala"] as const;
export type Pipeline = (typeof PIPELINES)[number];

export const PIPELINE_LABEL: Record<Pipeline, string> = {
  mineracao: "Mineração",
  producao: "Produção",
  validacao: "Validação",
  escala: "Escala",
};

export function nextPipeline(p: Pipeline): Pipeline | null {
  const i = PIPELINES.indexOf(p);
  return PIPELINES[i + 1] ?? null;
}
