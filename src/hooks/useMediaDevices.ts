// ─── useMediaDevices ──────────────────────────────────────────────────
// Enumerates audio + video input devices. Call refresh() after a mic or
// camera permission grant so labels become available (browsers hide
// device labels until at least one permission is granted).

import { useCallback, useEffect, useState } from "react";

export interface MediaDevicesHandle {
  mics: MediaDeviceInfo[];
  cameras: MediaDeviceInfo[];
  refresh: () => Promise<void>;
}

export function useMediaDevices(): MediaDevicesHandle {
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);

  const refresh = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setMics(devices.filter((d) => d.kind === "audioinput"));
      setCameras(devices.filter((d) => d.kind === "videoinput"));
    } catch {
      // Permissions not granted yet — skip silently.
    }
  }, []);

  useEffect(() => {
    void refresh();
    if (typeof navigator === "undefined" || !navigator.mediaDevices) return;
    const handler = () => void refresh();
    navigator.mediaDevices.addEventListener("devicechange", handler);
    return () => navigator.mediaDevices.removeEventListener("devicechange", handler);
  }, [refresh]);

  return { mics, cameras, refresh };
}
