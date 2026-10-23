// The form manifest this package ships to the agent comes from
// @livelayer/sdk, not from this repo: useLiveKitSession builds the SDK's
// LiveKitSession without `automanifest: false`, and on connect that session
// starts exactly this ManifestManager on its Room, which publishes the
// page's field VALUES as the `agent.context` participant attribute and
// republishes on every input. So the README's promise that
// `<form data-ll-skip>` and `data-ll-private` keep fields "out of the
// agent's view" holds only if the SDK this package resolves honours them.
//
// @livelayer/sdk 0.9 skipped only an input that carried data-ll-private
// itself: the values of inputs in a `<form data-ll-skip>` or inside a
// private wrapper, and private text inside a field's label, went out.
// 0.10 applies the page tools' subtree rule (live-layer-sdk#4). These
// tests pin that for the version in package.json.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ManifestManager, clearFieldRegistry } from "@livelayer/sdk";

function makeRoom() {
  return {
    localParticipant: {
      setAttributes: vi.fn(async (_attrs: Record<string, string>) => {}),
    },
  };
}

/** Every `agent.context` the manager published, parsed. */
function published(room: ReturnType<typeof makeRoom>) {
  return room.localParticipant.setAttributes.mock.calls.map(
    ([attrs]) => JSON.parse(attrs["agent.context"]) as { elements: Array<Record<string, unknown>> },
  );
}

async function flush() {
  await vi.advanceTimersByTimeAsync(300);
}

let manager: ManifestManager | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  clearFieldRegistry();
  document.body.innerHTML = "";
});

afterEach(() => {
  manager?.stop();
  manager = null;
  vi.useRealTimers();
});

function start(room: ReturnType<typeof makeRoom>) {
  manager = new ManifestManager({ room, publishDebounceMs: 50, rescanDebounceMs: 50 });
  manager.start();
}

describe("the @livelayer/sdk manifest keeps opted-out fields from the agent", () => {
  it("publishes no input inside a <form data-ll-skip> or a data-ll-private wrapper", async () => {
    document.body.innerHTML = `
      <form data-ll-skip><input name="account" value="ACCT-99812" /></form>
      <div data-ll-private><form><input name="ssn" value="123-45-6789" /></form></div>
      <div data-ll-private="true"><form><input name="dob" value="1970-01-01" /></form></div>
      <form><input name="email" value="a@b.test" /></form>`;
    const room = makeRoom();
    start(room);
    await flush();

    const all = published(room);
    expect(all.length).toBeGreaterThan(0);
    expect(all.at(-1)!.elements.map((e) => e.id)).toEqual(["email"]);
    const wire = JSON.stringify(room.localParticipant.setAttributes.mock.calls);
    expect(wire).not.toContain("ACCT-99812");
    expect(wire).not.toContain("123-45-6789");
    expect(wire).not.toContain("1970-01-01");
  });

  it("does not republish what the visitor types into an opted-out form", async () => {
    document.body.innerHTML = `
      <form data-ll-skip><input name="account" /></form>
      <form><input name="email" /></form>`;
    const room = makeRoom();
    start(room);
    await flush();

    const input = document.querySelector<HTMLInputElement>('input[name="account"]')!;
    input.value = "ACCT-55555";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();

    expect(JSON.stringify(room.localParticipant.setAttributes.mock.calls)).not.toContain("ACCT-55555");
  });

  it("leaves private text out of a published field's label", async () => {
    document.body.innerHTML = `
      <form>
        <label for="a">Email for <span data-ll-private>Jane Q. Private</span></label><input id="a" name="a" />
        <label>Phone <span data-ll-skip>(ends 4471)</span><input name="b" /></label>
      </form>`;
    const room = makeRoom();
    start(room);
    await flush();

    expect(published(room).at(-1)!.elements.map((e) => e.label)).toEqual(["Email for", "Phone"]);
  });

  it("leaves out password, hidden and cc-* inputs", async () => {
    document.body.innerHTML = `
      <form>
        <input type="password" name="pw" value="hunter2" />
        <input type="hidden" name="token" value="tok_123" />
        <input name="card" autocomplete="cc-number" value="4242424242424242" />
        <input name="email" value="a@b.test" />
      </form>`;
    const room = makeRoom();
    start(room);
    await flush();

    expect(published(room).at(-1)!.elements.map((e) => e.id)).toEqual(["email"]);
  });

  // The README's documented exception (the SDK's README says the same):
  // the manifest does not apply the page tools' autocomplete="off" rule.
  // If this starts failing, the SDK closed the gap: drop the exception
  // from the README's Privacy section.
  it('still reports an autocomplete="off" field, value included, unless it is marked data-ll-private', async () => {
    document.body.innerHTML = `
      <form>
        <input name="promo" autocomplete="off" value="PROMO-1" />
        <input name="memo" autocomplete="off" data-ll-private value="MEMO-2" />
      </form>`;
    const room = makeRoom();
    start(room);
    await flush();

    expect(published(room).at(-1)!.elements).toEqual([
      expect.objectContaining({ id: "promo", value: "PROMO-1" }),
    ]);
  });
});
