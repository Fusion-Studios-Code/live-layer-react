// ─── useDisplayModePersistence ────────────────────────────────────────
// Wraps useDisplayMode with localStorage persistence. The widget's display
// mode survives page reloads. Controlled mode bypasses persistence
// entirely (caller owns state, caller owns persistence if they want it).
//
// SSR-safe: initial render always uses `defaultValue`. First effect reads
// from localStorage and promotes the stored value. No hydration mismatch
// because server + pre-paint client both render the same default.

import { useEffect, useRef } from "react";
import { readLocalStorage, writeLocalStorage } from "../utils/persistence";
import { useDisplayMode, type DisplayMode } from "./useDisplayMode";

interface Options {
  value?: DisplayMode;
  defaultValue?: DisplayMode;
  onChange?: (next: DisplayMode) => void;
  persistKey?: string;
  disablePersistence?: boolean;
}

const VALID: DisplayMode[] = ["hidden", "minimized", "expanded"];

function parseStoredMode(raw: string | null): DisplayMode | null {
  if (!raw) return null;
  return (VALID as string[]).includes(raw) ? (raw as DisplayMode) : null;
}

export function useDisplayModePersistence({
  value,
  defaultValue = "expanded",
  onChange,
  persistKey = "ll-widget",
  disablePersistence = false,
}: Options = {}): [DisplayMode, (next: DisplayMode) => void] {
  const storageKey = `${persistKey}:display-mode`;
  const hydratedRef = useRef(false);

  const [current, setCurrent] = useDisplayMode({
    value,
    defaultValue,
    onChange: (next) => {
      // Only persist uncontrolled mode changes. Controlled = caller owns persistence.
      if (value === undefined && !disablePersistence) {
        writeLocalStorage(storageKey, next);
      }
      onChange?.(next);
    },
  });

  // On first mount (client-only), promote the stored value if any.
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    if (disablePersistence || value !== undefined) return;

    const stored = parseStoredMode(readLocalStorage(storageKey));
    if (stored && stored !== current) {
      setCurrent(stored);
    }
    // Only run once on mount; subsequent toggles are handled by setCurrent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return [current, setCurrent];
}
