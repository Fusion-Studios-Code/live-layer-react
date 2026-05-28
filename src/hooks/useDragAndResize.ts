// ─── useDragAndResize ─────────────────────────────────────────────────
//
// Owns the geometry (position + size) override layer for the expanded
// widget surface. Lets a website visitor drag the floating widget out of
// the way (it commonly covers a phone number / CTA) and resize it. Came
// from real embed feedback: "the widget is blocking content I want to
// see and I can't move it."
//
// CRITICAL — no first-paint flash (the 0.18.3 bug fix):
//   Sizing + corner anchoring live in CSS (media queries + the
//   .ll-widget[data-position] rules). This hook is an OVERRIDE LAYER that
//   is EMPTY until the visitor actually drags/resizes OR a persisted
//   geometry was restored. While geometry is null we return an empty
//   style object so the CSS defaults win at first paint — no JS-driven
//   sizing that would snap the widget from desktop dims to mobile dims
//   on the first effect tick.
//
// Persistence mirrors useDisplayModePersistence:
//   - SSR-safe: initial render is always null (matches server + pre-paint
//     client → no hydration mismatch).
//   - First client effect promotes a stored geometry if present.
//   - Writes on every committed drag/resize, keyed by `${persistKey}:geometry`.
//   - Skipped entirely when disablePersistence OR isEmbedded.
//
// Pointer events (not mouse/touch) with setPointerCapture, matching the
// existing HiddenLayout drag. touch-action:none on the handles (set in
// styles.css) stops touch-drag from scrolling the page.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { readLocalStorage, writeLocalStorage, removeLocalStorage } from "../utils/persistence";

/** Persisted geometry. All four are required together — partial geometry
 *  is treated as garbage and ignored (we never want to apply a top with no
 *  left, which would mix inline + CSS anchoring and jump the widget). */
export interface WidgetGeometry {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface UseDragAndResizeOptions {
  /** Master switch for dragging. When false, dragHandleProps are no-ops. */
  draggable: boolean;
  /** Master switch for resizing. When false, resizeHandleProps are no-ops. */
  resizable: boolean;
  /** Scopes localStorage so two widgets on one origin don't collide. */
  persistKey: string;
  /** Skip localStorage (host owns persistence, or it's a one-off mount). */
  disablePersistence: boolean;
  /**
   * Smallest the surface may shrink to — below this the controls (mic /
   * end-call / message input) start overlapping. Defaults roughly match the
   * desktop chrome's minimum comfortable footprint.
   */
  minWidth?: number;
  minHeight?: number;
  /** Margin kept between the widget and every viewport edge, in px. */
  edgeMargin?: number;
}

export interface DragHandleProps {
  onPointerDown: (e: ReactPointerEvent) => void;
  onPointerMove: (e: ReactPointerEvent) => void;
  onPointerUp: (e: ReactPointerEvent) => void;
  onPointerCancel: (e: ReactPointerEvent) => void;
  onDoubleClick: () => void;
  /** Drives the touch-action / user-select / cursor CSS in styles.css. */
  "data-ll-drag-handle": "" | undefined;
}

export interface ResizeHandleProps {
  onPointerDown: (e: ReactPointerEvent) => void;
  onPointerMove: (e: ReactPointerEvent) => void;
  onPointerUp: (e: ReactPointerEvent) => void;
  onPointerCancel: (e: ReactPointerEvent) => void;
  "data-ll-resize-handle": "" | undefined;
}

export interface UseDragAndResizeResult {
  /**
   * Inline style override for the root .ll-widget element. EMPTY ({}) until
   * the visitor has dragged/resized or a geometry was restored — so the CSS
   * media-query sizing + [data-position] corner anchoring stay the default
   * at first paint. Once geometry exists this pins the widget with explicit
   * fixed top/left/width/height (and clears the corner insets).
   */
  style: CSSProperties;
  /** True once a user geometry exists (post-drag/resize or restored). */
  hasGeometry: boolean;
  /** True while a drag is actively in progress (for an is-dragging class). */
  isDragging: boolean;
  /** True while a resize is actively in progress. */
  isResizing: boolean;
  /** Spread onto the drag handle (the expanded header). */
  dragHandleProps: DragHandleProps;
  /** Spread onto the resize handle (bottom-right corner grip). */
  resizeHandleProps: ResizeHandleProps;
  /** Clear stored + in-memory geometry, returning to the CSS default. */
  reset: () => void;
}

const DEFAULT_MIN_WIDTH = 280;
const DEFAULT_MIN_HEIGHT = 380;
const DEFAULT_EDGE_MARGIN = 8;
const DRAG_THRESHOLD_PX = 4;

function storageKeyFor(persistKey: string): string {
  return `${persistKey}:geometry`;
}

/** Parse a stored geometry blob. Returns null for anything that isn't a
 *  complete {top,left,width,height} of finite numbers. */
export function parseStoredGeometry(raw: string | null): WidgetGeometry | null {
  if (!raw) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof obj !== "object" || obj === null) return null;
  const g = obj as Record<string, unknown>;
  const { top, left, width, height } = g;
  if (
    typeof top !== "number" ||
    typeof left !== "number" ||
    typeof width !== "number" ||
    typeof height !== "number" ||
    !Number.isFinite(top) ||
    !Number.isFinite(left) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height)
  ) {
    return null;
  }
  return { top, left, width, height };
}

