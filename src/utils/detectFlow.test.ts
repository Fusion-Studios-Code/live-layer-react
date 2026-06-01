/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from "vitest";
import { detectFlow, resolveFlowControl } from "./detectFlow";

function setBody(html: string) {
  document.body.innerHTML = html;
}

describe("detectFlow — control detection", () => {
  beforeEach(() => setBody(""));

  it("detects a Continue button as the advance control", () => {
    setBody(`<form><input name="a" /></form><button id="cta">Continue</button>`);
    const flow = detectFlow(document);
    expect(flow.advance).toBeTruthy();
    expect(flow.advance!.label).toBe("Continue");
    expect(flow.advance!.id).toBe("ll-advance");
    expect(flow.kind).toBe("multi-step");
  });

  it("detects Back and Submit controls distinctly", () => {
    setBody(`<button>Back</button><button>Continue</button><button type="submit">Finish</button>`);
    const flow = detectFlow(document);
    expect(flow.back?.label).toBe("Back");
    expect(flow.advance?.label).toBe("Continue");
    expect(flow.submit?.label).toBe("Finish");
  });

  it("ignores disabled, hidden, and widget-chrome controls", () => {
    setBody(`
      <button disabled>Continue</button>
      <button style="display:none">Next</button>
      <div data-ll-private="true"><button>Proceed</button></div>
    `);
    const flow = detectFlow(document);
    expect(flow.advance).toBeUndefined();
  });

  it("ignores controls inside the widget's own chrome (.ll-widget)", () => {
    setBody(`<div class="ll-widget"><button>End call</button><button>Continue</button></div><button id="host">Continue</button>`);
    detectFlow(document);
    expect(resolveFlowControl("ll-advance")).toBe(document.getElementById("host"));
  });

  it("does not treat a typeless button outside a form as submit", () => {
    setBody(`<header><button>Login</button></header>`);
    const flow = detectFlow(document);
    expect(flow.submit).toBeUndefined();
  });

  it("returns single-page when there is no advance/stepper", () => {
    setBody(`<form><input name="a" /><button type="submit">Send</button></form>`);
    const flow = detectFlow(document);
    expect(flow.kind).toBe("single-page");
    expect(flow.advance).toBeUndefined();
    expect(flow.submit?.label).toBe("Send");
  });

  it("registry resolves the detected advance node and drops it when removed", () => {
    setBody(`<button id="go">Next</button>`);
    detectFlow(document);
    const el = resolveFlowControl("ll-advance");
    expect(el).toBe(document.getElementById("go"));
    document.body.innerHTML = "";
    expect(resolveFlowControl("ll-advance")).toBeNull();
  });
});
