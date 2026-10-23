// ─── fieldPrivacy ─────────────────────────────────────────────────────
// Single source of truth for "may the agent see / touch this element?"
// Used by extractPageContext (fields, and all page text through
// agentText), extractRoutes, detectFlow, fill_form, focus_field,
// submit_form (including its invalidFields), click, and the form lookup
// (findFormByLooseId).
//
// Privacy rules (hard-coded — do not relax):
//   - type="password"           → never
//   - autocomplete="off"        → never
//   - autocomplete starts cc-   → never (credit card stuff goes through Stripe Elements)
//   - inside [data-ll-private]  → never, whatever the attribute's value
//                                  (consumer-tagged sensitive section)
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
//
// Same rules, PRIVATE_SUBTREE string and agentText as @livelayer/sdk
// 0.10's src/page-tools/privacy.ts (live-layer-sdk#4), so the script-tag
// widget and this one show the agent the same page. Before 0.26.1 the
// text walkers here checked only `[data-ll-private="true"]`, and only
// on the element they read and its ancestors, then sent its whole
// textContent: a private span nested in an ordinary paragraph, heading,
// link, label or region reached the agent with it.

/**
 * Subtrees the agent never reads from or acts in. Accepts any value (or
 * none): `<div data-ll-private>` and `<div data-ll-private="true">` both
 * opt out. The bare attribute is the recommended spelling; "true" is
 * preserved for back-compat.
 */
export const PRIVATE_SUBTREE = "[data-ll-private], [data-ll-skip], .ll-widget";

export function hasPrivateAncestor(el: Element): boolean {
  return el.closest(PRIVATE_SUBTREE) !== null;
}

/** Never text: private subtrees, plus elements that do not render text. */
const SKIP_IN_TEXT = `${PRIVATE_SUBTREE}, script, style, noscript, template, [hidden]`;

/**
 * An element's text as the agent may read it: "" when the element sits
 * in a private subtree, otherwise its text with every private subtree
 * inside it cut out. Checking the element alone is not enough: a
 * `<span data-ll-private>` inside an ordinary <p>, heading, link, label
 * or region would otherwise come along with its parent's textContent.
 *
 * Without a private descendant this is the usual textContent (or
 * innerText when `rendered`), so ordinary text reads exactly as before.
 * With one, the text nodes are walked, skipping private and non-text
 * subtrees, and whitespace is collapsed.
 */
export function agentText(el: Element, rendered = false): string {
  if (hasPrivateAncestor(el)) return "";
  if (!el.querySelector(PRIVATE_SUBTREE)) {
    return (rendered && (el as HTMLElement).innerText) || el.textContent || "";
  }
  let text = "";
  const walker = el.ownerDocument.createTreeWalker(
    el,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) =>
        node.nodeType === Node.ELEMENT_NODE &&
        (node as Element).matches(SKIP_IN_TEXT)
          ? NodeFilter.FILTER_REJECT // skips the whole subtree
          : NodeFilter.FILTER_ACCEPT,
    },
  );
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) text += (node as Text).data;
  }
  return text.replace(/\s+/g, " ");
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
