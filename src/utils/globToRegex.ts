// ─── globToRegex ──────────────────────────────────────────────────────
// Convert a glob-style path pattern into an anchored RegExp. Used by
// useRouteMatch to decide if a pathname matches a showOn / hideOn entry.
//
// Glob rules:
//   *        matches one path segment (no slashes)
//   **       matches any depth (including zero segments)
//   trailing slashes are normalized away before matching
//
// Examples:
//   "/admin/*"   → /^\/admin\/[^/]+\/?$/
//   "/admin/**"  → /^\/admin(?:\/.*)?\/?$/
//   "/foo"       → /^\/foo\/?$/
//
// Why inline + memoized: pulling in micromatch (~12 KB) for one use case
// is silly. The pattern set is small and stable per consumer; cache the
// compiled regex per pattern string.

const cache = new Map<string, RegExp>();

const REGEX_SPECIAL = /[\\^$+?.()|{}[\]]/g;

function escapeRegex(s: string): string {
  return s.replace(REGEX_SPECIAL, "\\$&");
}

export function globToRegex(pattern: string): RegExp {
  const cached = cache.get(pattern);
  if (cached) return cached;

  // Normalize trailing slash — `/foo` and `/foo/` are the same path.
  const normalized = pattern.length > 1 && pattern.endsWith("/")
    ? pattern.slice(0, -1)
    : pattern;

  // Walk the string segment-by-segment so `*` and `**` don't get escaped.
  // Two-pass: first replace `**` with a sentinel, then escape, then put
  // the sentinels back. Avoids needing a real tokenizer.
  const DOUBLE_STAR = "\u0001";
  const SINGLE_STAR = "\u0002";

  const sentinelized = normalized
    .replace(/\*\*/g, DOUBLE_STAR)
    .replace(/\*/g, SINGLE_STAR);

  const escaped = escapeRegex(sentinelized);

  const regexBody = escaped
    // `**` after a `/` matches that slash + anything (including nothing).
    // Standalone `**` (rare but legal) matches any path.
    .replace(new RegExp(`\\/${DOUBLE_STAR}`, "g"), "(?:\\/.*)?")
    .replace(new RegExp(DOUBLE_STAR, "g"), ".*")
    // `*` matches one segment — no slashes.
    .replace(new RegExp(SINGLE_STAR, "g"), "[^/]+");

  const re = new RegExp(`^${regexBody}\\/?$`);
  cache.set(pattern, re);
  return re;
}

export function matchGlob(pattern: string, pathname: string): boolean {
  // Normalize pathname trailing slash to match globToRegex normalization.
  const normalized = pathname.length > 1 && pathname.endsWith("/")
    ? pathname.slice(0, -1)
    : pathname;
  return globToRegex(pattern).test(normalized);
}
