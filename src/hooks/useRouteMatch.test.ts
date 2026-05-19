import { describe, it, expect } from "vitest";
import { shouldRenderAtPath, matchesPattern } from "./useRouteMatch";

describe("matchesPattern", () => {
  it("matches a string glob", () => {
    expect(matchesPattern("/admin/*", "/admin/users")).toBe(true);
    expect(matchesPattern("/admin/*", "/admin/users/edit")).toBe(false);
  });

  it("matches a RegExp", () => {
    expect(matchesPattern(/^\/blog\/[a-z]+$/, "/blog/hello")).toBe(true);
    expect(matchesPattern(/^\/blog\/[a-z]+$/, "/blog/123")).toBe(false);
  });

  it("invokes a function predicate", () => {
    expect(matchesPattern((p) => p.startsWith("/x"), "/x/y")).toBe(true);
    expect(matchesPattern((p) => p.startsWith("/x"), "/y")).toBe(false);
  });
});

describe("shouldRenderAtPath", () => {
  it("renders by default when no patterns are configured", () => {
    expect(shouldRenderAtPath("/foo", undefined, undefined)).toBe(true);
    expect(shouldRenderAtPath("/", undefined, undefined)).toBe(true);
  });

  it("renders when pathname is undefined (SSR / first render)", () => {
    expect(shouldRenderAtPath(undefined, ["/"], ["/private"])).toBe(true);
  });

  it("hides on hideOn match", () => {
    expect(shouldRenderAtPath("/privacy", undefined, ["/privacy"])).toBe(false);
    expect(shouldRenderAtPath("/privacy", undefined, ["/privacy", "/terms"])).toBe(false);
    expect(shouldRenderAtPath("/about", undefined, ["/privacy"])).toBe(true);
  });

  it("renders only on showOn matches", () => {
    expect(shouldRenderAtPath("/", ["/"], undefined)).toBe(true);
    expect(shouldRenderAtPath("/about", ["/"], undefined)).toBe(false);
  });

  it("hideOn beats showOn on collision", () => {
    // pathname matches both — hideOn must win.
    expect(shouldRenderAtPath("/admin", ["/admin/**"], ["/admin"])).toBe(false);
    // pathname matches only showOn — render.
    expect(shouldRenderAtPath("/admin/x", ["/admin/**"], ["/admin"])).toBe(true);
  });

  it("treats empty showOn array as 'no whitelist'", () => {
    expect(shouldRenderAtPath("/foo", [], undefined)).toBe(true);
  });

  it("supports mixed string + regex + function patterns", () => {
    const patterns = [
      "/about",
      /^\/blog\/.+$/,
      (p: string) => p === "/contact",
    ];
    expect(shouldRenderAtPath("/about", patterns, undefined)).toBe(true);
    expect(shouldRenderAtPath("/blog/post", patterns, undefined)).toBe(true);
    expect(shouldRenderAtPath("/contact", patterns, undefined)).toBe(true);
    expect(shouldRenderAtPath("/other", patterns, undefined)).toBe(false);
  });
});
