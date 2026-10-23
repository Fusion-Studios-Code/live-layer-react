import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isThenable,
  resolveReplySender,
  submitRefusal,
  toolErrorReply,
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
});

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

  it("keeps a submit refusal without a requestId (older workers match by type)", () => {
    expect(submitRefusal({ type: "submit_form", formId: "c" }, "capability_blocked")).toEqual({
      type: "form_submit_blocked",
      formId: "c",
      reason: "capability_blocked",
      invalidFields: [],
    });
  });

  it("builds tool_error with the request it answers", () => {
    expect(
      toolErrorReply({ type: "request_routes", requestId: "r2" }, "capability_blocked", {
        capability: "read_page",
      }),
    ).toEqual({
      type: "tool_error",
      requestId: "r2",
      command: "request_routes",
      reason: "capability_blocked",
      capability: "read_page",
    });
  });

  it("sends no tool_error for a command nothing waits for", () => {
    expect(toolErrorReply({ type: "navigate", href: "/" }, "capability_blocked")).toBeNull();
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
