// ─── HiddenLayout ─────────────────────────────────────────────────────
//
// The minimum-footprint display mode. Renders a small edge tab with a
// directional chevron. Clicking expands directly to ExpandedLayout
// (AvatarWidget routes the onExpand callback to that mode). Dragging
// vertically repositions the tab along its edge; the position
// persists across reloads via localStorage.
//
// Edge selection based on `position`:
//   top-right, bottom-right  → right edge (chevron points left)
//   top-left,  bottom-left   → left  edge (chevron points right)
//   custom                   → defaults to right edge
//
// Why drag-to-reposition: Nova's site-embed feedback consistently
// flagged the centered tab as covering content users wanted to see.
// Letting the user nudge it up or down without leaving the page
// removes the friction without surfacing a settings menu.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FC,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { ChevronIcon } from "../components/icons";
import type { WidgetPosition } from "../types";

interface Props {
  position: WidgetPosition;
  isMobile: boolean;
  isSpeaking: boolean;
  onExpand: () => void;
  /** Accessible label when focused. */
  label?: string;
  /**
   * Avatar URL — when provided, the tab renders a small circular photo
   * INSIDE the tab and a tiny chevron on the inward edge as the click
   * affordance. Reinforces that the widget is an avatar-based experience
   * even when collapsed. Falls back to the chevron-only design when
   * unset.
   */
  avatarImageUrl?: string | null;
  /** Agent name — used as alt text for the avatar photo. */
  agentName?: string;
  /**
   * When the floating chrome is portaled to a scoped container (e.g.
   * a fork-demo card), pass the container element here. The tab's
   * vertical centering + drag-clamp will be computed against the
   * container's bounds instead of the viewport — without it the tab
   * defaults to `centerY = window.innerHeight / 2`, which puts it
   * far below a 260px-tall card and gets clipped by the card's
   * overflow:hidden. Drag-to-reposition is also suppressed in scoped
   * mode since a tiny card doesn't have the room to make it useful.
   */
  containerEl?: HTMLElement | null;
}

function edgeSide(position: WidgetPosition): "left" | "right" {
  if (position === "top-left" || position === "bottom-left") return "left";
  return "right";
}

const STORAGE_KEY = "ll-hidden-tab-center-y";
const DRAG_THRESHOLD_PX = 5;
const EDGE_PADDING_PX = 16;

function readSavedCenterY(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const n = Number.parseFloat(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writeSavedCenterY(y: number) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(y));
  } catch {
    // localStorage may be disabled in private mode — fail silent
  }
}