function viewportSize(): { vw: number; vh: number } {
  if (typeof window === "undefined") return { vw: 0, vh: 0 };
  return { vw: window.innerWidth, vh: window.innerHeight };
}

/** Clamp a width/height to [min, viewport - 2*margin]. Exported for tests. */
export function clampSize(
  width: number,
  height: number,
  opts: { minWidth: number; minHeight: number; edgeMargin: number; vw: number; vh: number },
): { width: number; height: number } {
  const { minWidth, minHeight, edgeMargin, vw, vh } = opts;
  // Max is the viewport minus a margin on each side. Guard against a
  // viewport smaller than the min (tiny test windows) — min always wins so
  // the controls never collapse, even if that pokes past the edge.
  const maxW = Math.max(minWidth, vw - edgeMargin * 2);
  const maxH = Math.max(minHeight, vh - edgeMargin * 2);
  return {
    width: Math.max(minWidth, Math.min(maxW, width)),
    height: Math.max(minHeight, Math.min(maxH, height)),
  };
}

/** Clamp a top/left so the box of (width × height) stays fully on screen
 *  with `edgeMargin` breathing room. Exported for tests. */
export function clampPosition(
  top: number,
  left: number,
  width: number,
  height: number,
  opts: { edgeMargin: number; vw: number; vh: number },
): { top: number; left: number } {
  const { edgeMargin, vw, vh } = opts;
  const minLeft = edgeMargin;
  const minTop = edgeMargin;
  // Furthest the top-left can go and still keep the whole box visible.
  // If the box is wider/taller than the viewport, pin to the top-left
  // margin rather than producing a negative max (which would shove it
  // off the opposite edge).
  const maxLeft = Math.max(minLeft, vw - width - edgeMargin);
  const maxTop = Math.max(minTop, vh - height - edgeMargin);
  return {
    top: Math.max(minTop, Math.min(maxTop, top)),
    left: Math.max(minLeft, Math.min(maxLeft, left)),
  };
}

interface DragState {
  startClientX: number;
  startClientY: number;
  startTop: number;
  startLeft: number;
  width: number;
  height: number;
  moved: boolean;
}

interface ResizeState {
  startClientX: number;
  startClientY: number;
  startWidth: number;
  startHeight: number;
  top: number;
  left: number;
}

