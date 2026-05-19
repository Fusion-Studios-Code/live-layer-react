// Extends expect() with DOM matchers (toBeInTheDocument, toHaveClass, etc.)
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Polyfill `localStorage` for the jsdom environment — vitest 4 + jsdom
// 29 stopped exposing it as a real Storage instance, so any test that
// calls `localStorage.clear()` or relies on the Storage API throws
// "localStorage.clear is not a function". Install a tiny in-memory
// shim before tests run.
if (
  typeof globalThis.localStorage === "undefined" ||
  typeof globalThis.localStorage.clear !== "function"
) {
  const store: Record<string, string> = {};
  const shim: Storage = {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; },
    clear() { for (const k of Object.keys(store)) delete store[k]; },
    key(i) { return Object.keys(store)[i] ?? null; },
    get length() { return Object.keys(store).length; },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: shim,
    configurable: true,
    writable: true,
  });
  if (typeof globalThis.window !== "undefined") {
    Object.defineProperty(globalThis.window, "localStorage", {
      value: shim,
      configurable: true,
      writable: true,
    });
  }
}

// Each test gets a fresh DOM — jsdom otherwise accumulates nodes across tests.
afterEach(() => {
  cleanup();
});
