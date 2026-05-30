// ─── useMicrophoneState ───────────────────────────────────────────────
// Owns the user's mic track lifecycle: publish on connect, mute/unmute on
// demand, cleanup on disconnect. Exposes a friendly error string when
// the browser denies permission so the UI can prompt.
//
// 0.20.0: optional boot-up gate. When `gateUntilAgentReady` is true and
// `agentState` is wired, the hook mutes the freshly-published mic and
// holds it muted until the agent first reports "listening". Without
// this the worker's STT subscribes the moment the track appears and
// transcribes any partial speech during the connect/greeting window
// into the agent's first turn (e.g. the user saying "hi" before the
// avatar has greeted). The user wins immediately — toggleMute releases
// the gate so a manual click during the window isn't undone later.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createLocalAudioTrack,
  type LocalAudioTrack,
  type Room,
} from "livekit-client";

/**
 * Wrap the published mic's raw `mediaStreamTrack` in a one-track
 * MediaStream — what Web Audio's createMediaStreamSource expects. The
 * track is shared with LiveKit's outbound publication; analysing it
 * doesn't fork audio or cost extra bandwidth, the analyser just taps
 * the same pipe non-destructively.
 */
function trackToStream(track: LocalAudioTrack | null): MediaStream | null {
  const mst = track?.mediaStreamTrack;
  if (!mst) return null;
  return new MediaStream([mst]);
}

export interface MicrophoneStateOptions {
  /**
   * When true, the freshly-published mic is muted until `agentState`
   * first transitions to "listening". Prevents the worker's STT from
   * picking up speech during the connect/greeting window. Released
   * early if the user calls `toggleMute` — their click wins.
   *
   * Default: `false` (pre-0.20.0 behavior). `<AvatarWidget>` passes
   * `true` so embed sites get the gate without opting in. Direct
   * hook consumers can opt in by passing `true` alongside `agentState`.
   *
   * If `true` but no `agentState` is ever set, the mic stays muted —
   * you almost certainly want both options together.
   */
  gateUntilAgentReady?: boolean;
  /**
   * Current agent state from `useLiveKitSession` (or your own source).
   * Watched only when `gateUntilAgentReady` is true — the first
   * transition to "listening" unmutes and releases the gate.
   */
  agentState?: string | null;
}

export interface MicrophoneStateHandle {
  isMuted: boolean;
  /** Currently-selected input deviceId (empty string if default / unset). */
  activeDeviceId: string;
  /** Human-readable error when mic publish failed, else null. */
  micError: string | null;
  /** Toggle mute on the currently-published track. No-op if no track. */
  toggleMute: () => void;
  /**
   * Create + publish a local mic track into the given room. Safe to call
   * multiple times — replaces any existing track.
   */
  setupMic: (room: Room) => Promise<void>;
  /**
   * Bind the mic hook to an externally-managed Room without publishing a
   * track. Use this in controlled mode (consumer owns the Room and the
   * mic track) so `switchDevice` still has a Room to talk to. No-op if
   * the room reference is already set.
   */
  attachRoom: (room: Room) => void;
  /**
   * Switch to a different audio-input device. Uses LiveKit's
   * `room.switchActiveDevice` so it works regardless of whether the
   * package or the host owns the published track. Returns silently if
   * no Room has been attached yet.
   */
  switchDevice: (deviceId: string) => Promise<void>;
  /** Unpublish and dispose the current track. Safe to call when no track. */
  teardownMic: () => void;
  /** Clear the error state (e.g. after user clicks Retry). */
  clearError: () => void;
  /**
   * 0.15.2: read-only accessor for the published mic as a MediaStream
   * suitable for Web Audio analysis (the AudioWaveform reads mic
   * amplitude so it reacts when the VISITOR is talking, not just when
   * the agent is). Returns null when no mic has been set up. The
   * stream wraps the same `mediaStreamTrack` LiveKit is already
   * publishing — non-destructive tap, no bandwidth cost.
   */
  getMicStream: () => MediaStream | null;
}

