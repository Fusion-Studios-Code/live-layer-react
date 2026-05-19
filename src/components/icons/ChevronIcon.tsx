// Directional chevron. Used by the hidden-mode edge tab — rotates to
// point outward based on the widget's position edge.

import type { FC } from "react";

interface Props {
  direction?: "left" | "right" | "up" | "down";
  className?: string;
}

const ROTATIONS: Record<"left" | "right" | "up" | "down", number> = {
  left: 180,
  right: 0,
  up: -90,
  down: 90,
};

export const ChevronIcon: FC<Props> = ({ direction = "right", className }) => (
  <svg
    className={className}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={2}
    style={{ transform: `rotate(${ROTATIONS[direction]}deg)` }}
    aria-hidden="true"
  >
    {/* Bounding box (9,6)→(15,18) → perfectly centered in the 24×24 viewBox. */}
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 6l6 6-6 6" />
  </svg>
);
