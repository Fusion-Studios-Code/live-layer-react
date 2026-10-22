// Widget-level checks for the data-channel size guard: replies the widget
// sends in response to agent commands must fit one LiveKit data packet,
// and a rejected publishData must be caught rather than left unhandled.
//
// The LiveKit session hook is replaced with a stub whose room exposes a
// publishData that behaves like livekit-client 2.20+: it rejects with
// PublishDataError when the encoded packet is over 64,000 bytes.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, waitFor } from "@testing-library/react";
import { AvatarWidget } from "./AvatarWidget";
import {
  LIVEKIT_MAX_DATA_PACKET_BYTES,
  MAX_DATA_PAYLOAD_BYTES,
} from "./utils/dataPayload";

type DataHandler = (msg: Record<string, unknown>) => void;

const live = vi.hoisted(() => ({
  onDataMessage: null as DataHandler | null,
  publishData: null as null | ((data: Uint8Array, opts: unknown) => Promise<void>),
}));

vi.mock("./hooks/useLiveKitSession", () => ({
  useLiveKitSession: (opts: { onDataMessage?: DataHandler }) => {
    if (opts.onDataMessage) live.onDataMessage = opts.onDataMessage;
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
      getRoom: () => ({
        localParticipant: {
          publishData: (data: Uint8Array, o: unknown) => live.publishData!(data, o),
        },
      }),
      session: null,
    };
  },
}));

// Rough DataPacket envelope: identity, kind, sequence and framing.
const ENVELOPE_BYTES = 200;

function livekitLikePublish() {
  return vi.fn(async (data: Uint8Array) => {
    const packet = data.byteLength + ENVELOPE_BYTES;
    if (packet > LIVEKIT_MAX_DATA_PACKET_BYTES) {
      throw Object.assign(
        new Error(
          `cannot publish data packet larger than ${LIVEKIT_MAX_DATA_PACKET_BYTES} bytes (got ${packet})`,
        ),
        { name: "PublishDataError" },
      );
    }
  });
}

const decode = (data: Uint8Array) =>
  JSON.parse(new TextDecoder().decode(data)) as Record<string, any>;

function dispatch(msg: Record<string, unknown>) {
  act(() => {
    live.onDataMessage!(msg);
  });
}

describe("AvatarWidget data-channel size guard", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    live.onDataMessage = null;
    live.publishData = livekitLikePublish();
    document.body.innerHTML = `<main><h1>Pricing</h1><p>Plans for every team.</p></main>`;
    // useAgentInfo prefetches agent config; keep it off the network.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 404 })),
    );
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("answers request_page_context with oversized pageContextExtras inside the packet limit", async () => {
    render(
      <AvatarWidget
        agentId="test-agent"
        pageContextExtras={{ plan: "pro", catalog: "x".repeat(200_000) }}
      />,
    );
    dispatch({ type: "request_page_context", requestId: "req-1" });

    await waitFor(() => expect(live.publishData).toHaveBeenCalledTimes(1));
    const [data, opts] = vi.mocked(live.publishData!).mock.calls[0];
    expect(opts).toEqual({ reliable: true });
    expect(data.byteLength).toBeLessThanOrEqual(MAX_DATA_PAYLOAD_BYTES);
    await expect(vi.mocked(live.publishData!).mock.results[0].value).resolves.toBeUndefined();

    const msg = decode(data);
    expect(msg.type).toBe("page_context");
    expect(msg.requestId).toBe("req-1");
    expect(msg.context.pathname).toBe("/");
    expect(msg.context.extras.plan).toBe("pro");
    expect(msg.context.truncated).toEqual(["extras"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("reply trimmed"));
  });

  it("sends small extras unchanged with no truncation marker", async () => {
    render(<AvatarWidget agentId="test-agent" pageContextExtras={{ plan: "pro" }} />);
    dispatch({ type: "request_page_context", requestId: "req-2" });

    await waitFor(() => expect(live.publishData).toHaveBeenCalledTimes(1));
    const msg = decode(vi.mocked(live.publishData!).mock.calls[0][0]);
    expect(msg.context.extras).toEqual({ plan: "pro" });
    expect(msg.context.truncated).toBeUndefined();
  });

  it("catches a rejected publishData instead of leaving it unhandled", async () => {
    const err = Object.assign(new Error("Publisher connection is not set"), {
      name: "UnexpectedConnectionState",
    });
    live.publishData = vi.fn().mockRejectedValue(err);
    render(<AvatarWidget agentId="test-agent" />);
    dispatch({ type: "request_page_context", requestId: "req-3" });

    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith(
        "[LiveLayer] request_page_context: publishData failed.",
        err,
      ),
    );
  });

  it("trims a getRoutes list that would overflow one packet", async () => {
    const routes = Array.from({ length: 200 }, (_, i) => ({
      href: `/projects/${i}`,
      title: `Project ${i}`,
      description: "d".repeat(1_000),
    }));
    render(<AvatarWidget agentId="test-agent" getRoutes={() => routes} />);
    dispatch({ type: "request_routes", requestId: "req-4" });

    await waitFor(() => expect(live.publishData).toHaveBeenCalledTimes(1));
    const data = vi.mocked(live.publishData!).mock.calls[0][0];
    expect(data.byteLength).toBeLessThanOrEqual(MAX_DATA_PAYLOAD_BYTES);
    await expect(vi.mocked(live.publishData!).mock.results[0].value).resolves.toBeUndefined();
    const msg = decode(data);
    expect(msg.requestId).toBe("req-4");
    expect(msg.routes.length).toBeGreaterThan(0);
    expect(msg.routes.length).toBeLessThan(200);
    expect(msg.routes[0].href).toBe("/projects/0");
  });
});
