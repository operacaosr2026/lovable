import jpeg from "jpeg-js";
import { decode as decodePng, convertIndexedToRgb } from "fast-png";

// Reduz foto no próprio servidor (JS puro: jpeg-js + fast-png), sem o Image
// Transformations do Supabase — que cobra por imagem/mês acima de 100 no Pro.
// Lê JPEG (com o giro do celular — EXIF) e PNG; outro formato (HEIC, WebP, GIF)
// devolve null e quem chamou decide o que fazer.

export type Raster = { w: number; h: number; px: Uint8Array };   // RGBA, opaco

// Orientação EXIF (1–8) do JPEG; 1 = já está em pé.
function jpegOrientation(b: Uint8Array): number {
  let i = 2;
  while (i + 10 < b.length && b[i] === 0xff) {
    const marker = b[i + 1], len = (b[i + 2] << 8) | b[i + 3];
    if (marker === 0xda) break;   // começo da imagem: não tem mais cabeçalho
    if (marker === 0xe1 && b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66) {
      const t = i + 10, le = b[t] === 0x49;
      const u16 = (o: number) => (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
      const u32 = (o: number) => (le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 2 ** 24
        : b[o] * 2 ** 24 + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]));
      const ifd = t + u32(t + 4);
      if (ifd + 2 > b.length) return 1;
      const n = u16(ifd);
      for (let k = 0; k < n; k++) {
        const e = ifd + 2 + k * 12;
        if (e + 10 > b.length) break;
        if (u16(e) === 0x0112) { const v = u16(e + 8); return v >= 1 && v <= 8 ? v : 1; }
      }
      return 1;
    }
    i += 2 + len;
  }
  return 1;
}

function decode(bytes: Uint8Array): { r: Raster; orientation: number } | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    const img = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024 });
    return { r: { w: img.width, h: img.height, px: img.data }, orientation: jpegOrientation(bytes) };
  }
  if (bytes[0] === 0x89 && bytes[1] === 0x50) {
    const png = decodePng(bytes);
    const data = png.palette ? convertIndexedToRgb(png) : png.data;
    const ch = png.palette ? (png.transparency ? 4 : 3) : png.channels;
    const shift = !png.palette && png.depth === 16 ? 8 : 0;
    const n = png.width * png.height, px = new Uint8Array(n * 4);
    for (let p = 0; p < n; p++) {
      const s = p * ch;
      const v = (k: number) => data[s + k] >> shift;
      const [r, g, b] = ch >= 3 ? [v(0), v(1), v(2)] : [v(0), v(0), v(0)];
      const a = ch === 4 ? v(3) : ch === 2 ? v(1) : 255;
      // Transparente vira fundo branco (JPEG não tem transparência).
      px[p * 4] = (r * a + 255 * (255 - a)) / 255;
      px[p * 4 + 1] = (g * a + 255 * (255 - a)) / 255;
      px[p * 4 + 2] = (b * a + 255 * (255 - a)) / 255;
      px[p * 4 + 3] = 255;
    }
    return { r: { w: png.width, h: png.height, px }, orientation: 1 };
  }
  return null;
}

// Média de área (box): cada pixel de saída é a média do retângulo que ele cobre
// na origem — sem serrilhado ao reduzir muito. `crop` e a saída estão no espaço
// já girado; `orientation` mapeia de volta pro pixel da origem.
function resample(src: Raster, orientation: number, crop: { x: number; y: number; w: number; h: number }, outW: number, outH: number): Raster {
  const { w, h, px } = src;
  const at = (X: number, Y: number): number => {
    switch (orientation) {
      case 2: return Y * w + (w - 1 - X);
      case 3: return (h - 1 - Y) * w + (w - 1 - X);
      case 4: return (h - 1 - Y) * w + X;
      case 5: return X * w + Y;
      case 6: return (h - 1 - X) * w + Y;
      case 7: return (h - 1 - X) * w + (w - 1 - Y);
      case 8: return X * w + (w - 1 - Y);
      default: return Y * w + X;
    }
  };
  const out = new Uint8Array(outW * outH * 4);
  const sx = crop.w / outW, sy = crop.h / outH;
  for (let oy = 0; oy < outH; oy++) {
    const y0 = Math.floor(crop.y + oy * sy), y1 = Math.max(y0 + 1, Math.floor(crop.y + (oy + 1) * sy));
    for (let ox = 0; ox < outW; ox++) {
      const x0 = Math.floor(crop.x + ox * sx), x1 = Math.max(x0 + 1, Math.floor(crop.x + (ox + 1) * sx));
      let r = 0, g = 0, b = 0, n = 0;
      for (let Y = y0; Y < y1; Y++) for (let X = x0; X < x1; X++) {
        const i = at(X, Y) * 4;
        r += px[i]; g += px[i + 1]; b += px[i + 2]; n++;
      }
      const o = (oy * outW + ox) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
    }
  }
  return { w: outW, h: outH, px: out };
}

// Cabe inteira num quadrado de `max` (sem ampliar).
const fit = (src: Raster, max: number, orientation = 1) => {
  const turned = orientation >= 5;
  const W = turned ? src.h : src.w, H = turned ? src.w : src.h;
  const k = Math.min(1, max / Math.max(W, H));
  return resample(src, orientation, { x: 0, y: 0, w: W, h: H }, Math.max(1, Math.round(W * k)), Math.max(1, Math.round(H * k)));
};

// Quadrado `size` recortado do centro.
const cover = (src: Raster, size: number) => {
  const side = Math.min(src.w, src.h);
  const out = Math.min(size, side);
  return resample(src, 1, { x: Math.floor((src.w - side) / 2), y: Math.floor((src.h - side) / 2), w: side, h: side }, out, out);
};

const toJpeg = (r: Raster, quality: number) => new Uint8Array(jpeg.encode({ width: r.w, height: r.h, data: r.px }, quality).data);

export type Previews = {
  thumb: Uint8Array;   // 400×400 recortada (grade)
  large: Uint8Array;   // até 1400px (foto aberta)
  small: Uint8Array;   // até 400px inteira (IA foto × print)
  hashGrid: Raster;    // 9×8 (impressão digital)
};

export function makePreviews(bytes: Uint8Array): Previews | null {
  const d = decode(bytes);
  if (!d || d.r.w < 9 || d.r.h < 8) return null;
  const large = fit(d.r, 1400, d.orientation);   // gira e reduz uma vez; o resto sai daqui
  return {
    thumb: toJpeg(cover(large, 400), 70),
    large: toJpeg(large, 75),
    small: toJpeg(fit(large, 400), 70),
    hashGrid: resample(large, 1, { x: 0, y: 0, w: large.w, h: large.h }, 9, 8),
  };
}
