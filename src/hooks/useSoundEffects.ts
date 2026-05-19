// Mirrors the dashboard's lib/audio/play-sound.ts pattern. The same MP3
// files (page-change-sound, confirmation-sound, thinking-sound) are
// served from the live-layer Next.js public folder, so the embedded
// widget reads them from `${baseUrl}/audio/...` — production and dev
// resolve to the right host automatically.

import { useCallback, useEffect, useMemo, useRef } from "react";

export type SoundEffectsConfig =
  | boolean
  | {
      navigate?: boolean;
      thinking?: boolean;
      action?: boolean;
    };

interface Resolved {
  navigate: boolean;
  thinking: boolean;
  action: boolean;
}

function resolve(cfg: SoundEffectsConfig | undefined): Resolved {
  if (cfg === false) return { navigate: false, thinking: false, action: false };
  if (cfg === undefined || cfg === true)
    return { navigate: true, thinking: true, action: true };
  return {
    navigate: cfg.navigate !== false,
    thinking: cfg.thinking !== false,
    action: cfg.action !== false,
  };
}

interface Hook {
  playPageChange: () => void;
  playConfirmation: () => void;
  setThinking: (active: boolean) => void;
}

/**
 * Internal hook that owns the three UI sound effects mirrored from the
 * dashboard. Audio failures are silently swallowed — sounds are never
 * critical and autoplay restrictions are common.
 */
export function useSoundEffects(opts: {
  baseUrl: string;
  config?: SoundEffectsConfig;
}): Hook {
  const cfg = useMemo(() => resolve(opts.config), [opts.config]);
  const base = opts.baseUrl.replace(/\/+$/, "");
  const thinkingRef = useRef<HTMLAudioElement | null>(null);

  const playOneShot = useCallback(
    (path: string) => {
      try {
        const a = new Audio(`${base}${path}`);
        // Don't await — fire and forget. Promise rejection (autoplay
        // gating, no user gesture yet) is silently ignored.
        void a.play().catch(() => {});
      } catch {
        // Audio constructor failed (SSR, no Audio API)
      }
    },
    [base],
  );

  const playPageChange = useCallback(() => {
    if (!cfg.navigate) return;
    playOneShot("/audio/page-change-sound.mp3");
  }, [cfg.navigate, playOneShot]);

  const playConfirmation = useCallback(() => {
    if (!cfg.action) return;
    playOneShot("/audio/confirmation-sound.mp3");
  }, [cfg.action, playOneShot]);

  const setThinking = useCallback(
    (active: boolean) => {
      if (!cfg.thinking) {
        // Disabled — make sure any leftover loop is killed.
        if (thinkingRef.current) {
          try {
            thinkingRef.current.pause();
          } catch {
            // ignore
          }
          thinkingRef.current = null;
        }
        return;
      }
      if (active) {
        if (thinkingRef.current) return; // already looping
        try {
          const a = new Audio(`${base}/audio/thinking-sound.mp3`);
          a.loop = true;
          a.volume = 0.3;
          void a.play().catch(() => {
            // Autoplay blocked or fetch failed; clear so we can retry on
            // the next thinking transition.
            thinkingRef.current = null;
          });
          thinkingRef.current = a;
        } catch {
          // ignore
        }
      } else if (thinkingRef.current) {
        try {
          thinkingRef.current.pause();
        } catch {
          // ignore
        }
        thinkingRef.current = null;
      }
    },
    [base, cfg.thinking],
  );

  // Best-effort cleanup on unmount.
  useEffect(() => {
    return () => {
      if (thinkingRef.current) {
        try {
          thinkingRef.current.pause();
        } catch {
          // ignore
        }
        thinkingRef.current = null;
      }
    };
  }, []);

  // Stabilize the returned object so consumers can put it in long-lived
  // useCallback deps without churning identity every render. The three
  // members are already useCallback'd; we just memoize the wrapper.
  return useMemo(
    () => ({ playPageChange, playConfirmation, setThinking }),
    [playPageChange, playConfirmation, setThinking],
  );
}
