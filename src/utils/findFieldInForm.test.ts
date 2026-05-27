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

describe("zero-markup form — type/label/placeholder/constraints round-trip", () => {
  it("gives the agent enough context to fill a form with no ids, no names, only types + wrapping <label> + placeholder + required + constraints", () => {
    // The "bare minimum" contract: clients should not have to change
    // ANYTHING in their existing forms. The agent must learn what each
    // field wants from semantic HTML alone.
    document.body.innerHTML = `
      <form>
        <label>Your email
          <input type="email" placeholder="you@company.com" required autocomplete="email" />
        </label>
        <label>Phone
          <input type="tel" placeholder="(555) 555-5555" pattern="\\d{3}-\\d{3}-\\d{4}" autocomplete="tel" />
        </label>
        <label>Quantity
          <input type="number" min="1" max="100" step="1" />
        </label>
        <label>Message
          <textarea minlength="10" maxlength="500" required></textarea>
        </label>
        <button type="submit">Send message</button>
      </form>
    `;
    const ctx = extractPageContext();
    expect(ctx.forms.length).toBe(1);
    const form = ctx.forms[0]!;

    // Form intent inferred from submit button text.
    expect(form.intent).toBe("Send message");

    // Every field surfaced with a synthesized agent-callable name.
    const byLabel = Object.fromEntries(
      form.fields.map((f) => [f.label, f]),
    );

    // Email field — type, label, placeholder, required, autocomplete.
    expect(byLabel["Your email"]).toBeDefined();
    expect(byLabel["Your email"]!.type).toBe("email");
    expect(byLabel["Your email"]!.placeholder).toBe("you@company.com");
    expect(byLabel["Your email"]!.required).toBe(true);
    expect(byLabel["Your email"]!.autocomplete).toBe("email");

    // Phone field — pattern + autocomplete preserved verbatim so the
    // agent can format spoken input correctly the first time.
    expect(byLabel["Phone"]!.pattern).toBe("\\d{3}-\\d{3}-\\d{4}");
    expect(byLabel["Phone"]!.autocomplete).toBe("tel");

    // Numeric bounds — agent now sees the 1..100 range up front
    // instead of learning it after a rejected fill.
    expect(byLabel["Quantity"]!.min).toBe("1");
    expect(byLabel["Quantity"]!.max).toBe("100");
    expect(byLabel["Quantity"]!.step).toBe("1");

    // Textarea length bounds.
    expect(byLabel["Message"]!.minLength).toBe(10);
    expect(byLabel["Message"]!.maxLength).toBe(500);

    // Round-trip: every key the agent observed must resolve back to a
    // DOM node so fill_form can actually run.
    const formEl = document.querySelector<HTMLFormElement>("form")!;
    for (const field of form.fields) {
      const el = findFieldInForm(formEl, field.name);
      expect(el, `key "${field.name}" (label="${field.label}") must resolve`).not.toBeNull();
    }
  });

  it("omits constraint fields when the underlying attribute is not set (keeps the payload small)", () => {
    // Negative case: bare-bones form with just type + label. No
    // constraint attributes should show up as undefined keys.
    document.body.innerHTML = `
      <form>
        <label>Name <input type="text" /></label>
      </form>
    `;
    const ctx = extractPageContext();
    const field = ctx.forms[0]!.fields[0]!;
    expect(field.label).toBe("Name");
    expect(field.required).toBeUndefined();
    expect(field.placeholder).toBeUndefined();
    expect(field.min).toBeUndefined();
    expect(field.max).toBeUndefined();
    expect(field.minLength).toBeUndefined();
    expect(field.maxLength).toBeUndefined();
    expect(field.pattern).toBeUndefined();
    expect(field.autocomplete).toBeUndefined();
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
