import { describe, it, expect, beforeEach } from "vitest";
import { collectInvalidFields, PRIVATE_FIELD_INVALID } from "./invalidFields";

describe("collectInvalidFields", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("uses the script tag's wording for the private entry", () => {
    // @livelayer/sdk 0.10 page-tools/submit-form.ts PRIVATE_FIELD_INVALID.
    expect(PRIVATE_FIELD_INVALID).toBe(
      "a private field you can't see or fill: ask the visitor to check it",
    );
  });

  it("is empty for a valid form", () => {
    document.body.innerHTML = `<form id="f"><input name="a" required value="x" /></form>`;
    expect(collectInvalidFields(document.getElementById("f") as HTMLFormElement)).toEqual([]);
  });

  it("names a field by aria-label, then its label, then name / id", () => {
    document.body.innerHTML = `
      <form id="f">
        <input name="a" aria-label="Work email" required />
        <label for="b">Phone</label><input id="b" name="b" required />
        <input name="c" required />
      </form>`;
    expect(
      collectInvalidFields(document.getElementById("f") as HTMLFormElement).map((e) => e.split(":")[0]),
    ).toEqual(["Work email", "Phone", "c"]);
  });

  it("adds the private entry once, after the visible fields, however many private fields fail", () => {
    document.body.innerHTML = `
      <form id="f">
        <input name="pw" type="password" required />
        <input name="a" required />
        <input name="cc" autocomplete="cc-number" required />
      </form>`;
    const out = collectInvalidFields(document.getElementById("f") as HTMLFormElement);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatch(/^a: /);
    expect(out[1]).toBe(PRIVATE_FIELD_INVALID);
  });

  it("survives an id that would break a label selector", () => {
    document.body.innerHTML = `<form id="f"><input id='x"y' name="q" required /></form>`;
    expect(collectInvalidFields(document.getElementById("f") as HTMLFormElement)).toEqual([
      expect.stringMatching(/^q: /),
    ]);
  });
});
