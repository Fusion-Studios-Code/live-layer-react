// What the agent's commands may touch, and what submit_form tells it.
// One subtree rule everywhere (utils/fieldPrivacy PRIVATE_SUBTREE):
// nothing inside [data-ll-private] (any value), [data-ll-skip] or
// .ll-widget is clicked, filled or submitted, and a field the agent may
// not see is never named in a form_submit_blocked's invalidFields.
// Ported from @livelayer/sdk 0.10's handle-agent-command-privacy.test.ts
// and page-tools-requests.test.ts (live-layer-sdk#4), which found these
// gaps in this package (0.26.0 and earlier).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, waitFor } from "@testing-library/react";
import { AvatarWidget, type ControlledSession } from "./AvatarWidget";

type DataHandler = (msg: Record<string, unknown>) => void;

// The SDK's PRIVATE_FIELD_INVALID, spelled out so this file runs against
// a widget that does not export it.
const PRIVATE_FIELD_INVALID = "a private field you can't see or fill: ask the visitor to check it";

function renderControlled() {
  let subscriber: DataHandler | null = null;
  const publishData = vi.fn();
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
    publishData,
  };
  render(<AvatarWidget agentId="test-agent" controlledSession={session} soundEffects={false} />);
  const dispatch = (msg: Record<string, unknown>) => {
    act(() => {
      subscriber!(msg);
    });
  };
  const replies = () => publishData.mock.calls.map(([msg]) => msg as Record<string, any>);
  return { dispatch, publishData, replies };
}

beforeEach(() => {
  document.body.innerHTML = "";
  window.localStorage.clear();
  // useAgentInfo prefetches agent config; keep it off the network.
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 404 })));
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const OFF_LIMITS = [
  ["bare data-ll-private", "data-ll-private"],
  ['data-ll-private="true"', 'data-ll-private="true"'],
  ["data-ll-skip", "data-ll-skip"],
  [".ll-widget", 'class="ll-widget"'],
] as const;

describe("click", () => {
  it.each(OFF_LIMITS)("never clicks inside a %s subtree", (_label, attr) => {
    const { dispatch } = renderControlled();
    document.body.insertAdjacentHTML(
      "beforeend",
      `<div ${attr}><button id="b">Delete account</button></div>`,
    );
    let clicks = 0;
    document.getElementById("b")!.addEventListener("click", () => clicks++);
    dispatch({ type: "click", selector: "#b" });
    expect(clicks).toBe(0);
  });

  it("clicks an ordinary element", () => {
    const { dispatch } = renderControlled();
    document.body.insertAdjacentHTML("beforeend", `<button id="b">Show pricing</button>`);
    let clicks = 0;
    document.getElementById("b")!.addEventListener("click", () => clicks++);
    dispatch({ type: "click", selector: "#b" });
    expect(clicks).toBe(1);
  });
});

