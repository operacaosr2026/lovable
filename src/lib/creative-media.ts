// Upscale de criativos no navegador: largura vai pra 1080 e a altura segue a proporção.
// Só aumenta — arquivos com 1080 ou mais de largura passam intactos.
const TARGET_WIDTH = 1080;

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
const withExt = (name: string, ext: string) => `${name.replace(/\.[^.]+$/, "")}.${ext}`;

export type UpscaleResult = { file: File; upscaled: boolean; failed?: boolean };

export async function upscaleCreative(file: File, onProgress?: (p: number) => void): Promise<UpscaleResult> {
  try {
    if (file.type.startsWith("image/")) return await upscaleImage(file);
    if (file.type.startsWith("video/")) return await upscaleVideo(file, onProgress);
  } catch (e) {
    console.error("Falha ao converter criativo para 1080", e);
    return { file, upscaled: false, failed: true };
  }
  return { file, upscaled: false };
}

async function upscaleImage(file: File): Promise<UpscaleResult> {
  if (file.type === "image/gif" || file.type === "image/svg+xml") return { file, upscaled: false };
  const bmp = await createImageBitmap(file);
  if (bmp.width >= TARGET_WIDTH) { bmp.close(); return { file, upscaled: false }; }
  const canvas = document.createElement("canvas");
  canvas.width = TARGET_WIDTH;
  canvas.height = Math.round((bmp.height * TARGET_WIDTH) / bmp.width);
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const png = file.type === "image/png";
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, png ? "image/png" : "image/jpeg", 0.95));
  if (!blob) throw new Error("Não foi possível gerar a imagem");
  return { file: new File([blob], withExt(file.name, png ? "png" : "jpg"), { type: blob.type }), upscaled: true };
}

async function upscaleVideo(file: File, onProgress?: (p: number) => void): Promise<UpscaleResult> {
  if (typeof VideoEncoder === "undefined") throw new Error("Navegador sem suporte a WebCodecs");
  const { Input, Output, Conversion, BlobSource, BufferTarget, Mp4OutputFormat, ALL_FORMATS, QUALITY_VERY_HIGH } = await import("mediabunny");

  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track) return { file, upscaled: false };
  const w = await track.getDisplayWidth();
  const h = await track.getDisplayHeight();
  if (w >= TARGET_WIDTH) return { file, upscaled: false };

  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target });
  const conversion = await Conversion.init({
    input,
    output,
    video: { width: TARGET_WIDTH, height: even((h * TARGET_WIDTH) / w), fit: "fill", codec: "avc", quality: QUALITY_VERY_HIGH },
    audio: { codec: "aac" },
  });
  // Faixa descartada (ex.: áudio que o navegador não codifica) estragaria o criativo — melhor manter o original.
  if (!conversion.isValid || conversion.discardedTracks.length) throw new Error(`Conversão inválida: ${conversion.discardedTracks.map((t) => t.reason).join(", ")}`);
  if (onProgress) conversion.onProgress = onProgress;
  await conversion.execute();
  if (!target.buffer) throw new Error("Conversão sem saída");
  return { file: new File([target.buffer], withExt(file.name, "mp4"), { type: "video/mp4" }), upscaled: true };
}
