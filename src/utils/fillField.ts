// ─── fillField ────────────────────────────────────────────────────────
// Set a form field's value in a way that React-controlled inputs notice.
//
// THE BUG WE'RE WORKING AROUND: React keeps an internal "valueTracker"
// per <input>. When `onChange` fires, React compares the event's value
// against the tracker. If they're equal, React assumes it already saw
// this value and skips the update — your state is never set.
//
// `el.value = "x"` sets the DOM property directly. The native setter
// is what updates the tracker. So we have to call the prototype's
// setter explicitly, then dispatch a bubbling input event so React's
// listener (which is delegated to the document root) fires.
//
// This is the canonical fix. Used by every dev tool that programmatically
// fills React forms (Cypress, Playwright, Testing Library, react-hook-form's
// internal test helpers).

function setNativeValue(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
) {
  const proto =
    el instanceof HTMLInputElement
      ? HTMLInputElement.prototype
      : el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLSelectElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  const setter = desc?.set;
  if (setter) {
    setter.call(el, value);
  } else {
    // Last-resort fallback (shouldn't happen on real browsers).
    (el as { value: string }).value = value;
  }
}

export function fillField(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
  opts: { triggerInput?: boolean; triggerChange?: boolean } = {},
): void {
  const triggerInput = opts.triggerInput ?? true;
  const triggerChange = opts.triggerChange ?? true;

  // Checkboxes / radios use `checked`, not `value`.
  if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
    const desc = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "checked",
    );
    const setter = desc?.set;
    const next = value === "true" || value === "1" || value === "on";
    if (setter) setter.call(el, next);
    else el.checked = next;
    if (triggerInput) el.dispatchEvent(new Event("input", { bubbles: true }));
    if (triggerChange) el.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }

  setNativeValue(el, value);
  if (triggerInput) el.dispatchEvent(new Event("input", { bubbles: true }));
  if (triggerChange) el.dispatchEvent(new Event("change", { bubbles: true }));
}
