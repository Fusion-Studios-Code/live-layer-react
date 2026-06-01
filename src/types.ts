// Shared public types for @livelayer/react. Exported from index.ts.

export type WidgetPosition =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right"
  | "custom";

export type DisplayMode = "hidden" | "minimized" | "expanded";

/**
 * Agent commands streamed over the LiveKit data channel. The base package
 * recognizes universal types (agent_state, avatar_active, etc.) and forwards
 * everything else to the consumer's `onAgentCommand` callback.
 *
 * This is an open union — unknown future command types still include `type`.
 */
export interface AgentCommand {
  type: string;
  [key: string]: unknown;
}

export interface AgentEventDetail {
  eventName: string;
  data: Record<string, unknown>;
}

export interface TeamMember {
  id: string;
  name: string;
  role?: string;
  avatarImageUrl?: string;
  previewVideoUrl?: string;
  /**
   * Per-member agent override. When the user switches to this member the
   * widget reconnects with this agentId. If omitted, uses the top-level
   * agentId prop (single-agent team).
   */
  agentId?: string;
}

export interface BrandingConfig {
  logoUrl?: string;
  productName?: string;
  primaryColor?: string;
  accentColor?: string;
  backgroundColor?: string;
  textColor?: string;
}

// ── Route patterns (showOn / hideOn) ─────────────────────────────────────

/**
 * Pattern matched against the current pathname to decide if the widget
 * renders.
 *
 * - `string` — exact match OR glob with `*` (one segment) and `**` (any depth)
 * - `RegExp` — full regex flexibility
 * - function — fully custom predicate
 *
 * Glob examples:
 *   "/"               only the home route
 *   "/admin/X"        /admin/foo but NOT /admin/foo/bar       (X = single star)
 *   "/admin/XX"       /admin and any descendant               (XX = double star)
 *   "/blog/X/comments" /blog/x/comments but not deeper paths   (X = single star)
 */
export type RoutePattern = string | RegExp | ((pathname: string) => boolean);

// ── Page context (extractPageContext) ────────────────────────────────────

/** A single actionable flow control (Continue / Back / Submit) the agent can trigger. */
export interface FlowControl {
  /** Stable logical id the SDK maps back to a live DOM node ("ll-advance" | "ll-back" | "ll-submit"). */
  id: string;
  /** Human label for the agent, e.g. "Continue". */
  label: string;
}

/** Runtime-inferred multi-step (wizard) structure of the current page. */
export interface FlowContext {
  kind: "multi-step" | "single-page";
  /** 1-based, best-effort (undefined when the stepper is unreadable). */
  currentStep?: number;
  /** best-effort total step count. */
  totalSteps?: number;
  /** current step's label, e.g. "Getting to know you". */
  stepLabel?: string;
  /** forward control if present on the current view. */
  advance?: FlowControl;
  /** backward control if present. */
  back?: FlowControl;
  /** final-step submit control if present (distinct from `advance`). */
  submit?: FlowControl;
}

/**
 * Snapshot of what the user is currently looking at, sent to the agent in
 * response to a `request_page_context` command.
 *
 * Form values, password inputs, and elements marked `data-ll-private="true"`
 * are NEVER included. See README → Privacy.
 */
export interface PageContext {
  /** Full URL at the moment the snapshot was taken. */
  url: string;
  /** document.title at snapshot time. */
  title: string;
  /** Pathname only (no host, no query, no hash). */
  pathname: string;
  /** Author-curated regions via <LiveLayerRegion> — agent should prefer these. */
  regions: Array<{ id: string; intent?: string; text: string }>;
  /** Visible content fallback — auto-extracted text from headings/paragraphs. */
  visibleText: string;
  /** Anchor hrefs visible in viewport, top-to-bottom, max 20. */
  visibleLinks: Array<{ href: string; text: string }>;
  /** Form fields visible in viewport — labels and types only, never values. */
  visibleFields: Array<{ label: string; type: string }>;
  /**
   * Every <form> on the page is auto-discovered (0.12.0). The agent
   * uses these entries to call `fill_form`, `submit_form`, or
   * `collect_from_page`. Values NEVER included. Forms opted out via
   * `data-ll-skip` or inside a `data-ll-private` subtree are absent.
   */
  forms: Array<{
    id: string;
    intent?: string;
    fields: Array<{
      /**
       * Agent-callable identifier. Prefers the input's `name` attribute,
       * falls back to `id`, then `field_<n>` positional index within the
       * form. The agent passes this string back as the key in
       * `fill_form({ values: { [name]: "..." } })`. Stable across renders
       * as long as the form's input order doesn't change.
       */
      name: string;
      label: string;
      type: string;
      /** Whether the field is required (HTML5 `required` attribute). */
      required?: boolean;
      /** Placeholder text. Useful when no <label> is associated. */
      placeholder?: string;
      /**
       * HTML5 constraint hints — surfaced proactively so the agent can
       * format input correctly the first time instead of learning the
       * constraint reactively from `validationMessage` after a rejected
       * fill. All optional; only present when the underlying attribute
       * was set on the DOM element.
       *
       *   minLength / maxLength — string length bounds (text, email,
       *                            textarea, password, etc.)
       *   min / max             — numeric / date / time bounds (typed
       *                            as strings to preserve the host's
       *                            exact attribute value)
       *   step                  — numeric / date / time step
       *   pattern               — regex the value must satisfy
       *   autocomplete          — semantic hint (e.g. "email",
       *                            "given-name", "tel", "street-
       *                            address"). Excluded when its value
       *                            is "off" or starts with "cc-"
       *                            (those fields are privacy-filtered
       *                            entirely upstream).
       */
      minLength?: number;
      maxLength?: number;
      min?: string;
      max?: string;
      step?: string;
      pattern?: string;
      autocomplete?: string;
      /** Choices for <select> fields. Capped at 20 per field. */
      options?: Array<{ value: string; label: string }>;
      /** Live HTML5 validation error (omitted when field is valid). */
      validationMessage?: string;
    }>;
  }>;
  /** Free-form metadata bag from the consumer's pageContextExtras prop. */
  extras?: Record<string, unknown>;
  /** Runtime-inferred wizard structure; absent on a plain single-page form. */
  flow?: FlowContext;
}

// ── Capabilities (0.4.0) ─────────────────────────────────────────────────

/**
 * What the agent's data-channel commands are allowed to do. Pass to
 * `<AvatarWidget capabilities={[...]} />` to restrict.
 *
 * Mapping:
 *   "navigate"     → navigate command
 *   "scroll"       → scroll_to + scroll_page commands
 *   "click"        → click command
 *   "fill_forms"   → fill_form + focus_field commands
 *   "submit_forms" → submit_form command
 *   "read_page"    → request_page_context + request_routes commands
 *
 * Default (undefined): everything enabled (matches 0.3.x behavior).
 */
export type AgentCapability =
  | "navigate"
  | "scroll"
  | "click"
  | "fill_forms"
  | "submit_forms"
  | "read_page"
  /**
   * 0.11.0 — LiveKit Agent Tasks structured collection (page-form,
   * agent-declared field list, slide form). The detailed result types
   * live in `./hooks/useCollect` to keep co-located with the consumer.
   */
  | "collect_data";
