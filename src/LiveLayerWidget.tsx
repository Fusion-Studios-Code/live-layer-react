// ─── React Wrapper for <livelayer-widget> ────────────────────────────
// Wraps the web component in a React component with proper lifecycle
// management. Survives client-side navigation (component stays mounted
// through route changes).

import { useEffect, useRef, useCallback, type FC } from "react";

// Ensure the web component is registered (side-effect import)
import "@livelayer/sdk";

export interface AgentEventDetail {
  eventName: string;
  data: Record<string, unknown>;
}

export interface LiveLayerWidgetProps {
  /** The agent ID to connect to */
  agentId: string;
  /** Base URL of the Live Layer API (e.g. "https://app.livelayer.studio") */
  baseUrl?: string;
  /** API key for cross-origin authentication */
  apiKey?: string;
  /**
   * Override the experience mode from the published config.
   * If not set, the mode from the agent's published config is used.
   */
  mode?: "WIDGET" | "EMBEDDED";
  /** Callback fired when the agent emits an event via the data channel */
  onAgentEvent?: (event: AgentEventDetail) => void;
  /** Additional CSS class name on the wrapper div */
  className?: string;
  /** Inline styles on the wrapper div */
  style?: React.CSSProperties;
}

/**
 * React component that renders a `<livelayer-widget>` custom element.
 *
 * @example
 * ```tsx
 * <LiveLayerWidget
 *   agentId="agent_xxx"
 *   onAgentEvent={(e) => console.log(e.eventName, e.data)}
 * />
 * ```
 */
export const LiveLayerWidget: FC<LiveLayerWidgetProps> = ({
  agentId,
  baseUrl,
  apiKey,
  mode,
  onAgentEvent,
  className,
  style,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<HTMLElement | null>(null);
  const callbackRef = useRef(onAgentEvent);

  // Keep callback ref in sync without re-attaching the listener
  callbackRef.current = onAgentEvent;

  const handleAgentEvent = useCallback((e: Event) => {
    const detail = (e as CustomEvent<AgentEventDetail>).detail;
    callbackRef.current?.(detail);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Create the custom element imperatively so we control its lifecycle
    const widget = document.createElement("livelayer-widget");
    widget.setAttribute("agent-id", agentId);
    if (baseUrl) {
      widget.setAttribute("base-url", baseUrl);
    }
    if (apiKey) {
      widget.setAttribute("api-key", apiKey);
    }
    if (mode) {
      widget.setAttribute("mode", mode);
    }

    widget.addEventListener("agent-event", handleAgentEvent);
    container.appendChild(widget);
    widgetRef.current = widget;

    return () => {
      widget.removeEventListener("agent-event", handleAgentEvent);
      container.removeChild(widget);
      widgetRef.current = null;
    };
    // Re-create only when agentId changes — not on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  // Update mode attribute without recreating the element
  useEffect(() => {
    if (widgetRef.current) {
      if (mode) {
        widgetRef.current.setAttribute("mode", mode);
      } else {
        widgetRef.current.removeAttribute("mode");
      }
    }
  }, [mode]);

  return <div ref={containerRef} className={className} style={style} />;
};