export function useDragAndResize(
  options: UseDragAndResizeOptions,
): UseDragAndResizeResult {
  const {
    draggable,
    resizable,
    persistKey,
    disablePersistence,
    minWidth = DEFAULT_MIN_WIDTH,
    minHeight = DEFAULT_MIN_HEIGHT,
    edgeMargin = DEFAULT_EDGE_MARGIN,
  } = options;

  // null === "no user geometry yet" === render with NO inline style so the
  // CSS defaults (media-query sizing + corner anchoring) win at first paint.
  const [geometry, setGeometry] = useState<WidgetGeometry | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);

  const dragRef = useRef<DragState | null>(null);
  const resizeRef = useRef<ResizeState | null>(null);
  const hydratedRef = useRef(false);
  // Most recent committed geometry, so pointer-move handlers (which read
  // measured DOM rects for the FIRST move) and resize can branch on it
  // without stale closures.
  const geometryRef = useRef<WidgetGeometry | null>(null);
  geometryRef.current = geometry;

  const persist = useCallback(
    (g: WidgetGeometry | null) => {
      if (disablePersistence) return;
      if (g === null) {
        removeLocalStorage(storageKeyFor(persistKey));
      } else {
        writeLocalStorage(storageKeyFor(persistKey), JSON.stringify(g));
      }
    },
    [disablePersistence, persistKey],
  );

  // Promote a stored geometry on first client mount (SSR-safe: first render
  // was null, matching the server). Re-clamp it against the CURRENT viewport
  // so a geometry saved on a big monitor doesn't strand the widget off the
  // edge of a small one.
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    if (disablePersistence) return;

    const stored = parseStoredGeometry(readLocalStorage(storageKeyFor(persistKey)));
    if (!stored) return;
    const { vw, vh } = viewportSize();
    const size = clampSize(stored.width, stored.height, {
      minWidth,
      minHeight,
      edgeMargin,
      vw,
      vh,
    });
    const pos = clampPosition(stored.top, stored.left, size.width, size.height, {
      edgeMargin,
      vw,
      vh,
    });
    setGeometry({ ...pos, ...size });
    // Mount-only; subsequent changes flow through the pointer handlers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-clamp on viewport resize so a geometry that was valid on a larger
  // window doesn't leave the widget partially/fully off-screen after the
  // window shrinks (or the phone rotates).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => {
      setGeometry((prev) => {
        if (prev === null) return null;
        const { vw, vh } = viewportSize();
        const size = clampSize(prev.width, prev.height, {
          minWidth,
          minHeight,
          edgeMargin,
          vw,
          vh,
        });
        const pos = clampPosition(prev.top, prev.left, size.width, size.height, {
          edgeMargin,
          vw,
          vh,
        });
        return { ...pos, ...size };
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [minWidth, minHeight, edgeMargin]);

  // ── Drag ───────────────────────────────────────────────────────────
  const onDragPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (!draggable) return;
      // Mouse: primary button only. Touch/pen pass through.
      if (e.pointerType === "mouse" && e.button !== 0) return;
      // Never start a drag from an interactive control in the header
      // (minimize / close / the team + language pills + their menus).
      // Only the empty handle area initiates a drag.
      const target = e.target as Element | null;
      if (
        target &&
        typeof target.closest === "function" &&
        target.closest('button, a, input, select, textarea, [role="listbox"], [role="option"], [data-ll-no-drag]')
      ) {
        return;
      }

      // Establish the starting box. If the visitor hasn't moved the widget
      // yet (geometry === null), measure its current rendered rect off the
      // root element so the drag picks up EXACTLY where the CSS-anchored
      // widget sits — no jump on the first drag.
      let startTop: number;
      let startLeft: number;
      let width: number;
      let height: number;
      const current = geometryRef.current;
      if (current) {
        ({ top: startTop, left: startLeft, width, height } = current);
      } else {
        const root = (e.currentTarget as Element).closest(".ll-widget");
        const rect = root?.getBoundingClientRect();
        if (!rect) return;
        startTop = rect.top;
        startLeft = rect.left;
        width = rect.width;
        height = rect.height;
      }

      try {
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
      } catch {
        // jsdom + some browsers don't implement setPointerCapture — ignore.
      }
      dragRef.current = {
        startClientX: e.clientX,
        startClientY: e.clientY,
        startTop,
        startLeft,
        width,
        height,
        moved: false,
      };
    },
    [draggable],
  );

  const onDragPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = e.clientX - drag.startClientX;
      const dy = e.clientY - drag.startClientY;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD_PX) {
        drag.moved = true;
        setIsDragging(true);
      }
      if (!drag.moved) return;
      const { vw, vh } = viewportSize();
      const pos = clampPosition(
        drag.startTop + dy,
        drag.startLeft + dx,
        drag.width,
        drag.height,
        { edgeMargin, vw, vh },
      );
      setGeometry({ ...pos, width: drag.width, height: drag.height });
    },
    [edgeMargin],
  );

  const endDrag = useCallback(
    (e: ReactPointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      try {
        (e.currentTarget as Element).releasePointerCapture(e.pointerId);
      } catch {
        // capture may already be gone — ignore.
      }
      dragRef.current = null;
      if (drag.moved) {
        setIsDragging(false);
        setGeometry((g) => {
          if (g) persist(g);
          return g;
        });
      }
    },
    [persist],
  );

  // Double-click the handle → reset to CSS default (clears stored geometry).
  const reset = useCallback(() => {
    dragRef.current = null;
    resizeRef.current = null;
    setIsDragging(false);
    setIsResizing(false);
    setGeometry(null);
    persist(null);
  }, [persist]);

  // ── Resize ─────────────────────────────────────────────────────────
  const onResizePointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (!resizable) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      // Don't let the resize pointerdown also bubble into a drag start.
      e.stopPropagation();

      let top: number;
      let left: number;
      let startWidth: number;
      let startHeight: number;
      const current = geometryRef.current;
      if (current) {
        ({ top, left, width: startWidth, height: startHeight } = current);
      } else {
        const root = (e.currentTarget as Element).closest(".ll-widget");
        const rect = root?.getBoundingClientRect();
        if (!rect) return;
        top = rect.top;
        left = rect.left;
        startWidth = rect.width;
        startHeight = rect.height;
      }

      try {
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
      } catch {
        // ignore — see drag note.
      }
      resizeRef.current = {
        startClientX: e.clientX,
        startClientY: e.clientY,
        startWidth,
        startHeight,
        top,
        left,
      };
      setIsResizing(true);
    },
    [resizable],
  );

  const onResizePointerMove = useCallback(
    (e: ReactPointerEvent) => {
      const rz = resizeRef.current;
      if (!rz) return;
      const dx = e.clientX - rz.startClientX;
      const dy = e.clientY - rz.startClientY;
      const { vw, vh } = viewportSize();
      // Bottom-right grip: the top-left stays put, so the max size is also
      // bounded by how much room is left between the (fixed) top-left and
      // the far edges — pick the tighter of the global max and that.
      const roomW = vw - rz.left - edgeMargin;
      const roomH = vh - rz.top - edgeMargin;
      const size = clampSize(rz.startWidth + dx, rz.startHeight + dy, {
        minWidth,
        minHeight,
        edgeMargin,
        // Clamp the available viewport to the room from the anchored corner
        // so the widget can't grow past the bottom/right edge.
        vw: Math.min(vw, rz.left + roomW + edgeMargin),
        vh: Math.min(vh, rz.top + roomH + edgeMargin),
      });
      setGeometry({ top: rz.top, left: rz.left, ...size });
    },
    [edgeMargin, minWidth, minHeight],
  );

  const endResize = useCallback(
    (e: ReactPointerEvent) => {
      const rz = resizeRef.current;
      if (!rz) return;
      try {
        (e.currentTarget as Element).releasePointerCapture(e.pointerId);
      } catch {
        // ignore.
      }
      resizeRef.current = null;
      setIsResizing(false);
      setGeometry((g) => {
        if (g) persist(g);
        return g;
      });
    },
    [persist],
  );

  // ── Output ─────────────────────────────────────────────────────────
  // EMPTY until interaction → CSS defaults win → no first-paint flash.
  const style: CSSProperties =
    geometry === null
      ? {}
      : {
          position: "fixed",
          top: `${geometry.top}px`,
          left: `${geometry.left}px`,
          right: "auto",
          bottom: "auto",
          width: `${geometry.width}px`,
          height: `${geometry.height}px`,
        };

  const dragHandleProps: DragHandleProps = {
    onPointerDown: onDragPointerDown,
    onPointerMove: onDragPointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
    onDoubleClick: reset,
    "data-ll-drag-handle": draggable ? "" : undefined,
  };

  const resizeHandleProps: ResizeHandleProps = {
    onPointerDown: onResizePointerDown,
    onPointerMove: onResizePointerMove,
    onPointerUp: endResize,
    onPointerCancel: endResize,
    "data-ll-resize-handle": resizable ? "" : undefined,
  };

  return {
    style,
    hasGeometry: geometry !== null,
    isDragging,
    isResizing,
    dragHandleProps,
    resizeHandleProps,
    reset,
  };
}
