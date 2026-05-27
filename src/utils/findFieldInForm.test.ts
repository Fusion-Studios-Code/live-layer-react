// Tests for the 0.14.0 selector-based field resolver.
//
// Coverage focus: every fallback in the `name → id → field_<n>` chain
// round-trips. extractPageContext synthesizes a key, findFieldInForm
// inverts it, and we never lose a field along the way.

import { describe, it, expect, beforeEach } from "vitest";
import {
  findFieldInForm,
  findFillableFieldInForm,
} from "./findFieldInForm";
import { extractPageContext } from "./extractPageContext";

function makeForm(html: string): HTMLFormElement {
  document.body.innerHTML = html;
  const form = document.querySelector<HTMLFormElement>("form");
  if (!form) throw new Error("test setup: no form in fixture");
  return form;
}

describe("findFieldInForm — fast path (real `name` attr)", () => {
  it("resolves a `name=` keyed field exactly as the agent observed it", () => {
    const form = makeForm(`
      <form>
        <input name="email" type="email" />
        <input name="message" />
      </form>
    `);
    const el = findFieldInForm(form, "email");
    expect(el).not.toBeNull();
    expect(el?.getAttribute("name")).toBe("email");
  });

  it("escapes quotes in the key when the selector path would otherwise be invalid", () => {
    // Defense against a malicious / weird page emitting name='evil"key'.
    // We want findFieldInForm to return null safely, not throw.
    const form = makeForm(`<form><input name="real" /></form>`);
    const el = findFieldInForm(form, 'evil"key');
    expect(el).toBeNull();
  });
});

describe("findFieldInForm — id fallback (nameless React forms)", () => {
  it("resolves a field that only has an id= attribute", () => {
    // This is the Fusion portfolio contact form pattern — every input
    // has id= for <label htmlFor> but no name=.
    const form = makeForm(`
      <form>
        <input id="email" type="email" />
        <input id="message" />
      </form>
    `);
    const el = findFieldInForm(form, "email");
    expect(el).not.toBeNull();
    expect(el?.getAttribute("id")).toBe("email");
  });

  it("prefers name= when both name= and id= are present and the agent asked by name", () => {
    const form = makeForm(`
      <form>
        <input id="email-id" name="email" type="email" />
      </form>
    `);
    expect(findFieldInForm(form, "email")?.getAttribute("name")).toBe("email");
  });
});

describe("findFieldInForm — positional fallback (truly anonymous fields)", () => {
  it("resolves `field_0`, `field_1`, ... by DOM order, skipping non-data inputs", () => {
    const form = makeForm(`
      <form>
        <input />
        <input type="hidden" />
        <input type="submit" value="Send" />
        <textarea></textarea>
      </form>
    `);
    const first = findFieldInForm(form, "field_0");
    const second = findFieldInForm(form, "field_1");
    expect(first?.tagName).toBe("INPUT");
    expect(first instanceof HTMLInputElement && first.type === "text").toBe(true);
    expect(second?.tagName).toBe("TEXTAREA");
  });
});

describe("findFieldInForm — round-trips with extractPageContext", () => {
  it("every field the agent sees in PageContext can be resolved back to its DOM node", () => {
    // The contract: the `name` value in PageContext.forms[].fields[].name
    // MUST be a key findFieldInForm accepts. This is the integration check
    // — extractPageContext and findFieldInForm must agree on key synthesis.
    document.body.innerHTML = `
      <form>
        <label for="email">Your email</label>
        <input id="email" type="email" />
        <label for="message">Your message</label>
        <textarea id="message"></textarea>
        <input />
      </form>
    `;
    const ctx = extractPageContext();
    const formEl = document.querySelector<HTMLFormElement>("form")!;
    expect(ctx.forms.length).toBe(1);
    for (const field of ctx.forms[0]!.fields) {
      const el = findFieldInForm(formEl, field.name);
      expect(el, `field "${field.name}" should resolve`).not.toBeNull();
    }
  });

  it("Fusion contact-form shape (id-only fields, no name= anywhere) is fully fillable", () => {
    // Real-world regression case. Mirrors components/contact-modal.tsx
    // on the Fusion portfolio.
    document.body.innerHTML = `
      <form>
        <label for="subject">Select a subject</label>
        <select id="subject">
          <option value="general">General</option>
          <option value="project">Project</option>
        </select>
        <label for="name">Your name</label>
        <input id="name" />
        <label for="email">Your email</label>
        <input id="email" type="email" />
        <label for="message">Message</label>
        <textarea id="message"></textarea>
      </form>
    `;
    const ctx = extractPageContext();
    const form = document.querySelector<HTMLFormElement>("form")!;
    const fields = ctx.forms[0]!.fields.map((f) => f.name);
    expect(fields).toContain("subject");
    expect(fields).toContain("name");
    expect(fields).toContain("email");
    expect(fields).toContain("message");
    for (const key of fields) {
      const el = findFieldInForm(form, key);
      expect(el, `key "${key}" must resolve to its DOM node`).not.toBeNull();
    }
  });
});

describe("findFillableFieldInForm — privacy filtering", () => {
  it("returns reason=private for password inputs even when the key matches", () => {
    const form = makeForm(`<form><input id="pw" type="password" /></form>`);
    const result = findFillableFieldInForm(form, "pw");
    expect(result.el).toBeNull();
    if (result.el === null) expect(result.reason).toBe("private");
  });

  it("returns reason=not_found when the key matches nothing", () => {
    const form = makeForm(`<form><input id="email" /></form>`);
    const result = findFillableFieldInForm(form, "nope");
    expect(result.el).toBeNull();
    if (result.el === null) expect(result.reason).toBe("not_found");
  });

  it("returns the el when the key matches a fillable field", () => {
    const form = makeForm(`<form><input id="email" type="email" /></form>`);
    const result = findFillableFieldInForm(form, "email");
    expect(result.el).not.toBeNull();
    expect(result.el?.getAttribute("id")).toBe("email");
  });
});
