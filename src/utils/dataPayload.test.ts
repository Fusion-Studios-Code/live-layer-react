import { describe, it, expect, vi, afterEach } from "vitest";
import {
  LIVEKIT_MAX_DATA_PACKET_BYTES,
  MAX_DATA_PAYLOAD_BYTES,
  MAX_PAGE_CONTEXT_EXTRAS_BYTES,
  capPageContextExtras,
  encodePageContextReply,
  encodeRoutesReply,
  publishJsonReliable,
  publishReliable,
  truncateToBytes,
} from "./dataPayload";

const bytes = (s: string) => new TextEncoder().encode(s).byteLength;
const decode = (data: Uint8Array) =>
  JSON.parse(new TextDecoder().decode(data)) as Record<string, any>;

function pageContext(overrides: Record<string, unknown> = {}) {
  return {
    url: "https://example.com/pricing",
    title: "Pricing",
    pathname: "/pricing",
    regions: [{ id: "hero", text: "Plans for every team" }],
    visibleText: "Plans for every team.",
    visibleLinks: [{ href: "/contact", text: "Contact" }],
    visibleFields: [{ label: "Email", type: "email" }],
    forms: [
      {
        id: "contact",
        fields: [
          { name: "email", label: "Email", type: "email" },
          {
            name: "topic",
            label: "Topic",
            type: "select",
            options: [{ value: "sales", label: "Sales" }],
          },
        ],
      },
    ],
    ...overrides,
  };
}

function bigForm(id: string, optionLabelBytes: number) {
  return {
    id,
    fields: Array.from({ length: 30 }, (_, i) => ({
      name: `f${i}`,
      label: `Field ${i}`,
      type: "select",
      options: Array.from({ length: 20 }, (_, j) => ({
        value: `v${j}`,
        label: "o".repeat(optionLabelBytes),
      })),
    })),
  };
}

describe("budget constants", () => {
  it("leave headroom under livekit-client's 64,000-byte packet clamp", () => {
    expect(LIVEKIT_MAX_DATA_PACKET_BYTES).toBe(64_000);
    expect(MAX_DATA_PAYLOAD_BYTES).toBeLessThan(LIVEKIT_MAX_DATA_PACKET_BYTES);
    expect(MAX_PAGE_CONTEXT_EXTRAS_BYTES).toBeLessThan(MAX_DATA_PAYLOAD_BYTES);
  });
});

describe("truncateToBytes", () => {
  it("returns short strings unchanged", () => {
    expect(truncateToBytes("hello", 10)).toBe("hello");
  });

  it("cuts long strings to the byte budget with an ellipsis", () => {
    const out = truncateToBytes("a".repeat(100), 20);
    expect(bytes(out)).toBeLessThanOrEqual(20);
    expect(out.endsWith("…")).toBe(true);
  });

  it("never splits a multi-byte character", () => {
    // Each emoji is 4 bytes; a 10-byte budget leaves 7 for content.
    const out = truncateToBytes("😀😀😀😀😀", 10);
    expect(bytes(out)).toBeLessThanOrEqual(10);
    expect(out).toBe("😀…");
    expect(out).not.toContain("�");
  });
});

describe("capPageContextExtras", () => {
  it("passes small extras through untouched", () => {
    const extras = { plan: "pro", seats: 4 };
    const out = capPageContextExtras(extras, 1_000);
    expect(out.truncated).toBe(false);
    expect(out.extras).toBe(extras);
  });

  it("keeps keys in order while they fit and cuts the string that overflows", () => {
    const out = capPageContextExtras(
      { plan: "pro", catalog: "x".repeat(5_000), later: "kept if room" },
      1_000,
    );
    expect(out.truncated).toBe(true);
    expect(out.extras.plan).toBe("pro");
    expect(typeof out.extras.catalog).toBe("string");
    expect((out.extras.catalog as string).endsWith("…")).toBe(true);
    expect(bytes(JSON.stringify(out.extras))).toBeLessThanOrEqual(1_000);
  });

  it("drops non-string values that do not fit", () => {
    const out = capPageContextExtras(
      { plan: "pro", rows: Array.from({ length: 500 }, (_, i) => ({ i })) },
      200,
    );
    expect(out.extras).toEqual({ plan: "pro" });
    expect(out.truncated).toBe(true);
  });

  it("accounts for JSON escaping when cutting a string", () => {
    const out = capPageContextExtras({ text: "\n".repeat(5_000) }, 500);
    expect(bytes(JSON.stringify(out.extras))).toBeLessThanOrEqual(500);
    expect((out.extras.text as string).length).toBeGreaterThan(0);
  });

  it("drops values that cannot be serialized instead of failing the reply", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const out = capPageContextExtras({ plan: "pro", cyclic, big: BigInt(1) });
    expect(out.extras).toEqual({ plan: "pro" });
    expect(out.truncated).toBe(true);
  });
});

