// ─── findFormByLooseId ───────────────────────────────────────────────
//
// Locate an on-page <form> matching the loose `formId` the agent passes
// back in fill_form / submit_form / focus_field / collect_from_page
// commands. The agent observed the form via `extractPageContext`,
// which infers a form id from (in order):
//
//   1. form.id
//   2. form.name
//   3. data-ll-intent slugged (e.g. "request a demo" → "request-a-demo")
//   4. fallback "form_<index>"
//
// This helper performs the same lookup in reverse — it accepts any of
// those forms of identifier and returns the best matching <form>. Used
// by AvatarWidget's command handlers so the agent's `formId` round-trips
// reliably no matter which slot the form's identity lives in.
//
// Returns null when nothing matches. Callers warn + bail.

import { PRIVATE_SUBTREE } from "./fieldPrivacy";

export interface FindFormOptions {
  /**
   * Which unmatched ids may fall back to the page's only fillable form.
   *   - "any" (default; fill_form, focus_field): any id.
   *   - "positional": only a positional `form_<n>` id, the generic name the
   *     agent uses for a form it saw without a real id. submit_form uses
   *     this, since a submit cannot be undone: an id that names no form
   *     must not submit whichever form happens to be the only one.
   */
  singleFormFallback?: "any" | "positional";
}

const POSITIONAL_ID = /^form_\d+$/;

export function findFormByLooseId(
  doc: Document,
  formId: string,
  options: FindFormOptions = {},
): HTMLFormElement | null {
  if (!formId) return null;
  const safe = formId.replace(/"/g, '\\"');

  // Never resolve a form the agent must not touch: its own widget DOM
  // (.ll-widget — e.g. the message composer) or a host opt-out subtree
  // (data-ll-private with any value / data-ll-skip): PRIVATE_SUBTREE, the
  // same rule as AvatarWidget's fill_form/submit_form guard and the
  // extractPageContext discovery exclusion, so positional `form_<n>` ids
  // count the same forms on both sides. Without this, a loose id —
  // especially the positional `form_<n>` fallback, which skips forms that
  // carry a real id — can land on the widget's own unnamed form and trip
  // "refusing to touch a private / opted-out subtree". (Before 0.26.1 this
  // checked only data-ll-private="true", so a form inside a bare
  // data-ll-private could be filled and submitted by id.)
  const offLimits = (form: HTMLFormElement): boolean =>
    form.closest(PRIVATE_SUBTREE) !== null;

  // 1. Direct id match.
  try {
    const byId = doc.querySelector<HTMLFormElement>(
      `form#${CSS.escape(formId)}`,
    );
    if (byId && !offLimits(byId)) return byId;
  } catch {
    /* invalid selector — fall through */
  }

  // 2. Name attribute match.
  const byName = doc.querySelector<HTMLFormElement>(
    `form[name="${safe}"]`,
  );
  if (byName && !offLimits(byName)) return byName;

  // 3. data-ll-intent (raw value, then slugged compare).
  const byIntentRaw = doc.querySelector<HTMLFormElement>(
    `form[data-ll-intent="${safe}"]`,
  );
  if (byIntentRaw && !offLimits(byIntentRaw)) return byIntentRaw;

  const forms = Array.from(
    doc.querySelectorAll<HTMLFormElement>("form"),
  ).filter((form) => !offLimits(form));
  for (const form of forms) {
    const intent = form.getAttribute("data-ll-intent");
    if (intent && intentToSlug(intent) === formId) return form;
  }

  // 4. form_<index> synthesized fallback — count from 0 across the
  //    same DOM order extractPageContext walks. Skip forms that
  //    already carried a real id / name / intent, since those would
  //    have been picked above.
  if (POSITIONAL_ID.test(formId)) {
    const wantedIdx = parseInt(formId.slice("form_".length), 10);
    let synthIdx = 0;
    for (const form of forms) {
      const hasRealId =
        form.id ||
        form.getAttribute("name") ||
        form.getAttribute("data-ll-intent");
      if (hasRealId) continue;
      if (synthIdx === wantedIdx) return form;
      synthIdx++;
    }
  }

  // Last resort: the agent referenced a form we can't resolve — commonly a
  // generic positional id ("form_0" / "field_0") that doesn't echo this
  // page's real form id. If exactly ONE fillable host form exists, use it:
  // single-form pages are the common case and the intent is unambiguous.
  // Multiple fillable forms stay ambiguous → null (the caller warns).
  //
  // Never when the id names an off-limits form: the agent asked for that
  // form (which it must not touch), not for the page's public one.
  if (forms.length !== 1) return null;
  if (
    (options.singleFormFallback ?? "any") === "positional" &&
    !POSITIONAL_ID.test(formId)
  ) {
    return null;
  }
  const namesOffLimitsForm = Array.from(
    doc.querySelectorAll<HTMLFormElement>("form"),
  ).some((form) => offLimits(form) && answersTo(form, formId));
  return namesOffLimitsForm ? null : forms[0];
}

/** True when `formId` is this form's id, name, data-ll-intent or its slug. */
function answersTo(form: HTMLFormElement, formId: string): boolean {
  const intent = form.getAttribute("data-ll-intent");
  return (
    form.getAttribute("id") === formId ||
    form.getAttribute("name") === formId ||
    (intent !== null && (intent === formId || intentToSlug(intent) === formId))
  );
}

/** Mirror of extractPageContext.intentToSlug — keep in sync. */
function intentToSlug(intent: string): string | null {
  const slug = intent
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || null;
}
