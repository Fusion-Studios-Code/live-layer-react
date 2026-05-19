// ─── OverflowPopover ───────────────────────────────────────────────────────
// A tiny floating panel anchored ABOVE a trigger element.
// Used by CompactToolbar to host secondary controls behind a ••• button.
//
// Renders into document.body via createPortal so it escapes ancestor
// overflow:hidden / clip-path / transform contexts. Without the portal,
// hosts that wrap the widget in a rounded `overflow-hidden` container
// (the marketing customization slot is one) clip the popover when it
// opens upward and the user only sees the bottom 1-2 menu items.
//
// Position is computed from the anchor's getBoundingClientRect() and
// pinned to viewport coordinates via position:fixed.
//
// Closes on: click-outside (mousedown), Escape key. Listeners are
// only attached while open === true.

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FC,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

interface OverflowPopoverProps {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  children: ReactNode;
}

interface Position {
  top: number;
  left: number;
}

const GAP = 8;
const VIEWPORT_PADDING = 8;

export const OverflowPopover: FC<OverflowPopoverProps> = ({
  open,
  onClose,
  anchorRef,
  children,
}) => {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Position | null>(null);

  // Recompute position when open flips true. We use a layout effect so
  // the popover's first paint already has the correct coordinates —
  // otherwise it briefly flashes at (0,0) before snapping into place.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const anchor = anchorRef.current;
    if (!anchor) return;

    const compute = () => {
      const a = anchor.getBoundingClientRect();
      // Center popover horizontally on the anchor; lift bottom edge above
      // the anchor's top via a translate(-50%, -100%) on the rendered node.
      const next: Position = {
        top: a.top - GAP,
        left: a.left + a.width / 2,
      };
      // Clamp horizontally so the popover doesn't run off the viewport
      // edge. The popover is left/translated so `left` is its center —
      // we don't know its width here, but a min of VIEWPORT_PADDING +
      // (assumed half-width ~90px) keeps it readable on small screens.
      const minLeft = VIEWPORT_PADDING + 90;
      const maxLeft = window.innerWidth - VIEWPORT_PADDING - 90;
      if (next.left < minLeft) next.left = minLeft;
      if (next.left > maxLeft) next.left = maxLeft;
      setPos(next);
    };

    compute();
    // Reposition on scroll / resize so the popover tracks its anchor.
    window.addEventListener("scroll", compute, true);
    window.addEventListener("resize", compute);
    return () => {
      window.removeEventListener("scroll", compute, true);
      window.removeEventListener("resize", compute);
    };
  }, [open, anchorRef]);

  // Attach / detach document listeners while open.
  useEffect(() => {
    if (!open) return;

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const popoverEl = popoverRef.current;
      const anchorEl = anchorRef.current;

      // Skip if click is inside the popover itself.
      if (popoverEl && popoverEl.contains(target)) return;
      // Skip if click is inside the anchor — let the parent's onClick toggle.
      if (anchorEl && anchorEl.contains(target)) return;

      onClose();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose, anchorRef]);

  if (!open || pos === null) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={popoverRef}
      className="ll-overflow-popover"
      role="menu"
      style={{
        position: "fixed",
        // Lift the popover above the anchor via translateY(-100%).
        // top points to (anchorTop - GAP); transform pulls bottom up to there.
        top: pos.top,
        left: pos.left,
        transform: "translate(-50%, -100%)",
      }}
    >
      {children}
    </div>,
    document.body,
  );
};