export function useMicrophoneState(
  opts: MicrophoneStateOptions = {},
): MicrophoneStateHandle {
  const gateEnabled = opts.gateUntilAgentReady ?? false;
  const agentState = opts.agentState ?? null;
  const [isMuted, setIsMuted] = useState(gateEnabled);
  const [activeDeviceId, setActiveDeviceId] = useState<string>("");
  const [micError, setMicError] = useState<string | null>(null);
  const trackRef = useRef<LocalAudioTrack | null>(null);
  const roomRef = useRef<Room | null>(null);
  // Boot-up gate. `active` flips false on user toggle (their click
  // wins) or on the first agentState=listening release. `lastAutoIntent`
  // lets the release effect distinguish "user/host hasn't touched the
  // mic since we muted it" from "someone externally changed the room
  // mic state during the gate window".
  const gateRef = useRef<{ active: boolean; lastAutoIntent: boolean | null }>({
    active: gateEnabled,
    lastAutoIntent: null,
  });

  const setupMic = useCallback(async (room: Room) => {
    // Replace any prior track cleanly.
    if (trackRef.current && roomRef.current) {
      try {
        await roomRef.current.localParticipant.unpublishTrack(trackRef.current);
      } catch {
        // best effort
      }
      trackRef.current.stop();
      trackRef.current = null;
    }
    roomRef.current = room;
    setMicError(null);
    try {
      const track = await createLocalAudioTrack({
        echoCancellation: true,
        noiseSuppression: true,
      });
      await room.localParticipant.publishTrack(track);
      trackRef.current = track;
      // Boot-up gate: silence the just-published track until the agent
      // is ready (see header comment). Small race — publishTrack returned
      // before this setMicrophoneEnabled(false) lands, so a few frames
      // may go out before the source flips. The worker hasn't subscribed
      // yet in that window so STT doesn't see them in practice.
      if (gateRef.current.active) {
        await room.localParticipant.setMicrophoneEnabled(false);
        gateRef.current.lastAutoIntent = false;
        setIsMuted(true);
      } else {
        // Keep isMuted in sync with the new track's current state.
        setIsMuted(track.isMuted);
      }
      // Capture the deviceId actually selected so the menu can render
      // the correct active row.
      const settings = track.mediaStreamTrack?.getSettings?.();
      if (settings?.deviceId) setActiveDeviceId(settings.deviceId);
    } catch (err) {
      const msg =
        err instanceof Error && err.name === "NotAllowedError"
          ? "Enable your microphone to talk with the agent."
          : "Microphone unavailable. Check browser permissions and try again.";
      setMicError(msg);
      throw err;
    }
  }, []);

  const attachRoom = useCallback((room: Room) => {
    roomRef.current = room;
  }, []);

  const switchDevice = useCallback(async (deviceId: string) => {
    const room = roomRef.current;
    if (!room) return;
    try {
      // LiveKit's switchActiveDevice handles whichever audio track is
      // currently published — works in both internal-session and
      // controlled-session modes (where the host owns the track).
      await room.switchActiveDevice("audioinput", deviceId);
      setActiveDeviceId(deviceId);
    } catch (err) {
      console.warn("[useMicrophoneState] switchDevice failed:", err);
    }
  }, []);

  const toggleMute = useCallback(async () => {
    // SECURITY-CRITICAL PATH. setMicrophoneEnabled() is LiveKit's
    // canonical "actually stop / start publishing audio" primitive.
    // It flips the published mic's enabled state at the WebRTC
    // source so frames go silent on disable and resume on enable —
    // unlike track.mute() which on some SDK versions is signaling-
    // only and lets audio keep flowing.
    //
    // Driver MUST be our local isMuted state, NOT track.isMuted.
    // setMicrophoneEnabled can unpublish-and-republish the track
    // under the hood; trackRef.current can be left pointing at the
    // dead pre-disable track. Reading track.isMuted off that stale
    // ref returned false even after a mute toggle, which made the
    // next click "mute" again instead of unmuting — the user's
    // reported "I can't unmute" bug.
    const room = roomRef.current;
    const nextMuted = !isMuted;

    // Optimistic UI: flip the visible state immediately so the
    // mute button doesn't lag behind the user's intent.
    setIsMuted(nextMuted);
    // User touched the mic — their call wins. Release the gate so the
    // agent-state effect doesn't override on first "listening".
    gateRef.current.active = false;

    if (!room) return;
    try {
      await room.localParticipant.setMicrophoneEnabled(!nextMuted);
    } catch (err) {
      console.warn("[useMicrophoneState] setMicrophoneEnabled failed:", err);
      // Revert UI so the user knows mute didn't actually take
      // effect. Lying about mute state is the worst possible
      // failure mode here.
      setIsMuted(!nextMuted);
    }
  }, [isMuted]);

  // Boot-up gate release: on the first agentState=listening transition,
  // unmute the mic. User-override safety: only auto-flip if the room mic
  // state still matches what we last set. If a host (e.g. dashboard V2's
  // own gate logic, or voice-clone's setMicEnabled) changed it, leave
  // their state and just release the gate.
  useEffect(() => {
    if (!gateRef.current.active) return;
    if (agentState !== "listening") return;
    const room = roomRef.current;
    const local = room?.localParticipant;
    if (!local) {
      gateRef.current.active = false;
      return;
    }
    if (local.isMicrophoneEnabled === gateRef.current.lastAutoIntent) {
      void local.setMicrophoneEnabled(true);
      gateRef.current.lastAutoIntent = true;
      setIsMuted(false);
    }
    gateRef.current.active = false;
  }, [agentState]);

  const teardownMic = useCallback(() => {
    const track = trackRef.current;
    const room = roomRef.current;
    if (track && room) {
      try {
        void room.localParticipant.unpublishTrack(track);
      } catch {
        // best effort
      }
      track.stop();
    }
    trackRef.current = null;
    roomRef.current = null;
    // Re-arm the gate so the next setupMic re-mutes on publish.
    gateRef.current = { active: gateEnabled, lastAutoIntent: null };
    setIsMuted(gateEnabled);
    setActiveDeviceId("");
  }, [gateEnabled]);

  const clearError = useCallback(() => setMicError(null), []);

  const getMicStream = useCallback(() => trackToStream(trackRef.current), []);

  return {
    isMuted,
    activeDeviceId,
    micError,
    toggleMute,
    setupMic,
    attachRoom,
    switchDevice,
    teardownMic,
    clearError,
    getMicStream,
  };
}
