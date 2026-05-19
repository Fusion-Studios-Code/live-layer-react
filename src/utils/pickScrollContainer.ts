// ─── pickScrollContainer ──────────────────────────────────────────────
// Many Next.js / portfolio sites lock body height (overflow: hidden)
// and put the actual scroll on an inner element. The widget's default
// scroll_page handler used `window.scrollBy`, which does nothing in
// that case — the agent says "I'll scroll" and nothing visible moves.
//
// This util returns the right scroll target:
//   1. If `window` (== documentElement) actually scrolls, use it.
//   2. Otherwise, walk the DOM and pick the largest scrollable element
//      that's currently in the viewport. Same heuristic that browsers
//      use for spacebar / arrow-key scrolling on locked-body sites.
//   3. Fallback: window (so we always return something).
//
// The chosen element changes on each call — no caching — because
// scroll-locked sites swap their scroll container per route.

export type ScrollTarget = Window | HTMLElement;

function isWindowScrollable(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false;
  }
  const el = document.scrollingElement || document.documentElement;
  if (!el) return false;
  // The window scrolls if the document is taller than the viewport.
  // We don't trust just scrollHeight > clientHeight — some sites set
  // body { height: 100vh; overflow: hidden } which ALSO has
  // scrollHeight === clientHeight at the documentElement level. So we
  // check both AND that overflow is computed as visible/auto/scroll.
  if (el.scrollHeight <= el.clientHeight + 2) return false;
  const cs = window.getComputedStyle(el);
  if (cs.overflowY === "hidden" || cs.overflowY === "clip") return false;
  return true;
}

function isElementScrollable(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const cs = window.getComputedStyle(el);
  const overflowY = cs.overflowY;
  if (overflowY !== "auto" && overflowY !== "scroll") return false;
  if (el.scrollHeight <= el.clientHeight + 2) return false;
  return true;
}

function pickLargestScrollableInViewport(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>("body, body *"),
  );
  let best: HTMLElement | null = null;
  let bestArea = 0;
  for (const el of candidates) {
    if (!isElementScrollable(el)) continue;
    const rect = el.getBoundingClientRect();
    // Must be at least partially in the viewport (skip hidden / off-screen).
    if (rect.bottom <= 0 || rect.top >= window.innerHeight) continue;
    if (rect.right <= 0 || rect.left >= window.innerWidth) continue;
    if (rect.width <= 0 || rect.height <= 0) continue;
    // Skip the LiveLayer widget itself.
    if (el.closest(".ll-widget")) continue;
    const area = rect.width * rect.height;
    if (area > bestArea) {
      bestArea = area;
      best = el;
    }
  }
  return best;
}

export function pickScrollContainer(): ScrollTarget {
  if (typeof window === "undefined") {
    return null as unknown as ScrollTarget; // SSR guard — caller checks
  }
  if (isWindowScrollable()) return window;
  const inner = pickLargestScrollableInViewport();
  if (inner) return inner;
  return window;
}

export function getViewportHeight(target: ScrollTarget): number {
  if (target instanceof Window) {
    return target.innerHeight || 0;
  }
  return target.clientHeight || 0;
}

export function getMaxScroll(target: ScrollTarget): number {
  if (target instanceof Window) {
    if (typeof document === "undefined") return 0;
    return Math.max(
      document.body?.scrollHeight ?? 0,
      document.documentElement?.scrollHeight ?? 0,
    );
  }
  return target.scrollHeight - target.clientHeight;
}
