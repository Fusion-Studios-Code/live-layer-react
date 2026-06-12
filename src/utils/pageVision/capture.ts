/**
 * DOM → JPEG capture via html-to-image, honoring the same privacy
 * exclusions as the DOM scraper (fieldPrivacy.ts / extractPageContext.ts):
 * the widget's own chrome, [data-ll-private] / [data-ll-skip] subtrees,
 * password inputs, and iframes are never rasterized.
 */
import { toCanvas } from "html-to-image";
import { THUMB_SIZE, rgbaToGrayscaleThumb } from "./dedup";

const EXCLUDE_SELECTOR = [
  ".ll-widget",
  "[data-ll-private]",
  "[data-ll-skip]",
  "input[type='password']",
  "iframe",
].join(", ");

export function isExcludedFromCapture(node: Element): boolean {
  return typeof node.matches === "function" && node.matches(EXCLUDE_SELECTOR);
}

/** html-to-image filter: return true to KEEP a node. */
export function captureFilter(node: Node): boolean {
  if (!(node instanceof Element)) return true; // text/comment nodes
  return !isExcludedFromCapture(node);
}

export interface CapturedPage {
  blob: Blob;
  /** 32×32 grayscale thumb for dedup + envelope hash. */
  thumb: Uint8Array;
  width: number;
  height: number;
}

export interface CaptureOptions {
  maxWidth: number;
  jpegQuality: number;
}

/**
 * Rasterize the visible document, downscaled to maxWidth, and compute the
 * dedup thumb from the same canvas. Returns null when capture is
 * impossible (no body, canvas unavailable, html-to-image throw).
 */
export async function capturePageImage(opts: CaptureOptions): Promise<CapturedPage | null> {
  try {
    const target = document.body;
    if (!target) return null;
    const srcW = Math.max(1, target.scrollWidth || window.innerWidth || 1);
    const srcH = Math.max(1, window.innerHeight || target.scrollHeight || 1);
    const scale = Math.min(1, opts.maxWidth / srcW);

    const canvas = await toCanvas(target, {
      filter: captureFilter,
      canvasWidth: Math.round(srcW * scale),
      canvasHeight: Math.round(srcH * scale),
      backgroundColor: "#ffffff",
      // Fonts are skipped because the LLM doesn't need them and inlining
      // webfonts costs latency on every capture.
      skipFonts: true,
      // Viewport-sized slice at the CURRENT scroll position — what the
      // visitor actually sees (the whole point of step_change captures on
      // long forms), not the top of the page; keeps tokens bounded too.
      // Best-effort: fixed-position elements render at their DOM position
      // and html-element backgrounds don't shift with the transform.
      style: { transform: `translateY(-${window.scrollY || 0}px)` },
      height: srcH,
      width: srcW,
    });

    const tCanvas = document.createElement("canvas");
    tCanvas.width = THUMB_SIZE;
    tCanvas.height = THUMB_SIZE;
    const tCtx = tCanvas.getContext("2d");
    if (!tCtx) return null;
    tCtx.drawImage(canvas, 0, 0, THUMB_SIZE, THUMB_SIZE);
    const rgba = tCtx.getImageData(0, 0, THUMB_SIZE, THUMB_SIZE).data;
    const thumb = rgbaToGrayscaleThumb(rgba);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", opts.jpegQuality),
    );
    if (!blob) return null;
    return { blob, thumb, width: canvas.width, height: canvas.height };
  } catch (err) {
    console.warn("[LiveLayer] page-vision capture failed:", err);
    return null;
  }
}
