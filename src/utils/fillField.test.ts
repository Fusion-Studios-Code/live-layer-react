import { describe, it, expect, beforeEach, vi } from "vitest";
import { fillField } from "./fillField";

describe("fillField", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("sets value on a plain input", () => {
    document.body.innerHTML = `<input id="x" type="text" />`;
    const el = document.getElementById("x") as HTMLInputElement;
    fillField(el, "hello");
    expect(el.value).toBe("hello");
  });

  it("dispatches input + change events", () => {
    document.body.innerHTML = `<input id="x" type="text" />`;
    const el = document.getElementById("x") as HTMLInputElement;
    const onInput = vi.fn();
    const onChange = vi.fn();
    el.addEventListener("input", onInput);
    el.addEventListener("change", onChange);
    fillField(el, "hello");
    expect(onInput).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("calls the prototype's value setter directly (React-controlled-input fix)", () => {
    // The point of fillField over `el.value = x` is going through the
    // PROTOTYPE setter so React's internal valueTracker updates. Verify
    // by spying on the proto setter.
    document.body.innerHTML = `<input id="x" type="text" />`;
    const el = document.getElementById("x") as HTMLInputElement;
    const proto = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    );
    const origSetter = proto?.set;
    const spy = vi.fn(function (this: HTMLInputElement, v: string) {
      origSetter?.call(this, v);
    });
    Object.defineProperty(HTMLInputElement.prototype, "value", {
      ...proto,
      set: spy,
    });
    try {
      fillField(el, "hello");
      expect(spy).toHaveBeenCalledWith("hello");
      expect(el.value).toBe("hello");
    } finally {
      // Restore so other tests don't see the spy
      Object.defineProperty(HTMLInputElement.prototype, "value", proto!);
    }
  });

  it("toggles checkbox via checked, not value", () => {
    document.body.innerHTML = `<input id="x" type="checkbox" />`;
    const el = document.getElementById("x") as HTMLInputElement;
    expect(el.checked).toBe(false);
    fillField(el, "true");
    expect(el.checked).toBe(true);
    fillField(el, "false");
    expect(el.checked).toBe(false);
  });

  it("supports textarea", () => {
    document.body.innerHTML = `<textarea id="x"></textarea>`;
    const el = document.getElementById("x") as HTMLTextAreaElement;
    fillField(el, "multi\nline");
    expect(el.value).toBe("multi\nline");
  });

  it("supports select", () => {
    document.body.innerHTML = `
      <select id="x">
        <option value="a">A</option>
        <option value="b">B</option>
      </select>
    `;
    const el = document.getElementById("x") as HTMLSelectElement;
    fillField(el, "b");
    expect(el.value).toBe("b");
  });

  it("respects triggerInput=false / triggerChange=false", () => {
    document.body.innerHTML = `<input id="x" type="text" />`;
    const el = document.getElementById("x") as HTMLInputElement;
    const onInput = vi.fn();
    const onChange = vi.fn();
    el.addEventListener("input", onInput);
    el.addEventListener("change", onChange);
    fillField(el, "hello", { triggerInput: false, triggerChange: false });
    expect(el.value).toBe("hello");
    expect(onInput).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });
});
