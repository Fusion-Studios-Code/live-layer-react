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
// Refusals: the same protocol as the script-tag widget (@livelayer/sdk
// 0.10, src/page-tools/index.ts, live-layer-sdk#4), so the worker reads
// one shape whichever widget is on the page. A refused request is
// answered with its NORMAL reply type, plus
//
//   error:      why (ReplyError): "capability_blocked" when the host's
//               `capabilities` leave the capability out; this widget
//               also sends "reply_too_large" / "extraction_failed"
//   capability: the capability left out (capability_blocked only)
//   message:    a sentence for the LLM: what happened, and what to do
//
//   page_context: the refusal is repeated inside `context`, because the
//                 worker hands `context` to the LLM verbatim.
//   routes:       `routes: []`.
//   submit:       type form_submit_blocked with `reason` (see
//                 SubmitRefusalReason) and `invalidFields: []`; for
//                 capability_blocked the message is also the one
//                 invalidFields entry, which the worker prints ("Invalid
//                 field(s): …"), plus error / capability / message.
//
// Every worker already accepts these types, so a refusal resolves its
// wait at once instead of after 2 s / 6 s. Only these three requests are
// answered: navigate, fill_form and the other fire-and-forget commands
// have no reply type, and nothing waits for them.

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

/** The `error` of a refused page read (page_context / routes). */
export type ReplyError =
  /** The host's `capabilities` prop does not include the capability. */
  | "capability_blocked"
  /** Not even a minimal reply fits one data packet. */
  | "reply_too_large"
  /** Reading the page threw; there is nothing to send. */
  | "extraction_failed";

/** `error` of a reply refused because of the host's capability allowlist. */
export const CAPABILITY_BLOCKED = "capability_blocked";

// LLM-facing. Same wording as @livelayer/sdk 0.10 (page-tools/index.ts).
export const READ_PAGE_BLOCKED_MESSAGE =
  "Reading the page is turned off on this site (its widget leaves out the read_page capability), so you can't see the visitor's screen or list its links. " +
  "Don't call get_page_context or get_routes again; answer from what you already know or ask the visitor.";

export const ROUTES_BLOCKED_MESSAGE =
  "Reading the page is turned off on this site (its widget leaves out the read_page capability), so you can't list its links. " +
  "Don't call get_routes or get_page_context again; use a route from your instructions if one fits, otherwise ask the visitor.";

export const SUBMIT_BLOCKED_MESSAGE =
  "Submitting forms is turned off on this site (its widget leaves out the submit_forms capability), so nothing was sent. " +
  "Don't call submit_form again; tell the visitor you can't send it for them and ask them to press the form's own submit button.";

// React only (the script tag sends nothing / an empty list here).
export const PAGE_CONTEXT_TOO_LARGE_MESSAGE =
  "The visitor's page is too large to send in one message, even after trimming, so you can't see it this time. " +
  "Answer from what you already know or ask the visitor.";

export const ROUTES_TOO_LARGE_MESSAGE =
  "The page's link list is too large to send in one message, so you can't list its links this time. " +
  "Use a route from your instructions if one fits, otherwise ask the visitor.";

export const PAGE_CONTEXT_FAILED_MESSAGE =
  "The visitor's page could not be read this time. " +
  "Answer from what you already know or ask the visitor.";

export const ROUTES_FAILED_MESSAGE =
  "The page's links could not be read this time. " +
  "Use a route from your instructions if one fits, otherwise ask the visitor.";

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
 * The answer to a submit_form the widget will not carry out. Same type as
 * a validation block, so every worker reads it as "did not submit".
 * `formId` echoes the command's ("" when it had none), as the script tag
 * does.
 */
export function submitRefusal(
  cmd: Readonly<Record<string, unknown>>,
  reason: SubmitRefusalReason,
): Record<string, unknown> {
  const formId = typeof cmd.formId === "string" ? cmd.formId : "";
  const reply =
    reason === CAPABILITY_BLOCKED
      ? {
          type: "form_submit_blocked",
          formId,
          reason,
          // The worker prints invalidFields but not `message` (live-layer
          // ec34f9b3), so the refusal rides there too. It adds the period.
          invalidFields: [SUBMIT_BLOCKED_MESSAGE.replace(/\.$/, "")],
          error: CAPABILITY_BLOCKED,
          capability: "submit_forms",
          message: SUBMIT_BLOCKED_MESSAGE,
        }
      : { type: "form_submit_blocked", formId, reason, invalidFields: [] };
  return withRequestId(reply, requestIdOf(cmd));
}

/** The reply types of the two page reads (request_page_context, request_routes). */
export type PageReadReply = "page_context" | "routes";

const PAGE_READ_MESSAGES: Readonly<Record<PageReadReply, Readonly<Record<ReplyError, string>>>> = {
  page_context: {
    capability_blocked: READ_PAGE_BLOCKED_MESSAGE,
    reply_too_large: PAGE_CONTEXT_TOO_LARGE_MESSAGE,
    extraction_failed: PAGE_CONTEXT_FAILED_MESSAGE,
  },
  routes: {
    capability_blocked: ROUTES_BLOCKED_MESSAGE,
    reply_too_large: ROUTES_TOO_LARGE_MESSAGE,
    extraction_failed: ROUTES_FAILED_MESSAGE,
  },
};

/**
 * The answer to a page read the widget will not or cannot serve: its
 * normal reply type (`page_context` / `routes`) with error, capability
 * (capability_blocked only) and message. A page_context repeats the
 * refusal as its `context`; routes is `[]`.
 */
export function pageReadRefusal(
  type: PageReadReply,
  cmd: Readonly<Record<string, unknown>>,
  error: ReplyError,
): Record<string, unknown> {
  const refusal = {
    error,
    ...(error === CAPABILITY_BLOCKED ? { capability: "read_page" } : {}),
    message: PAGE_READ_MESSAGES[type][error],
  };
  const reply =
    type === "page_context"
      ? { type, ...refusal, context: refusal }
      : { type, ...refusal, routes: [] };
  return withRequestId(reply, requestIdOf(cmd));
}

/** True for a Promise or any other thenable (another realm's Promise, a polyfill). */
export function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}
