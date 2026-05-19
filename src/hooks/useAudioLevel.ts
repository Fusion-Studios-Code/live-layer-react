// ─── useAudioLevel ────────────────────────────────────────────────────
//
// Own one AudioContext + AnalyserNode for the widget's lifetime. Consumers
// attach a media element (audio or video) and subscribe to level updates.
//
//   ┌───────────────┐      ┌───────────────┐      ┌─────────────┐
//   │ HTMLMedia     │─────►│ MediaElement  │─────►│  Analyser   │─────► destination
//   │ Element       │      │ SourceNode    │      │  (fft 64)   │
//   └───────────────┘      └───────────────┘      └─────────────┘
//                                                        │
//                                                        │ getByteFreq
//                                                        │ via rAF loop
//                                                        ▼
//                                                  subscribers:
//                                                    cb(level 0..1)
//
// Why this shape:
//   - One rAF loop regardless of how many components subscribe.
//   - Subscribers get raw levels directly; they set DOM refs, not React
//     state. No 60fps React re-renders.
//   - `attach()` disposes prior source cleanly before creating a new one,
//     so swapping (agent track → user mic) doesn't leak.
//   - Full teardown on unmount: rAF cancelled, source + analyser
//     disconnected, AudioContext closed.
//
// Known Web Audio API limit: a single HTMLMediaElement can be the source
// of ONLY ONE MediaElementAudioSourceNode. If the same element is attached
// twice (e.g., React strict-mode double effect), the second createMediaElement-
// Source throws. We catch, warn, and continue — behaviour matches the
// original AvatarWidget.

import { useCallback, useEffect, useRef } from "react";

type LevelSubscriber = (level: number) => void;

export interface AudioLevelHandle {
  /** Attach a media element as the analyser source. Safe to call repeatedly — swaps sources. */
  attach: (element: HTMLMediaElement) => void;
  /** Stop the rAF loop and disconnect the current source. Keeps the context alive. */
  detach: () => void;
  /** Subscribe to level ticks (0..1). Returns an unsubscribe fn. */
  subscribe: (cb: LevelSubscriber) => () => void;
}

export function useAudioLevel(): AudioLevelHandle {
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const subscribersRef = useRef<Set<LevelSubscriber>>(new Set());
  const bufferRef = useRef<Uint8Array<ArrayBuffer> | null>(null);

  const tick = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) {
      rafRef.current = null;
      return;
    }
    if (!bufferRef.current || bufferRef.current.length !== analyser.frequencyBinCount) {
      // Cast to the stricter typing TS 5.7+ expects for getByteFrequencyData.
      bufferRef.current = new Uint8Array(
        new ArrayBuffer(analyser.frequencyBinCount),
      );
    }
    const data = bufferRef.current;
    analyser.getByteFrequencyData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i];
    const level = sum / data.length / 255;
    for (const cb of subscribersRef.current) {
      try {
        cb(level);
      } catch (e) {
        console.error("[useAudioLevel] subscriber threw:", e);
      }
    }
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const ensureContext = useCallback(() => {
    if (ctxRef.current) return;
    if (typeof window === "undefined" || typeof AudioContext === "undefined") return;
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 64;
    analyser.connect(ctx.destination);
    ctxRef.current = ctx;
    analyserRef.current = analyser;
  }, []);

  const attach = useCallback(
    (element: HTMLMediaElement) => {
      ensureContext();
      if (!ctxRef.current || !analyserRef.current) return;

      // Dispose any existing source cleanly before creating a new one.
      if (sourceRef.current) {
        try {
          sourceRef.current.disconnect();
        } catch {
          // already disconnected
        }
        sourceRef.current = null;
      }

      try {
        const source = ctxRef.current.createMediaElementSource(element);
        source.connect(analyserRef.current);
        sourceRef.current = source;
      } catch (e) {
        // An HTMLMediaElement may be used as source only once. If the caller
        // re-attaches an element that was previously a source (even via a
        // prior hook instance), this throws. We log and leave state intact
        // so the rest of the widget still works.
        console.warn("[useAudioLevel] createMediaElementSource failed:", e);
        return;
      }

      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(tick);
      }
    },
    [ensureContext, tick],
  );

  const detach = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (sourceRef.current) {
      try {
        sourceRef.current.disconnect();
      } catch {
        // already disconnected
      }
      sourceRef.current = null;
    }
  }, []);

  const subscribe = useCallback((cb: LevelSubscriber) => {
    subscribersRef.current.add(cb);
    return () => {
      subscribersRef.current.delete(cb);
    };
  }, []);

  // Full teardown on unmount
  useEffect(() => {
    return () => {
      detach();
      if (analyserRef.current) {
        try {
          analyserRef.current.disconnect();
        } catch {
          // ignore
        }
        analyserRef.current = null;
      }
      if (ctxRef.current) {
        try {
          void ctxRef.current.close();
        } catch {
          // ignore
        }
        ctxRef.current = null;
      }
      subscribersRef.current.clear();
      bufferRef.current = null;
    };
  }, [detach]);

  return { attach, detach, subscribe };
}
