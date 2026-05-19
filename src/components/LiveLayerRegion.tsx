// ─── LiveLayerRegion ──────────────────────────────────────────────────
// Author-curated region that the page-context extractor prioritizes.
//
//   <LiveLayerRegion id="pricing" intent="show pricing tiers">
//     <PricingTable />
//   </LiveLayerRegion>
//
// Renders a div with `data-ll-region` and `data-ll-intent` attributes.
// The default DOM walker reads these and surfaces them to the agent
// with their author-supplied `intent` so the agent has language for
// what's on the page rather than just raw text.
//
// `as` lets the consumer pick a different element (default: div) when
// a wrapping div would break their layout (e.g. inside a flex row use
// `as="span"` or pass the section's actual element type).

import {
  forwardRef,
  type ElementType,
  type ReactNode,
  type Ref,
  createElement,
  type CSSProperties,
} from "react";

export interface LiveLayerRegionProps {
  /** Stable identifier for the region. Becomes `data-ll-region`. */
  id: string;
  /** One-line description of what the agent should know about this region. */
  intent?: string;
  /** Element to render. Defaults to "div". */
  as?: ElementType;
  /** Extra class name on the wrapper. */
  className?: string;
  /** Inline styles. */
  style?: CSSProperties;
  children: ReactNode;
}

export const LiveLayerRegion = forwardRef<HTMLElement, LiveLayerRegionProps>(
  function LiveLayerRegion(
    { id, intent, as = "div", className, style, children },
    ref,
  ) {
    return createElement(
      as,
      {
        ref: ref as Ref<HTMLElement>,
        "data-ll-region": id,
        "data-ll-intent": intent,
        className,
        style,
      },
      children,
    );
  },
);
