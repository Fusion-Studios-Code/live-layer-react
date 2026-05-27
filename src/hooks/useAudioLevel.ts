// ─── useAudioLevel ────────────────────────────────────────────────────
//
// Multi-source audio analyser for the widget. Owns ONE AudioContext +
// rAF loop for the widget's lifetime. Consumers attach any number of
// independent audio sources (the agent's <audio> element + the
// visitor's local mic MediaStream are the two typical ones) and
// subscribe to a single combined level signal. The combined level is
// max(allSources) so subscribers see whichever side is currently
// louder — perfect for a waveform that should react to "whoever is
// talking" without per-tick decision logic in the renderer.
//
//   ┌─────────────────────┐        ┌────────────┐
//   │ HTMLAudioElement    │───────►│ Analyser A │──┐
//   │ (agent track)       │        │  fft 64    │  │
//   └─────────────────────┘        └────────────┘  │
//                                                  ▼
//                                            max(level) ──► subscribers
//                                                  ▲
//   ┌─────────────────────┐        ┌────────────┐  │
//   │ MediaStream         │───────►│ Analyser B │──┘
//   │ (local mic track)   │        │  fft 64    │
//   └─────────────────────┘        └────────────┘
//
// Why max() and not sum():
//   - sum overshoots quickly to 1.0 once both sides are loud, washing
//     out variation in the bars. max preserves dynamic range for the
//     louder participant — which is what the eye reads as "who's
//     talking right now."
//   - mathematically simple, no compressor / agc, no per-source
//     calibration needed.
//
// Each source slot is keyed by purpose ("agent" / "mic") so re-attaching
// the same source type swaps cleanly without leaving orphan nodes.
//
// Known Web Audio API limit: a single HTMLMediaElement can be the
// source of ONLY ONE MediaElementAudioSourceNode. If the same element
// is re-attached (e.g. React strict-mode double-effect), the second
// createMediaElementSource throws. We catch, warn, keep state intact.
// Same restriction does NOT apply to MediaStreamAudioSourceNode — those
// can be created multiple times against the same stream.

import { useCallback, useEffect, useRef } from "react";

type LevelSubscriber = (level: number) => void;

/** Slot identifier — each source kind owns one slot, swapping in place. */
export type AudioLevelSlot = "agent" | "mic";

export interface AudioLevelHandle {
  /**
   * Attach an HTMLMediaElement (the agent's <audio>/<video>) as the
   * source for the given slot. Safe to call repeatedly — replaces the
   * prior source for that slot.
   */
  attach: (element: HTMLMediaElement, slot?: AudioLevelSlot) => void;
  /**
   * Attach a MediaStream (the local mic track) as the source for the
   * given slot. Safe to call repeatedly — replaces the prior source.
   */
  attachStream: (stream: MediaStream, slot?: AudioLevelSlot) => void;
  /**
   * Detach ALL slots and stop the rAF loop. Keeps the AudioContext
   * alive (cheap, reused on next attach).
   */
  detach: () => void;
  /**
   * Detach a specific slot. Useful when only the mic goes away (e.g.
   * the visitor toggles mute) but the agent audio should keep driving
   * the waveform.
   */
  detachSlot: (slot: AudioLevelSlot) => void;
  /** Subscribe to combined level ticks (0..1). Returns an unsubscribe fn. */
  subscribe: (cb: LevelSubscriber) => () => void;
}

interface SourceEntry {
  analyser: AnalyserNode;
  node: AudioNode;
  /** Reused per-source typed buffer for getByteFrequencyData. */
  buffer: Uint8Array<ArrayBuffer>;
}

