/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

// Mock livekit-client BEFORE importing the hook. The hook owns the
// mic track lifecycle (createLocalAudioTrack + publishTrack), and
// 0.20.0 layers a boot-up gate on top by calling setMicrophoneEnabled
// from inside setupMic and from the agentState effect. Everything we
// care about here is a side-effect on the mocked LocalParticipant.
vi.mock("livekit-client", () => {
  const mockTrack = {
    isMuted: false,
    mediaStreamTrack: {
      getSettings: () => ({ deviceId: "mic-default" }),
    },
    stop: vi.fn(),
  };
  return {
    createLocalAudioTrack: vi.fn(async () => mockTrack),
    // String values mirror livekit-client's RoomEvent enum — the hook
    // subscribes with these for the controlled-mode room-state sync.
    RoomEvent: {
      LocalTrackPublished: "localTrackPublished",
      LocalTrackUnpublished: "localTrackUnpublished",
      TrackMuted: "trackMuted",
      TrackUnmuted: "trackUnmuted",
    },
    __mockTrack: mockTrack,
  };
});

import { useMicrophoneState } from "./useMicrophoneState";

// Build a fresh fake Room each test so calls don't bleed across.
// `isMicrophoneEnabled` mirrors what `setMicrophoneEnabled` was last
// called with — that's what the hook reads back for user-override
// detection at agent-ready time.
function makeRoom() {
  const state = { isMicrophoneEnabled: true };
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const setMicrophoneEnabled = vi.fn(async (enabled: boolean) => {
    state.isMicrophoneEnabled = enabled;
  });
  return {
    localParticipant: {
      publishTrack: vi.fn(async () => undefined),
      unpublishTrack: vi.fn(async () => undefined),
      setMicrophoneEnabled,
      get isMicrophoneEnabled() {
        return state.isMicrophoneEnabled;
      },
    },
    switchActiveDevice: vi.fn(async () => undefined),
    on(event: string, cb: (...args: unknown[]) => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(cb);
      return this;
    },
    off(event: string, cb: (...args: unknown[]) => void) {
      listeners.get(event)?.delete(cb);
      return this;
    },
    __emit(event: string) {
      listeners.get(event)?.forEach((cb) => cb());
    },
    __state: state,
  };
}

