// ─── dataPayload ──────────────────────────────────────────────────────
// Keeps the widget's data-channel replies under LiveKit's message ceiling,
// and turns a failed publish into a console warning instead of an
// unhandled promise rejection.
//
// livekit-client 2.20+ refuses to send a data packet larger than the
// negotiated SCTP max message size, clamped to 64,000 B, and rejects
// publishData() with PublishDataError. The limit applies to the whole
// encoded DataPacket (payload plus sender identity, topic and framing),
// so the payload budget below leaves headroom for that envelope. Older
// clients did not deliver such packets end to end either, so this is the
// real limit, not a client quirk.
//
// Page-context replies are the payload that can grow without bound: the
// DOM walker caps its own text, but host-supplied `pageContextExtras`, a
// custom `getPageContext`, and pages with many large forms are not
// capped. A reply that is too big used to be dropped, so the agent's
// get_page_context call timed out with no context at all. Now the reply
// is trimmed to fit and lists what was cut in `context.truncated`.

/** livekit-client's ceiling for one data packet (RTCEngine DEFAULT_MAX_MESSAGE_SIZE). */
export const LIVEKIT_MAX_DATA_PACKET_BYTES = 64_000;

/** Payload budget: the packet ceiling minus headroom for the DataPacket envelope. */
export const MAX_DATA_PAYLOAD_BYTES = 60_000;

/** Budget for host-supplied `pageContextExtras` inside one page_context reply. */
export const MAX_PAGE_CONTEXT_EXTRAS_BYTES = 16_000;

/** visibleText is cut to this many bytes when a reply has to shrink. */
const SHRUNK_VISIBLE_TEXT_BYTES = 2_000;

/** A string extra is truncated rather than dropped only if this much room is left. */
const MIN_TRUNCATED_STRING_BYTES = 64;

const ELLIPSIS = "…";
const ELLIPSIS_BYTES = 3;

const encoder = new TextEncoder();

