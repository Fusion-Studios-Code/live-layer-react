// Private content never reaches the agent through the page context or
// the routes list: not from a [data-ll-private] (any value) or
// [data-ll-skip] subtree, and not when a private element is nested
// inside an ordinary paragraph, heading, link, label, region or
// form-intent source. Ported from @livelayer/sdk 0.10's
// page-tools-walkers.test.ts (live-layer-sdk#4), which found these
// leaks in this package's walker (0.26.0 and earlier).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { extractPageContext, clearPageContextCache } from "./extractPageContext";
import { extractRoutes, clearRoutesCache } from "./extractRoutes";
import { detectFlow } from "./detectFlow";

// jsdom's getBoundingClientRect is all zeros, which reads as "not visible".
function mockVisible() {
  const orig = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () {
    return {
      x: 0,
      y: 0,
      top: 100,
      bottom: 200,
      left: 0,
      right: 100,
      width: 100,
      height: 100,
      toJSON() {},
    } as DOMRect;
  };
  return () => {
    Element.prototype.getBoundingClientRect = orig;
  };
}

let restoreVisible: () => void;

beforeEach(() => {
  document.body.innerHTML = "";
  Object.defineProperty(window, "innerHeight", { value: 800, writable: true });
  Object.defineProperty(window, "innerWidth", { value: 1200, writable: true });
  restoreVisible = mockVisible();
  clearPageContextCache();
  clearRoutesCache();
});

afterEach(() => {
  restoreVisible();
});

const SUBTREES = [
  ["bare data-ll-private", "data-ll-private"],
  ['data-ll-private="true"', 'data-ll-private="true"'],
  ["data-ll-skip", "data-ll-skip"],
] as const;

describe("private subtrees, whatever the data-ll-private value", () => {
  // 0.26.0 skipped only data-ll-private="true" for text, links and
  // regions, so a bare data-ll-private or a data-ll-skip subtree was read.
  it.each(SUBTREES)("leaves a %s subtree's text, links and regions out", (_label, attr) => {
    document.body.innerHTML = `
      <h1>Account</h1>
      <div ${attr}>
        <h2>Jane Q. Private</h2>
        <p>Balance on ACCT-99812 is $4,210.55 today.</p>
        <a href="/statements/99812">Statement for ACCT-99812</a>
        <div data-ll-region="acct">Routing 021000021</div>
      </div>
    `;
    const ctx = extractPageContext();
    expect(ctx.visibleText).toBe("H1: Account");
    expect(ctx.visibleLinks).toEqual([]);
    expect(ctx.regions).toEqual([]);
    expect(extractRoutes()).toEqual([]);
    expect(JSON.stringify(ctx)).not.toMatch(/Jane|99812|021000021/);
  });
});