describe("useMicrophoneState boot-up gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("default (no opts) leaves the mic hot — pre-0.20 behavior", async () => {
    const room = makeRoom();
    const { result } = renderHook(() => useMicrophoneState());
    await act(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await result.current.setupMic(room as any);
    });
    expect(room.localParticipant.publishTrack).toHaveBeenCalled();
    expect(room.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
    expect(result.current.isMuted).toBe(false);
  });

  it("with gateUntilAgentReady=true, mutes the mic immediately after publish", async () => {
    const room = makeRoom();
    const { result } = renderHook(() =>
      useMicrophoneState({ gateUntilAgentReady: true, agentState: "idle" }),
    );
    await act(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await result.current.setupMic(room as any);
    });
    expect(room.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(false);
    expect(result.current.isMuted).toBe(true);
  });

  it("unmutes the mic when agentState transitions to listening", async () => {
    const room = makeRoom();
    let agentState: string = "idle";
    const { result, rerender } = renderHook(() =>
      useMicrophoneState({ gateUntilAgentReady: true, agentState }),
    );
    await act(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await result.current.setupMic(room as any);
    });
    expect(result.current.isMuted).toBe(true);
    expect(room.__state.isMicrophoneEnabled).toBe(false);

    agentState = "listening";
    rerender();
    await waitFor(() =>
      expect(room.localParticipant.setMicrophoneEnabled).toHaveBeenLastCalledWith(true),
    );
    await waitFor(() => expect(result.current.isMuted).toBe(false));
  });

  it("toggleMute during the gate window releases the gate (user wins)", async () => {
    const room = makeRoom();
    let agentState: string = "idle";
    const { result, rerender } = renderHook(() =>
      useMicrophoneState({ gateUntilAgentReady: true, agentState }),
    );
    await act(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await result.current.setupMic(room as any);
    });
    expect(result.current.isMuted).toBe(true);

    // User clicks mic button while still in the gate window — releases
    // and unmutes. setMicrophoneEnabled(true) is the call from toggle.
    await act(async () => {
      result.current.toggleMute();
    });
    expect(result.current.isMuted).toBe(false);
    expect(room.localParticipant.setMicrophoneEnabled).toHaveBeenLastCalledWith(true);

    // Now if user mutes again before listening, listening must NOT
    // override that.
    await act(async () => {
      result.current.toggleMute();
    });
    expect(result.current.isMuted).toBe(true);
    room.localParticipant.setMicrophoneEnabled.mockClear();

    agentState = "listening";
    rerender();
    // Wait a tick so any pending effect would have run.
    await new Promise((r) => setTimeout(r, 0));
    expect(room.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
    expect(result.current.isMuted).toBe(true);
  });

  it("does not auto-unmute if the room mic state was externally changed during the gate window", async () => {
    const room = makeRoom();
    let agentState: string = "idle";
    const { result, rerender } = renderHook(() =>
      useMicrophoneState({ gateUntilAgentReady: true, agentState }),
    );
    await act(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await result.current.setupMic(room as any);
    });
    // Simulate the host (e.g. dashboard V2 with its own gate) flipping
    // the room mic. The widget's hook didn't initiate this, so when
    // listening arrives the override safety should keep its hands off.
    room.__state.isMicrophoneEnabled = true;
    room.localParticipant.setMicrophoneEnabled.mockClear();

    agentState = "listening";
    rerender();
    await new Promise((r) => setTimeout(r, 0));
    expect(room.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
  });

  it("attachRoom (controlled mode) syncs isMuted to the host's live mic — stuck-red regression", async () => {
    // livelayer.studio bug: V2 owns the Room and publishes a hot mic;
    // the hook's gate init'd isMuted=true and nothing ever cleared it,
    // so the icon showed muted-red while the agent could hear the user.
    const room = makeRoom(); // host mic enabled (default)
    const { result } = renderHook(() =>
      useMicrophoneState({ gateUntilAgentReady: true, agentState: "idle" }),
    );
    expect(result.current.isMuted).toBe(true); // gate init
    act(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      result.current.attachRoom(room as any);
    });
    expect(result.current.isMuted).toBe(false); // mirrors hot host mic
  });

  it("attachRoom keeps mirroring host mic changes via room events", async () => {
    const room = makeRoom();
    room.__state.isMicrophoneEnabled = false; // host hasn't published yet
    const { result } = renderHook(() =>
      useMicrophoneState({ gateUntilAgentReady: true, agentState: "idle" }),
    );
    act(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      result.current.attachRoom(room as any);
    });
    expect(result.current.isMuted).toBe(true); // truthful: no mic yet

    // Host publishes the mic → icon must clear.
    act(() => {
      room.__state.isMicrophoneEnabled = true;
      room.__emit("localTrackPublished");
    });
    expect(result.current.isMuted).toBe(false);

    // Host mutes later → icon must go red again.
    act(() => {
      room.__state.isMicrophoneEnabled = false;
      room.__emit("trackMuted");
    });
    expect(result.current.isMuted).toBe(true);
  });

  it("gate release syncs the icon to reality when the host changed the mic mid-gate", async () => {
    const room = makeRoom();
    let agentState: string = "idle";
    const { result, rerender } = renderHook(() =>
      useMicrophoneState({ gateUntilAgentReady: true, agentState }),
    );
    await act(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await result.current.setupMic(room as any);
    });
    expect(result.current.isMuted).toBe(true);

    // Host force-enables the mic during the gate window.
    room.__state.isMicrophoneEnabled = true;

    agentState = "listening";
    rerender();
    // Hands off the room state, but the icon must reflect the hot mic.
    await waitFor(() => expect(result.current.isMuted).toBe(false));
  });

  it("teardownMic re-arms the gate so the next setupMic re-mutes", async () => {
    const room = makeRoom();
    let agentState: string = "idle";
    const { result, rerender } = renderHook(() =>
      useMicrophoneState({ gateUntilAgentReady: true, agentState }),
    );
    await act(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await result.current.setupMic(room as any);
    });
    agentState = "listening";
    rerender();
    await waitFor(() => expect(result.current.isMuted).toBe(false));

    // Tear down and reconnect — second setupMic should re-mute.
    act(() => {
      result.current.teardownMic();
    });
    expect(result.current.isMuted).toBe(true); // gateEnabled reflected
    const room2 = makeRoom();
    room.localParticipant.setMicrophoneEnabled.mockClear();
    await act(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await result.current.setupMic(room2 as any);
    });
    expect(room2.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(false);
  });
});
