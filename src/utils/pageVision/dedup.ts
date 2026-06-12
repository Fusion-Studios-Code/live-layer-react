/**
 * 32×32 grayscale thumbnail dedup — mirrors the worker VisionHandler's
 * DEDUP_MAE_THRESHOLD = 8.0 and Dean's screenshots.py, so the browser
 * skips uploading visually-unchanged pages.
 */

export const THUMB_SIZE = 32;
export const DEDUP_MAE_THRESHOLD = 8.0;

/** RGBA (THUMB_SIZE²×4 bytes) → grayscale luma bytes (THUMB_SIZE²). */
export function rgbaToGrayscaleThumb(rgba: Uint8ClampedArray): Uint8Array {
  const out = new Uint8Array(THUMB_SIZE * THUMB_SIZE);
  for (let i = 0; i < out.length; i++) {
    out[i] = Math.round(
      0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2],
    );
  }
  return out;
}

export function meanAbsoluteError(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length || a.length === 0) return Number.POSITIVE_INFINITY;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

/** FNV-1a 32-bit hex — compact change-marker for the data-channel envelope. */
export function thumbHashHex(thumb: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < thumb.length; i++) {
    h ^= thumb[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
