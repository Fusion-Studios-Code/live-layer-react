// ─── useRouteMatch ────────────────────────────────────────────────────
// Pure decision: given the current pathname and showOn / hideOn config,
// should the widget render?
//
// Rules:
//   - If neither showOn nor hideOn: always render
//   - hideOn wins over showOn for collisions
//   - showOn defines a whitelist; pathname must match at least one
//   - Empty showOn (e.g. []) treated same as undefined: render allowed
//   - undefined pathname (SSR / pre-mount): render allowed (avoids flicker)
//
// The hook is just a memo around `shouldRender` — kept as a hook so the
// `import` shape matches the rest of the package.

import { useMemo } from "react";
import type { RoutePattern } from "../types";
import { matchGlob } from "../utils/globToRegex";

export function matchesPattern(pattern: RoutePattern, pathname: string): boolean {
  if (typeof pattern === "function") return pattern(pathname);
  if (pattern instanceof RegExp) return pattern.test(pathname);
  // string — treat as glob (which also handles exact match for patterns
  // without `*`).
  return matchGlob(pattern, pathname);
}

function matchesAny(
  patterns: RoutePattern[] | undefined,
  pathname: string,
): boolean {
  if (!patterns || patterns.length === 0) return false;
  for (const p of patterns) {
    if (matchesPattern(p, pathname)) return true;
  }
  return false;
}

/**
 * Pure: should the widget render at this pathname?
 *
 * @param pathname  current path, or undefined if not yet known
 * @param showOn    if set, restricts rendering to matching paths only
 * @param hideOn    if set, blocks rendering on matching paths (wins)
 */
export function shouldRenderAtPath(
  pathname: string | undefined,
  showOn: RoutePattern[] | undefined,
  hideOn: RoutePattern[] | undefined,
): boolean {
  if (pathname === undefined) return true; // first render / SSR — don't flicker
  if (matchesAny(hideOn, pathname)) return false;
  if (showOn && showOn.length > 0) return matchesAny(showOn, pathname);
  return true;
}

export function useRouteMatch(
  pathname: string | undefined,
  showOn: RoutePattern[] | undefined,
  hideOn: RoutePattern[] | undefined,
): boolean {
  return useMemo(
    () => shouldRenderAtPath(pathname, showOn, hideOn),
    [pathname, showOn, hideOn],
  );
}
