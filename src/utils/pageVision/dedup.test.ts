import { describe, it, expect } from "vitest";
import {
  THUMB_SIZE,
  DEDUP_MAE_THRESHOLD,
  rgbaToGrayscaleThumb,
  meanAbsoluteError,
  thumbHashHex,
} from "./dedup";

function solidRgba(r: number, g: number, b: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(THUMB_SIZE * THUMB_SIZE * 4);
  for (let i = 0; i < THUMB_SIZE * THUMB_SIZE; i++) {
    px[i * 4] = r; px[i * 4 + 1] = g; px[i * 4 + 2] = b; px[i * 4 + 3] = 255;
  }
  return px;
}

describe("pageVision dedup", () => {
  it("converts RGBA to a 32x32 grayscale thumb (luma weights)", () => {
    const thumb = rgbaToGrayscaleThumb(solidRgba(255, 0, 0));
    expect(thumb).toHaveLength(THUMB_SIZE * THUMB_SIZE);
    expect(thumb[0]).toBe(Math.round(0.299 * 255)); // 76
  });

  it("MAE is 0 for identical thumbs and large for opposite thumbs", () => {
    const a = rgbaToGrayscaleThumb(solidRgba(0, 0, 0));
    const b = rgbaToGrayscaleThumb(solidRgba(255, 255, 255));
    expect(meanAbsoluteError(a, a)).toBe(0);
    expect(meanAbsoluteError(a, b)).toBe(255);
    expect(meanAbsoluteError(a, b)).toBeGreaterThan(DEDUP_MAE_THRESHOLD);
  });

  it("MAE of mismatched lengths is Infinity (never dedups)", () => {
    expect(meanAbsoluteError(new Uint8Array(4), new Uint8Array(8))).toBe(Number.POSITIVE_INFINITY);
  });

  it("hashes are stable and differ for different thumbs", () => {
    const a = rgbaToGrayscaleThumb(solidRgba(10, 10, 10));
    const b = rgbaToGrayscaleThumb(solidRgba(200, 200, 200));
    expect(thumbHashHex(a)).toBe(thumbHashHex(a));
    expect(thumbHashHex(a)).not.toBe(thumbHashHex(b));
    expect(thumbHashHex(a)).toMatch(/^[0-9a-f]{8}$/);
  });
});
