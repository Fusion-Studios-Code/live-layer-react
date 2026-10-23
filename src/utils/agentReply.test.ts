import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isThenable,
  pageReadRefusal,
  PAGE_CONTEXT_TOO_LARGE_MESSAGE,
  READ_PAGE_BLOCKED_MESSAGE,
  resolveReplySender,
  ROUTES_BLOCKED_MESSAGE,
  ROUTES_FAILED_MESSAGE,
  SUBMIT_BLOCKED_MESSAGE,
  submitRefusal,
} from "./agentReply";
import { MAX_DATA_PAYLOAD_BYTES } from "./dataPayload";

const encode = (msg: unknown) => new TextEncoder().encode(JSON.stringify(msg));

function room() {
  const publishData = vi.fn(async (_d: Uint8Array, _o: unknown) => {});
  return { room: { localParticipant: { publishData } }, publishData };
}

describe("resolveReplySender", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the internal session's Room when not controlled", async () => {
    const internal = room();
    const sender = resolveReplySender(undefined, () => internal.room);
    expect(sender?.route).toBe("room");
    await expect(sender!.send(encode({ type: "routes" }), "t")).resolves.toBe(true);
    expect(internal.publishData).toHaveBeenCalledTimes(1);
    expect(internal.publishData.mock.calls[0][1]).toEqual({ reliable: true });
  });

  it("returns null when the internal session has no Room", () => {
    expect(resolveReplySender(undefined, () => null)).toBeNull();
  });

  it("never falls back to the internal Room in controlled mode", () => {
    const internal = room();
    expect(resolveReplySender({}, () => internal.room)).toBeNull();
    expect(resolveReplySender({ getRoom: () => null }, () => internal.room)).toBeNull();
  });

  it("uses the controlled Room from getRoom() when there is no publishData", async () => {
    const internal = room();
    const host = room();
    const sender = resolveReplySender({ getRoom: () => host.room }, () => internal.room);
    expect(sender?.route).toBe("host_room");
    await sender!.send(encode({ type: "routes" }), "t");
    expect(host.publishData).toHaveBeenCalledTimes(1);
    expect(internal.publishData).not.toHaveBeenCalled();
  });

  it("treats a throwing getRoom() as no Room", () => {
    const sender = resolveReplySender(
      {
        getRoom: () => {
          throw new Error("not ready");
        },
      },
      () => null,
    );
    expect(sender).toBeNull();
  });

  it("prefers the host's publishData and hands it the decoded object", async () => {
    const host = room();
    const publishData = vi.fn();
    const sender = resolveReplySender({ publishData, getRoom: () => host.room }, () => null);
    expect(sender?.route).toBe("host_publish");
    const msg = { type: "page_context", requestId: "r1", context: { pathname: "/é" } };
    await expect(sender!.send(encode(msg), "t")).resolves.toBe(true);
    expect(publishData).toHaveBeenCalledWith(msg);
    expect(host.publishData).not.toHaveBeenCalled();
  });

  it("does not hand the host a payload over the data-channel budget", async () => {
    const publishData = vi.fn();
    const sender = resolveReplySender({ publishData }, () => null)!;
    const big = encode({ type: "routes", pad: "x".repeat(MAX_DATA_PAYLOAD_BYTES) });
    await expect(sender.send(big, "request_routes")).resolves.toBe(false);
    expect(publishData).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("over the"));
  });

  it("catches a host publishData that throws or rejects", async () => {
    const err = new Error("gone");
    const throwing = resolveReplySender(
      {
        publishData: () => {
          throw err;
        },
      },
      () => null,
    )!;
    await expect(throwing.send(encode({ type: "routes" }), "a")).resolves.toBe(false);
    const rejecting = resolveReplySender({ publishData: () => Promise.reject(err) }, () => null)!;
    await expect(rejecting.send(encode({ type: "routes" }), "b")).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith("[LiveLayer] a: controlledSession.publishData failed.", err);
    expect(warn).toHaveBeenCalledWith("[LiveLayer] b: controlledSession.publishData failed.", err);
  });

  // A host may pass a class instance whose methods read `this`. The widget
  // calls sendData and typed messages as methods on the session, so replies
  // must be method calls too, or they throw while everything else the host
  // sends works.
  class HostRoomSession {
    constructor(protected readonly room: unknown) {}
    getRoom() {
      return this.room;
    }
  }
  class HostPublishSession extends HostRoomSession {
    sent: Record<string, unknown>[] = [];
    publishData(data: Record<string, unknown>) {
      this.sent.push(data);
    }
  }

  it("calls a class-instance host's publishData as a method", async () => {
    const host = new HostPublishSession(null);
    const sender = resolveReplySender(host, () => null)!;
    expect(sender.route).toBe("host_publish");
    const msg = { type: "page_context", requestId: "r1", context: {} };
    await expect(sender.send(encode(msg), "t")).resolves.toBe(true);
    expect(host.sent).toEqual([msg]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("calls a class-instance host's getRoom as a method", async () => {
    const r = room();
    const sender = resolveReplySender(new HostRoomSession(r.room), () => null);
    expect(sender?.route).toBe("host_room");
    await expect(sender!.send(encode({ type: "routes" }), "t")).resolves.toBe(true);
    expect(r.publishData).toHaveBeenCalledTimes(1);
  });
});

// The script-tag widget's protocol (@livelayer/sdk 0.10, page-tools/index.ts):
// the normal reply type, plus error / capability / message.
describe("refusal shapes", () => {
  it("answers a refused submit with form_submit_blocked, which every worker reads as not submitted", () => {
    expect(
      submitRefusal({ type: "submit_form", formId: "contact", requestId: "r1" }, "form_not_found"),
    ).toEqual({
      type: "form_submit_blocked",
      formId: "contact",
      reason: "form_not_found",
      invalidFields: [],
      requestId: "r1",
    });
  });

  it("echoes an empty formId when the command had none, as the script tag does", () => {
    expect(submitRefusal({ type: "submit_form", requestId: "r0" }, "missing_form_id")).toEqual({
      type: "form_submit_blocked",
      formId: "",
      reason: "missing_form_id",
      invalidFields: [],
      requestId: "r0",
    });
  });

  it("carries a blocked submit's message in invalidFields, which the worker prints", () => {
    expect(submitRefusal({ type: "submit_form", formId: "c" }, "capability_blocked")).toEqual({
      type: "form_submit_blocked",
      formId: "c",
      reason: "capability_blocked",
      invalidFields: [SUBMIT_BLOCKED_MESSAGE.slice(0, -1)],
      error: "capability_blocked",
      capability: "submit_forms",
      message: SUBMIT_BLOCKED_MESSAGE,
    });
  });

  it("answers a blocked page read with page_context, the refusal repeated as its context", () => {
    const refusal = {
      error: "capability_blocked",
      capability: "read_page",
      message: READ_PAGE_BLOCKED_MESSAGE,
    };
    expect(
      pageReadRefusal("page_context", { type: "request_page_context", requestId: "r2" }, "capability_blocked"),
    ).toEqual({ type: "page_context", ...refusal, context: refusal, requestId: "r2" });
  });

  it("answers a blocked routes read with an empty routes list", () => {
    expect(
      pageReadRefusal("routes", { type: "request_routes", requestId: "r3" }, "capability_blocked"),
    ).toEqual({
      type: "routes",
      error: "capability_blocked",
      capability: "read_page",
      message: ROUTES_BLOCKED_MESSAGE,
      routes: [],
      requestId: "r3",
    });
  });

  it("names no capability when the read failed for another reason", () => {
    expect(pageReadRefusal("page_context", { type: "request_page_context" }, "reply_too_large")).toEqual({
      type: "page_context",
      error: "reply_too_large",
      message: PAGE_CONTEXT_TOO_LARGE_MESSAGE,
      context: { error: "reply_too_large", message: PAGE_CONTEXT_TOO_LARGE_MESSAGE },
    });
    expect(pageReadRefusal("routes", { type: "request_routes", requestId: "r4" }, "extraction_failed")).toEqual({
      type: "routes",
      error: "extraction_failed",
      message: ROUTES_FAILED_MESSAGE,
      routes: [],
      requestId: "r4",
    });
  });

  it("uses the script tag's wording for the capability refusals", () => {
    // Byte-for-byte the strings in @livelayer/sdk 0.10 page-tools/index.ts,
    // so the agent hears the same refusal whichever widget is on the page.
    expect(READ_PAGE_BLOCKED_MESSAGE).toBe(
      "Reading the page is turned off on this site (its widget leaves out the read_page capability), so you can't see the visitor's screen or list its links. Don't call get_page_context or get_routes again; answer from what you already know or ask the visitor.",
    );
    expect(ROUTES_BLOCKED_MESSAGE).toBe(
      "Reading the page is turned off on this site (its widget leaves out the read_page capability), so you can't list its links. Don't call get_routes or get_page_context again; use a route from your instructions if one fits, otherwise ask the visitor.",
    );
    expect(SUBMIT_BLOCKED_MESSAGE).toBe(
      "Submitting forms is turned off on this site (its widget leaves out the submit_forms capability), so nothing was sent. Don't call submit_form again; tell the visitor you can't send it for them and ask them to press the form's own submit button.",
    );
  });
});

describe("isThenable", () => {
  it("accepts promises and promise-likes only", () => {
    expect(isThenable(Promise.resolve(1))).toBe(true);
    expect(isThenable({ then: () => {} })).toBe(true);
    expect(isThenable({ url: "/" })).toBe(false);
    expect(isThenable(null)).toBe(false);
    expect(isThenable(undefined)).toBe(false);
  });
});
