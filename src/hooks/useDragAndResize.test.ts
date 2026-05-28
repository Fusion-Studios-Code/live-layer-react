import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  useDragAndResize,
  clampPosition,
  clampSize,
  parseStoredGeometry,
  type WidgetGeometry,
} from "./useDragAndResize";

// jsdom's default viewport is 1024×768 and the dims are writable. Several
// tests below resize the window to exercise clamping against a small
// viewport; we restore the defaults afterwards so tests stay independent.
const DEFAULT_VW = 1024;
const DEFAULT_VH = 768;

function setViewport(vw: number, vh: number) {
  (window as unknown as { innerWidth: number }).innerWidth = vw;
  (window as unknown as { innerHeight: number }).innerHeight = vh;
}

const BASE_OPTS = {
  draggable: true,
  resizable: true,
  persistKey: "ll-test",
  disablePersistence: false,
};

describe("useDragAndResize", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setViewport(DEFAULT_VW, DEFAULT_VH);
  });
  afterEach(() => {
    setViewport(DEFAULT_VW, DEFAULT_VH);
  });

  // ── No first-paint flash: empty geometry → no inline style ─────────
  describe("no-flash default (empty until interaction)", () => {
    it("returns an empty style object and hasGeometry=false on first mount", () => {
      const { result } = renderHook(() => useDragAndResize(BASE_OPTS));
      expect(result.current.style).toEqual({});
      expect(result.current.hasGeometry).toBe(false);
    });

    it("does not set any positioning/sizing keys before interaction", () => {
      const { result } = renderHook(() => useDragAndResize(BASE_OPTS));
      const s = result.current.style;
      // None of the override keys should be present — the CSS defaults win.
      expect(s).not.toHaveProperty("top");
      expect(s).not.toHaveProperty("left");
      expect(s).not.toHaveProperty("width");
      expect(s).not.toHaveProperty("height");
      expect(s).not.toHaveProperty("position");
    });

    it("keeps style empty when nothing is stored and persistence is on", () => {
      const { result } = renderHook(() => useDragAndResize(BASE_OPTS));
      // Effect ran (mount), found nothing in storage → still empty.
      expect(result.current.style).toEqual({});
      expect(result.current.hasGeometry).toBe(false);
    });
  });

  // ── Persistence round-trip ─────────────────────────────────────────
  describe("persistence", () => {
    it("restores a stored geometry on mount as an inline style override", () => {
      const stored: WidgetGeometry = {
        top: 100,
        left: 120,
        width: 400,
        height: 560,
      };
      window.localStorage.setItem("ll-test:geometry", JSON.stringify(stored));

      const { result } = renderHook(() => useDragAndResize(BASE_OPTS));

      expect(result.current.hasGeometry).toBe(true);
      expect(result.current.style).toMatchObject({
        position: "fixed",
        top: "100px",
        left: "120px",
        width: "400px",
        height: "560px",
        right: "auto",
        bottom: "auto",
      });
    });

    it("reads back exactly what a committed drag wrote (round-trip)", () => {
      // First mount writes via reset(null) → removeItem path is separate;
      // here we simulate a write by seeding storage, reading it on a fresh
      // mount, and confirming the values survive the JSON round-trip.
      const written: WidgetGeometry = {
        top: 42,
        left: 84,
        width: 300,
        height: 420,
      };
      window.localStorage.setItem("ll-test:geometry", JSON.stringify(written));

      const raw = window.localStorage.getItem("ll-test:geometry");
      expect(parseStoredGeometry(raw)).toEqual(written);

      const { result } = renderHook(() => useDragAndResize(BASE_OPTS));
      expect(result.current.style).toMatchObject({
        top: "42px",
        left: "84px",
        width: "300px",
        height: "420px",
      });
    });

    it("scopes storage by persistKey so two widgets don't collide", () => {
      window.localStorage.setItem(
        "w-a:geometry",
        JSON.stringify({ top: 10, left: 10, width: 300, height: 400 }),
      );
      window.localStorage.setItem(
        "w-b:geometry",
        JSON.stringify({ top: 20, left: 20, width: 320, height: 420 }),
      );

      const { result: a } = renderHook(() =>
        useDragAndResize({ ...BASE_OPTS, persistKey: "w-a" }),
      );
      const { result: b } = renderHook(() =>
        useDragAndResize({ ...BASE_OPTS, persistKey: "w-b" }),
      );

      expect(a.current.style).toMatchObject({ top: "10px", left: "10px" });
      expect(b.current.style).toMatchObject({ top: "20px", left: "20px" });
    });

    it("does NOT restore when disablePersistence is true", () => {
      window.localStorage.setItem(
        "ll-test:geometry",
        JSON.stringify({ top: 100, left: 120, width: 400, height: 560 }),
      );
      const { result } = renderHook(() =>
        useDragAndResize({ ...BASE_OPTS, disablePersistence: true }),
      );
      expect(result.current.hasGeometry).toBe(false);
      expect(result.current.style).toEqual({});
    });

    it("reset() clears the stored geometry and returns to the empty default", () => {
      window.localStorage.setItem(
        "ll-test:geometry",
        JSON.stringify({ top: 100, left: 120, width: 400, height: 560 }),
      );
      const { result } = renderHook(() => useDragAndResize(BASE_OPTS));
      expect(result.current.hasGeometry).toBe(true);

      act(() => result.current.reset());

      expect(result.current.hasGeometry).toBe(false);
      expect(result.current.style).toEqual({});
      // Storage cleared too.
      expect(window.localStorage.getItem("ll-test:geometry")).toBeNull();
    });

    it("ignores garbage / partial geometry in storage and stays empty", () => {
      window.localStorage.setItem("ll-test:geometry", "not json");
      const a = renderHook(() => useDragAndResize(BASE_OPTS));
      expect(a.result.current.hasGeometry).toBe(false);

      window.localStorage.clear();
      // Partial — missing height. Mixing inline top with CSS sizing would
      // jump the widget, so partial blobs are rejected wholesale.
      window.localStorage.setItem(
        "ll-test:geometry",
        JSON.stringify({ top: 10, left: 10, width: 300 }),
      );
      const b = renderHook(() => useDragAndResize(BASE_OPTS));
      expect(b.result.current.hasGeometry).toBe(false);
    });

    it("re-clamps a restored geometry against the CURRENT (smaller) viewport", () => {
      // Saved on a big monitor — would be off-screen on this small window.
      window.localStorage.setItem(
        "ll-test:geometry",
        JSON.stringify({ top: 700, left: 900, width: 400, height: 560 }),
      );
      setViewport(500, 600);

      const { result } = renderHook(() => useDragAndResize(BASE_OPTS));

      // Width clamped to viewport (500 - 2*8 = 484), height to min (380 >
      // 600-16=584? no — 584 > 380 so height stays 560), position clamped so
      // the box stays fully visible.
      const s = result.current.style as Record<string, string>;
      const width = parseInt(s.width, 10);
      const height = parseInt(s.height, 10);
      const top = parseInt(s.top, 10);
      const left = parseInt(s.left, 10);
      expect(width).toBeLessThanOrEqual(500 - 16);
      expect(height).toBeLessThanOrEqual(600 - 16);
      // Fully on-screen with the 8px margin.
      expect(left).toBeGreaterThanOrEqual(8);
      expect(top).toBeGreaterThanOrEqual(8);
      expect(left + width).toBeLessThanOrEqual(500 - 8 + 1); // +1 for rounding
      expect(top + height).toBeLessThanOrEqual(600 - 8 + 1);
    });
  });

  // ── Disabled handles are no-ops ────────────────────────────────────
  describe("disabled (default-off-on-mobile) behavior", () => {
    it("omits the drag-handle data attribute when draggable is false", () => {
      const { result } = renderHook(() =>
        useDragAndResize({ ...BASE_OPTS, draggable: false }),
      );
      expect(
        result.current.dragHandleProps["data-ll-drag-handle"],
      ).toBeUndefined();
    });

    it("omits the resize-handle data attribute when resizable is false", () => {
      const { result } = renderHook(() =>
        useDragAndResize({ ...BASE_OPTS, resizable: false }),
      );
      expect(
        result.current.resizeHandleProps["data-ll-resize-handle"],
      ).toBeUndefined();
    });

    it("sets both data attributes to '' when enabled", () => {
      const { result } = renderHook(() => useDragAndResize(BASE_OPTS));
      expect(result.current.dragHandleProps["data-ll-drag-handle"]).toBe("");
      expect(result.current.resizeHandleProps["data-ll-resize-handle"]).toBe(
        "",
      );
    });

    it("a pointerdown on a disabled drag handle does not start a drag", () => {
      const { result } = renderHook(() =>
        useDragAndResize({ ...BASE_OPTS, draggable: false }),
      );
      const div = document.createElement("div");
      Object.assign(div, { setPointerCapture() {}, releasePointerCapture() {} });
      div.getBoundingClientRect = () =>
        ({ top: 50, left: 60, width: 400, height: 560 }) as DOMRect;
      // closest must resolve to a .ll-widget for the measure path.
      const root = document.createElement("div");
      root.className = "ll-widget";
      root.appendChild(div);

      act(() => {
        result.current.dragHandleProps.onPointerDown({
          pointerType: "mouse",
          button: 0,
          clientX: 0,
          clientY: 0,
          pointerId: 1,
          currentTarget: div,
          target: div,
        } as never);
      });
      act(() => {
        result.current.dragHandleProps.onPointerMove({
          clientX: 100,
          clientY: 100,
          pointerId: 1,
          currentTarget: div,
          target: div,
        } as never);
      });
      // Still no geometry — the drag never armed.
      expect(result.current.hasGeometry).toBe(false);
      expect(result.current.style).toEqual({});
    });
  });

  // ── Pure clamping math (the load-bearing geometry logic) ───────────
  describe("clampSize", () => {
    const opts = (vw: number, vh: number) => ({
      minWidth: 280,
      minHeight: 380,
      edgeMargin: 8,
      vw,
      vh,
    });

    it("clamps below the minimum up to the min", () => {
      expect(clampSize(100, 100, opts(1024, 768))).toEqual({
        width: 280,
        height: 380,
      });
    });

    it("clamps above the viewport max down to viewport minus 2*margin", () => {
      expect(clampSize(5000, 5000, opts(1024, 768))).toEqual({
        width: 1024 - 16,
        height: 768 - 16,
      });
    });

    it("passes a size that's already in range through unchanged", () => {
      expect(clampSize(400, 560, opts(1024, 768))).toEqual({
        width: 400,
        height: 560,
      });
    });

    it("min wins even when the viewport is smaller than the min", () => {
      // Tiny viewport: max would be negative, but the controls must not
      // collapse — min always wins.
      expect(clampSize(200, 200, opts(100, 100))).toEqual({
        width: 280,
        height: 380,
      });
    });
  });

  describe("clampPosition", () => {
    const opts = (vw: number, vh: number) => ({ edgeMargin: 8, vw, vh });

    it("clamps a negative top/left to the edge margin", () => {
      expect(clampPosition(-50, -50, 400, 560, opts(1024, 768))).toEqual({
        top: 8,
        left: 8,
      });
    });

    it("clamps the bottom-right past the viewport back inside", () => {
      // Box pushed off the bottom-right corner.
      const { top, left } = clampPosition(
        2000,
        2000,
        400,
        560,
        opts(1024, 768),
      );
      // maxLeft = 1024 - 400 - 8 = 616, maxTop = 768 - 560 - 8 = 200.
      expect(left).toBe(616);
      expect(top).toBe(200);
      // Box stays fully visible.
      expect(left + 400).toBeLessThanOrEqual(1024 - 8);
      expect(top + 560).toBeLessThanOrEqual(768 - 8);
    });

    it("passes an in-bounds position through unchanged", () => {
      expect(clampPosition(100, 120, 400, 560, opts(1024, 768))).toEqual({
        top: 100,
        left: 120,
      });
    });

    it("pins to the top-left margin when the box is larger than the viewport", () => {
      // Box wider+taller than the viewport — can't be fully visible, so we
      // pin to the top-left margin rather than shoving it off the far edge.
      expect(clampPosition(500, 500, 2000, 2000, opts(1024, 768))).toEqual({
        top: 8,
        left: 8,
      });
    });
  });

  describe("parseStoredGeometry", () => {
    it("returns null for null / empty / non-JSON input", () => {
      expect(parseStoredGeometry(null)).toBeNull();
      expect(parseStoredGeometry("")).toBeNull();
      expect(parseStoredGeometry("{")).toBeNull();
      expect(parseStoredGeometry("[]")).toBeNull();
      expect(parseStoredGeometry("42")).toBeNull();
    });

    it("returns null when any field is missing or non-finite", () => {
      expect(
        parseStoredGeometry(JSON.stringify({ top: 1, left: 2, width: 3 })),
      ).toBeNull();
      expect(
        parseStoredGeometry(
          JSON.stringify({ top: 1, left: 2, width: 3, height: "x" }),
        ),
      ).toBeNull();
      expect(
        parseStoredGeometry(
          JSON.stringify({ top: 1, left: 2, width: 3, height: NaN }),
        ),
      ).toBeNull();
    });

    it("parses a complete numeric geometry", () => {
      expect(
        parseStoredGeometry(
          JSON.stringify({ top: 1, left: 2, width: 3, height: 4 }),
        ),
      ).toEqual({ top: 1, left: 2, width: 3, height: 4 });
    });
  });

  // ── Drag interaction (commits geometry + persists) ─────────────────
  describe("drag interaction", () => {
    function makeHandleEl() {
      const root = document.createElement("div");
      root.className = "ll-widget";
      const handle = document.createElement("div");
      // jsdom doesn't implement pointer capture — stub so the hook's
      // try/catch isn't the thing under test here.
      Object.assign(handle, {
        setPointerCapture() {},
        releasePointerCapture() {},
      });
      handle.getBoundingClientRect = () =>
        ({ top: 50, left: 60, width: 400, height: 560 }) as DOMRect;
      root.getBoundingClientRect = () =>
        ({ top: 50, left: 60, width: 400, height: 560 }) as DOMRect;
      root.appendChild(handle);
      document.body.appendChild(root);
      return handle;
    }

    it("measures the current rect on the first drag, then tracks the pointer", () => {
      const { result } = renderHook(() => useDragAndResize(BASE_OPTS));
      const handle = makeHandleEl();

      act(() => {
        result.current.dragHandleProps.onPointerDown({
          pointerType: "mouse",
          button: 0,
          clientX: 200,
          clientY: 200,
          pointerId: 1,
          currentTarget: handle,
          target: handle,
        } as never);
      });
      // Move 30px right / 40px down — past the threshold.
      act(() => {
        result.current.dragHandleProps.onPointerMove({
          clientX: 230,
          clientY: 240,
          pointerId: 1,
          currentTarget: handle,
          target: handle,
        } as never);
      });

      expect(result.current.isDragging).toBe(true);
      expect(result.current.style).toMatchObject({
        position: "fixed",
        left: "90px", // 60 + 30
        top: "90px", // 50 + 40
        width: "400px",
        height: "560px",
      });
    });

    it("persists the committed geometry on pointerup", () => {
      const { result } = renderHook(() => useDragAndResize(BASE_OPTS));
      const handle = makeHandleEl();

      act(() => {
        result.current.dragHandleProps.onPointerDown({
          pointerType: "mouse",
          button: 0,
          clientX: 200,
          clientY: 200,
          pointerId: 1,
          currentTarget: handle,
          target: handle,
        } as never);
      });
      act(() => {
        result.current.dragHandleProps.onPointerMove({
          clientX: 230,
          clientY: 240,
          pointerId: 1,
          currentTarget: handle,
          target: handle,
        } as never);
      });
      act(() => {
        result.current.dragHandleProps.onPointerUp({
          pointerId: 1,
          currentTarget: handle,
          target: handle,
        } as never);
      });

      expect(result.current.isDragging).toBe(false);
      const stored = parseStoredGeometry(
        window.localStorage.getItem("ll-test:geometry"),
      );
      expect(stored).toEqual({ top: 90, left: 90, width: 400, height: 560 });
    });

    it("does not commit or persist a sub-threshold tap (no real drag)", () => {
      const { result } = renderHook(() => useDragAndResize(BASE_OPTS));
      const handle = makeHandleEl();

      act(() => {
        result.current.dragHandleProps.onPointerDown({
          pointerType: "mouse",
          button: 0,
          clientX: 200,
          clientY: 200,
          pointerId: 1,
          currentTarget: handle,
          target: handle,
        } as never);
      });
      // 2px move — under the 4px threshold.
      act(() => {
        result.current.dragHandleProps.onPointerMove({
          clientX: 201,
          clientY: 201,
          pointerId: 1,
          currentTarget: handle,
          target: handle,
        } as never);
      });
      act(() => {
        result.current.dragHandleProps.onPointerUp({
          pointerId: 1,
          currentTarget: handle,
          target: handle,
        } as never);
      });

      expect(result.current.hasGeometry).toBe(false);
      expect(window.localStorage.getItem("ll-test:geometry")).toBeNull();
    });

    it("does not start a drag from an interactive header control (button)", () => {
      const { result } = renderHook(() => useDragAndResize(BASE_OPTS));
      const root = document.createElement("div");
      root.className = "ll-widget";
      const handle = document.createElement("div");
      const btn = document.createElement("button");
      Object.assign(handle, {
        setPointerCapture() {},
        releasePointerCapture() {},
      });
      handle.getBoundingClientRect = () =>
        ({ top: 50, left: 60, width: 400, height: 560 }) as DOMRect;
      handle.appendChild(btn);
      root.appendChild(handle);
      document.body.appendChild(root);

      act(() => {
        // pointerdown originates on the button inside the handle.
        result.current.dragHandleProps.onPointerDown({
          pointerType: "mouse",
          button: 0,
          clientX: 200,
          clientY: 200,
          pointerId: 1,
          currentTarget: handle,
          target: btn,
        } as never);
      });
      act(() => {
        result.current.dragHandleProps.onPointerMove({
          clientX: 260,
          clientY: 260,
          pointerId: 1,
          currentTarget: handle,
          target: btn,
        } as never);
      });

      expect(result.current.isDragging).toBe(false);
      expect(result.current.hasGeometry).toBe(false);
    });
  });

  // ── Resize interaction (commits size + persists) ───────────────────
  describe("resize interaction", () => {
    function makeGripEl() {
      const root = document.createElement("div");
      root.className = "ll-widget";
      const grip = document.createElement("div");
      Object.assign(grip, {
        setPointerCapture() {},
        releasePointerCapture() {},
      });
      grip.getBoundingClientRect = () =>
        ({ top: 0, left: 0, width: 10, height: 10 }) as DOMRect;
      root.getBoundingClientRect = () =>
        ({ top: 50, left: 60, width: 400, height: 560 }) as DOMRect;
      root.appendChild(grip);
      document.body.appendChild(root);
      return grip;
    }

    it("grows width/height by the pointer delta and persists on pointerup", () => {
      const { result } = renderHook(() => useDragAndResize(BASE_OPTS));
      const grip = makeGripEl();

      act(() => {
        result.current.resizeHandleProps.onPointerDown({
          pointerType: "mouse",
          button: 0,
          clientX: 100,
          clientY: 100,
          pointerId: 1,
          currentTarget: grip,
          target: grip,
          stopPropagation() {},
        } as never);
      });
      // Drag the grip +50 / +60.
      act(() => {
        result.current.resizeHandleProps.onPointerMove({
          clientX: 150,
          clientY: 160,
          pointerId: 1,
          currentTarget: grip,
          target: grip,
        } as never);
      });

      expect(result.current.isResizing).toBe(true);
      expect(result.current.style).toMatchObject({
        width: "450px", // 400 + 50
        height: "620px", // 560 + 60
        top: "50px", // anchored top-left stays put
        left: "60px",
      });

      act(() => {
        result.current.resizeHandleProps.onPointerUp({
          pointerId: 1,
          currentTarget: grip,
          target: grip,
        } as never);
      });
      expect(result.current.isResizing).toBe(false);
      expect(
        parseStoredGeometry(window.localStorage.getItem("ll-test:geometry")),
      ).toEqual({ top: 50, left: 60, width: 450, height: 620 });
    });

    it("clamps resize to the minimum so the controls never collapse", () => {
      const { result } = renderHook(() => useDragAndResize(BASE_OPTS));
      const grip = makeGripEl();

      act(() => {
        result.current.resizeHandleProps.onPointerDown({
          pointerType: "mouse",
          button: 0,
          clientX: 100,
          clientY: 100,
          pointerId: 1,
          currentTarget: grip,
          target: grip,
          stopPropagation() {},
        } as never);
      });
      // Drag way up-left to try to shrink below the minimum.
      act(() => {
        result.current.resizeHandleProps.onPointerMove({
          clientX: -500,
          clientY: -500,
          pointerId: 1,
          currentTarget: grip,
          target: grip,
        } as never);
      });

      expect(result.current.style).toMatchObject({
        width: "280px", // min
        height: "380px", // min
      });
    });
  });
});