export const HiddenLayout: FC<Props> = ({
  position,
  isMobile,
  isSpeaking,
  onExpand,
  label = "Open widget",
  avatarImageUrl,
  agentName,
  containerEl,
}) => {
  const side = edgeSide(position);
  const chevronDirection = side === "right" ? "left" : "right";
  const tabHeight = isMobile ? 80 : 72;
  const showAvatar = !!avatarImageUrl;
  const isScoped = !!containerEl;

  // null until the client-only effect has resolved a saved or default
  // center-Y. Until then we render with the CSS fallback (top: 50%).
  // In scoped mode (containerEl provided) we skip the inline override
  // entirely so the CSS fallback centers the tab vertically inside the
  // container — the saved-Y / drag system was designed for a viewport-
  // sized canvas, not a 260px-tall card.
  const [centerY, setCenterY] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{
    startClientY: number;
    startCenterY: number;
    moved: boolean;
  } | null>(null);
  const suppressNextClickRef = useRef(false);

  const clamp = useCallback(
    (y: number): number => {
      if (typeof window === "undefined") return y;
      const half = tabHeight / 2;
      const min = EDGE_PADDING_PX + half;
      const max = window.innerHeight - EDGE_PADDING_PX - half;
      if (max < min) return Math.max(min, y); // tiny viewport fallback
      return Math.max(min, Math.min(max, y));
    },
    [tabHeight],
  );

  // Initialize on mount + re-clamp on viewport resize so a saved Y
  // from a tall window doesn't push the tab off-screen on a small one.
  // Skipped entirely in scoped mode — there the CSS fallback handles
  // centering and drag is suppressed.
  useEffect(() => {
    if (isScoped) {
      setCenterY(null);
      return;
    }
    const saved = readSavedCenterY();
    setCenterY(clamp(saved ?? window.innerHeight / 2));

    const onResize = () => {
      setCenterY((prev) => (prev === null ? null : clamp(prev)));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clamp, isScoped]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      // No drag in scoped mode — the click-through still works.
      if (isScoped) return;
      // Mouse: only respond to the primary button. Touch/pen pass through.
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (centerY === null) return;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Some test environments (jsdom) don't implement setPointerCapture
      }
      dragRef.current = {
        startClientY: e.clientY,
        startCenterY: centerY,
        moved: false,
      };
    },
    [centerY, isScoped],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dy = e.clientY - drag.startClientY;
      if (!drag.moved && Math.abs(dy) > DRAG_THRESHOLD_PX) {
        drag.moved = true;
        setIsDragging(true);
      }
      if (drag.moved) {
        setCenterY(clamp(drag.startCenterY + dy));
      }
    },
    [clamp],
  );

  const endDrag = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore — capture may have been released already
      }
      dragRef.current = null;
      if (drag.moved) {
        setIsDragging(false);
        // Suppress the click that follows the pointerup so a drag
        // doesn't also expand the widget. The flag is consumed in
        // onClick below; cleared automatically on the next pointerdown.
        suppressNextClickRef.current = true;
        setCenterY((y) => {
          if (y !== null) writeSavedCenterY(y);
          return y;
        });
      }
    },
    [],
  );

  const onClick = useCallback(() => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    onExpand();
  }, [onExpand]);

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLButtonElement>) => {
      // Enter / Space already trigger onClick on a <button>; we override
      // arrow keys to nudge the tab so keyboard users get parity with
      // drag. 8px per press feels responsive without being twitchy.
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const delta = e.key === "ArrowUp" ? -8 : 8;
        setCenterY((y) => {
          if (y === null) return y;
          const next = clamp(y + delta);
          writeSavedCenterY(next);
          return next;
        });
      }
    },
    [clamp],
  );

  const classes = [
    "ll-hidden",
    `ll-hidden--${side}`,
    isMobile ? "ll-hidden--mobile" : "ll-hidden--desktop",
    isSpeaking ? "ll-hidden--speaking" : null,
    isDragging ? "is-dragging" : null,
    showAvatar ? "ll-hidden--with-avatar" : null,
    isScoped ? "ll-hidden--scoped" : null,
  ]
    .filter(Boolean)
    .join(" ");

  // Inline positioning overrides the CSS fallback once we have a Y.
  // `transform: none` removes the translateY(-50%) so `top` is treated
  // as the literal pixel position of the tab's top edge.
  const inlineStyle: CSSProperties | undefined =
    centerY === null
      ? undefined
      : { top: `${centerY - tabHeight / 2}px`, transform: "none" };

  return (
    <button
      type="button"
      className={classes}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClick={onClick}
      onKeyDown={onKeyDown}
      aria-label={label}
      data-position={position}
      style={inlineStyle}
    >
      {showAvatar ? (
        // Layout: tiny chevron flush against the inward edge (peeks out
        // as the click affordance), then the circular avatar photo
        // taking the rest of the tab. Reinforces "this is an
        // avatar-based experience" even when collapsed.
        <>
          <ChevronIcon
            direction={chevronDirection}
            className="ll-hidden__chevron ll-hidden__chevron--mini"
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={avatarImageUrl as string}
            alt={agentName ? `${agentName} avatar` : "Agent avatar"}
            className="ll-hidden__avatar"
            draggable={false}
          />
        </>
      ) : (
        <ChevronIcon
          direction={chevronDirection}
          className="ll-hidden__chevron"
        />
      )}
    </button>
  );
};