describe("encodePageContextReply", () => {
  it("encodes a normal reply unchanged", () => {
    const reply = { type: "page_context", context: pageContext(), requestId: "r1" };
    const out = encodePageContextReply(reply)!;
    expect(out.truncated).toEqual([]);
    expect(decode(out.data)).toEqual(reply);
  });

  it("caps oversized extras and says so, keeping the rest of the context", () => {
    const reply = {
      type: "page_context",
      requestId: "r1",
      context: pageContext({
        extras: { plan: "pro", catalog: "x".repeat(200_000) },
      }),
    };
    const out = encodePageContextReply(reply)!;
    expect(out.data.byteLength).toBeLessThanOrEqual(MAX_DATA_PAYLOAD_BYTES);
    const msg = decode(out.data);
    expect(msg.type).toBe("page_context");
    expect(msg.requestId).toBe("r1");
    expect(msg.context.extras.plan).toBe("pro");
    expect(bytes(JSON.stringify(msg.context.extras))).toBeLessThanOrEqual(
      MAX_PAGE_CONTEXT_EXTRAS_BYTES,
    );
    expect(msg.context.truncated).toEqual(["extras"]);
    expect(msg.context.forms).toEqual(pageContext().forms);
    expect(msg.context.visibleLinks).toEqual(pageContext().visibleLinks);
  });

  it("sheds the cheapest sections first and keeps forms when it can", () => {
    // Ten 30-field forms with 20 long option labels each: ~400 KB, all of
    // it in options. Dropping the options alone brings it under budget.
    const forms = Array.from({ length: 10 }, (_, i) => bigForm(`form${i}`, 60));
    const reply = { type: "page_context", context: pageContext({ forms }) };
    expect(bytes(JSON.stringify(reply))).toBeGreaterThan(MAX_DATA_PAYLOAD_BYTES);

    const out = encodePageContextReply(reply)!;
    expect(out.data.byteLength).toBeLessThanOrEqual(MAX_DATA_PAYLOAD_BYTES);
    const msg = decode(out.data);
    expect(msg.context.truncated).toEqual(["visibleLinks", "visibleFields", "formOptions"]);
    expect(msg.context.forms).toHaveLength(10);
    expect(msg.context.forms[0].fields[0]).toEqual({
      name: "f0",
      label: "Field 0",
      type: "select",
    });
    expect(msg.context.regions).toEqual(pageContext().regions);
  });

  it("drops forms from the end when nothing else is left to cut", () => {
    const forms = Array.from({ length: 8 }, (_, i) => ({
      id: `form${i}`,
      intent: "i".repeat(10_000),
      fields: [],
    }));
    const reply = { type: "page_context", context: pageContext({ forms }) };
    const out = encodePageContextReply(reply)!;
    expect(out.data.byteLength).toBeLessThanOrEqual(MAX_DATA_PAYLOAD_BYTES);
    const msg = decode(out.data);
    expect(msg.context.truncated).toContain("forms");
    expect(msg.context.forms.length).toBeGreaterThan(0);
    expect(msg.context.forms.length).toBeLessThan(8);
    expect(msg.context.forms[0].id).toBe("form0");
  });

  it("falls back to url, title and pathname for an unshrinkable custom context", () => {
    const reply = {
      type: "page_context",
      requestId: "r2",
      context: { ...pageContext(), custom: "z".repeat(100_000) },
    };
    const out = encodePageContextReply(reply)!;
    expect(out.data.byteLength).toBeLessThanOrEqual(MAX_DATA_PAYLOAD_BYTES);
    const msg = decode(out.data);
    expect(msg.requestId).toBe("r2");
    expect(msg.context).toMatchObject({
      url: "https://example.com/pricing",
      title: "Pricing",
      pathname: "/pricing",
      forms: [],
    });
    expect(msg.context.truncated[msg.context.truncated.length - 1]).toBe("all");
  });

  it("falls back instead of failing when the context cannot be serialized", () => {
    const ctx: Record<string, unknown> = { ...pageContext() };
    ctx.loop = ctx;
    const out = encodePageContextReply({ type: "page_context", context: ctx })!;
    expect(decode(out.data).context.truncated).toContain("all");
  });

  it("does not mutate the context it was given (the walker caches it)", () => {
    const deepFreeze = <T,>(o: T): T => {
      if (o && typeof o === "object") {
        Object.values(o).forEach(deepFreeze);
        Object.freeze(o);
      }
      return o;
    };
    const forms = Array.from({ length: 10 }, (_, i) => bigForm(`form${i}`, 60));
    const context = deepFreeze(
      pageContext({ forms, extras: { blob: "x".repeat(100_000) } }),
    );
    const before = JSON.stringify(context);
    const out = encodePageContextReply({ type: "page_context", context });
    expect(out).not.toBeNull();
    expect(JSON.stringify(context)).toBe(before);
  });

  it("honours a custom byte budget", () => {
    const reply = { type: "page_context", context: pageContext() };
    const out = encodePageContextReply(reply, { maxBytes: 300 })!;
    expect(out.data.byteLength).toBeLessThanOrEqual(300);
  });
});

