import { describe, it, expect } from "vitest";
import { captureFilter, isExcludedFromCapture } from "./capture";

function el(html: string): Element {
  const tpl = document.createElement("div");
  tpl.innerHTML = html;
  return tpl.firstElementChild as Element;
}

describe("page-vision capture exclusions", () => {
  it("excludes the widget chrome, private regions, and password inputs", () => {
    expect(isExcludedFromCapture(el(`<div class="ll-widget"></div>`))).toBe(true);
    expect(isExcludedFromCapture(el(`<div data-ll-private></div>`))).toBe(true);
    expect(isExcludedFromCapture(el(`<div data-ll-private="true"></div>`))).toBe(true);
    expect(isExcludedFromCapture(el(`<section data-ll-skip></section>`))).toBe(true);
    expect(isExcludedFromCapture(el(`<input type="password" />`))).toBe(true);
    expect(isExcludedFromCapture(el(`<iframe></iframe>`))).toBe(true);
  });

  it("keeps ordinary content", () => {
    expect(isExcludedFromCapture(el(`<main><h1>Hi</h1></main>`))).toBe(false);
    expect(isExcludedFromCapture(el(`<input type="text" />`))).toBe(false);
  });

  it("captureFilter keeps text nodes and filters excluded elements", () => {
    expect(captureFilter(document.createTextNode("hello"))).toBe(true);
    expect(captureFilter(el(`<div class="ll-widget"></div>`))).toBe(false);
    expect(captureFilter(el(`<p>fine</p>`))).toBe(true);
  });
});
