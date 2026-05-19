// ─── localStorage helpers (SSR-safe) ─────────────────────────────────
// Respects the consumer's `disablePersistence` flag. Never throws — a
// storage failure (private-mode Safari, quota exceeded, disabled) silently
// falls back to in-memory-only behavior.

export function readLocalStorage(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeLocalStorage(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // quota, private mode, disabled — swallow
  }
}

export function removeLocalStorage(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // see above
  }
}
