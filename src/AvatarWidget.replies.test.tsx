// The widget's answers to the agent's requests (request_page_context,
// request_routes, submit_form): they reach the agent in controlled mode,
// and a request the widget refuses is answered instead of left to time out.
//
// The internal LiveKit session hook is replaced with a stub whose Room has
// its own publishData spy, so a test can tell which connection a reply
// went out on. In controlled mode a reply must go through the host's
// controlledSession, never through the widget's internal session (in a
// real controlled mount that session never connects).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, waitFor } from "@testing-library/react";
import { AvatarWidget, type ControlledSession } from "./AvatarWidget";
import { clearPageContextCache } from "./utils/extractPageContext";
import { clearRoutesCache } from "./utils/extractRoutes";
import { MAX_DATA_PAYLOAD_BYTES } from "./utils/dataPayload";
import {
  READ_PAGE_BLOCKED_MESSAGE,
  ROUTES_BLOCKED_MESSAGE,
  SUBMIT_BLOCKED_MESSAGE,
} from "./utils/agentReply";

type DataHandler = (msg: Record<string, unknown>) => void;
type PublishSpy = ReturnType<typeof vi.fn>;

const internal = vi.hoisted(() => ({
  onDataMessage: null as DataHandler | null,
  publishData: null as null | ((data: Uint8Array, opts: unknown) => Promise<void>),
}));

vi.mock("./hooks/useLiveKitSession", () => ({
  useLiveKitSession: (opts: { onDataMessage?: DataHandler }) => {
    if (opts.onDataMessage) internal.onDataMessage = opts.onDataMessage;
    return {
      connectionState: "idle",
      agentState: "idle",
      transcript: [],
      agentConfig: null,
      videoElement: null,
      audioElement: null,
      canResume: false,
      error: null,
      connect: async () => {},
      disconnect: () => {},
      getRoom: () => ({
        localParticipant: {
          publishData: (data: Uint8Array, o: unknown) => internal.publishData!(data, o),
        },
      }),
      session: null,
    };
  },
}));

const decode = (data: Uint8Array) =>
  JSON.parse(new TextDecoder().decode(data)) as Record<string, any>;

/** Every reply a host Room's publishData spy received, decoded. */
const roomReplies = (spy: PublishSpy) =>
  spy.mock.calls.map(([data]) => decode(data as Uint8Array));

/** Every reply a host publishData spy received. */
const hostReplies = (spy: PublishSpy) =>
  spy.mock.calls.map(([msg]) => msg as Record<string, any>);

function hostRoom() {
  const publishData = vi.fn(async (_data: Uint8Array, _opts: unknown) => {});
  return { room: { localParticipant: { publishData } }, publishData };
}

function makeControlledSession(overrides: Partial<ControlledSession> = {}) {
  let subscriber: DataHandler | null = null;
  // Left idle: replies do not depend on the connection state, and a
  // connected session also binds the camera / screen-share hooks to the
  // host Room, which these fakes do not implement.
  const session: ControlledSession = {
    connectionState: "idle",
    agentState: "idle",
    transcript: [],
    videoElement: null,
    audioElement: null,
    canResume: false,
    error: null,
    onConnect: vi.fn(),
    onDisconnect: vi.fn(),
    subscribeToDataMessages: (cb) => {
      subscriber = cb;
      return () => {
        subscriber = null;
      };
    },
    ...overrides,
  };
  const dispatch = (msg: Record<string, unknown>) => {
    act(() => {
      subscriber!(msg);
    });
  };
  return { session, dispatch };
}

