// ─── extractRoutes ────────────────────────────────────────────────────
// DOM-walks every <a href> on the page and returns a deduped list of
// routes the agent could navigate to. Used by the `request_routes`
// command. Cached for 5s (longer than page-context's 1s — routes
// change less). Bust on pushState.
//
// Skip rules:
//   - data-ll-private subtrees
//   - .ll-widget (the widget itself)
//   - href that's empty / "#" / "javascript:" / "mailto:" / "tel:"

import { hasPrivateAncestor } from "./fieldPrivacy";

const MAX_ROUTES = 200;

export interface ExtractedRoute {
  href: string;
  /** Visible link text (DOM-walker source) or short label (consumer-supplied). */
  text: string;
  /** Same origin as `window.location.origin`. External links surface but flagged. */
  internal: boolean;
  /**
   * Optional human-friendly page title — shown to the LLM alongside the
   * href so it can match user intent ("take me to that pricing page")
   * without scraping the page itself. Set this when the host supplies
   * routes via the `getRoutes` callback prop.
   */
  title?: string;
  /**
   * Optional one-line description — same purpose as `title` but for
   * disambiguating similar paths (e.g. "Project case study for X").
   */
  description?: string;
}

/**
 * The shape consumers pass back from the `getRoutes` callback. Matches
 * `ExtractedRoute` but every field except `href` is optional — defaults
 * are filled in by the widget.
 */
export interface RouteEntryInput {
  href: string;
  text?: string;
  title?: string;
  description?: string;
  internal?: boolean;
}

/**
 * Normalize a consumer-supplied route into the canonical shape the
 * agent will see. Defaults: `text` falls back to `title` then to
 * `href`, `internal` defaults to true (explicit lists are usually
 * about the host's own routes).
 */
export function normalizeRouteInput(input: RouteEntryInput): ExtractedRoute {
  const href = String(input.href || "");
  return {
    href,
    text: String(input.text ?? input.title ?? href),
    internal: input.internal ?? true,
    title: input.title,
    description: input.description,
  };
}

function isNavigableHref(href: string): boolean {
  if (!href) return false;
  if (href.startsWith("#")) return false;
  if (href.startsWith("javascript:")) return false;
  if (href.startsWith("mailto:")) return false;
  if (href.startsWith("tel:")) return false;
  return true;
}

export function extractRoutes(doc?: Document): ExtractedRoute[] {
  const d = doc ?? (typeof document !== "undefined" ? document : null);
  if (!d) return [];
  const origin =
    (typeof window !== "undefined" && window.location.origin) || "";

  const seen = new Set<string>();
  const out: ExtractedRoute[] = [];
  const anchors = Array.from(d.querySelectorAll<HTMLAnchorElement>("a[href]"));

  for (const a of anchors) {
    if (out.length >= MAX_ROUTES) break;
    if (hasPrivateAncestor(a)) continue;
    const rawHref = a.getAttribute("href") || "";
    if (!isNavigableHref(rawHref)) continue;

    // Normalize: keep relative hrefs as-is for in-app routing; for
    // absolute hrefs, surface as-is but flag internal vs external.
    let href = rawHref;
    let internal = true;
    try {
      if (typeof window !== "undefined") {
        const url = new URL(rawHref, origin);
        internal = url.origin === origin;
        // For internal absolute URLs, return just the path+search+hash.
        if (internal && rawHref.startsWith("http")) {
          href = url.pathname + url.search + url.hash;
        }
      }
    } catch {
      // bad URL, skip
      continue;
    }

    if (seen.has(href)) continue;
    seen.add(href);
    const text = (a.textContent || "").trim().slice(0, 120);
    out.push({ href, text, internal });
  }

  return out;
}

let cached: { at: number; pathname: string; routes: ExtractedRoute[] } | null = null;
const CACHE_MS = 5000;

export function getCachedRoutes(): ExtractedRoute[] {
  const now = Date.now();
  const pathname =
    (typeof window !== "undefined" && window.location.pathname) || "/";
  if (cached && cached.pathname === pathname && now - cached.at < CACHE_MS) {
    return cached.routes;
  }
  const routes = extractRoutes();
  cached = { at: now, pathname, routes };
  return routes;
}

export function clearRoutesCache() {
  cached = null;
}
