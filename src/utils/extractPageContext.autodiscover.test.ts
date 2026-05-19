// ─── extractPageContext — form auto-discovery ─────────────────────────
//
// Locks down the unified-API form discovery: every <form> is visible by
// default, opt-out via data-ll-skip / data-ll-private / always-on
// browser-native signals. Companion to the existing extractPageContext
// tests; this file is focused on the form-extraction surface that
// 0.12.0 rewrote.

import { describe, it, expect, beforeEach } from "vitest";
import { extractPageContext } from "./extractPageContext";

function setup(html: string) {
  document.body.innerHTML = html;
}

describe("extractPageContext — form auto-discovery", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("discovers every <form> on the page by default", () => {
    setup(`
      <form id="signup">
        <label>Email <input name="email" type="email" required /></label>
        <input name="company" />
      </form>
      <form id="contact">
        <input name="message" />
      </form>
    `);
    const ctx = extractPageContext();
    expect(ctx.forms.map((f) => f.id).sort()).toEqual(["contact", "signup"]);
  });

  it("infers form id from id → name → intent slug → form_<n>", () => {
    setup(`
      <form id="real-id"><input name="a" /></form>
      <form name="named-form"><input name="b" /></form>
      <form data-ll-intent="request a demo"><input name="c" /></form>
      <form><input name="d" /></form>
    `);
    const ctx = extractPageContext();
    const ids = ctx.forms.map((f) => f.id);
    expect(ids).toEqual(["real-id", "named-form", "request-a-demo", "form_0"]);
  });

  it("opts out a form when [data-ll-skip] is present", () => {
    setup(`
      <form id="signup"><input name="email" /></form>
      <form id="secret" data-ll-skip><input name="secret" /></form>
    `);
    const ctx = extractPageContext();
    expect(ctx.forms.map((f) => f.id)).toEqual(["signup"]);
  });

  it("excludes always-on private fields (password / cc-* / off)", () => {
    setup(`
      <form id="login">
        <input name="email" type="email" />
        <input name="password" type="password" />
        <input name="cc" autocomplete="cc-number" />
        <input name="opted_out" autocomplete="off" />
        <input name="private_one" data-ll-private />
        <input name="message" />
      </form>
    `);
    const ctx = extractPageContext();
    expect(ctx.forms).toHaveLength(1);
    const names = ctx.forms[0].fields.map((f) => f.name).sort();
    expect(names).toEqual(["email", "message"]);
  });

  it("excludes submit / button / hidden / file inputs from data fields", () => {
    setup(`
      <form>
        <input name="email" />
        <input name="csrf" type="hidden" value="x" />
        <input name="avatar" type="file" />
        <input name="save" type="submit" value="Save" />
        <button name="cancel" type="button">Cancel</button>
      </form>
    `);
    const ctx = extractPageContext();
    expect(ctx.forms[0].fields.map((f) => f.name)).toEqual(["email"]);
  });

  it("infers labels from wrapping <label>, aria-label, placeholder, label[for=]", () => {
    setup(`
      <form>
        <label>Wrapping label <input name="a" /></label>
        <input name="b" aria-label="Aria label" />
        <input name="c" placeholder="Placeholder text" />
        <label for="d-id">For label</label><input id="d-id" name="d" />
      </form>
    `);
    const ctx = extractPageContext();
    const labels = Object.fromEntries(
      ctx.forms[0].fields.map((f) => [f.name, f.label]),
    );
    expect(labels.a).toMatch(/Wrapping label/);
    expect(labels.b).toBe("Aria label");
    expect(labels.c).toBe("Placeholder text");
    expect(labels.d).toBe("For label");
  });

  it("infers intent from submit button text when data-ll-intent absent", () => {
    setup(`
      <form>
        <input name="email" />
        <button type="submit">Request a demo</button>
      </form>
    `);
    const ctx = extractPageContext();
    expect(ctx.forms[0].intent).toBe("Request a demo");
  });

  it("respects explicit data-ll-intent over inferred intent", () => {
    setup(`
      <form data-ll-intent="newsletter signup">
        <input name="email" />
        <button type="submit">Submit</button>
      </form>
    `);
    const ctx = extractPageContext();
    expect(ctx.forms[0].intent).toBe("newsletter signup");
  });

  it("marks required fields", () => {
    setup(`
      <form>
        <input name="email" required />
        <input name="company" />
      </form>
    `);
    const ctx = extractPageContext();
    const required = Object.fromEntries(
      ctx.forms[0].fields.map((f) => [f.name, f.required ?? false]),
    );
    expect(required).toEqual({ email: true, company: false });
  });

  it("captures <select> options", () => {
    setup(`
      <form>
        <select name="industry">
          <option value="" disabled>Pick one…</option>
          <option value="tech">Tech</option>
          <option value="finance">Finance</option>
        </select>
      </form>
    `);
    const ctx = extractPageContext();
    const industry = ctx.forms[0].fields.find((f) => f.name === "industry");
    // Disabled placeholder is dropped; real options preserved.
    expect(industry?.options?.map((o) => o.value)).toEqual([
      "tech",
      "finance",
    ]);
  });
});
