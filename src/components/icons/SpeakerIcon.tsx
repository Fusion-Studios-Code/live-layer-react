// Speaker / volume icon. Matches Nova's header volume glyph.

import type { FC } from "react";

interface Props {
  muted?: boolean;
  className?: string;
}

export const SpeakerIcon: FC<Props> = ({ muted = false, className }) => (
  <svg
    className={className}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={2}
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M15 9v6m3-9v12M9 5l-3 4H3v6h3l3 4V5z"
    />
    {muted && (
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 20L20 4" />
    )}
  </svg>
);
