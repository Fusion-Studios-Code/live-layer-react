// ─── AudioWaveform ────────────────────────────────────────────────────
// Renders N bars whose heights track the live audio level. Subscribes to
// `useAudioLevel` and writes bar heights to DOM refs directly — no React
// re-render per tick. This is critical for 60fps on mobile where the
// minimized dock renders this prominently.
//
// Each bar's instantaneous height combines the shared audio level with a
// deterministic per-bar phase offset so neighboring bars don't move in
// lockstep (looks more alive). Phase is a stable function of bar index,
// not random, so the animation is the same across frames at a given
// level — only the level input drives variation.

import { useEffect, useMemo, useRef } from "react";
import type { FC } from "react";
import type { AudioLevelHandle } from "../hooks/useAudioLevel";

interface Props {
  audioLevel: AudioLevelHandle;
  /** Number of bars. Default 20. */
  bars?: number;
  /** Max height in px that a bar reaches at level 1.0. */
  maxHeight?: number;
  /** Min height in px (bar always visible). */
  minHeight?: number;
  /** CSS class on the container. */
  className?: string;
  /** Per-bar CSS class. */
  barClassName?: string;
}

export const AudioWaveform: FC<Props> = ({
  audioLevel,
  bars = 20,
  maxHeight = 20,
  minHeight = 4,
  className,
  barClassName,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const barRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Deterministic phase per bar so adjacent bars look independent.
  const phases = useMemo(() => {
    // Golden-ratio irrational spacing spreads bars pseudo-randomly across [0, 1).
    const phi = (Math.sqrt(5) - 1) / 2;
    return Array.from({ length: bars }, (_, i) => {
      const frac = (i * phi) % 1;
      return 0.5 + frac * 0.5; // 0.5..1.0 — always positive amplitude
    });
  }, [bars]);

  useEffect(() => {
    const unsubscribe = audioLevel.subscribe((level) => {
      for (let i = 0; i < bars; i++) {
        const el = barRefs.current[i];
        if (!el) continue;
        const h = Math.max(minHeight, level * maxHeight * phases[i]);
        el.style.height = `${h}px`;
      }
    });
    return unsubscribe;
  }, [audioLevel, bars, maxHeight, minHeight, phases]);

  const cls = ["ll-waveform", className].filter(Boolean).join(" ");

  return (
    <div ref={containerRef} className={cls} aria-hidden="true">
      {Array.from({ length: bars }, (_, i) => (
        <div
          key={i}
          ref={(el) => {
            barRefs.current[i] = el;
          }}
          className={["ll-waveform__bar", barClassName].filter(Boolean).join(" ")}
          style={{ height: `${minHeight}px` }}
        />
      ))}
    </div>
  );
};
