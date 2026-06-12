/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

// Mock capture + upload BEFORE importing the hook so no canvas/network
// runs. The capture mock returns an IDENTICAL thumb on every call — that
// reproduces the disconnect/reconnect scenario where the controller's MAE
// dedup swallows the second flow_start capture, leaving republishLast()
// as the ONLY way the new worker session ever receives an envelope.
vi.mock("../utils/pageVision/capture", () => ({
  capturePageImage: vi.fn(async () => ({
    blob: new Blob(["jpeg"], { type: "image/jpeg" }),
    thumb: new Uint8Array(32 * 32), // all-zero — identical every capture
    width: 100,
    height: 100,
  })),
}));

vi.mock("../utils/pageVision/upload", () => ({
  uploadScreenshot: vi.fn(
    async () =>
      "https://x.supabase.co/storage/v1/object/public/page-vision/test.jpg",
  ),
}));

import { usePageVision } from "./usePageVision";
import type { PageVisionClientConfig } from "../utils/pageVision/controller";

// One stable config object — the hook recreates its controller when the
// config identity changes, and the reconnect scenario specifically needs
// the SAME controller (with lastThumb/lastEnvelope set) to persist.
const config: PageVisionClientConfig = {
  enabled: true,
  captureOn: ["flow_start", "route_change", "step_change"],
  maxWidth: 1024,
  jpegQuality: 0.7,
  upload: {
    supabaseUrl: "https://x.supabase.co",
    anonKey: "anon",
    bucket: "page-vision",
  },
};

/** Flush the async capture→dedup→upload→publish chain started in an effect. */
const flush = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

beforeEach(() => {
  // The hook waits two rAFs ("after next paint") before capturing; make
  // them immediate so the trigger chain starts inside the rerender act().
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback): number => {
    cb(0);
    return 0;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPageVision() {
  const publish = vi.fn();
  const { rerender } = renderHook(
    (props: { connected: boolean; agentReady: boolean }) =>
      usePageVision({
        config,
        connected: props.connected,
        pathname: "/",
        currentStep: undefined,
        publishData: publish,
        agentReady: props.agentReady,
      }),
    { initialProps: { connected: false, agentReady: false } },
  );
  return { publish, rerender };
}

describe("usePageVision agentReady republish latch", () => {
  it("republishes the flow_start envelope when the agent first becomes ready", async () => {
    const { publish, rerender } = renderPageVision();

    rerender({ connected: true, agentReady: false });
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    const envelope = publish.mock.calls[0][0];
    expect(envelope).toMatchObject({ type: "page_screenshot", reason: "flow_start" });

    rerender({ connected: true, agentReady: true });
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish.mock.calls[1][0]).toBe(envelope); // same envelope, no re-capture
  });

  it("does not refire when agentReady toggles within a single connect", async () => {
    const { publish, rerender } = renderPageVision();

    rerender({ connected: true, agentReady: false });
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    rerender({ connected: true, agentReady: true });
    expect(publish).toHaveBeenCalledTimes(2);

    // agentReady flaps while connected stays true → latch must hold.
    rerender({ connected: true, agentReady: false });
    rerender({ connected: true, agentReady: true });
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it("resets the latch on disconnect so the next session's agentReady republishes", async () => {
    const { publish, rerender } = renderPageVision();

    // First session: flow_start capture + republish on agent-ready.
    rerender({ connected: true, agentReady: false });
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    const envelope = publish.mock.calls[0][0];
    rerender({ connected: true, agentReady: true });
    expect(publish).toHaveBeenCalledTimes(2);

    // Disconnect (widget stays mounted), then reconnect. The second
    // flow_start capture is MAE-deduped (identical thumb) → no publish,
    // exactly as in production when the page hasn't changed.
    rerender({ connected: false, agentReady: false });
    rerender({ connected: true, agentReady: false });
    await flush();
    expect(publish).toHaveBeenCalledTimes(2); // deduped — nothing sent yet

    // The new session's agentReady must republish despite the old latch,
    // otherwise the new worker session never receives ANY envelope.
    rerender({ connected: true, agentReady: true });
    expect(publish).toHaveBeenCalledTimes(3);
    expect(publish.mock.calls[2][0]).toBe(envelope);
  });
});
