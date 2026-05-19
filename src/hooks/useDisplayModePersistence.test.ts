import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useDisplayModePersistence } from "./useDisplayModePersistence";

describe("useDisplayModePersistence", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("falls back to defaultValue on first mount when no stored value exists", () => {
    const { result } = renderHook(() =>
      useDisplayModePersistence({ defaultValue: "minimized" }),
    );
    expect(result.current[0]).toBe("minimized");
  });

  it("persists uncontrolled mode changes to localStorage", () => {
    const { result } = renderHook(() =>
      useDisplayModePersistence({ persistKey: "ll-test", defaultValue: "expanded" }),
    );
    act(() => result.current[1]("hidden"));
    expect(window.localStorage.getItem("ll-test:display-mode")).toBe("hidden");
  });

  it("restores stored value on mount", () => {
    window.localStorage.setItem("ll-test:display-mode", "minimized");
    const { result } = renderHook(() =>
      useDisplayModePersistence({ persistKey: "ll-test", defaultValue: "expanded" }),
    );
    // First render shows default (SSR-safe); effect promotes the stored value.
    expect(result.current[0]).toBe("minimized");
  });

  it("ignores garbage in storage and keeps defaultValue", () => {
    window.localStorage.setItem("ll-test:display-mode", "bogus");
    const { result } = renderHook(() =>
      useDisplayModePersistence({ persistKey: "ll-test", defaultValue: "expanded" }),
    );
    expect(result.current[0]).toBe("expanded");
  });

  it("does not persist when disablePersistence is true", () => {
    const { result } = renderHook(() =>
      useDisplayModePersistence({
        persistKey: "ll-test",
        defaultValue: "expanded",
        disablePersistence: true,
      }),
    );
    act(() => result.current[1]("hidden"));
    expect(window.localStorage.getItem("ll-test:display-mode")).toBeNull();
  });

  it("does not persist when controlled (caller owns persistence)", () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useDisplayModePersistence({
        value: "minimized",
        persistKey: "ll-test",
        onChange,
      }),
    );
    act(() => result.current[1]("expanded"));
    expect(window.localStorage.getItem("ll-test:display-mode")).toBeNull();
    expect(onChange).toHaveBeenCalledWith("expanded");
  });

  it("scopes storage by persistKey so two widgets on the same origin don't collide", () => {
    const { result: a } = renderHook(() =>
      useDisplayModePersistence({ persistKey: "w-a" }),
    );
    const { result: b } = renderHook(() =>
      useDisplayModePersistence({ persistKey: "w-b" }),
    );
    act(() => a.current[1]("hidden"));
    act(() => b.current[1]("minimized"));
    expect(window.localStorage.getItem("w-a:display-mode")).toBe("hidden");
    expect(window.localStorage.getItem("w-b:display-mode")).toBe("minimized");
  });
});
