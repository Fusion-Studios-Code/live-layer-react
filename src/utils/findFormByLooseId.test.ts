import { describe, it, expect, beforeEach } from "vitest";
import { findFormByLooseId } from "./findFormByLooseId";

describe("findFormByLooseId — off-limits exclusion + single-form fallback", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("resolves a host form by id", () => {
    document.body.innerHTML = `
      <form id="intake-opening"><input name="x" /></form>
      <div class="ll-widget"><form><input name="msg" /></form></div>
    `;
    expect(findFormByLooseId(document, "intake-opening")?.id).toBe(
      "intake-opening",
    );
  });

  it("falls back to the single fillable host form for an unresolvable id (never the widget form)", () => {
    // Host form is named, so positional form_0 skips it; the only other form
    // is the widget's own (.ll-widget, excluded). A generic form_0 / field_0 /
    // anything-unmatched resolves to the single fillable host form — and never
    // the widget's composer.
    document.body.innerHTML = `
      <form id="intake-opening"><input name="x" /></form>
      <div class="ll-widget"><form><input name="msg" /></form></div>
    `;
    for (const id of ["form_0", "field_0", "whatever"]) {
      const f = findFormByLooseId(document, id);
      expect(f?.id).toBe("intake-opening");
      expect(f?.closest(".ll-widget")).toBeNull();
    }
  });

  it("never returns a .ll-widget form, and does not fall back to it when it is the only form", () => {
    document.body.innerHTML = `<div class="ll-widget"><form id="composer"></form></div>`;
    expect(findFormByLooseId(document, "composer")).toBeNull(); // matched by id but off-limits
    expect(findFormByLooseId(document, "form_0")).toBeNull(); // nothing fillable to fall back to
  });

  it("excludes data-ll-skip and data-ll-private forms", () => {
    document.body.innerHTML = `
      <form id="skipme" data-ll-skip><input name="x" /></form>
      <div data-ll-private="true"><form id="privately"></form></div>
    `;
    expect(findFormByLooseId(document, "skipme")).toBeNull();
    expect(findFormByLooseId(document, "privately")).toBeNull();
  });

  it("excludes a form inside a bare data-ll-private, or carrying one itself", () => {
    // Any data-ll-private value opts out, as in extractPageContext.
    document.body.innerHTML = `
      <div data-ll-private><form id="wrapped" name="wrapped-name" data-ll-intent="Wrapped intent"></form></div>
      <form id="own" data-ll-private></form>
      <form id="contact"><input name="email" /></form>
    `;
    for (const id of ["wrapped", "wrapped-name", "Wrapped intent", "wrapped-intent", "own"]) {
      expect(findFormByLooseId(document, id)).toBeNull();
    }
  });

  it("counts positional form_N ids over the same forms extractPageContext lists", () => {
    // extractPageContext skips a form in any private subtree, so the public
    // unnamed form below is its form_0.
    document.body.innerHTML = `
      <div data-ll-private><form><input name="a" /></form></div>
      <form data-ll-private><input name="b" /></form>
      <form><input name="c" /></form>
      <form><input name="d" /></form>
    `;
    const forms = Array.from(document.querySelectorAll("form"));
    expect(findFormByLooseId(document, "form_0")).toBe(forms[2]);
    expect(findFormByLooseId(document, "form_1")).toBe(forms[3]);
  });

  it("does NOT single-form-fallback when multiple fillable forms exist (stays ambiguous)", () => {
    document.body.innerHTML = `<form id="a"></form><form id="b"></form>`;
    expect(findFormByLooseId(document, "nope")).toBeNull();
    // but an exact id still resolves
    expect(findFormByLooseId(document, "a")?.id).toBe("a");
  });

  it("does not fall back to the only public form for an id that names an off-limits form", () => {
    document.body.innerHTML = `
      <form id="contact"><input name="email" /></form>
      <div data-ll-private="true"><form id="account" name="acct" data-ll-intent="Update account"></form></div>
      <div data-ll-skip><form id="payment"></form></div>
      <div class="ll-widget"><form id="composer"></form></div>
    `;
    for (const id of ["account", "acct", "Update account", "update-account", "payment", "composer"]) {
      expect(findFormByLooseId(document, id)).toBeNull();
    }
    // An id that names nothing still falls back for fill_form / focus_field.
    expect(findFormByLooseId(document, "whatever")?.id).toBe("contact");
  });

  it("singleFormFallback: positional only falls back for a form_<n> id (submit_form)", () => {
    document.body.innerHTML = `
      <form id="contact"><input name="email" /></form>
      <div class="ll-widget"><form><input name="msg" /></form></div>
    `;
    const strict = { singleFormFallback: "positional" } as const;
    expect(findFormByLooseId(document, "contact", strict)?.id).toBe("contact");
    expect(findFormByLooseId(document, "form_0", strict)?.id).toBe("contact");
    expect(findFormByLooseId(document, "form_3", strict)?.id).toBe("contact");
    expect(findFormByLooseId(document, "field_0", strict)).toBeNull();
    expect(findFormByLooseId(document, "does-not-exist", strict)).toBeNull();
  });

  it("positional form_N still disambiguates several non-widget unnamed forms", () => {
    document.body.innerHTML = `
      <form><input name="a" /></form>
      <form><input name="b" /></form>
      <div class="ll-widget"><form><input name="msg" /></form></div>
    `;
    const hostForms = Array.from(document.querySelectorAll("form")).filter(
      (f) => !f.closest(".ll-widget"),
    );
    expect(findFormByLooseId(document, "form_0")).toBe(hostForms[0]);
    expect(findFormByLooseId(document, "form_1")).toBe(hostForms[1]);
  });
});
