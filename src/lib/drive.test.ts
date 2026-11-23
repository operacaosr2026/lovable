import { describe, expect, it } from "vitest";
import { parseDriveLink } from "@/lib/drive.server";

describe("parseDriveLink", () => {
  it("pasta", () => {
    expect(parseDriveLink("https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp?usp=sharing")).toEqual({ kind: "folder", id: "1AbCdEfGhIjKlMnOp" });
    expect(parseDriveLink("https://drive.google.com/drive/u/0/folders/1AbCdEfGhIjKlMnOp")).toEqual({ kind: "folder", id: "1AbCdEfGhIjKlMnOp" });
  });
  it("arquivo", () => {
    expect(parseDriveLink("https://drive.google.com/file/d/1XyZ_abc-1234567/view?usp=drive_link")).toEqual({ kind: "file", id: "1XyZ_abc-1234567" });
  });
  it("open?id= e id solto", () => {
    expect(parseDriveLink("https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp")).toEqual({ kind: "unknown", id: "1AbCdEfGhIjKlMnOp" });
    expect(parseDriveLink("1AbCdEfGhIjKlMnOpQrStUv")).toEqual({ kind: "unknown", id: "1AbCdEfGhIjKlMnOpQrStUv" });
  });
  it("não é Drive", () => {
    expect(parseDriveLink("https://exemplo.com/abc")).toBeNull();
  });
});
