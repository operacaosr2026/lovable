// Melhorias automáticas da Meta no anúncio (Advantage+ criativo e afins), uma por uma.
// Vão em degrees_of_freedom_spec.creative_features_spec como OPT_IN/OPT_OUT. Sem
// mandar, a Meta usa o padrão dela (várias ligadas); aqui tudo vai desligado,
// menos o que a pessoa ligar. ai: true = gera mídia/texto novo com IA.
// "Otimizar texto por pessoa" (text_optimizations) não está aqui: liga sozinho
// quando o anúncio tem mais de um título ou descrição (ver textOptimizationOn).

export type AiFeature = { key: string; label: string; help: string; group: AiGroup; ai?: boolean };
export type AiGroup = "text" | "site" | "media" | "translate" | "extras";

export const AI_FEATURES: AiFeature[] = [
  { group: "text", key: "text_generation", label: "Geração de texto (Advantage+)", help: "A Meta cria variações do seu texto com IA.", ai: true },
  { group: "text", key: "enhance_cta", label: "Melhorar botão", help: "Junta frases do anúncio ao botão de ação." },
  { group: "text", key: "description_automation", label: "Descrição automática", help: "Cria a descrição abaixo do título sozinha." },
  { group: "text", key: "ads_with_benefits", label: "Destaque suas promoções", help: "Mostra promoções e benefícios junto do anúncio." },

  { group: "site", key: "show_summary", label: "Resumo do site", help: "Mostra um resumo da página de destino." },
  { group: "site", key: "show_destination_blurbs", label: "Destaques do site", help: "Mostra trechos em destaque da página de destino." },
  { group: "site", key: "site_extensions", label: "Links do site", help: "Mostra links de outras páginas do site." },
  { group: "site", key: "product_extensions", label: "Produtos", help: "Mostra produtos do catálogo ao lado da mídia." },

  { group: "media", key: "image_touchups", label: "Retoques visuais", help: "Corta e expande a imagem pra cada posicionamento." },
  { group: "media", key: "adapt_to_placement", label: "Adaptar ao posicionamento", help: "Ajusta a imagem ao formato de cada lugar." },
  { group: "media", key: "image_brightness_and_contrast", label: "Brilho e contraste", help: "Ajusta brilho e contraste da imagem." },
  { group: "media", key: "image_templates", label: "Sobreposições na imagem", help: "Coloca textos por cima da imagem.", ai: true },
  { group: "media", key: "image_uncrop", label: "Expandir imagem", help: "Cria bordas novas na imagem.", ai: true },
  { group: "media", key: "image_animation", label: "Animar imagem", help: "Transforma a imagem num vídeo curto.", ai: true },
  { group: "media", key: "image_background_gen", label: "Gerar fundo", help: "Troca o fundo da imagem do produto.", ai: true },
  { group: "media", key: "video_auto_crop", label: "Cortar vídeo", help: "Corta e expande o vídeo pra cada posicionamento." },
  { group: "media", key: "video_uncrop", label: "Expandir vídeo", help: "Cria bordas novas no vídeo.", ai: true },
  { group: "media", key: "video_filtering", label: "Filtro de vídeo", help: "Melhora o visual do vídeo (ex.: HDR)." },
  { group: "media", key: "media_type_automation", label: "Mídias relacionadas", help: "A Meta junta outras mídias às suas (ex.: vídeos do catálogo)." },
  { group: "media", key: "multi_photo_to_video", label: "Fotos viram vídeo", help: "Junta várias fotos num vídeo." },

  { group: "translate", key: "text_translation", label: "Traduzir textos", help: "Traduz o texto do anúncio pro idioma de quem vê." },
  { group: "translate", key: "image_text_translation", label: "Traduzir texto da imagem", help: "Traduz o texto escrito dentro da imagem." },
  { group: "translate", key: "text_overlay_translation", label: "Traduzir sobreposições", help: "Traduz textos colocados por cima da mídia." },
  { group: "translate", key: "translate_voiceover", label: "Traduzir narração", help: "Traduz o áudio do vídeo (inglês → espanhol).", ai: true },

  { group: "extras", key: "inline_comment", label: "Comentários relevantes", help: "Mostra um comentário bom embaixo do anúncio." },
  { group: "extras", key: "reveal_details_over_time", label: "Revelar detalhes", help: "Mostra mais detalhes conforme a pessoa assiste." },
  { group: "extras", key: "creative_stickers", label: "Adesivos de ação", help: "Coloca adesivos com o botão na mídia.", ai: true },
];

export const AI_GROUP_LABEL: Record<AiGroup, string> = {
  text: "Texto", site: "Site e produtos", media: "Mídia", translate: "Tradução", extras: "Outros",
};

// Ligado quando o anúncio tem mais de um título ou mais de uma descrição.
export const textOptimizationOn = (titles: number, bodies: number) => titles > 1 || bodies > 1;

// on = chaves ligadas; o resto vai explicitamente desligado.
export function creativeFeaturesSpec(on: Record<string, boolean> | undefined, textOptimization: boolean) {
  const status = (v: boolean) => ({ enroll_status: v ? "OPT_IN" : "OPT_OUT" });
  return {
    creative_features_spec: {
      ...Object.fromEntries(AI_FEATURES.map((f) => [f.key, status(!!on?.[f.key])])),
      text_optimizations: status(textOptimization),
    },
  };
}
