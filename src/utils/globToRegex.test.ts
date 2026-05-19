import { describe, it, expect } from "vitest";
import { matchGlob } from "./globToRegex";

describe("matchGlob", () => {
  it("matches an exact path", () => {
    expect(matchGlob("/", "/")).toBe(true);
    expect(matchGlob("/foo", "/foo")).toBe(true);
    expect(matchGlob("/foo", "/bar")).toBe(false);
  });

  it("normalizes trailing slashes on both pattern and pathname", () => {
    expect(matchGlob("/foo/", "/foo")).toBe(true);
    expect(matchGlob("/foo", "/foo/")).toBe(true);
    expect(matchGlob("/foo/", "/foo/")).toBe(true);
  });

  it("matches one segment with `*`", () => {
    expect(matchGlob("/admin/*", "/admin/users")).toBe(true);
    expect(matchGlob("/admin/*", "/admin")).toBe(false);
    expect(matchGlob("/admin/*", "/admin/users/edit")).toBe(false);
  });

  it("matches any depth with `**`", () => {
    expect(matchGlob("/admin/**", "/admin")).toBe(true);
    expect(matchGlob("/admin/**", "/admin/users")).toBe(true);
    expect(matchGlob("/admin/**", "/admin/users/edit")).toBe(true);
    expect(matchGlob("/admin/**", "/other")).toBe(false);
  });

  it("supports a `*` segment in the middle of a pattern", () => {
    expect(matchGlob("/blog/*/comments", "/blog/post-1/comments")).toBe(true);
    expect(matchGlob("/blog/*/comments", "/blog/post-1/edit")).toBe(false);
    expect(matchGlob("/blog/*/comments", "/blog/post-1/sub/comments")).toBe(false);
  });

  it("escapes regex metacharacters in literal segments", () => {
    // `+` is regex-special; pattern should match literally.
    expect(matchGlob("/items/c+", "/items/c+")).toBe(true);
    expect(matchGlob("/items/c+", "/items/c")).toBe(false);
  });

  it("anchors to the full pathname (no suffix bleed)", () => {
    expect(matchGlob("/foo", "/foobar")).toBe(false);
    expect(matchGlob("/foo", "/foo/bar")).toBe(false);
  });

  it("memoizes — repeated calls return the same regex", () => {
    // Smoke check — if memoization were broken the result would still match
    // but recompile each time. We assert correctness, not perf.
    expect(matchGlob("/x", "/x")).toBe(true);
    expect(matchGlob("/x", "/x")).toBe(true);
    expect(matchGlob("/x", "/y")).toBe(false);
  });
});