// A private element nested inside an ordinary paragraph, heading, link,
// label or region is cut out of that element's text; the rest of the
// text still reaches the agent.
describe("private content nested inside ordinary elements", () => {
  it.each(SUBTREES)(
    "cuts a nested %s element out of paragraphs, list items and headings",
    (_label, attr) => {
      document.body.innerHTML = `
        <h2>Welcome back, <span ${attr}>Jane Q. Private</span></h2>
        <p>Your balance is <span ${attr}>ACCT-99812 $4,210.55</span> today.</p>
        <ul><li>Order status: shipped <span ${attr}>to 12 Secret Lane</span></li></ul>
      `;
      const ctx = extractPageContext();
      expect(ctx.visibleText.split("\n")).toEqual([
        "H2: Welcome back,",
        "Your balance is today.",
        "Order status: shipped",
      ]);
      for (const leak of ["Jane Q. Private", "ACCT-99812", "Secret Lane"]) {
        expect(JSON.stringify(ctx)).not.toContain(leak);
      }
    },
  );

  it("cuts a nested private element out of a region's text", () => {
    document.body.innerHTML = `
      <section data-ll-region="account">Account summary <div data-ll-private="true">SSN 123-45-6789</div></section>
    `;
    expect(extractPageContext().regions).toEqual([
      { id: "account", intent: undefined, text: "Account summary" },
    ]);
  });

  it("cuts a nested private element out of link text, in the page context and in routes", () => {
    document.body.innerHTML = `<a href="/me">Profile of <span data-ll-private>Jane Q. Private</span></a>`;
    expect(extractPageContext().visibleLinks).toEqual([{ href: "/me", text: "Profile of" }]);
    expect(extractRoutes()).toEqual([{ href: "/me", text: "Profile of", internal: true }]);
  });

  it("drops a link whose whole text is private from the page context, and lists the route without text", () => {
    document.body.innerHTML = `<a href="/u/42"><span data-ll-skip>Jane Q. Private</span></a>`;
    expect(extractPageContext().visibleLinks).toEqual([]);
    expect(extractRoutes()).toEqual([{ href: "/u/42", text: "", internal: true }]);
  });

  it("never takes a field label from private text", () => {
    document.body.innerHTML = `
      <form id="f">
        <label for="a">Email for <span data-ll-private>jane@private.example</span></label><input id="a" name="a" />
        <div data-ll-private><label for="b">Jane's maiden name</label></div><input id="b" name="b" />
        <label>Phone <span data-ll-skip>(ends 4471)</span><input name="c" /></label>
      </form>
    `;
    const ctx = extractPageContext();
    expect(ctx.forms[0]!.fields.map((f) => [f.name, f.label])).toEqual([
      ["a", "Email for"],
      ["b", "b"],
      ["c", "Phone"],
    ]);
    expect(ctx.visibleFields.map((f) => f.label)).toEqual(["Email for", "Phone"]);
    expect(JSON.stringify(ctx)).not.toMatch(/jane@private|maiden|4471/);
  });

  it.each([
    [
      "a heading in a private sibling",
      `<div><div data-ll-private><h2>Jane Doe medical record</h2></div><form id="f"><input name="a" /></form></div>`,
      undefined,
    ],
    [
      "a private heading ahead of a public one",
      `<div><h2 data-ll-skip>Jane Doe billing</h2><h3>Contact us</h3><form id="f"><input name="a" /></form></div>`,
      "Contact us",
    ],
    [
      "a private aria-labelledby target",
      `<span id="t" data-ll-private>Jane Doe intake</span><form id="f" aria-labelledby="t"><input name="a" /></form>`,
      undefined,
    ],
    [
      "a submit button in a private subtree",
      `<form id="f"><div data-ll-skip><button type="submit">Pay Jane Doe's invoice</button></div><input name="a" /></form>`,
      undefined,
    ],
    [
      "private text inside a public heading",
      `<div><h2>Book a call with <span data-ll-private>Jane Doe</span></h2><form id="f"><input name="a" /></form></div>`,
      "Book a call with",
    ],
  ])("never infers a form's intent from %s", (_label, html, intent) => {
    document.body.innerHTML = html;
    const forms = extractPageContext().forms;
    expect(forms.map((f) => [f.id, f.intent])).toEqual([["f", intent]]);
    expect(JSON.stringify(forms)).not.toContain("Jane Doe");
  });

  it("leaves a private option out of a select's options", () => {
    document.body.innerHTML = `
      <form id="f"><select name="acct">
        <option value="">Pick an account</option>
        <option value="chk">Checking</option>
        <option value="sav" data-ll-private>Savings ending 9981</option>
      </select></form>
    `;
    const field = extractPageContext().forms[0]!.fields[0]!;
    expect(field.options).toEqual([
      { value: "", label: "Pick an account" },
      { value: "chk", label: "Checking" },
    ]);
    expect(JSON.stringify(field)).not.toContain("9981");
  });

  // React only: the script-tag widget reports no `flow`.
  it("cuts private text out of the flow's control and step labels", () => {
    document.body.innerHTML = `
      <ol class="stepper">
        <li>Account</li>
        <li class="active">Pay <span data-ll-skip>Jane Doe's invoice</span></li>
      </ol>
      <form><input name="a" /></form>
      <button>Continue <span data-ll-private>to Jane Doe's checkout</span></button>
    `;
    const flow = detectFlow(document);
    expect(flow.advance?.label).toBe("Continue");
    expect(flow.stepLabel).toBe("Pay");
    expect(JSON.stringify(extractPageContext().flow)).not.toContain("Jane Doe");
  });
});
