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

  it("does NOT single-form-fallback when multiple fillable forms exist (stays ambiguous)", () => {
    document.body.innerHTML = `<form id="a"></form><form id="b"></form>`;
    expect(findFormByLooseId(document, "nope")).toBeNull();
    // but an exact id still resolves
    expect(findFormByLooseId(document, "a")?.id).toBe("a");
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
