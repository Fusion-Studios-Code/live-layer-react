// ─── useScreenShareState ──────────────────────────────────────────────
// Wraps room.localParticipant.setScreenShareEnabled(). Single toggle,
// no device selection (browser picker handles that). Exposes the local
// preview element so the widget can render a PIP.

import { useCallback, useRef, useState } from "react";
import { Track, type Room } from "livekit-client";

export interface ScreenShareStateHandle {
  isEnabled: boolean;
  error: string | null;
  previewEl: HTMLVideoElement | null;
  toggle: () => Promise<void>;
  attachRoom: (room: Room) => void;
  teardown: () => void;
  clearError: () => void;
}

export function useScreenShareState(): ScreenShareStateHandle {
  const [isEnabled, setIsEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewEl, setPreviewEl] = useState<HTMLVideoElement | null>(null);
  const roomRef = useRef<Room | null>(null);

  const attachRoom = useCallback((room: Room) => {
    roomRef.current = room;
  }, []);

  const stopPreview = useCallback(() => setPreviewEl(null), []);

  const toggle = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    if (isEnabled) {
      try { await room.localParticipant.setScreenShareEnabled(false); }
      catch { /* already stopped */ }
      stopPreview();
      setIsEnabled(false);
      return;
    }
    setError(null);
    try {
      await room.localParticipant.setScreenShareEnabled(true);
      // Track publishes asynchronously. Poll briefly for the attached element.
      let tries = 0;
      const pickUp = () => {
        const pub = room.localParticipant.getTrackPublication(Track.Source.ScreenShare);
        if (pub?.track) {
          const el = pub.track.attach() as HTMLVideoElement;
          setPreviewEl(el);
          setIsEnabled(true);
          try {
            room.localParticipant.publishData(
              new TextEncoder().encode(JSON.stringify({ type: "user_screen_share_on" })),
              { reliable: true },
            );
          } catch { /* best effort */ }
          return;
        }
        if (tries++ < 10) setTimeout(pickUp, 100);
        else setIsEnabled(true); // give up on PIP but we're sharing
      };
      pickUp();
    } catch (err) {
      // User canceled picker is a benign error — don't show it.
      const name = err instanceof Error ? err.name : "";
      if (name !== "NotAllowedError" && name !== "AbortError") {
        setError("Screen share unavailable. Try again.");
      }
      setIsEnabled(false);
    }
  }, [isEnabled, stopPreview]);

  const teardown = useCallback(() => {
    const room = roomRef.current;
    if (room && isEnabled) {
      try { room.localParticipant.setScreenShareEnabled(false); } catch { /* best effort */ }
    }
    stopPreview();
    setIsEnabled(false);
    setError(null);
    roomRef.current = null;
  }, [isEnabled, stopPreview]);

  const clearError = useCallback(() => setError(null), []);

  return { isEnabled, error, previewEl, toggle, attachRoom, teardown, clearError };
}
