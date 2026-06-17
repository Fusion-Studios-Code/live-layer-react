// ─── Host→agent application signals ───────────────────────────────────
//
// A small, typed channel for the host app to tell the agent when the user
// moves to a new page/step (and which fields still need collecting) and to
// emit arbitrary app events ("policy loaded", "checkout failed"). These ride
// the same LiveKit data channel as the rest of the protocol via the widget's
// `sendData` handle; the agent worker folds them into its LLM context so it
// reacts — asking for the next missing required field, acknowledging a page
// change, etc.
//
// This closes the page-awareness gap declaratively: instead of leaning on DOM
// heuristics, any SPA/form can announce its current page + required state.

/** One field's state on the current page (id matches a FieldManifest id). */
export interface LLPageField {
  id: string;
  label: string;
  required: boolean;
  filled: boolean;
}

/** Describes the page/step the user is currently on. */
export interface LLPageDescriptor {
  /** Stable page/step id. */
  id: string;
  label: string;
  /** Current route / pathname. */
  route: string;
  /** 1-based step index + total, for "step 2 of 3" phrasing by the agent. */
  index?: number;
  total?: number;
}

/** Host→agent: the user moved to a new page/step; here is its field state. */
export interface LLPageChangedMessage {
  type: "ll_page_changed";
  page: LLPageDescriptor;
  fields: LLPageField[];
  /** Ids of required fields on this page still empty — the agent's to-do list. */
  requiredRemaining: string[];
}

/** Host→agent: a discrete app event the agent should react to. */
export interface LLAppEventMessage {
  type: "ll_app_event";
  name: string;
  data?: Record<string, unknown>;
}

export type LLAppSignal = LLPageChangedMessage | LLAppEventMessage;

/** Minimal structural sink — satisfied by `AvatarWidgetHandle`. */
export interface AppSignalSink {
  sendData: (data: Record<string, unknown>) => void | Promise<void>;
}

function emit(sink: AppSignalSink, signal: LLAppSignal, label: string): void {
  void Promise.resolve(
    sink.sendData(signal as unknown as Record<string, unknown>),
  ).catch((err) => console.warn(`[livelayer] ${label} failed:`, err));
}

export interface PageChangedInput {
  page: LLPageDescriptor;
  fields: LLPageField[];
}

/**
 * Publish a page/step change plus its field state to the agent. The
 * `requiredRemaining` to-do list is derived from the fields, so callers only
 * declare which fields are required and whether they're filled.
 */
export function publishPageChanged(
  sink: AppSignalSink | null | undefined,
  input: PageChangedInput,
): void {
  if (!sink) return;
  emit(
    sink,
    {
      type: "ll_page_changed",
      page: input.page,
      fields: input.fields,
      requiredRemaining: input.fields
        .filter((f) => f.required && !f.filled)
        .map((f) => f.id),
    },
    "publishPageChanged",
  );
}

/** Publish an arbitrary app event to the agent. */
export function publishAppEvent(
  sink: AppSignalSink | null | undefined,
  name: string,
  data?: Record<string, unknown>,
): void {
  if (!sink) return;
  emit(
    sink,
    { type: "ll_app_event", name, ...(data ? { data } : {}) },
    "publishAppEvent",
  );
}
