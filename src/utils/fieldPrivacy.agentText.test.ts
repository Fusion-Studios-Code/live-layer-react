// agentText: an element's text as the agent may read it. Same function
// as @livelayer/sdk 0.10's page-tools/privacy.ts (live-layer-sdk#4).
import { describe, it, expect, beforeEach } from "vitest";
import { agentText, hasPrivateAncestor, PRIVATE_SUBTREE } from "./fieldPrivacy";

const byId = (id: string) => document.getElementById(id)!;

describe("agentText", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("is the element's textContent when nothing inside it is private", () => {
    document.body.innerHTML = `<p id="p">Plans  start
      at <b>$20</b>.</p>`;
    expect(agentText(byId("p"))).toBe(byId("p").textContent);
  });

  it("uses innerText when `rendered` and the browser has it", () => {
    document.body.innerHTML = `<div id="r">Free $0</div>`;
    const el = byId("r");
    Object.defineProperty(el, "innerText", { value: "Free $0 (rendered)", configurable: true });
    expect(agentText(el, true)).toBe("Free $0 (rendered)");
    expect(agentText(el)).toBe("Free $0");
  });

  it.each([
    ["bare data-ll-private", "data-ll-private"],
    ['data-ll-private="true"', 'data-ll-private="true"'],
    ["data-ll-skip", "data-ll-skip"],
    [".ll-widget", 'class="ll-widget"'],
  ])("is empty for an element in a %s subtree, and cuts one nested inside it out", (_label, attr) => {
    document.body.innerHTML = `
      <div ${attr}><p id="inside">Jane Q. Private</p></div>
      <p id="outer">Balance <span ${attr}>ACCT-99812</span>
        today</p>`;
    expect(agentText(byId("inside"))).toBe("");
    expect(agentText(byId("outer"))).toBe("Balance today");
  });

  it("skips non-text elements and hidden subtrees when it walks", () => {
    document.body.innerHTML = `
      <p id="p">Hi <span data-ll-private>Jane</span><script>var token = 1</script><span hidden>internal</span> there</p>`;
    expect(agentText(byId("p"))).toBe("Hi there");
  });

  it("matches the script tag's subtree rule", () => {
    expect(PRIVATE_SUBTREE).toBe("[data-ll-private], [data-ll-skip], .ll-widget");
    document.body.innerHTML = `<div data-ll-private=""><i id="i"></i></div>`;
    expect(hasPrivateAncestor(byId("i"))).toBe(true);
  });
});
