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

export function findFormByLooseId(
  doc: Document,
  formId: string,
): HTMLFormElement | null {
  if (!formId) return null;
  const safe = formId.replace(/"/g, '\\"');

  // 1. Direct id match.
  try {
    const byId = doc.querySelector<HTMLFormElement>(
      `form#${CSS.escape(formId)}`,
    );
    if (byId) return byId;
  } catch {
    /* invalid selector — fall through */
  }

  // 2. Name attribute match.
  const byName = doc.querySelector<HTMLFormElement>(
    `form[name="${safe}"]`,
  );
  if (byName) return byName;

  // 3. data-ll-intent (raw value, then slugged compare).
  const byIntentRaw = doc.querySelector<HTMLFormElement>(
    `form[data-ll-intent="${safe}"]`,
  );
  if (byIntentRaw) return byIntentRaw;

  const forms = Array.from(doc.querySelectorAll<HTMLFormElement>("form"));
  for (const form of forms) {
    const intent = form.getAttribute("data-ll-intent");
    if (intent && intentToSlug(intent) === formId) return form;
  }

  // 4. form_<index> synthesized fallback — count from 0 across the
  //    same DOM order extractPageContext walks. Skip forms that
  //    already carried a real id / name / intent, since those would
  //    have been picked above.
  if (/^form_\d+$/.test(formId)) {
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

  return null;
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