function byteLength(text: string): number {
  return encoder.encode(text).byteLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** JSON.stringify that returns undefined for cycles, BigInt and other throws. */
function safeStringify(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function tryEncode(value: unknown): Uint8Array | null {
  const json = safeStringify(value);
  return json === undefined ? null : encoder.encode(json);
}

/** JSON-encode a message to UTF-8, or null when it cannot be serialized. */
export function encodeJson(message: Record<string, unknown>): Uint8Array | null {
  return tryEncode(message);
}

/** Cut a string to at most `maxBytes` UTF-8 bytes, ending with an ellipsis. */
export function truncateToBytes(text: string, maxBytes: number): string {
  const bytes = encoder.encode(text);
  if (bytes.byteLength <= maxBytes) return text;
  if (maxBytes < ELLIPSIS_BYTES) return "";
  // Decoding a prefix can split a multi-byte character; the decoder turns
  // the partial character into U+FFFD, which is dropped here.
  const prefix = new TextDecoder()
    .decode(bytes.subarray(0, maxBytes - ELLIPSIS_BYTES))
    .replace(/�+$/, "");
  return prefix + ELLIPSIS;
}

/**
 * Fit `pageContextExtras` into `maxBytes` of JSON. Keys are kept in
 * insertion order while they fit; a string that does not fit is cut when
 * there is reasonable room left, anything else is dropped. Values that
 * cannot be serialized (BigInt, cycles) are dropped too, since they would
 * otherwise make the whole reply fail to encode.
 */
export function capPageContextExtras(
  extras: Record<string, unknown>,
  maxBytes: number = MAX_PAGE_CONTEXT_EXTRAS_BYTES,
): { extras: Record<string, unknown>; truncated: boolean } {
  const whole = safeStringify(extras);
  if (whole !== undefined && byteLength(whole) <= maxBytes) {
    return { extras, truncated: false };
  }

  const out: Record<string, unknown> = {};
  let used = 2; // "{}"
  for (const [key, value] of Object.entries(extras)) {
    const json = safeStringify(value);
    if (json === undefined) continue;
    // `"key":` plus a separating comma.
    const keyBytes = byteLength(JSON.stringify(key)) + 2;
    const valueBytes = byteLength(json);
    if (used + keyBytes + valueBytes <= maxBytes) {
      out[key] = value;
      used += keyBytes + valueBytes;
      continue;
    }
    if (typeof value !== "string") continue;
    // Room for the JSON-encoded string, quotes included. Escapes (\n, \",
    // control characters) make the encoded form longer than the raw text,
    // so scale the raw budget down by the overshoot until it fits.
    const room = maxBytes - used - keyBytes;
    let budget = room - 2;
    while (budget >= MIN_TRUNCATED_STRING_BYTES) {
      const cut = truncateToBytes(value, budget);
      const cutBytes = byteLength(JSON.stringify(cut));
      if (cutBytes <= room) {
        out[key] = cut;
        used += keyBytes + cutBytes;
        break;
      }
      budget = Math.min(budget - 1, Math.floor((budget * room) / cutBytes));
    }
  }
  return { extras: out, truncated: true };
}

type FormsList = Array<Record<string, unknown>>;

/**
 * Ways to shrink a page context, cheapest loss first. Each returns true
 * when it changed something. Forms come last because the agent needs them
 * for fill_form / submit_form; visibleFields repeats what forms carry, and
 * the agent can list pages with get_routes when visibleLinks is cut.
 */
const SHRINK_STEPS: Array<{
  label: string;
  apply: (ctx: Record<string, unknown>) => boolean;
}> = [
  {
    label: "visibleLinks",
    apply: (ctx) => clearArray(ctx, "visibleLinks"),
  },
  {
    label: "visibleFields",
    apply: (ctx) => clearArray(ctx, "visibleFields"),
  },
  {
    label: "formOptions",
    apply: (ctx) => {
      if (!Array.isArray(ctx.forms)) return false;
      let changed = false;
      ctx.forms = (ctx.forms as FormsList).map((form) => {
        if (!isRecord(form) || !Array.isArray(form.fields)) return form;
        return {
          ...form,
          fields: (form.fields as unknown[]).map((field) => {
            if (!isRecord(field) || !("options" in field)) return field;
            changed = true;
            const { options: _dropped, ...rest } = field;
            return rest;
          }),
        };
      });
      return changed;
    },
  },
  {
    label: "visibleText",
    apply: (ctx) => {
      if (typeof ctx.visibleText !== "string") return false;
      const cut = truncateToBytes(ctx.visibleText, SHRUNK_VISIBLE_TEXT_BYTES);
      if (cut === ctx.visibleText) return false;
      ctx.visibleText = cut;
      return true;
    },
  },
  {
    label: "extras",
    apply: (ctx) => {
      if (ctx.extras === undefined) return false;
      delete ctx.extras;
      return true;
    },
  },
  {
    label: "regions",
    apply: (ctx) => clearArray(ctx, "regions"),
  },
];

function clearArray(ctx: Record<string, unknown>, key: string): boolean {
  const value = ctx[key];
  if (!Array.isArray(value) || value.length === 0) return false;
  ctx[key] = [];
  return true;
}

function stringField(value: unknown, maxBytes: number, fallback = ""): string {
  return typeof value === "string" ? truncateToBytes(value, maxBytes) : fallback;
}

/**
 * Encode a `page_context` reply so it fits one data packet.
 *
 * `pageContextExtras` is always held to `maxExtrasBytes`. If the reply is
 * still over `maxBytes`, it sheds sections in SHRINK_STEPS order, then
 * forms from the end of the list, and as a last resort sends only the
 * url, title and pathname. Whatever was cut is listed in
 * `context.truncated` so the agent knows the snapshot is partial.
 *
 * Returns null only if not even the minimal reply fits.
 */
export function encodePageContextReply(
  reply: Record<string, unknown>,
  limits: { maxBytes?: number; maxExtrasBytes?: number } = {},
): { data: Uint8Array; truncated: string[] } | null {
  const maxBytes = limits.maxBytes ?? MAX_DATA_PAYLOAD_BYTES;
  const maxExtrasBytes = limits.maxExtrasBytes ?? MAX_PAGE_CONTEXT_EXTRAS_BYTES;

  if (!isRecord(reply.context)) {
    const data = tryEncode(reply);
    return data && data.byteLength <= maxBytes ? { data, truncated: [] } : null;
  }

  const ctx: Record<string, unknown> = { ...reply.context };
  const truncated: string[] = [];
  const mark = (label: string) => {
    if (!truncated.includes(label)) truncated.push(label);
  };
  const attempt = () => {
    const context = truncated.length > 0 ? { ...ctx, truncated: [...truncated] } : ctx;
    const data = tryEncode({ ...reply, context });
    return data && data.byteLength <= maxBytes ? data : null;
  };

  if (isRecord(ctx.extras)) {
    const capped = capPageContextExtras(ctx.extras, maxExtrasBytes);
    if (capped.truncated) {
      ctx.extras = capped.extras;
      mark("extras");
    }
  }

  let data = attempt();
  if (data) return { data, truncated };

  for (const step of SHRINK_STEPS) {
    if (!step.apply(ctx)) continue;
    mark(step.label);
    data = attempt();
    if (data) return { data, truncated };
  }

  if (Array.isArray(ctx.forms) && ctx.forms.length > 0) {
    mark("forms");
    const forms = [...(ctx.forms as unknown[])];
    while (forms.length > 0) {
      forms.pop();
      ctx.forms = [...forms];
      data = attempt();
      if (data) return { data, truncated };
    }
  }

  // Last resort: where the visitor is, and nothing else.
  mark("all");
  const minimal = {
    url: stringField(ctx.url, 2_000),
    title: stringField(ctx.title, 500),
    pathname: stringField(ctx.pathname, 2_000, "/"),
    regions: [],
    visibleText: "",
    visibleLinks: [],
    visibleFields: [],
    forms: [],
    truncated: [...truncated],
  };
  data = tryEncode({ ...reply, context: minimal });
  return data && data.byteLength <= maxBytes ? { data, truncated } : null;
}

/**
 * Encode a `routes` reply so it fits one data packet, keeping as many
 * routes from the front of the list as fit.
 */
export function encodeRoutesReply(
  reply: Record<string, unknown>,
  routes: unknown[],
  maxBytes: number = MAX_DATA_PAYLOAD_BYTES,
): { data: Uint8Array; dropped: number } | null {
  const encodeWith = (count: number) => {
    const data = tryEncode({ ...reply, routes: routes.slice(0, count) });
    return data && data.byteLength <= maxBytes ? data : null;
  };
  const full = encodeWith(routes.length);
  if (full) return { data: full, dropped: 0 };
  // Largest prefix that fits, by binary search.
  let lo = 0;
  let hi = routes.length - 1;
  let best = encodeWith(0);
  let bestCount = 0;
  if (!best) return null;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const data = encodeWith(mid);
    if (data) {
      best = data;
      bestCount = mid;
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return { data: best, dropped: routes.length - bestCount };
}

/** The slice of a LiveKit LocalParticipant this module needs. */
export interface DataPublisher {
  // Method syntax keeps the parameter bivariant, so livekit-client's
  // LocalParticipant (which takes a narrower Uint8Array) is assignable.
  publishData(data: Uint8Array, options: { reliable: boolean }): unknown;
}

/**
 * Publish bytes on the reliable data channel without letting a failure
 * escape as an unhandled rejection. Oversized payloads are not sent (the
 * client would reject them anyway). Resolves true when the publish
 * succeeded, false otherwise; never rejects.
 */
export function publishReliable(
  publisher: DataPublisher,
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
    console.warn(`[LiveLayer] ${label}: publishData failed.`, err);
    return false;
  };
  try {
    return Promise.resolve(publisher.publishData(data, { reliable: true })).then(
      () => true,
      failed,
    );
  } catch (err) {
    return Promise.resolve(failed(err));
  }
}

/** JSON-encode a message and publish it with {@link publishReliable}. */
export function publishJsonReliable(
  publisher: DataPublisher,
  message: Record<string, unknown>,
  label: string,
): Promise<boolean> {
  const data = tryEncode(message);
  if (!data) {
    console.warn(`[LiveLayer] ${label}: message could not be serialized. Not sent.`);
    return Promise.resolve(false);
  }
  return publishReliable(publisher, data, label);
}
