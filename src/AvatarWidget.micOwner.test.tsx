// AvatarWidget publishes the microphone through its own mic hook (which
// holds it muted until the agent is ready), so its internal session must
// not ask the SDK to publish a second mic track.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { AvatarWidget } from "./AvatarWidget";

const seen = vi.hoisted(() => ({ opts: [] as Record<string, unknown>[] }));

vi.mock("./hooks/useLiveKitSession", () => ({
  useLiveKitSession: (opts: Record<string, unknown>) => {
    seen.opts.push(opts);
    return {
      connectionState: "idle",
      agentState: "idle",
      transcript: [],
      agentConfig: null,
      videoElement: null,
      audioElement: null,
      canResume: false,
      error: null,
      connect: async () => {},
      disconnect: () => {},
      getRoom: () => null,
      session: null,
    };
  },
}));

describe("AvatarWidget mic ownership", () => {
  beforeEach(() => {
    seen.opts = [];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 404 })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("creates its internal session with publishMicrophone: false", () => {
    render(<AvatarWidget agentId="test-agent" />);
    expect(seen.opts.length).toBeGreaterThan(0);
    expect(seen.opts.every((o) => o.publishMicrophone === false)).toBe(true);
  });
});
