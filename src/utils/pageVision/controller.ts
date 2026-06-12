import type { CapturedPage, CaptureOptions } from "./capture";
import { DEDUP_MAE_THRESHOLD, meanAbsoluteError, thumbHashHex } from "./dedup";
import type { PageVisionUploadConfig } from "./upload";

export type CaptureReason = "flow_start" | "route_change" | "step_change";

export interface PageVisionClientConfig {
  enabled: boolean;
  captureOn: CaptureReason[];
  maxWidth: number;
  jpegQuality: number;
  upload: PageVisionUploadConfig;
}

export interface PageVisionControllerDeps {
  config: PageVisionClientConfig;
  capture: (opts: CaptureOptions) => Promise<CapturedPage | null>;
  upload: (blob: Blob, cfg: PageVisionUploadConfig) => Promise<string | null>;
  publish: (payload: Record<string, unknown>) => void;
}

/**
 * Orchestrates one capture→dedup→upload→publish pass per trigger.
 * Pure-dependency class so the React hook stays a thin adapter.
 *
 * Carry-forward 1: remembers the last published envelope so
 * republishLast() can re-send it (~100B) if the worker's listener
 * registered after the flow_start was sent.
 *
 * Carry-forward 2: guards against empty upload config strings that a
 * misconfigured server endpoint may return even when enabled is true.
 */
export class PageVisionController {
  private lastThumb: Uint8Array | null = null;
  private inFlight = false;
  private lastEnvelope: Record<string, unknown> | null = null;

  constructor(private deps: PageVisionControllerDeps) {}

  async trigger(reason: CaptureReason, route: string): Promise<void> {
    const { config } = this.deps;
    if (!config.enabled || !config.captureOn.includes(reason)) return;
    if (this.inFlight) return;

    // Carry-forward 2: bail early if upload config is incomplete
    if (
      !config.upload.supabaseUrl ||
      !config.upload.anonKey ||
      !config.upload.bucket
    ) return;

    this.inFlight = true;
    try {
      const cap = await this.deps.capture({
        maxWidth: config.maxWidth,
        jpegQuality: config.jpegQuality,
      });
      if (!cap) return;
      if (this.lastThumb && meanAbsoluteError(this.lastThumb, cap.thumb) < DEDUP_MAE_THRESHOLD) {
        return; // visually unchanged — skip upload entirely
      }
      const url = await this.deps.upload(cap.blob, config.upload);
      if (!url) return; // upload failed — keep lastThumb unset so we retry
      this.lastThumb = cap.thumb;
      const envelope: Record<string, unknown> = {
        type: "page_screenshot",
        url,
        route,
        reason,
        hash: thumbHashHex(cap.thumb),
        capturedAt: Date.now(),
      };
      this.lastEnvelope = envelope;
      this.deps.publish(envelope);
    } finally {
      this.inFlight = false;
    }
  }

  /**
   * Carry-forward 1: re-publish the last envelope without re-capturing or
   * re-uploading. Called when the agent becomes ready for the first time
   * after connect, to cover the rare window where the worker's listener
   * registered after the original flow_start was sent.
   */
  republishLast(): void {
    if (this.lastEnvelope) {
      this.deps.publish(this.lastEnvelope);
    }
  }
}
