import { describe, it, expect, beforeEach } from "vitest";
import { isFieldFillable, hasPrivateAncestor } from "./fieldPrivacy";

describe("isFieldFillable", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("allows a normal text input", () => {
    document.body.innerHTML = `<input id="x" type="text" />`;
    const el = document.getElementById("x") as HTMLInputElement;
    expect(isFieldFillable(el)).toBe(true);
  });

  it("blocks password inputs unconditionally", () => {
    document.body.innerHTML = `<input id="x" type="password" />`;
    const el = document.getElementById("x") as HTMLInputElement;
    expect(isFieldFillable(el)).toBe(false);
  });

  it("blocks autocomplete=off", () => {
    document.body.innerHTML = `<input id="x" type="text" autocomplete="off" />`;
    const el = document.getElementById("x") as HTMLInputElement;
    expect(isFieldFillable(el)).toBe(false);
  });

  it("blocks autocomplete=cc-*", () => {
    document.body.innerHTML = `
      <input id="a" type="text" autocomplete="cc-number" />
      <input id="b" type="text" autocomplete="cc-csc" />
      <input id="c" type="text" autocomplete="cc-exp" />
    `;
    expect(isFieldFillable(document.getElementById("a") as HTMLInputElement)).toBe(false);
    expect(isFieldFillable(document.getElementById("b") as HTMLInputElement)).toBe(false);
    expect(isFieldFillable(document.getElementById("c") as HTMLInputElement)).toBe(false);
  });

  it("blocks fields inside data-ll-private", () => {
    document.body.innerHTML = `
      <div data-ll-private="true">
        <input id="x" type="text" />
      </div>
    `;
    const el = document.getElementById("x") as HTMLInputElement;
    expect(isFieldFillable(el)).toBe(false);
  });

  it("blocks fields inside .ll-widget", () => {
    document.body.innerHTML = `
      <div class="ll-widget">
        <input id="x" type="text" />
      </div>
    `;
    const el = document.getElementById("x") as HTMLInputElement;
    expect(isFieldFillable(el)).toBe(false);
  });

  it("allows textareas and selects", () => {
    document.body.innerHTML = `
      <textarea id="t"></textarea>
      <select id="s"><option>a</option></select>
    `;
    expect(isFieldFillable(document.getElementById("t") as HTMLTextAreaElement)).toBe(true);
    expect(isFieldFillable(document.getElementById("s") as HTMLSelectElement)).toBe(true);
  });
});

describe("hasPrivateAncestor", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("flags self if itself private", () => {
    document.body.innerHTML = `<div data-ll-private="true" id="x"></div>`;
    expect(hasPrivateAncestor(document.getElementById("x")!)).toBe(true);
  });

  it("flags nested children", () => {
    document.body.innerHTML = `
      <div data-ll-private="true">
        <div><span id="x"></span></div>
      </div>
    `;
    expect(hasPrivateAncestor(document.getElementById("x")!)).toBe(true);
  });

  it("does not flag siblings", () => {
    document.body.innerHTML = `
      <div data-ll-private="true"></div>
      <div id="x"></div>
    `;
    expect(hasPrivateAncestor(document.getElementById("x")!)).toBe(false);
  });
});
