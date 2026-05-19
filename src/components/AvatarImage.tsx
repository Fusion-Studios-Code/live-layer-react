// ─── AvatarImage ──────────────────────────────────────────────────────
// Fade-in avatar image. Replaces the previous implementation's use of
// `next/image` with a plain <img> so the package has zero Next.js
// coupling. `loading="lazy"` handles out-of-viewport cost; `fetchpriority`
// high tells the browser to prefer this resource when it's in the
// critical render path (the expanded widget always shows this image).

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, FC } from "react";

interface Props {
  src: string;
  alt: string;
  /** When true, the image scales up slightly — matches the pre-canned audio animation. */
  preCannedPlaying?: boolean;
  className?: string;
  style?: CSSProperties;
}

export const AvatarImage: FC<Props> = ({
  src,
  alt,
  preCannedPlaying = false,
  className,
  style,
}) => {
  const [loaded, setLoaded] = useState(false);
  const prevSrcRef = useRef(src);

  // Reset loaded flag when src changes (swap to different avatar).
  useEffect(() => {
    if (prevSrcRef.current !== src) {
      prevSrcRef.current = src;
      setLoaded(false);
    }
  }, [src]);

  if (!src) return null;

  const combinedStyle: CSSProperties = {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
    objectPosition: "top",
    transition: "opacity 500ms ease, transform 500ms ease",
    transform: preCannedPlaying ? "scale(1.02)" : "scale(1)",
    opacity: loaded ? 1 : 0,
    ...style,
  };

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className={className}
      style={combinedStyle}
      loading="eager"
      // React 19 expects camelCase `fetchPriority`; React 18 also accepts it.
      // The lowercase form (HTML attr) emits a console warning under React 19.
      // Vercel's build env now resolves a DOM type that includes
      // fetchPriority, so the prior `@ts-expect-error` directive errored
      // as unused (TS2578) and broke the deploy. Dropped the directive;
      // if a future TS bump regresses, the underlying TS error will
      // surface and we'll decide which side to patch.
      fetchPriority="high"
      onLoad={() => setLoaded(true)}
    />
  );
};
