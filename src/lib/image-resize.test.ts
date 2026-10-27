import { describe, expect, it } from "vitest";
import jpeg from "jpeg-js";
import { encode as encodePng } from "fast-png";
import { makePreviews } from "./image-resize.server";

// Metade esquerda vermelha, direita azul.
function halves(w: number, h: number) {
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    px.set(x < w / 2 ? [255, 0, 0, 255] : [0, 0, 255, 255], i);
  }
  return px;
}

// Põe um APP1/EXIF com a orientação logo depois do SOI.
function withOrientation(jpg: Uint8Array, o: number) {
  const tiff = [0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, o, 0, 0, 0, 0, 0, 0, 0, 0];
  const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const len = body.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 0xff, ...body, ...jpg.slice(2)]);
}

const pixel = (jpg: Uint8Array, x: number, y: number) => {
  const img = jpeg.decode(jpg, { useTArray: true, formatAsRGBA: true });
  const i = (y * img.width + x) * 4;
  return { w: img.width, h: img.height, rgb: [img.data[i], img.data[i + 1], img.data[i + 2]] };
};
const isRed = ([r, g, b]: number[]) => r > 200 && g < 60 && b < 60;
const isBlue = ([r, g, b]: number[]) => b > 200 && r < 60 && g < 60;

describe("makePreviews", () => {
  it("reduz JPEG grande e mantém a proporção", () => {
    const src = new Uint8Array(jpeg.encode({ width: 3000, height: 2000, data: halves(3000, 2000) }, 90).data);
    const pv = makePreviews(src)!;
    expect(pixel(pv.large, 0, 0).w).toBe(1400);
    expect(pixel(pv.large, 0, 0).h).toBe(933);
    expect(pixel(pv.thumb, 0, 0)).toMatchObject({ w: 400, h: 400 });
    expect(pixel(pv.small, 0, 0)).toMatchObject({ w: 400, h: 267 });
    expect(pv.hashGrid).toMatchObject({ w: 9, h: 8 });
  });

  it("aplica o giro do celular (EXIF 6 = 90° horário)", () => {
    const src = withOrientation(new Uint8Array(jpeg.encode({ width: 400, height: 200, data: halves(400, 200) }, 90).data), 6);
    const pv = makePreviews(src)!;
    const top = pixel(pv.large, 100, 20), bottom = pixel(pv.large, 100, 380);
    expect([top.w, top.h]).toEqual([200, 400]);
    expect(isRed(top.rgb)).toBe(true);
    expect(isBlue(bottom.rgb)).toBe(true);
  });

  it("PNG transparente vira fundo branco", () => {
    const png = encodePng({ width: 20, height: 20, data: new Uint8Array(20 * 20 * 4), channels: 4 });
    const pv = makePreviews(png)!;
    expect(pixel(pv.large, 10, 10).rgb.every((c) => c > 240)).toBe(true);
  });

  it("formato que não lê (HEIC etc.) devolve null", () => {
    expect(makePreviews(new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]))).toBeNull();
  });
});
