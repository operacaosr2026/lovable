import jpeg from "jpeg-js";
import { decode as decodePng } from "fast-png";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Raster } from "@/lib/image-resize.server";

// "Impressão digital" visual da foto (dHash de 64 bits): a mesma foto reenviada
// comprimida, com outro nome ou sem metadados dá o mesmo hash (ou quase).
// JPEG/PNG: a grade 9×8 sai das miniaturas feitas no servidor (dhash). Outros
// formatos (HEIC etc.): a 9×8 vem do Supabase (Image Transformations), que
// entrega JPEG ou PNG (imagePhash).

export function dhash(r: Raster): string {
  return hashOf(r.w, r.px, 4);
}

function hashOf(w: number, px: ArrayLike<number>, ch: number) {
  const gray = (x: number, y: number) => {
    const i = (y * w + x) * ch;
    return ch >= 3 ? 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2] : px[i];
  };
  let bits = "";
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += gray(x, y) > gray(x + 1, y) ? "1" : "0";
  return BigInt(`0b${bits}`).toString(16).padStart(16, "0");
}

export async function imagePhash(bucket: string, path: string): Promise<string | null> {
  const { data } = await supabaseAdmin.storage.from(bucket)
    .createSignedUrl(path, 300, { transform: { width: 9, height: 8, resize: "fill" } });
  if (!data?.signedUrl) return null;
  const res = await fetch(data.signedUrl, { headers: { Accept: "image/jpeg,image/png" } });
  if (!res.ok) return null;
  const buf = new Uint8Array(await res.arrayBuffer());
  let w: number, h: number, px: ArrayLike<number>, ch: number;
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    const img = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
    w = img.width; h = img.height; px = img.data; ch = 4;
  } else if (buf[0] === 0x89 && buf[1] === 0x50) {
    const img = decodePng(buf);
    w = img.width; h = img.height; px = img.data; ch = img.channels;
  } else return null;
  if (w < 9 || h < 8) return null;
  return hashOf(w, px, ch);
}

// Bits diferentes entre dois hashes (0 = idêntica).
export function phashDistance(a: string, b: string) {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`), n = 0;
  while (x) { n += Number(x & 1n); x >>= 1n; }
  return n;
}

export const SAME_PHOTO_MAX_DISTANCE = 10;   // mesma foto reenviada: 0–2 (6–7 pelo Supabase); fotos diferentes: 20+
