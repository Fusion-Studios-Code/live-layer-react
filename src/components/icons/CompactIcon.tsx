// Horizontal-line "compact" icon (row style).

import type { FC } from "react";

interface Props {
  className?: string;
}

export const CompactIcon: FC<Props> = ({ className }) => (
  <svg
    className={className}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={2}
    aria-hidden="true"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4" />
  </svg>
);
