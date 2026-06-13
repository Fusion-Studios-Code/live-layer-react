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

/**
 * Data-channel envelope for one published screenshot. A `type` alias (not
 * an interface) so it stays assignable to Record<string, unknown> at the
 * widget's publishData boundary.
 */
export type PageScreenshotEnvelope = {
  type: "page_screenshot";
  url: string;
  route: string;
  reason: CaptureReason;
  hash: string;
  capturedAt: number;
};

export interface PageVisionControllerDeps {
  config: PageVisionClientConfig;
  capture: (opts: CaptureOptions) => Promise<CapturedPage | null>;
  upload: (blob: Blob, cfg: PageVisionUploadConfig) => Promise<string | null>;
  publish: (payload: PageScreenshotEnvelope) => void;
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
 * misconfigured server endpoint may return even when enabled is true
 * (warns once so the integrator hears about the misconfiguration).
 */
export class PageVisionController {
  private lastThumb: Uint8Array | null = null;
  private inFlight = false;
  private lastEnvelope: PageScreenshotEnvelope | null = null;
  private warnedIncompleteConfig = false;

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
    ) {
      if (!this.warnedIncompleteConfig) {
        this.warnedIncompleteConfig = true;
        console.warn(
          "[LiveLayer] page-vision enabled but upload config incomplete — skipping captures",
        );
      }
      return;
    }

    this.inFlight = true;
    try {
      const cap = await this.deps.capture({
        maxWidth: config.maxWidth,
        jpegQuality: config.jpegQuality,
      });
      if (!cap) return;
      // Stamp at capture time — upload latency shouldn't skew the
      // timestamp the worker uses to judge freshness.
      const capturedAt = Date.now();
      if (this.lastThumb && meanAbsoluteError(this.lastThumb, cap.thumb) < DEDUP_MAE_THRESHOLD) {
        return; // visually unchanged — skip upload entirely
      }
      const url = await this.deps.upload(cap.blob, config.upload);
      if (!url) return; // upload failed — keep lastThumb unset so we retry
      this.lastThumb = cap.thumb;
      const envelope: PageScreenshotEnvelope = {
        type: "page_screenshot",
        url,
        route,
        reason,
        hash: thumbHashHex(cap.thumb),
        capturedAt,
      };
      // Save BEFORE publishing: if the data channel throws (e.g. not open
      // yet), republishLast() on agent-ready can still deliver this envelope.
      this.lastEnvelope = envelope;
      this.safePublish(envelope);
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
    if (this.lastEnvelope) this.safePublish(this.lastEnvelope);
  }

  /** Publish must never break a trigger — a throwing data channel is logged, not fatal. */
  private safePublish(envelope: PageScreenshotEnvelope): void {
    try {
      this.deps.publish(envelope);
    } catch (err) {
      console.warn("[LiveLayer] page-vision publish failed:", err);
    }
  }
}
