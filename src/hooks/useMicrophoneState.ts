// ─── useMicrophoneState ───────────────────────────────────────────────
// Owns the user's mic track lifecycle: publish on connect, mute/unmute on
// demand, cleanup on disconnect. Exposes a friendly error string when
// the browser denies permission so the UI can prompt.

import { useCallback, useRef, useState } from "react";
import {
  createLocalAudioTrack,
  type LocalAudioTrack,
  type Room,
} from "livekit-client";

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
}

export function useMicrophoneState(): MicrophoneStateHandle {
  const [isMuted, setIsMuted] = useState(false);
  const [activeDeviceId, setActiveDeviceId] = useState<string>("");
  const [micError, setMicError] = useState<string | null>(null);
  const trackRef = useRef<LocalAudioTrack | null>(null);
  const roomRef = useRef<Room | null>(null);

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
      // Keep isMuted in sync with the new track's current state.
      setIsMuted(track.isMuted);
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
    setIsMuted(false);
    setActiveDeviceId("");
  }, []);

  const clearError = useCallback(() => setMicError(null), []);

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
  };
}