function renderControlled(
  overrides: Partial<ControlledSession>,
  props: Partial<Parameters<typeof AvatarWidget>[0]> = {},
) {
  const { session, dispatch } = makeControlledSession(overrides);
  render(
    <AvatarWidget
      agentId="test-agent"
      controlledSession={session}
      soundEffects={false}
      {...props}
    />,
  );
  return dispatch;
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  internal.onDataMessage = null;
  internal.publishData = vi.fn(async () => {});
  clearPageContextCache();
  clearRoutesCache();
  window.localStorage.clear();
  document.title = "Pricing";
  document.body.innerHTML = `<main><h1>Pricing</h1><a href="/plans">Plans</a><a href="/contact">Contact</a></main>`;
  // useAgentInfo prefetches agent config; keep it off the network.
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 404 })));
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("controlled mode: replies go out through the controlled session", () => {
  it("answers request_page_context on the Room from getRoom() when there is no publishData", async () => {
    const host = hostRoom();
    const dispatch = renderControlled({ getRoom: () => host.room });

    dispatch({ type: "request_page_context", requestId: "pc-1" });

    await waitFor(() => expect(host.publishData).toHaveBeenCalledTimes(1));
    expect(host.publishData.mock.calls[0][1]).toEqual({ reliable: true });
    const [reply] = roomReplies(host.publishData);
    expect(reply.type).toBe("page_context");
    expect(reply.requestId).toBe("pc-1");
    expect(reply.context.pathname).toBe("/");
    expect(reply.context.title).toBe("Pricing");
    expect(internal.publishData).not.toHaveBeenCalled();
  });

  it("answers request_routes through controlledSession.publishData", async () => {
    const publishData = vi.fn();
    const dispatch = renderControlled({ publishData });

    dispatch({ type: "request_routes", requestId: "rt-1" });

    await waitFor(() => expect(publishData).toHaveBeenCalledTimes(1));
    const [reply] = hostReplies(publishData);
    expect(reply.type).toBe("routes");
    expect(reply.requestId).toBe("rt-1");
    expect(reply.routes.map((r: { href: string }) => r.href)).toEqual(
      expect.arrayContaining(["/plans", "/contact"]),
    );
    expect(internal.publishData).not.toHaveBeenCalled();
  });

  it("uses publishData, not the Room, when the host passes both", async () => {
    const host = hostRoom();
    const publishData = vi.fn();
    const dispatch = renderControlled({ publishData, getRoom: () => host.room });

    dispatch({ type: "request_routes", requestId: "rt-2" });

    await waitFor(() => expect(publishData).toHaveBeenCalledTimes(1));
    expect(host.publishData).not.toHaveBeenCalled();
    expect(internal.publishData).not.toHaveBeenCalled();
  });

  it("sends page_context_pending then page_context for an async getPageContext, both with the requestId", async () => {
    const host = hostRoom();
    let resolve!: (ctx: Record<string, unknown>) => void;
    const getPageContext = vi.fn(
      () => new Promise<any>((r) => {
        resolve = r;
      }),
    );
    const dispatch = renderControlled({ getRoom: () => host.room }, { getPageContext });

    dispatch({ type: "request_page_context", requestId: "pc-2" });
    await waitFor(() => expect(host.publishData).toHaveBeenCalledTimes(1));
    expect(roomReplies(host.publishData)[0]).toEqual({
      type: "page_context_pending",
      requestId: "pc-2",
    });

    await act(async () => {
      resolve({ url: "https://x.test/app", title: "App", pathname: "/app" });
    });
    await waitFor(() => expect(host.publishData).toHaveBeenCalledTimes(2));
    const reply = roomReplies(host.publishData)[1];
    expect(reply.type).toBe("page_context");
    expect(reply.requestId).toBe("pc-2");
    expect(reply.context.pathname).toBe("/app");
  });

  it("treats a thenable that is not a native Promise as async", async () => {
    const publishData = vi.fn();
    const thenable = {
      then(onOk: (ctx: unknown) => void) {
        onOk({ url: "https://x.test/", title: "T", pathname: "/thenable" });
      },
    };
    const dispatch = renderControlled({ publishData }, { getPageContext: () => thenable as any });

    dispatch({ type: "request_page_context", requestId: "pc-3" });

    await waitFor(() => expect(publishData).toHaveBeenCalledTimes(2));
    const [pending, reply] = hostReplies(publishData);
    expect(pending).toEqual({ type: "page_context_pending", requestId: "pc-3" });
    expect(reply.context.pathname).toBe("/thenable");
  });

  it("falls back to the default walker when getPageContext throws", async () => {
    const publishData = vi.fn();
    const dispatch = renderControlled(
      { publishData },
      {
        getPageContext: () => {
          throw new Error("boom");
        },
      },
    );

    dispatch({ type: "request_page_context", requestId: "pc-4" });

    await waitFor(() => expect(publishData).toHaveBeenCalledTimes(1));
    const [reply] = hostReplies(publishData);
    expect(reply.type).toBe("page_context");
    expect(reply.requestId).toBe("pc-4");
    // The walker's context, not the empty one.
    expect(reply.context.title).toBe("Pricing");
  });

  it("holds an oversized page_context to one packet on the publishData path", async () => {
    const publishData = vi.fn();
    const dispatch = renderControlled(
      { publishData },
      { pageContextExtras: { plan: "pro", catalog: "x".repeat(200_000) } },
    );

    dispatch({ type: "request_page_context", requestId: "pc-5" });

    await waitFor(() => expect(publishData).toHaveBeenCalledTimes(1));
    const [reply] = hostReplies(publishData);
    expect(new TextEncoder().encode(JSON.stringify(reply)).byteLength).toBeLessThanOrEqual(
      MAX_DATA_PAYLOAD_BYTES,
    );
    expect(reply.requestId).toBe("pc-5");
    expect(reply.context.extras.plan).toBe("pro");
    expect(reply.context.truncated).toEqual(["extras"]);
  });

  it("reports a submit_form outcome through the controlled session", async () => {
    document.body.innerHTML = `
      <form id="contact"><input name="email" value="a@b.test" /><button type="submit">Send</button></form>`;
    const form = document.getElementById("contact") as HTMLFormElement;
    // An SPA form that handles the submit itself and resets on success.
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      setTimeout(() => clearFields(form), 50);
    });
    const host = hostRoom();
    const dispatch = renderControlled({ getRoom: () => host.room });

    dispatch({ type: "submit_form", formId: "contact", requestId: "sf-1" });

    await waitFor(() => expect(host.publishData).toHaveBeenCalledTimes(1), { timeout: 3000 });
    const [reply] = roomReplies(host.publishData);
    expect(reply).toMatchObject({ type: "form_submitted", formId: "contact", requestId: "sf-1" });
    expect(internal.publishData).not.toHaveBeenCalled();
  });

  it("answers through a class-instance host whose methods read `this`", async () => {
    // The widget calls sendData and typed messages as methods on the
    // session, so a class-instance host works for those; replies must be
    // method calls too.
    const host = hostRoom();
    class HostSession {
      connectionState = "idle" as const;
      agentState = "idle" as const;
      transcript = [];
      videoElement = null;
      audioElement = null;
      canResume = false;
      error = null;
      onConnect = vi.fn();
      onDisconnect = vi.fn();
      subscriber: DataHandler | null = null;
      constructor(readonly room: typeof host.room) {}
      subscribeToDataMessages(cb: DataHandler) {
        this.subscriber = cb;
        return () => {
          this.subscriber = null;
        };
      }
      publishData(data: Record<string, unknown>) {
        return this.room.localParticipant.publishData(
          new TextEncoder().encode(JSON.stringify(data)),
          { reliable: true },
        );
      }
      getRoom() {
        return this.room;
      }
    }
    const session = new HostSession(host.room);
    render(<AvatarWidget agentId="test-agent" controlledSession={session} soundEffects={false} />);

    act(() => {
      session.subscriber!({ type: "request_page_context", requestId: "pc-9" });
      session.subscriber!({ type: "request_routes", requestId: "rt-6" });
    });

    await waitFor(() => expect(host.publishData).toHaveBeenCalledTimes(2));
    expect(roomReplies(host.publishData).map((r) => [r.type, r.requestId])).toEqual([
      ["page_context", "pc-9"],
      ["routes", "rt-6"],
    ]);
    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining("publishData failed"),
      expect.anything(),
    );
    expect(internal.publishData).not.toHaveBeenCalled();
  });

  it("warns, and does not use the internal session, when the host gives no way to publish", async () => {
    const dispatch = renderControlled({ getRoom: () => null });

    dispatch({ type: "request_page_context", requestId: "pc-6" });

    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("request_page_context: no connection to answer the agent on"),
      ),
    );
    expect(internal.publishData).not.toHaveBeenCalled();
  });

  it("keeps a throwing host publishData from escaping the handler", async () => {
    const err = new Error("host is gone");
    const publishData = vi.fn(() => {
      throw err;
    });
    const dispatch = renderControlled({ publishData });

    expect(() => dispatch({ type: "request_routes", requestId: "rt-3" })).not.toThrow();
    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith(
        "[LiveLayer] request_routes: controlledSession.publishData failed.",
        err,
      ),
    );
  });
});

