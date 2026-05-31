import { describe, it, expect, beforeEach } from "vitest";
import { findFormByLooseId } from "./findFormByLooseId";

describe("findFormByLooseId — never resolves an off-limits form", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("does not return a .ll-widget form via the positional form_0 fallback", () => {
    // The host form has a real id (skipped in positional counting), so the
    // only UNNAMED form is the widget's own composer. It must NOT become
    // form_0 — otherwise fill_form resolves it and refuses the private subtree.
    document.body.innerHTML = `
      <form id="intake-opening"><input name="x" /></form>
      <div class="ll-widget"><form><input name="msg" /></form></div>
    `;
    expect(findFormByLooseId(document, "form_0")).toBeNull();
  });

  it("does not return a .ll-widget form even when matched by id", () => {
    document.body.innerHTML = `<div class="ll-widget"><form id="composer"></form></div>`;
    expect(findFormByLooseId(document, "composer")).toBeNull();
  });

  it("excludes data-ll-skip and data-ll-private forms", () => {
    document.body.innerHTML = `
      <form id="skipme" data-ll-skip><input name="x" /></form>
      <div data-ll-private="true"><form id="privately"></form></div>
    `;
    expect(findFormByLooseId(document, "skipme")).toBeNull();
    expect(findFormByLooseId(document, "privately")).toBeNull();
  });

  it("still resolves a host form by id when a widget form is present", () => {
    document.body.innerHTML = `
      <form id="intake-opening"><input name="x" /></form>
      <div class="ll-widget"><form><input name="msg" /></form></div>
    `;
    expect(findFormByLooseId(document, "intake-opening")?.id).toBe(
      "intake-opening",
    );
  });

  it("positional form_0 resolves the first NON-widget unnamed form", () => {
    document.body.innerHTML = `
      <form><input name="a" /></form>
      <div class="ll-widget"><form><input name="msg" /></form></div>
    `;
    const f = findFormByLooseId(document, "form_0");
    expect(f).not.toBeNull();
    expect(f?.closest(".ll-widget")).toBeNull();
  });
});
