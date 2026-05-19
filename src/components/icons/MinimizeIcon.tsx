// Downward chevron "minimize" icon.

import type { FC } from "react";

interface Props {
  className?: string;
}

export const MinimizeIcon: FC<Props> = ({ className }) => (
  <svg
    className={className}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={2}
    aria-hidden="true"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
  </svg>
);
