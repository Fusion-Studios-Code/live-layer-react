// ─── invalidFields ───────────────────────────────────────────────────
// The `invalidFields` list of a `form_submit_blocked` reply: one
// "<label>: <validationMessage>" entry per control that fails native
// HTML5 validation, so the agent can name the field to fix.
//
// Privacy: a field the agent may not see (fieldPrivacy.isFieldFillable
// false: a [data-ll-private] / [data-ll-skip] subtree, a password,
// autocomplete="off" or "cc-*") is never named. Its label is private,
// and its validationMessage is worse: in Chromium it quotes what the
// visitor typed ("'jane.example.com' is missing an '@'") or a
// password's length. Such a field still blocks the submit, so every
// one of them is folded into the single PRIVATE_FIELD_INVALID entry:
// no label, no message, no count. Before 0.26.1 every invalid control
// in `form.elements` was listed with its label and live message.
//
// Same rule and wording as @livelayer/sdk 0.10's page-tools/submit-form.ts
// collectInvalid (live-layer-sdk#4). The worker prints the list as
// "Invalid field(s): …".

import { agentText, isFieldFillable } from "./fieldPrivacy";

/**
 * The one invalidFields entry that stands for every failing field the
 * agent may not see.
 */
export const PRIVATE_FIELD_INVALID =
  "a private field you can't see or fill: ask the visitor to check it";

type FormControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/** The name the agent knows a field by: aria-label, its <label for>, then name / id / type. */
function fieldLabel(form: HTMLFormElement, el: Element): string {
  const al = el.getAttribute("aria-label");
  if (al) return al;
  const id = (el as HTMLElement).id;
  if (id) {
    const lab = form.ownerDocument.querySelector(
      `label[for="${id.replace(/"/g, '\\"')}"]`,
    );
    // agentText: without any private element nested in the label.
    const text = lab ? agentText(lab).trim() : "";
    if (text) return text;
  }
  return (
    el.getAttribute("name") || id || (el as HTMLInputElement).type || "field"
  );
}

/**
 * Every control of `form` failing native validation, as
 * "<label>: <validationMessage>", with the agent-invisible ones folded
 * into one PRIVATE_FIELD_INVALID entry at the end. [] when nothing
 * fails (or reading the form throws).
 */
export function collectInvalidFields(form: HTMLFormElement): string[] {
  try {
    const out: string[] = [];
    let privateInvalid = false;
    for (const el of Array.from(form.elements as ArrayLike<Element>)) {
      const c = el as FormControl;
      if (!("willValidate" in el) || !c.willValidate || c.checkValidity()) continue;
      if (isFieldFillable(c)) out.push(`${fieldLabel(form, el)}: ${c.validationMessage}`);
      else privateInvalid = true;
    }
    if (privateInvalid) out.push(PRIVATE_FIELD_INVALID);
    return out;
  } catch {
    return [];
  }
}
