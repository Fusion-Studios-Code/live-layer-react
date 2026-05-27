// ─── findFieldInForm ──────────────────────────────────────────────────
// Locate a fillable <input>/<textarea>/<select> in a form by the
// agent-callable identifier (the `name` field the agent reads out of
// PageContext.forms[*].fields[*].name).
//
// MUST MIRROR extractPageContext.ts field-discovery key synthesis:
//   1. el.getAttribute("name")   — preferred when present
//   2. el.getAttribute("id")     — common on React forms that use
//                                  <label htmlFor> for a11y instead of
//                                  emitting name= (the Fusion portfolio
//                                  contact form was the trigger case)
//   3. `field_<positionalIdx>`   — for fully anonymous inputs
//
// Resolution order on the fill side mirrors the synthesis order so
// every key the agent ever observed maps back to the same DOM node.
//
// Skips the same non-data input types extractPageContext skips
// (submit/button/reset/hidden/image/file) so the positional indices
// agree on both sides.
//
// Privacy: callers are responsible for an `isFieldFillable(el)` check
// AFTER resolution. We deliberately do NOT bake the privacy filter in
// here — callers want a "field exists" vs "field is private" distinction
// so they can warn about each case separately.

import { isFieldFillable } from "./fieldPrivacy";

export type FillableEl =
  | HTMLInputElement
  | HTMLTextAreaElement
  | HTMLSelectElement;

/**
 * Skip-list mirrored from extractPageContext.ts. Both files must
 * iterate inputs identically so positional `field_<n>` keys round-trip.
 */
function isDataInput(el: FillableEl): boolean {
  if (el instanceof HTMLInputElement) {
    const t = el.type;
    if (
      t === "submit" ||
      t === "button" ||
      t === "reset" ||
      t === "hidden" ||
      t === "image" ||
      t === "file"
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Compute the agent-callable identifier for a field. Must mirror the
 * extractPageContext synthesis.
 */
function fieldKey(el: FillableEl, positionalIdx: number): string {
  return (
    el.getAttribute("name") ||
    el.getAttribute("id") ||
    `field_${positionalIdx}`
  );
}

/**
 * Resolve the agent's key (whatever it observed in PageContext) back to
 * a DOM element. Returns null if nothing in the form maps to the key.
 *
 * Two-pass approach handles the de-dup collision suffix
 * (`name__<idx>`) extractPageContext applies when two anonymous
 * fields collapse to the same fallback identifier. First pass is the
 * fast common case; second pass is the rarely-hit de-dup case.
 */
export function findFieldInForm(
  form: HTMLFormElement,
  key: string,
): FillableEl | null {
  if (!key) return null;

  // Fast path: a real `name=` match wins outright. Common case for
  // forms authored against the HTML spec, and the path that ALL pre-
  // 0.14.0 keys take.
  try {
    const direct = form.querySelector<FillableEl>(
      `[name="${key.replace(/"/g, '\\"')}"]`,
    );
    if (direct && isDataInput(direct)) return direct;
  } catch {
    /* invalid selector — fall through to scan */
  }

  // Scan-and-match. Walk inputs in DOM order, compute each one's
  // fieldKey, and match against what the agent sent. Same iteration
  // order extractPageContext uses, so positional `field_<n>` keys
  // resolve correctly.
  const all = Array.from(
    form.querySelectorAll<FillableEl>("input, textarea, select"),
  );
  let positionalIdx = 0;
  const seen = new Map<string, FillableEl>();
  for (const el of all) {
    if (!isDataInput(el)) continue;
    const baseKey = fieldKey(el, positionalIdx);
    // De-dup collision suffix matches extractPageContext's:
    //   if (usedKeys.has(name)) name = `${name}__${positionalIdx}`
    let resolvedKey = baseKey;
    if (seen.has(baseKey)) {
      resolvedKey = `${baseKey}__${positionalIdx}`;
    }
    if (resolvedKey === key) return el;
    seen.set(baseKey, el);
    positionalIdx++;
  }
  return null;
}

/**
 * Convenience: resolve + privacy check in one step. Returns
 *   { el }                 on success
 *   { el: null, reason }   on failure, with a short reason string
 *                          callers can drop into a warn() message.
 */
export function findFillableFieldInForm(
  form: HTMLFormElement,
  key: string,
): { el: FillableEl } | { el: null; reason: string } {
  const el = findFieldInForm(form, key);
  if (!el) return { el: null, reason: "not_found" };
  if (!isFieldFillable(el)) return { el: null, reason: "private" };
  return { el };
}
