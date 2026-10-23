// ─── agentReply ───────────────────────────────────────────────────────
// How the widget answers the agent's requests (request_page_context,
// request_routes, submit_form): which connection a reply goes out on, and
// what the widget sends when it will not or cannot carry a request out.
//
// The worker waits for each answer (2 s for the page reads, 6 s for a
// submit) and matches it by `requestId`. A request the widget drops costs
// the visitor that whole wait, so every request that reaches the widget
// gets exactly one terminal answer, refusals included.
//
// Where a reply goes:
//   - Uncontrolled: the Room of the widget's own LiveKit session.
//   - Controlled: the host owns the Room and the widget's internal session
//     never connects (its getRoom() is null), so replies go through the
//     ControlledSession: its `publishData` when the host supplied one,
//     otherwise the Room its `getRoom()` returns. This is the same order
//     the widget already uses for sendData and typed messages.
// Either way the reply is the same JSON, held to MAX_DATA_PAYLOAD_BYTES.
//
// Refusals:
//   - submit_form answers with `form_submit_blocked` and a refusal reason
//     (see SubmitRefusalReason). The worker already reads that reply as
//     "the form did NOT submit", so it answers at once instead of waiting
//     out the 6 s and calling the outcome unknown.
//   - Every other request answers with
//     `{ type: "tool_error", requestId, command, reason }`. Workers that
//     do not read `tool_error` yet ignore it, so it costs them nothing.
//     A command without a `requestId` (navigate, fill_form and the other
//     fire-and-forget commands) is not answered: nothing waits for it.

import {
  MAX_DATA_PAYLOAD_BYTES,
  publishReliable,
  type DataPublisher,
} from "./dataPayload";

/** The parts of a ControlledSession the widget can reply through. */
export interface ReplyHost {
  publishData?: (data: Record<string, unknown>) => void | Promise<void>;
  getRoom?: () => unknown | null;
}

/** A ReplyHost that supplied publishData. */
type PublishingHost = ReplyHost & Required<Pick<ReplyHost, "publishData">>;

/** Which connection a reply goes out on. */
export type ReplyRoute = "room" | "host_publish" | "host_room";

/** Sends one encoded JSON reply. Resolves true when sent; never rejects. */
export interface ReplySender {
  route: ReplyRoute;
  send: (data: Uint8Array, label: string) => Promise<boolean>;
}

/** Why the widget did not carry out a submit_form. */
export type SubmitRefusalReason =
  /** The host's `capabilities` prop does not include "submit_forms". */
  | "capability_blocked"
  /** The command carried no formId. */
  | "missing_form_id"
  /** No <form> on the page matches the formId. */
  | "form_not_found"
  /**
   * The matched form sits in a private / data-ll-skip subtree. A guard
   * only: the form lookup never resolves such a form, so a submit naming
   * one is answered `form_not_found` and the agent learns nothing about it.
   */
  | "form_private";

/** Why the widget answered a request with `tool_error`. */
export type ToolErrorReason =
  /** The host's `capabilities` prop does not include the capability. */
  | "capability_blocked"
  /** Not even a minimal reply fits one data packet. */
  | "reply_too_large"
  /** Reading the page threw; there is nothing to send. */
  | "extraction_failed";

const decoder = new TextDecoder();

function localParticipantOf(room: unknown): DataPublisher | null {
  const lp = (room as { localParticipant?: unknown } | null | undefined)
    ?.localParticipant as { publishData?: unknown } | null | undefined;
  return lp && typeof lp.publishData === "function"
    ? (lp as DataPublisher)
    : null;
}

/** Run a Room getter, treating a throw as "no Room". */
function safeRoom(get: () => unknown): unknown {
  try {
    return get() ?? null;
  } catch {
    return null;
  }
}

/**
 * Hand an encoded reply to the host's publishData. The host takes an
 * object and encodes it itself, so the bytes are decoded back: the same
 * JSON, so the size check below holds for what the host sends.
 */
function publishThroughHost(
  host: PublishingHost,
  data: Uint8Array,
  label: string,
): Promise<boolean> {
  if (data.byteLength > MAX_DATA_PAYLOAD_BYTES) {
    console.warn(
      `[LiveLayer] ${label}: payload is ${data.byteLength} bytes, over the ` +
        `${MAX_DATA_PAYLOAD_BYTES} byte data-channel budget. Not sent.`,
    );
    return Promise.resolve(false);
  }
  const failed = (err: unknown) => {
    console.warn(`[LiveLayer] ${label}: controlledSession.publishData failed.`, err);
    return false;
  };
  try {
    const message = JSON.parse(decoder.decode(data)) as Record<string, unknown>;
    // A method call on the host, as the widget's sendData makes it: a
    // class-instance host's publishData may read `this`.
    return Promise.resolve(host.publishData(message)).then(() => true, failed);
  } catch (err) {
    return Promise.resolve(failed(err));
  }
}

/**
 * Pick the connection a reply goes out on, or null when there is none
 * (controlled mode with neither publishData nor a Room from getRoom, or
 * an uncontrolled session that is not connected).
 */
export function resolveReplySender(
  controlled: ReplyHost | null | undefined,
  internalRoom: (() => unknown) | undefined,
): ReplySender | null {
  if (controlled) {
    // Called as methods on `controlled`, never pulled off it: a host may
    // pass a class instance whose methods read `this`.
    if (typeof controlled.publishData === "function") {
      const host = controlled as PublishingHost;
      return {
        route: "host_publish",
        send: (data, label) => publishThroughHost(host, data, label),
      };
    }
    const lp = localParticipantOf(safeRoom(() => controlled.getRoom?.()));
    return lp
      ? { route: "host_room", send: (data, label) => publishReliable(lp, data, label) }
      : null;
  }
  const lp = localParticipantOf(safeRoom(() => internalRoom?.()));
  return lp
    ? { route: "room", send: (data, label) => publishReliable(lp, data, label) }
    : null;
}

/** Copy `message` with the command's requestId, when it has one. */
export function withRequestId(
  message: Record<string, unknown>,
  requestId: string | undefined,
): Record<string, unknown> {
  return requestId ? { ...message, requestId } : message;
}

/** The command's requestId, when it is a string. */
export function requestIdOf(cmd: Readonly<Record<string, unknown>>): string | undefined {
  return typeof cmd.requestId === "string" ? cmd.requestId : undefined;
}

/**
 * The answer to a submit_form the widget will not carry out. Same shape as
 * a validation block, so every worker reads it as "did not submit".
 */
export function submitRefusal(
  cmd: Readonly<Record<string, unknown>>,
  reason: SubmitRefusalReason,
): Record<string, unknown> {
  return withRequestId(
    {
      type: "form_submit_blocked",
      ...(typeof cmd.formId === "string" ? { formId: cmd.formId } : {}),
      reason,
      invalidFields: [],
    },
    requestIdOf(cmd),
  );
}

/**
 * The `tool_error` answer to a request the widget will not or cannot
 * serve, or null when the command has no requestId (nothing waits for it).
 */
export function toolErrorReply(
  cmd: Readonly<{ type: string } & Record<string, unknown>>,
  reason: ToolErrorReason,
  extra: Record<string, unknown> = {},
): Record<string, unknown> | null {
  const requestId = requestIdOf(cmd);
  if (!requestId) return null;
  return { type: "tool_error", requestId, command: cmd.type, reason, ...extra };
}

/** True for a Promise or any other thenable (another realm's Promise, a polyfill). */
export function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}