describe("forms in a private subtree, whatever the data-ll-private value", () => {
  it.each(OFF_LIMITS.filter(([label]) => label !== ".ll-widget"))(
    "never submits a form inside a %s subtree, and says it was not found",
    async (_label, attr) => {
      const { dispatch, publishData, replies } = renderControlled();
      document.body.insertAdjacentHTML(
        "beforeend",
        `<div ${attr}><form id="account"><input name="pw" value="x" /></form></div>`,
      );
      const submitted = vi.fn((e: Event) => e.preventDefault());
      document.getElementById("account")!.addEventListener("submit", submitted);

      dispatch({ type: "submit_form", formId: "account", requestId: "s1" });

      await waitFor(() => expect(publishData).toHaveBeenCalledTimes(1));
      expect(replies()[0]).toEqual({
        type: "form_submit_blocked",
        formId: "account",
        reason: "form_not_found",
        invalidFields: [],
        requestId: "s1",
      });
      expect(submitted).not.toHaveBeenCalled();
    },
  );

  // extractPageContext never lists a form inside any private subtree, so
  // `form_0` is the first public unnamed form. The lookup must count the
  // same forms, or form_0 lands on the private one.
  it("resolves form_0 to the form the page context calls form_0 when a private form comes first", async () => {
    const { dispatch, publishData, replies } = renderControlled();
    document.body.insertAdjacentHTML(
      "beforeend",
      `<div data-ll-private><form><input name="email" /></form></div>
       <form><input name="email" /></form>`,
    );
    const [privateForm, publicForm] = Array.from(document.querySelectorAll("form"));
    const privateSubmit = vi.fn((e: Event) => e.preventDefault());
    privateForm!.addEventListener("submit", privateSubmit);
    const publicEmail = publicForm!.elements.namedItem("email") as HTMLInputElement;
    // An SPA form that handles the submit itself and resets on success.
    publicForm!.addEventListener("submit", (e) => {
      e.preventDefault();
      setTimeout(() => (publicEmail.value = ""), 50);
    });

    dispatch({ type: "fill_form", formId: "form_0", values: { email: "a@b.test" } });
    expect(publicEmail.value).toBe("a@b.test");
    expect((privateForm!.elements.namedItem("email") as HTMLInputElement).value).toBe("");

    dispatch({ type: "submit_form", formId: "form_0", requestId: "s2" });
    await waitFor(() => expect(publishData).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(privateSubmit).not.toHaveBeenCalled();
    expect(replies()[0]).toMatchObject({ type: "form_submitted", formId: "form_0", requestId: "s2" });
  });
});

// invalidFields carries a label and the browser's validationMessage,
// which in Chromium quotes the typed value ("'jane.example.com' is
// missing an '@'"). A field the agent may not see is never named.
describe("invalidFields never describes a field the agent may not see", () => {
  const privateForm = `
    <form id="acct">
      <label for="name">Name</label><input id="name" name="name" required />
      <div data-ll-private><label for="ssn">Social security number</label><input id="ssn" name="ssn" required /></div>
      <label for="pw">Password</label><input id="pw" name="pw" type="password" required />
      <label for="otp">One-time code</label><input id="otp" name="otp" autocomplete="off" required />
      <label for="cc">Card number</label><input id="cc" name="cc" autocomplete="cc-number" required />
      <label for="memo">Memo</label><input id="memo" name="memo" data-ll-skip required />
      <button type="submit">Save</button>
    </form>
  `;
  const hidden = /Social security|ssn|Password|pw:|One-time|otp|Card number|cc:|Memo|memo/;

  it("names the visible field and folds every private one into one generic entry", async () => {
    const { dispatch, publishData, replies } = renderControlled();
    document.body.insertAdjacentHTML("beforeend", privateForm);

    dispatch({ type: "submit_form", formId: "acct", requestId: "p1" });

    await waitFor(() => expect(publishData).toHaveBeenCalledTimes(1));
    expect(replies()[0]).toMatchObject({ type: "form_submit_blocked", reason: "validation", requestId: "p1" });
    expect(replies()[0]!.invalidFields).toEqual([expect.stringMatching(/^Name: .+/), PRIVATE_FIELD_INVALID]);
    expect(JSON.stringify(replies()[0])).not.toMatch(hidden);
  });

  it("still blocks, without naming anything, when only private fields fail", async () => {
    const { dispatch, publishData, replies } = renderControlled();
    document.body.insertAdjacentHTML("beforeend", privateForm);
    (document.getElementById("name") as HTMLInputElement).value = "Jane";
    const submitted = vi.fn();
    document.addEventListener("submit", submitted);

    dispatch({ type: "submit_form", formId: "acct", requestId: "p2" });

    await waitFor(() => expect(publishData).toHaveBeenCalledTimes(1));
    expect(submitted).not.toHaveBeenCalled();
    document.removeEventListener("submit", submitted);
    expect(replies()).toEqual([
      {
        type: "form_submit_blocked",
        formId: "acct",
        reason: "validation",
        invalidFields: [PRIVATE_FIELD_INVALID],
        requestId: "p2",
      },
    ]);
  });

  it("hides a private field's error that appears while an SPA submit is watched", async () => {
    const { dispatch, publishData, replies } = renderControlled();
    document.body.insertAdjacentHTML(
      "beforeend",
      `<form id="acct">
        <input name="name" value="Jane" />
        <div data-ll-skip><label for="ref">Account</label><input id="ref" name="ref" value="ACCT-99812" /></div>
      </form>`,
    );
    const ref = document.getElementById("ref") as HTMLInputElement;
    document.getElementById("acct")!.addEventListener("submit", (e) => {
      e.preventDefault();
      setTimeout(() => ref.setCustomValidity("Account ACCT-99812 is locked"), 50);
    });

    dispatch({ type: "submit_form", formId: "acct", requestId: "p3" });

    await waitFor(() => expect(publishData).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(replies()).toEqual([
      {
        type: "form_submit_blocked",
        formId: "acct",
        reason: "validation",
        invalidFields: [PRIVATE_FIELD_INVALID],
        requestId: "p3",
      },
    ]);
  });

  it("leaves private text out of a visible field's label", async () => {
    const { dispatch, publishData, replies } = renderControlled();
    document.body.insertAdjacentHTML(
      "beforeend",
      `<form id="c"><label for="e">Email for <span data-ll-private>Jane Q. Private</span></label><input id="e" name="e" required /></form>`,
    );

    dispatch({ type: "submit_form", formId: "c", requestId: "p4" });

    await waitFor(() => expect(publishData).toHaveBeenCalledTimes(1));
    expect(replies()[0]!.invalidFields).toEqual([expect.stringMatching(/^Email for: .+/)]);
    expect(JSON.stringify(replies()[0])).not.toContain("Jane Q. Private");
  });
});
