// ─── useCameraState ───────────────────────────────────────────────────
// Owns the user's local camera track. Parallel to useMicrophoneState.
// Camera starts OFF; user toggles it explicitly from the widget toolbar.
// When enabled, also notifies the agent via a data message so the agent
// can factor video into its prompt (if the agent is configured to see).

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Track,
  createLocalVideoTrack,
  type LocalVideoTrack,
  type Room,
} from "livekit-client";

export interface CameraStateHandle {
  isEnabled: boolean;
  /** Human-readable error if getUserMedia was denied, else null. */
  error: string | null;
  /** The <video> element displaying the local camera preview (or null). */
  previewEl: HTMLVideoElement | null;
  /** The active device id, or "" if using default. */
  activeDeviceId: string;
  toggle: () => Promise<void>;
  /** Switch to a different camera device (keeps camera enabled). */
  switchDevice: (deviceId: string) => Promise<void>;
  /** Attach the Room once it's connected. */
  attachRoom: (room: Room) => void;
  /** Unpublish, stop the track, and clear state. */
  teardown: () => void;
  clearError: () => void;
}

const VIDEO_OPTS = { resolution: { width: 640, height: 480, frameRate: 24 } };

export function useCameraState(): CameraStateHandle {
  const [isEnabled, setIsEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewEl, setPreviewEl] = useState<HTMLVideoElement | null>(null);
  const [activeDeviceId, setActiveDeviceId] = useState<string>("");

  const roomRef = useRef<Room | null>(null);
  const trackRef = useRef<LocalVideoTrack | null>(null);

  const attachRoom = useCallback((room: Room) => {
    roomRef.current = room;
  }, []);

  const disableInternal = useCallback(() => {
    const room = roomRef.current;
    const track = trackRef.current;
    if (track && room) {
      // Capture track refs BEFORE unpublishing — LiveKit's unpublishTrack
      // can null out the publication's `track` property synchronously,
      // which used to throw "Cannot read properties of undefined
      // (reading 'stop')" when we then tried `pub.track.stop()` on the
      // (now-undefined) reference. Hit reliably when switching cameras
      // mid-session via the device-menu chevron.
      const pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
      const pubTrack = pub?.track;
      const toUnpublish = pubTrack ?? track;
      try { room.localParticipant.unpublishTrack(toUnpublish); } catch { /* best effort */ }
      try { toUnpublish.stop?.(); } catch { /* best effort */ }
    }
    trackRef.current = null;
    setPreviewEl(null);
    setIsEnabled(false);
  }, []);

  const enableInternal = useCallback(async (deviceId?: string) => {
    const room = roomRef.current;
    if (!room) return;
    setError(null);
    try {
      const opts: Parameters<typeof createLocalVideoTrack>[0] = { ...VIDEO_OPTS };
      if (deviceId) opts.deviceId = deviceId;
      const track = await createLocalVideoTrack(opts);
      await room.localParticipant.publishTrack(track);
      trackRef.current = track;
      const el = track.attach() as HTMLVideoElement;
      setPreviewEl(el);
      setIsEnabled(true);
      if (deviceId) setActiveDeviceId(deviceId);
      // Tell the agent we turned the camera on. Best-effort data message.
      try {
        room.localParticipant.publishData(
          new TextEncoder().encode(JSON.stringify({ type: "user_camera_on" })),
          { reliable: true },
        );
      } catch { /* best effort */ }
    } catch (err) {
      const msg =
        err instanceof Error && err.name === "NotAllowedError"
          ? "Enable your camera in the browser to share video."
          : "Camera unavailable. Check permissions and try again.";
      setError(msg);
    }
  }, []);

  const toggle = useCallback(async () => {
    if (isEnabled) {
      disableInternal();
    } else {
      await enableInternal(activeDeviceId || undefined);
    }
  }, [isEnabled, activeDeviceId, disableInternal, enableInternal]);

  const switchDevice = useCallback(async (deviceId: string) => {
    disableInternal();
    await enableInternal(deviceId);
  }, [disableInternal, enableInternal]);

  const teardown = useCallback(() => {
    disableInternal();
    roomRef.current = null;
    setError(null);
    setActiveDeviceId("");
  }, [disableInternal]);

  const clearError = useCallback(() => setError(null), []);

  useEffect(() => () => {
    // Component unmount — make sure we release the camera.
    if (trackRef.current) trackRef.current.stop();
  }, []);

  return {
    isEnabled,
    error,
    previewEl,
    activeDeviceId,
    toggle,
    switchDevice,
    attachRoom,
    teardown,
    clearError,
  };
}
