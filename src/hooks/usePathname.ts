// ─── usePathname ──────────────────────────────────────────────────────
// Source-of-truth for the current pathname inside <AvatarWidget>. Two modes:
//
//  1. Controlled — host passes `controlledPathname` (e.g. Next.js usePathname()
//     or React Router useLocation().pathname). We just return it.
//  2. Uncontrolled — we read window.location.pathname and listen for SPA
//     navigations by patching history.pushState/replaceState (the standard
//     pattern; Next.js router and React Router both do this themselves).
//
// The patch is idempotent: a marker on history.pushState prevents
// double-patching when multiple instances mount. Cleanup removes our
// listeners but does NOT restore the original pushState — other code
// may still be relying on the dispatched event.
//
// For Next.js App Router and React Router v6+ consumers should always
// pass controlledPathname. The internal patch is a fallback for plain
// HTML / vanilla SPA setups.

import { useEffect, useState } from "react";

const HISTORY_PATCH_MARKER = "__llHistoryPatched";
const PATHNAME_EVENT = "ll:pathname";

declare global {
  interface History {
    [HISTORY_PATCH_MARKER]?: boolean;
  }
}

function patchHistoryOnce() {
  if (typeof window === "undefined") return;
  if (window.history[HISTORY_PATCH_MARKER]) return;

  const origPush = window.history.pushState;
  const origReplace = window.history.replaceState;

  window.history.pushState = function (this: History, ...args) {
    const result = origPush.apply(this, args as Parameters<History["pushState"]>);
    window.dispatchEvent(new Event(PATHNAME_EVENT));
    return result;
  };

  window.history.replaceState = function (this: History, ...args) {
    const result = origReplace.apply(this, args as Parameters<History["replaceState"]>);
    window.dispatchEvent(new Event(PATHNAME_EVENT));
    return result;
  };

  window.history[HISTORY_PATCH_MARKER] = true;
}

function readPathname(): string {
  if (typeof window === "undefined") return "/";
  return window.location.pathname || "/";
}

/**
 * Returns the current pathname, reactive to SPA navigation.
 * Pass `controlledPathname` to skip internal detection (recommended for
 * Next.js App Router and React Router v6+ consumers).
 */
export function usePathname(controlledPathname?: string): string {
  const [internal, setInternal] = useState<string>(() =>
    controlledPathname ?? readPathname(),
  );

  useEffect(() => {
    if (controlledPathname !== undefined) return;
    patchHistoryOnce();

    const sync = () => setInternal(readPathname());
    sync();

    window.addEventListener("popstate", sync);
    window.addEventListener(PATHNAME_EVENT, sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener(PATHNAME_EVENT, sync);
    };
  }, [controlledPathname]);

  return controlledPathname ?? internal;
}
