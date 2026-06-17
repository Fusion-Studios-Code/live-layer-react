import { useEffect, useRef, type RefObject } from "react";
import type { AvatarWidgetHandle } from "../AvatarWidget";
import {
  publishPageChanged,
  type LLPageDescriptor,
  type LLPageField,
} from "../utils/appSignals";

export interface UseLiveLayerPageInput {
  /** The page/step the user is currently on. */
  page: LLPageDescriptor;
  /** The fields that belong to this page (required + filled state). */
  fields: LLPageField[];
}

/**
 * Declarative page/step awareness for the agent.
 *
 * Pass the widget ref plus the current page and its fields; the hook emits an
 * `ll_page_changed` signal whenever the page **id** changes, so the agent
 * always knows which page the user is on and what's still required. Field-value
 * churn alone does not re-emit — the agent reads live field values from the
 * manifest / page context; this fires on navigation, the moment that matters.
 *
 * `sendData` queues until the session connects, so an initial page declared
 * before connection is delivered as soon as the agent joins.
 */
export function useLiveLayerPage(
  widgetRef: RefObject<AvatarWidgetHandle | null>,
  input: UseLiveLayerPageInput,
): void {
  // Keep the freshest fields without re-emitting on every value change.
  const latest = useRef(input);
  latest.current = input;

  const lastPageId = useRef<string | null>(null);
  useEffect(() => {
    if (input.page.id === lastPageId.current) return;
    lastPageId.current = input.page.id;
    publishPageChanged(widgetRef.current, latest.current);
  }, [input.page.id, widgetRef]);
}
