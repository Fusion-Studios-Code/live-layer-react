// ─── useIsMobile ──────────────────────────────────────────────────────
// SSR-safe viewport width watcher. Returns `true` when the viewport width
// is below `breakpoint`. On the server and before first paint, returns
// `false` to avoid hydration mismatches — consumers that need the real
// value wait for the first effect.
//
// `breakpoint === false` disables mobile detection entirely (always false).

import { useEffect, useState } from "react";

const DEFAULT_BREAKPOINT = 640;

export function useIsMobile(breakpoint: number | false = DEFAULT_BREAKPOINT): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (breakpoint === false) {
      setIsMobile(false);
      return;
    }

    // Server/pre-paint already returned false. Check synchronously on mount
    // so the first visible render reflects the real viewport.
    if (typeof window === "undefined" || typeof window.matchMedia === "undefined") {
      return;
    }

    const query = `(max-width: ${breakpoint - 1}px)`;
    const mql = window.matchMedia(query);

    const update = () => setIsMobile(mql.matches);
    update(); // sync initial

    // Both APIs exist in the wild; prefer the modern addEventListener.
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", update);
      return () => mql.removeEventListener("change", update);
    } else {
      // Safari < 14, legacy fallback
      (mql as unknown as { addListener: (cb: () => void) => void }).addListener(update);
      return () => {
        (mql as unknown as { removeListener: (cb: () => void) => void }).removeListener(update);
      };
    }
  }, [breakpoint]);

  return isMobile;
}
