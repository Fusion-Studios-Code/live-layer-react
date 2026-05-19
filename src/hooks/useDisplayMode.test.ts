import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useDisplayMode } from "./useDisplayMode";

describe("useDisplayMode", () => {
  describe("uncontrolled", () => {
    it("defaults to 'expanded' when no defaultValue is given", () => {
      const { result } = renderHook(() => useDisplayMode());
      expect(result.current[0]).toBe("expanded");
    });

    it("honors defaultValue", () => {
      const { result } = renderHook(() => useDisplayMode({ defaultValue: "hidden" }));
      expect(result.current[0]).toBe("hidden");
    });

    it("updates internal state on setMode", () => {
      const { result } = renderHook(() => useDisplayMode({ defaultValue: "expanded" }));
      act(() => result.current[1]("minimized"));
      expect(result.current[0]).toBe("minimized");
      act(() => result.current[1]("hidden"));
      expect(result.current[0]).toBe("hidden");
    });

    it("fires onChange with the new value", () => {
      const onChange = vi.fn();
      const { result } = renderHook(() =>
        useDisplayMode({ defaultValue: "expanded", onChange }),
      );
      act(() => result.current[1]("minimized"));
      expect(onChange).toHaveBeenCalledWith("minimized");
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    it("is a no-op when set to the current mode", () => {
      const onChange = vi.fn();
      const { result } = renderHook(() =>
        useDisplayMode({ defaultValue: "expanded", onChange }),
      );
      act(() => result.current[1]("expanded"));
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe("controlled", () => {
    it("uses the value prop, not internal state", () => {
      const { result } = renderHook(() =>
        useDisplayMode({ value: "hidden", defaultValue: "expanded" }),
      );
      expect(result.current[0]).toBe("hidden");
    });

    it("does not mutate internal state on setMode (owner does it)", () => {
      const onChange = vi.fn();
      const { result, rerender } = renderHook(
        ({ value }: { value: "hidden" | "minimized" | "expanded" }) =>
          useDisplayMode({ value, onChange }),
        { initialProps: { value: "hidden" } },
      );
      act(() => result.current[1]("expanded"));
      // Still hidden — owner hasn't rerendered with the new value yet.
      expect(result.current[0]).toBe("hidden");
      expect(onChange).toHaveBeenCalledWith("expanded");

      // Owner accepts the change and rerenders with the new value.
      rerender({ value: "expanded" });
      expect(result.current[0]).toBe("expanded");
    });

    it("fires onChange on every transition, including ones the owner rejects", () => {
      const onChange = vi.fn();
      const { result } = renderHook(() =>
        useDisplayMode({ value: "minimized", onChange }),
      );
      act(() => result.current[1]("expanded"));
      act(() => result.current[1]("hidden"));
      expect(onChange).toHaveBeenNthCalledWith(1, "expanded");
      expect(onChange).toHaveBeenNthCalledWith(2, "hidden");
    });

    it("is a no-op when caller sets the current value", () => {
      const onChange = vi.fn();
      const { result } = renderHook(() =>
        useDisplayMode({ value: "minimized", onChange }),
      );
      act(() => result.current[1]("minimized"));
      expect(onChange).not.toHaveBeenCalled();
    });
  });
});
