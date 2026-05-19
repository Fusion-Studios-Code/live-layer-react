// ─── fieldPrivacy ─────────────────────────────────────────────────────
// Single source of truth for "is this field safe to expose / fill?"
// Used by extractPageContext (visibility), fill_form, focus_field.
//
// Privacy rules (hard-coded — do not relax):
//   - type="password"           → never
//   - autocomplete="off"        → never
//   - autocomplete starts cc-   → never (credit card stuff goes through Stripe Elements)
//   - inside [data-ll-private]  → never (consumer-tagged sensitive section)
//   - inside [data-ll-skip]     → never (subtree-wide opt-out; same semantics
//                                  as data-ll-private but the recommended
//                                  spelling for "exclude this form from the
//                                  agent's view" in the unified-API world)
//   - .ll-widget                → never (the widget itself)
//
// These are the LAST-RESORT guards. With auto-discovery (every <form>
// is agent-visible by default), the only way to keep something out of
// the agent's reach is to land in one of these buckets — and the
// browser already gives us strong signals (password type, cc-*
// autocomplete) for the cases that matter most.

const PRIVATE_ANCESTOR_SELECTORS = [
  // Accept any value (or empty) — `<input data-ll-private />` and
  // `<input data-ll-private="true" />` both opt out. The bare attribute
  // is the recommended spelling; "true" is preserved for back-compat.
  "[data-ll-private]",
  "[data-ll-skip]",
  ".ll-widget",
];

export function hasPrivateAncestor(el: Element): boolean {
  let cur: Element | null = el;
  while (cur) {
    for (const sel of PRIVATE_ANCESTOR_SELECTORS) {
      if (cur.matches(sel)) return true;
    }
    cur = cur.parentElement;
  }
  return false;
}

export function isFieldFillable(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
): boolean {
  if (hasPrivateAncestor(el)) return false;
  // password / cc-* / off only meaningful on <input>
  if (el instanceof HTMLInputElement) {
    if (el.type === "password") return false;
    const ac = (el.getAttribute("autocomplete") || "").toLowerCase();
    if (ac === "off") return false;
    if (ac.startsWith("cc-")) return false;
  }
  return true;
}