export function useAudioLevel(): AudioLevelHandle {
  const ctxRef = useRef<AudioContext | null>(null);
  const sourcesRef = useRef<Map<AudioLevelSlot, SourceEntry>>(new Map());
  const rafRef = useRef<number | null>(null);
  const subscribersRef = useRef<Set<LevelSubscriber>>(new Set());

  const tick = useCallback(() => {
    const sources = sourcesRef.current;
    if (sources.size === 0) {
      rafRef.current = null;
      return;
    }
    // Compute the per-source RMS-ish level (mean of byte-bin amplitudes
    // normalized to 0..1), then take the MAX across sources. Single
    // pass — no allocations beyond the per-source buffer reuse.
    let maxLevel = 0;
    for (const { analyser, buffer } of sources.values()) {
      // fftSize is fixed at 64 at install time so buffer.length always
      // matches analyser.frequencyBinCount (32). No realloc path needed.
      analyser.getByteFrequencyData(buffer);
      let sum = 0;
      for (let i = 0; i < buffer.length; i++) sum += buffer[i];
      const level = sum / buffer.length / 255;
      if (level > maxLevel) maxLevel = level;
    }
    for (const cb of subscribersRef.current) {
      try {
        cb(maxLevel);
      } catch (e) {
        console.error("[useAudioLevel] subscriber threw:", e);
      }
    }
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const ensureContext = useCallback((): AudioContext | null => {
    if (ctxRef.current) return ctxRef.current;
    if (typeof window === "undefined" || typeof AudioContext === "undefined") {
      return null;
    }
    ctxRef.current = new AudioContext();
    return ctxRef.current;
  }, []);

  const ensureLoop = useCallback(() => {
    if (rafRef.current === null && sourcesRef.current.size > 0) {
      rafRef.current = requestAnimationFrame(tick);
    }
  }, [tick]);

  /**
   * Internal: disconnect + drop the entry for a slot if present. Safe
   * to call when the slot is empty. Doesn't stop the rAF loop on its
   * own — caller stops it if size hits zero.
   */
  const dropSlot = useCallback((slot: AudioLevelSlot) => {
    const existing = sourcesRef.current.get(slot);
    if (!existing) return;
    try {
      existing.node.disconnect();
    } catch {
      // already disconnected
    }
    try {
      existing.analyser.disconnect();
    } catch {
      // already disconnected
    }
    sourcesRef.current.delete(slot);
  }, []);

  const installSource = useCallback(
    (slot: AudioLevelSlot, makeNode: (ctx: AudioContext) => AudioNode | null) => {
      const ctx = ensureContext();
      if (!ctx) return;

      dropSlot(slot);

      const node = makeNode(ctx);
      if (!node) return;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      try {
        node.connect(analyser);
      } catch (e) {
        console.warn("[useAudioLevel] connect failed for slot", slot, e);
        return;
      }
      // IMPORTANT: do NOT connect the analyser to ctx.destination. The
      // browser already plays the agent audio via its own <audio>
      // element, and the local mic is published via LiveKit — connecting
      // to destination here would either (a) double-play the agent
      // audio at 2× volume or (b) cause the mic to monitor back to the
      // visitor's speakers (feedback loop). The analyser still receives
      // frames from the source; destination isn't required for that.

      sourcesRef.current.set(slot, {
        analyser,
        node,
        buffer: new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount)),
      });
      ensureLoop();
    },
    [dropSlot, ensureContext, ensureLoop],
  );

  const attach = useCallback(
    (element: HTMLMediaElement, slot: AudioLevelSlot = "agent") => {
      installSource(slot, (ctx) => {
        try {
          return ctx.createMediaElementSource(element);
        } catch (e) {
          // An HTMLMediaElement can be the source of ONLY ONE
          // MediaElementAudioSourceNode. If the caller re-attaches an
          // element that was previously a source (even via a prior
          // hook instance), this throws. Log and continue — the rest
          // of the widget still works.
          console.warn(
            "[useAudioLevel] createMediaElementSource failed for slot",
            slot,
            e,
          );
          return null;
        }
      });
    },
    [installSource],
  );

  const attachStream = useCallback(
    (stream: MediaStream, slot: AudioLevelSlot = "mic") => {
      installSource(slot, (ctx) => {
        try {
          return ctx.createMediaStreamSource(stream);
        } catch (e) {
          console.warn(
            "[useAudioLevel] createMediaStreamSource failed for slot",
            slot,
            e,
          );
          return null;
        }
      });
    },
    [installSource],
  );

  const detachSlot = useCallback(
    (slot: AudioLevelSlot) => {
      dropSlot(slot);
      if (sourcesRef.current.size === 0 && rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    },
    [dropSlot],
  );

  const detach = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    for (const slot of Array.from(sourcesRef.current.keys())) {
      dropSlot(slot);
    }
  }, [dropSlot]);

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
      if (ctxRef.current) {
        try {
          void ctxRef.current.close();
        } catch {
          // ignore
        }
        ctxRef.current = null;
      }
      subscribersRef.current.clear();
    };
  }, [detach]);

  return { attach, attachStream, detach, detachSlot, subscribe };
}