// Refusals use the script-tag widget's protocol (@livelayer/sdk 0.10): the
// request's normal reply type, plus error / capability / message.
describe("refusals are answered, not left to time out", () => {
  it("answers request_page_context with a page_context refusal when read_page is not allowed", async () => {
    const publishData = vi.fn();
    const dispatch = renderControlled({ publishData }, { capabilities: ["navigate"] });

    dispatch({ type: "request_page_context", requestId: "pc-7" });

    await waitFor(() => expect(publishData).toHaveBeenCalledTimes(1));
    const refusal = {
      error: "capability_blocked",
      capability: "read_page",
      message: READ_PAGE_BLOCKED_MESSAGE,
    };
    expect(hostReplies(publishData)[0]).toEqual({
      type: "page_context",
      ...refusal,
      // The worker hands `context` to the LLM verbatim.
      context: refusal,
      requestId: "pc-7",
    });
  });

  it("answers request_routes with an empty routes refusal when read_page is not allowed", async () => {
    const publishData = vi.fn();
    const dispatch = renderControlled({ publishData }, { capabilities: ["navigate"] });

    dispatch({ type: "request_routes", requestId: "rt-4" });

    await waitFor(() => expect(publishData).toHaveBeenCalledTimes(1));
    expect(hostReplies(publishData)[0]).toEqual({
      type: "routes",
      error: "capability_blocked",
      capability: "read_page",
      message: ROUTES_BLOCKED_MESSAGE,
      routes: [],
      requestId: "rt-4",
    });
  });

  it("answers a page read that carries no requestId too", async () => {
    // An older worker matches the reply by type alone.
    const publishData = vi.fn();
    const dispatch = renderControlled({ publishData }, { capabilities: ["navigate"] });

    dispatch({ type: "request_routes" });

    await waitFor(() => expect(publishData).toHaveBeenCalledTimes(1));
    expect(hostReplies(publishData)[0]).toMatchObject({ type: "routes", error: "capability_blocked", routes: [] });
    expect(hostReplies(publishData)[0]).not.toHaveProperty("requestId");
  });

  it("answers request_routes with an extraction_failed refusal when the walker throws", async () => {
    const publishData = vi.fn();
    const dispatch = renderControlled({ publishData });
    // The walker reads every a[href]; make that read throw.
    const real = Document.prototype.querySelectorAll;
    vi.spyOn(Document.prototype, "querySelectorAll").mockImplementation(function (
      this: Document,
      sel: string,
    ) {
      if (sel === "a[href]") throw new Error("walker broke");
      return real.call(this, sel);
    } as typeof real);

    dispatch({ type: "request_routes", requestId: "rt-7" });

    await waitFor(() => expect(publishData).toHaveBeenCalledTimes(1));
    expect(hostReplies(publishData)[0]).toEqual({
      type: "routes",
      error: "extraction_failed",
      message: expect.stringContaining("links could not be read"),
      routes: [],
      requestId: "rt-7",
    });
  });

  it("answers submit_form with form_submit_blocked when submit_forms is not allowed, without submitting", async () => {
    document.body.innerHTML = `<form id="contact"><input name="email" value="a@b.test" /></form>`;
    const submitted = vi.fn((e: Event) => e.preventDefault());
    document.getElementById("contact")!.addEventListener("submit", submitted);
    const publishData = vi.fn();
    const dispatch = renderControlled({ publishData }, { capabilities: ["fill_forms"] });

    dispatch({ type: "submit_form", formId: "contact", requestId: "sf-2" });

    await waitFor(() => expect(publishData).toHaveBeenCalledTimes(1));
    expect(hostReplies(publishData)[0]).toEqual({
      type: "form_submit_blocked",
      formId: "contact",
      reason: "capability_blocked",
      // The worker prints invalidFields (not `message`) to the LLM, and
      // adds the final period.
      invalidFields: [SUBMIT_BLOCKED_MESSAGE.slice(0, -1)],
      error: "capability_blocked",
      capability: "submit_forms",
      message: SUBMIT_BLOCKED_MESSAGE,
      requestId: "sf-2",
    });
    expect(submitted).not.toHaveBeenCalled();
  });

  it("answers submit_form for a form id that matches no form", async () => {
    document.body.innerHTML = `
      <form id="signup"><input name="a" /></form>
      <form id="newsletter"><input name="b" /></form>`;
    const publishData = vi.fn();
    const dispatch = renderControlled({ publishData });

    dispatch({ type: "submit_form", formId: "checkout", requestId: "sf-3" });

    await waitFor(() => expect(publishData).toHaveBeenCalledTimes(1));
    expect(hostReplies(publishData)[0]).toEqual({
      type: "form_submit_blocked",
      formId: "checkout",
      reason: "form_not_found",
      invalidFields: [],
      requestId: "sf-3",
    });
  });

  it("answers submit_form with no formId", async () => {
    const publishData = vi.fn();
    const dispatch = renderControlled({ publishData });

    dispatch({ type: "submit_form", requestId: "sf-4" });

    await waitFor(() => expect(publishData).toHaveBeenCalledTimes(1));
    expect(hostReplies(publishData)[0]).toEqual({
      type: "form_submit_blocked",
      formId: "",
      reason: "missing_form_id",
      invalidFields: [],
      requestId: "sf-4",
    });
  });

  it("never submits a form in a private / data-ll-skip subtree, and says the form was not found", async () => {
    document.body.innerHTML = `
      <div data-ll-skip><form id="payment"><input name="card" value="4242" /></form></div>
      <div data-ll-private="true"><form id="account"><input name="pw" value="x" /></form></div>`;
    const submitted = vi.fn((e: Event) => e.preventDefault());
    document.getElementById("payment")!.addEventListener("submit", submitted);
    document.getElementById("account")!.addEventListener("submit", submitted);
    const publishData = vi.fn();
    const dispatch = renderControlled({ publishData });

    dispatch({ type: "submit_form", formId: "payment", requestId: "sf-5" });
    dispatch({ type: "submit_form", formId: "account", requestId: "sf-6" });

    await waitFor(() => expect(publishData).toHaveBeenCalledTimes(2));
    expect(hostReplies(publishData)).toEqual([
      {
        type: "form_submit_blocked",
        formId: "payment",
        reason: "form_not_found",
        invalidFields: [],
        requestId: "sf-5",
      },
      {
        type: "form_submit_blocked",
        formId: "account",
        reason: "form_not_found",
        invalidFields: [],
        requestId: "sf-6",
      },
    ]);
    expect(submitted).not.toHaveBeenCalled();
  });

  it("does not turn an unknown or private form id into a submit of the page's only public form", async () => {
    document.body.innerHTML = `
      <form id="contact"><input name="email" value="a@b.test" /></form>
      <div data-ll-private="true"><form id="account"><input name="pw" value="x" /></form></div>
      <div data-ll-skip><form id="payment"><input name="card" value="4242" /></form></div>`;
    const contactSubmitted = vi.fn((e: Event) => e.preventDefault());
    const offLimitsSubmitted = vi.fn((e: Event) => e.preventDefault());
    document.getElementById("contact")!.addEventListener("submit", contactSubmitted);
    document.getElementById("account")!.addEventListener("submit", offLimitsSubmitted);
    document.getElementById("payment")!.addEventListener("submit", offLimitsSubmitted);
    const publishData = vi.fn();
    const dispatch = renderControlled({ publishData });

    dispatch({ type: "submit_form", formId: "account", requestId: "sf-7" });
    dispatch({ type: "submit_form", formId: "payment", requestId: "sf-8" });
    dispatch({ type: "submit_form", formId: "does-not-exist", requestId: "sf-9" });

    await waitFor(() => expect(publishData).toHaveBeenCalledTimes(3));
    expect(hostReplies(publishData).map((r) => [r.type, r.formId, r.reason, r.requestId])).toEqual([
      ["form_submit_blocked", "account", "form_not_found", "sf-7"],
      ["form_submit_blocked", "payment", "form_not_found", "sf-8"],
      ["form_submit_blocked", "does-not-exist", "form_not_found", "sf-9"],
    ]);
    expect(contactSubmitted).not.toHaveBeenCalled();
    expect(offLimitsSubmitted).not.toHaveBeenCalled();
  });

  it("still submits the page's only public form for a positional form_<n> id", async () => {
    // A generic positional id is how the agent names a form it saw without
    // a real id; on a single-form page it stays unambiguous.
    document.body.innerHTML = `
      <form id="contact"><input name="email" value="a@b.test" /></form>
      <div data-ll-private="true"><form id="account"><input name="pw" value="x" /></form></div>`;
    const form = document.getElementById("contact") as HTMLFormElement;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      setTimeout(() => clearFields(form), 50);
    });
    const publishData = vi.fn();
    const dispatch = renderControlled({ publishData });

    dispatch({ type: "submit_form", formId: "form_0", requestId: "sf-10" });

    await waitFor(() => expect(publishData).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(hostReplies(publishData)[0]).toMatchObject({
      type: "form_submitted",
      formId: "form_0",
      requestId: "sf-10",
    });
  });

  it("does not answer a blocked fire-and-forget command (it carries no requestId)", async () => {
    const publishData = vi.fn();
    const dispatch = renderControlled({ publishData }, { capabilities: ["read_page"] });

    dispatch({ type: "navigate", href: "/plans" });
    dispatch({ type: "fill_form", formId: "contact", values: { email: "a@b.test" } });
    // A request after them proves the channel works and orders the check.
    dispatch({ type: "request_routes", requestId: "rt-5" });

    await waitFor(() => expect(publishData).toHaveBeenCalledTimes(1));
    expect(hostReplies(publishData)[0].type).toBe("routes");
  });

  it("does not answer a blocked fire-and-forget command even when it carries a requestId", async () => {
    // It has no reply type to answer with (tool_error is gone: no worker
    // read it), and the worker never waits on these commands.
    const publishData = vi.fn();
    const dispatch = renderControlled({ publishData }, { capabilities: ["read_page"] });

    dispatch({ type: "navigate", href: "/plans", requestId: "nv-1" });
    dispatch({ type: "click", selector: "a", requestId: "ck-1" });
    dispatch({ type: "request_routes", requestId: "rt-8" });

    await waitFor(() => expect(publishData).toHaveBeenCalledTimes(1));
    expect(hostReplies(publishData).map((r) => [r.type, r.requestId])).toEqual([["routes", "rt-8"]]);
  });

  it("answers a refusal on the internal session's Room when the widget is not controlled", async () => {
    render(<AvatarWidget agentId="test-agent" soundEffects={false} capabilities={["navigate"]} />);

    act(() => {
      internal.onDataMessage!({ type: "request_page_context", requestId: "pc-8" });
    });

    await waitFor(() => expect(internal.publishData).toHaveBeenCalledTimes(1));
    const [data, opts] = vi.mocked(internal.publishData!).mock.calls[0];
    expect(opts).toEqual({ reliable: true });
    expect(decode(data)).toMatchObject({
      type: "page_context",
      requestId: "pc-8",
      error: "capability_blocked",
      capability: "read_page",
    });
  });
});

function clearFields(form: HTMLFormElement) {
  for (const el of Array.from(form.elements)) {
    if (el instanceof HTMLInputElement) el.value = "";
  }
}
