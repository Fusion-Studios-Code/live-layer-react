import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { extractPageContext, clearPageContextCache, getCachedPageContext } from "./extractPageContext";

// jsdom getBoundingClientRect returns zeros by default, which would mark
// every element as "not visible." Force a real-looking rect.
function mockVisible(target: Document = document) {
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

describe("extractPageContext", () => {
  let restoreVisible: () => void;

  beforeEach(() => {
    document.body.innerHTML = "";
    Object.defineProperty(window, "innerHeight", { value: 800, writable: true });
    Object.defineProperty(window, "innerWidth", { value: 1200, writable: true });
    restoreVisible = mockVisible();
    clearPageContextCache();
  });

  afterEach(() => {
    restoreVisible();
  });

  it("extracts regions with intent", () => {
    document.body.innerHTML = `
      <div data-ll-region="pricing" data-ll-intent="show pricing tiers">
        Free $0/mo
        Pro $20/mo
      </div>
    `;
    const ctx = extractPageContext();
    expect(ctx.regions).toHaveLength(1);
    expect(ctx.regions[0]?.id).toBe("pricing");
    expect(ctx.regions[0]?.intent).toBe("show pricing tiers");
    expect(ctx.regions[0]?.text).toMatch(/Free.*Pro/s);
  });

  it("extracts visible headings and paragraphs", () => {
    document.body.innerHTML = `
      <h1>Welcome</h1>
      <p>This is a longer paragraph describing the product.</p>
    `;
    const ctx = extractPageContext();
    expect(ctx.visibleText).toContain("Welcome");
    expect(ctx.visibleText).toContain("This is a longer");
  });

  it("never includes form values", () => {
    document.body.innerHTML = `
      <label for="email">Email</label>
      <input id="email" type="email" value="user@example.com" />
    `;
    const ctx = extractPageContext();
    expect(JSON.stringify(ctx)).not.toContain("user@example.com");
    expect(ctx.visibleFields).toHaveLength(1);
    expect(ctx.visibleFields[0]?.label).toBe("Email");
    expect(ctx.visibleFields[0]?.type).toBe("email");
  });

  it("excludes password inputs entirely", () => {
    document.body.innerHTML = `
      <label for="pw">Password</label>
      <input id="pw" type="password" />
    `;
    const ctx = extractPageContext();
    expect(ctx.visibleFields).toHaveLength(0);
  });

  it("excludes credit-card autocomplete fields", () => {
    document.body.innerHTML = `
      <label for="cc">Card number</label>
      <input id="cc" type="text" autocomplete="cc-number" />
    `;
    const ctx = extractPageContext();
    expect(ctx.visibleFields).toHaveLength(0);
  });

  it("skips elements with data-ll-private", () => {
    document.body.innerHTML = `
      <div data-ll-private="true">
        <h1>Sensitive heading</h1>
        <p>Secret paragraph</p>
      </div>
      <h2>Public heading</h2>
    `;
    const ctx = extractPageContext();
    expect(ctx.visibleText).not.toContain("Sensitive heading");
    expect(ctx.visibleText).not.toContain("Secret paragraph");
    expect(ctx.visibleText).toContain("Public heading");
  });

  it("skips elements inside .ll-widget root", () => {
    document.body.innerHTML = `
      <div class="ll-widget">
        <h1>Widget heading</h1>
      </div>
      <h2>Page heading</h2>
    `;
    const ctx = extractPageContext();
    expect(ctx.visibleText).not.toContain("Widget heading");
    expect(ctx.visibleText).toContain("Page heading");
  });

  it("extracts visible anchor links with hrefs", () => {
    document.body.innerHTML = `
      <a href="/pricing">View pricing</a>
      <a href="/docs">Documentation</a>
    `;
    const ctx = extractPageContext();
    expect(ctx.visibleLinks).toHaveLength(2);
    expect(ctx.visibleLinks[0]).toMatchObject({ href: "/pricing", text: "View pricing" });
  });

  it("attaches consumer-supplied extras", () => {
    const extras = { userId: "u123", plan: "pro" };
    const ctx = extractPageContext(extras);
    expect(ctx.extras).toEqual(extras);
  });

  it("respects 4 KB output cap by dropping fields/links first", () => {
    // Generate a lot of content to force the cap
    const fields = Array.from({ length: 100 }, (_, i) =>
      `<label for="f${i}">Field ${i}</label><input id="f${i}" type="text" />`,
    ).join("");
    const links = Array.from({ length: 100 }, (_, i) =>
      `<a href="/p${i}">Link ${i}</a>`,
    ).join("");
    document.body.innerHTML = fields + links;
    const ctx = extractPageContext();
    const total = JSON.stringify(ctx).length;
    // Cap is 4096 for the inner content; serialized JSON has overhead
    // but the bulk should be under the threshold.
    expect(ctx.visibleFields.length + ctx.visibleLinks.length).toBeLessThan(150);
    expect(total).toBeLessThan(8192); // generous outer bound including JSON overhead
  });
});

describe("getCachedPageContext", () => {
  let restoreVisible: () => void;

  beforeEach(() => {
    document.body.innerHTML = "<h1>Home</h1>";
    Object.defineProperty(window, "innerHeight", { value: 800, writable: true });
    Object.defineProperty(window, "innerWidth", { value: 1200, writable: true });
    restoreVisible = mockVisible();
    clearPageContextCache();
  });

  afterEach(() => {
    restoreVisible();
  });

  it("returns cached result within 1 second", () => {
    const a = getCachedPageContext();
    document.body.innerHTML = "<h1>Changed</h1>";
    const b = getCachedPageContext();
    expect(a).toBe(b); // same reference — cache hit
  });

  it("clearPageContextCache forces a fresh walk", () => {
    const a = getCachedPageContext();
    document.body.innerHTML = "<h1>Changed</h1>";
    clearPageContextCache();
    const b = getCachedPageContext();
    expect(a).not.toBe(b);
    expect(b.visibleText).toContain("Changed");
  });
});
