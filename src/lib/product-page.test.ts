import { describe, expect, it } from "vitest";
import { parseReviewsText } from "@/lib/product-page";

describe("parseReviewsText", () => {
  it("lê cabeçalho e blocos separados por ---", () => {
    const r = parseReviewsText(`SECTION_TITLE: Our customers love it
OVERALL_RATING: 4,8
REVIEW_COUNT: 2,031
---
TITLE: better than expected
RATING: 4.5
AUTHOR: Jordan
TEXT: Great pair.
Fits true to size.
---
**Title:** no break in needed
**Rating:** 5 stars
**Author:** Marcus D
**Text:** "Comfy from day one."`);
    expect(r.heading).toBe("Our customers love it");
    expect(r.rating).toBe("4.8");
    expect(r.count).toBe("2,031");
    expect(r.reviews.map(({ id: _id, ...x }) => x)).toEqual([
      { title: "better than expected", text: "Great pair.\nFits true to size.", author: "Jordan", rating: 4.5 },
      { title: "no break in needed", text: "Comfy from day one.", author: "Marcus D", rating: 5 },
    ]);
  });

  it("aceita nomes em português e nota inválida vira 5", () => {
    const r = parseReviewsText("Título: ótimo\nNota: dez\nAutor: Ana\nTexto: Amei.");
    expect(r.reviews).toHaveLength(1);
    expect(r.reviews[0]).toMatchObject({ title: "ótimo", author: "Ana", text: "Amei.", rating: 5 });
  });

  it("ignora blocos sem título nem texto", () => {
    expect(parseReviewsText("---\nAUTHOR: Ana\n---").reviews).toHaveLength(0);
  });
});
