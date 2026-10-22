import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { useIsMobile } from "./useIsMobile";

// jsdom ships a stub matchMedia that always returns matches:false; override
// per test so we can simulate actual viewport behavior.
type Listener = (ev: MediaQueryListEvent) => void;
interface FakeMQL {
  matches: boolean;
  media: string;
  addEventListener: (type: "change", cb: Listener) => void;
  removeEventListener: (type: "change", cb: Listener) => void;
  listeners: Listener[];
  dispatch: (matches: boolean) => void;
}

function installMatchMedia(initialMatches: boolean): { getMql: () => FakeMQL } {
  let latestMql: FakeMQL;
  const factory = (media: string): FakeMQL => {
    const mql: FakeMQL = {
      matches: initialMatches,
      media,
      listeners: [],
      addEventListener: (_t, cb) => {
        mql.listeners.push(cb);
      },
      removeEventListener: (_t, cb) => {
        mql.listeners = mql.listeners.filter((l) => l !== cb);
      },
      dispatch: (matches) => {
        mql.matches = matches;
        const ev = { matches, media } as unknown as MediaQueryListEvent;
        for (const l of mql.listeners) l(ev);
      },
    };
    latestMql = mql;
    return mql;
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn((q: string) => factory(q) as unknown as MediaQueryList),
  );
  return {
    getMql: () => latestMql,
  };
}

describe("useIsMobile", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns false on first render (SSR-safe default)", () => {
    installMatchMedia(true);
    // We can't observe the pre-effect render value directly in a hook test
    // because effects run synchronously, but we can assert the after-effect
    // value reflects the real viewport.
    const { result } = renderHook(() => useIsMobile(640));
    expect(result.current).toBe(true);
  });

  it("returns false when viewport is wider than breakpoint", () => {
    installMatchMedia(false);
    const { result } = renderHook(() => useIsMobile(640));
    expect(result.current).toBe(false);
  });

  it("updates when viewport changes", () => {
    const { getMql } = installMatchMedia(false);
    const { result } = renderHook(() => useIsMobile(640));
    expect(result.current).toBe(false);
    act(() => getMql().dispatch(true));
    expect(result.current).toBe(true);
    act(() => getMql().dispatch(false));
    expect(result.current).toBe(false);
  });

  it("uses breakpoint - 1 in the max-width query (exclusive upper bound)", () => {
    installMatchMedia(false);
    const mm = vi.spyOn(window, "matchMedia");
    renderHook(() => useIsMobile(768));
    expect(mm).toHaveBeenCalledWith("(max-width: 767px)");
  });

  it("returns false and skips matchMedia when breakpoint is false", () => {
    const mm = vi.fn(() =>
      ({
        matches: true,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
    );
    vi.stubGlobal("matchMedia", mm);
    const { result } = renderHook(() => useIsMobile(false));
    expect(result.current).toBe(false);
    expect(mm).not.toHaveBeenCalled();
  });

  it("cleans up the listener on unmount", () => {
    const { getMql } = installMatchMedia(true);
    const { unmount } = renderHook(() => useIsMobile(640));
    expect(getMql().listeners.length).toBe(1);
    unmount();
    expect(getMql().listeners.length).toBe(0);
  });

  describe("initialValue (SSR user-agent hint)", () => {
    // Server render: effects never run, so the markup shows exactly what
    // the hook returns before hydration.
    const label = (isMobile: boolean) =>
      createElement("span", null, isMobile ? "mobile" : "desktop");
    function SeededProbe(props: { initialValue: boolean }) {
      return label(useIsMobile(768, props.initialValue));
    }
    function UnseededProbe() {
      return label(useIsMobile(768));
    }

    it("server-renders the seed when one is passed", () => {
      expect(
        renderToString(createElement(SeededProbe, { initialValue: true })),
      ).toContain("mobile");
      expect(
        renderToString(createElement(SeededProbe, { initialValue: false })),
      ).toContain("desktop");
    });

    it("server-renders false when no seed is passed (unchanged default)", () => {
      expect(renderToString(createElement(UnseededProbe))).toContain("desktop");
    });

    it("first client render uses the seed, then matchMedia takes over", () => {
      installMatchMedia(false);
      const seen: boolean[] = [];
      const { result } = renderHook(() => {
        const value = useIsMobile(768, true);
        seen.push(value);
        return value;
      });
      expect(seen[0]).toBe(true);
      expect(result.current).toBe(false);
    });

    it("keeps a correct seed without flipping on mount", () => {
      installMatchMedia(true);
      const seen: boolean[] = [];
      renderHook(() => {
        const value = useIsMobile(768, true);
        seen.push(value);
        return value;
      });
      expect(new Set(seen)).toEqual(new Set([true]));
    });

    it("breakpoint === false still forces false after mount, whatever the seed", () => {
      const { result } = renderHook(() => useIsMobile(false, true));
      expect(result.current).toBe(false);
    });
  });
});