describe("encodeRoutesReply", () => {
  it("sends every route when they fit", () => {
    const routes = [{ href: "/a" }, { href: "/b" }];
    const out = encodeRoutesReply({ type: "routes", requestId: "r" }, routes)!;
    expect(out.dropped).toBe(0);
    expect(decode(out.data)).toEqual({ type: "routes", requestId: "r", routes });
  });

  it("keeps the longest prefix of routes that fits", () => {
    const routes = Array.from({ length: 200 }, (_, i) => ({
      href: `/p/${i}`,
      text: `Page ${i}`,
      internal: true,
      description: "d".repeat(1_000),
    }));
    const out = encodeRoutesReply({ type: "routes" }, routes)!;
    expect(out.data.byteLength).toBeLessThanOrEqual(MAX_DATA_PAYLOAD_BYTES);
    const sent = decode(out.data).routes as unknown[];
    expect(sent.length + out.dropped).toBe(200);
    expect(out.dropped).toBeGreaterThan(0);
    expect(sent).toEqual(routes.slice(0, sent.length));
    // One more route would not have fitted.
    const oneMore = JSON.stringify({ type: "routes", routes: routes.slice(0, sent.length + 1) });
    expect(bytes(oneMore)).toBeGreaterThan(MAX_DATA_PAYLOAD_BYTES);
  });
});

describe("publishReliable", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("publishes on the reliable channel and resolves true", async () => {
    const publishData = vi.fn().mockResolvedValue(undefined);
    const data = new Uint8Array([1, 2, 3]);
    await expect(publishReliable({ publishData }, data, "t")).resolves.toBe(true);
    expect(publishData).toHaveBeenCalledWith(data, { reliable: true });
  });

  it("catches a rejected publish (e.g. PublishDataError) and logs it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = Object.assign(new Error("cannot publish data packet larger than 64000 bytes"), {
      name: "PublishDataError",
    });
    const publishData = vi.fn().mockRejectedValue(err);
    await expect(
      publishReliable({ publishData }, new Uint8Array([1]), "page"),
    ).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith("[LiveLayer] page: publishData failed.", err);
  });

  it("catches a synchronous throw", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const publishData = vi.fn(() => {
      throw new Error("not connected");
    });
    await expect(
      publishReliable({ publishData }, new Uint8Array([1]), "page"),
    ).resolves.toBe(false);
  });

  it("does not send a payload over the budget", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const publishData = vi.fn();
    const data = new Uint8Array(MAX_DATA_PAYLOAD_BYTES + 1);
    await expect(publishReliable({ publishData }, data, "big")).resolves.toBe(false);
    expect(publishData).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it("publishJsonReliable refuses a message that cannot be serialized", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const publishData = vi.fn();
    await expect(
      publishJsonReliable({ publishData }, { n: BigInt(1) }, "bad"),
    ).resolves.toBe(false);
    expect(publishData).not.toHaveBeenCalled();
  });
});
