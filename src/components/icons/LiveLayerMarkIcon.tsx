// ─── LiveLayerMarkIcon ────────────────────────────────────────────────
// The canonical LiveLayer brand mark — same paths the main app ships at
// /favicon.svg and components/brand/LiveLayerLogo.tsx. Inline SVG so the
// widget doesn't take a network round-trip just to render the header
// pill, and so the mark stays consistent even on hosts whose CSP blocks
// remote images.
//
// Use:
//   - Default size (14) matches the wordmark's cap-height in the
//     idle-state ll-expanded__brand pill (font-size: ~12px).
//   - currentColor on the wordmark element won't propagate here; the
//     brand fill is intentionally fixed to LiveLayer orange so the mark
//     reads as "LiveLayer" even on dark host themes.
//   - aria-hidden is the default because the surrounding wordmark text
//     "Live Layer" already carries the accessible name. Pass an
//     explicit aria-label only when this icon is rendered standalone.

interface LiveLayerMarkIconProps {
  size?: number;
  className?: string;
  /**
   * Override the fixed brand orange. ONLY use this for variants like
   * monochrome dark-mode previews — never for production widget UI
   * (the orange IS the brand recognition).
   */
  fill?: string;
}

const BRAND_FILL = "#E06540";

export function LiveLayerMarkIcon({
  size = 14,
  className,
  fill = BRAND_FILL,
}: LiveLayerMarkIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 52 52"
      fill="none"
      className={className}
      aria-hidden
    >
      <path
        d="M44.5714 26C44.5714 23.5612 44.0908 21.146 43.1575 18.8928C42.2242 16.6397 40.8565 14.5924 39.132 12.868C37.4076 11.1435 35.3603 9.77577 33.1072 8.84247C30.854 7.90917 28.4388 7.42857 26 7.42857C23.5612 7.42857 21.146 7.90916 18.8928 8.84247C16.6397 9.77577 14.5924 11.1435 12.868 12.868C11.1435 14.5924 9.77577 16.6397 8.84247 18.8928C7.90917 21.146 7.42857 23.5612 7.42857 26C7.42857 28.4388 7.90916 30.854 8.84247 33.1072C9.77577 35.3603 11.1435 37.4076 12.868 39.132C14.5924 40.8565 16.6397 42.2242 18.8928 43.1575C21.146 44.0908 23.5612 44.5714 26 44.5714H48.2857C50.3371 44.5714 52 46.2344 52 48.2857C52 50.3371 50.3371 52 48.2857 52H26C22.5857 52 19.2049 51.3275 16.0505 50.021C12.896 48.7144 10.0293 46.7993 7.61501 44.385C5.20069 41.9707 3.28564 39.104 1.97902 35.9495C0.67247 32.7951 -3.54212e-07 29.4143 0 26C-1.68163e-07 22.5857 0.672469 19.2049 1.97902 16.0505C3.28564 12.896 5.20069 10.0293 7.61501 7.61501C10.0293 5.20069 12.896 3.28564 16.0505 1.97902C19.2049 0.67247 22.5857 0 26 0C29.4143 1.86048e-07 32.7951 0.67247 35.9495 1.97902C39.104 3.28564 41.9707 5.20069 44.385 7.61501C46.7993 10.0293 48.7144 12.896 50.021 16.0505C51.3275 19.2049 52 22.5857 52 26C52 28.0513 50.3371 29.7143 48.2857 29.7143C46.2344 29.7143 44.5714 28.0513 44.5714 26Z"
        fill={fill}
      />
      <path
        d="M28.9717 23.7714C28.9717 21.3098 30.9672 19.3143 33.4288 19.3143C35.8904 19.3143 37.886 21.3098 37.886 23.7714C37.886 26.233 35.8904 28.2286 33.4288 28.2286C30.9672 28.2286 28.9717 26.233 28.9717 23.7714Z"
        fill={fill}
      />
      <path
        d="M18.5714 19.3143C16.1098 19.3143 14.1143 21.3098 14.1143 23.7714C14.1143 26.233 16.1098 28.2286 18.5714 28.2286C21.033 28.2286 23.0285 26.233 23.0285 23.7714C23.0285 21.3098 21.033 19.3143 18.5714 19.3143Z"
        fill={fill}
      />
    </svg>
  );
}
