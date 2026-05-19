import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { extractRoutes, clearRoutesCache } from "./extractRoutes";

describe("extractRoutes", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    Object.defineProperty(window, "location", {
      value: { origin: "http://localhost:3000", pathname: "/" },
      writable: true,
    });
    clearRoutesCache();
  });

  it("returns deduped anchor list", () => {
    document.body.innerHTML = `
      <a href="/pricing">Pricing</a>
      <a href="/pricing">Pricing again</a>
      <a href="/docs">Docs</a>
    `;
    const routes = extractRoutes();
    expect(routes).toHaveLength(2);
    expect(routes.map((r) => r.href)).toEqual(["/pricing", "/docs"]);
  });

  it("marks internal vs external", () => {
    document.body.innerHTML = `
      <a href="/local">Local</a>
      <a href="https://external.com/x">External</a>
    `;
    const routes = extractRoutes();
    const local = routes.find((r) => r.href === "/local");
    const ext = routes.find((r) => r.href === "https://external.com/x");
    expect(local?.internal).toBe(true);
    expect(ext?.internal).toBe(false);
  });

  it("excludes data-ll-private subtrees", () => {
    document.body.innerHTML = `
      <a href="/visible">Visible</a>
      <div data-ll-private="true">
        <a href="/secret">Secret</a>
      </div>
    `;
    const routes = extractRoutes();
    expect(routes.map((r) => r.href)).toEqual(["/visible"]);
  });

  it("skips non-navigable hrefs (#, javascript:, mailto:, tel:)", () => {
    document.body.innerHTML = `
      <a href="#">Anchor</a>
      <a href="javascript:void(0)">JS</a>
      <a href="mailto:foo@bar.com">Email</a>
      <a href="tel:+1">Phone</a>
      <a href="/real">Real</a>
    `;
    const routes = extractRoutes();
    expect(routes.map((r) => r.href)).toEqual(["/real"]);
  });

  it("normalizes internal absolute hrefs to path-only", () => {
    document.body.innerHTML = `
      <a href="http://localhost:3000/pricing?ref=hp">Pricing</a>
    `;
    const routes = extractRoutes();
    expect(routes[0]?.href).toBe("/pricing?ref=hp");
    expect(routes[0]?.internal).toBe(true);
  });
});
