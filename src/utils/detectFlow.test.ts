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

describe("detectFlow — stepper detection", () => {
  beforeEach(() => setBody(""));

  it("reads an aria-current=step stepper", () => {
    setBody(`
      <ol>
        <li>Getting to know you</li>
        <li aria-current="step">Your move</li>
        <li>What you need</li>
      </ol>
      <button>Continue</button>`);
    const flow = detectFlow(document);
    expect(flow.totalSteps).toBe(3);
    expect(flow.currentStep).toBe(2);
    expect(flow.stepLabel).toBe("Your move");
    expect(flow.kind).toBe("multi-step");
  });

  it("reads a numbered stepper inside a .stepper container", () => {
    setBody(`
      <div class="stepper">
        <div class="step active">1 Getting to know you</div>
        <div class="step">2 Your move</div>
        <div class="step">3 What you need</div>
      </div>`);
    const flow = detectFlow(document);
    expect(flow.totalSteps).toBe(3);
    expect(flow.currentStep).toBe(1);
    expect(flow.stepLabel).toContain("Getting to know you");
  });

  it("detects a Material-UI (MuiStepper) stepper with a nested active label", () => {
    setBody(`
      <div class="MuiStepper-root MuiStepper-horizontal">
        <div class="MuiStep-root"><span class="MuiStepLabel-root">Account</span></div>
        <div class="MuiStep-root"><span class="MuiStepLabel-root Mui-active">Payment</span></div>
        <div class="MuiStep-root"><span class="MuiStepLabel-root">Review</span></div>
      </div>`);
    const flow = detectFlow(document);
    expect(flow.totalSteps).toBe(3);
    expect(flow.currentStep).toBe(2);
    expect(flow.stepLabel).toBe("Payment");
  });

  it("detects an Ant Design (ant-steps) stepper", () => {
    setBody(`
      <div class="ant-steps ant-steps-horizontal">
        <div class="ant-steps-item ant-steps-item-finish"><div class="ant-steps-item-content">Account</div></div>
        <div class="ant-steps-item ant-steps-item-active"><div class="ant-steps-item-content">Payment</div></div>
        <div class="ant-steps-item ant-steps-item-wait"><div class="ant-steps-item-content">Review</div></div>
      </div>`);
    const flow = detectFlow(document);
    expect(flow.totalSteps).toBe(3);
    expect(flow.currentStep).toBe(2);
    expect(flow.stepLabel).toBe("Payment");
  });

  it("reads a role=progressbar stepper", () => {
    setBody(`<div role="progressbar" aria-valuenow="2" aria-valuemax="4" aria-valuetext="Step 2: Your move"></div>`);
    const flow = detectFlow(document);
    expect(flow.totalSteps).toBe(4);
    expect(flow.currentStep).toBe(2);
    expect(flow.stepLabel).toBe("Your move");
  });

  it("is multi-step via a high-confidence stepper even with no advance button", () => {
    setBody(`<ol><li aria-current="step">A</li><li>B</li></ol>`);
    const flow = detectFlow(document);
    expect(flow.kind).toBe("multi-step");
    expect(flow.totalSteps).toBe(2);
    expect(flow.currentStep).toBe(1);
  });

  it("does NOT misread an ordinary nav bar with an active link as a stepper", () => {
    // The critical false-positive guard: a normal site nav has an ".active"
    // link but no step/wizard/progress class and no sequential numbers, so it
    // must stay single-page (no totalSteps).
    setBody(`
      <nav class="navbar">
        <a class="nav-link active" href="/">Home</a>
        <a class="nav-link" href="/about">About</a>
        <a class="nav-link" href="/contact">Contact</a>
      </nav>
      <main><p>Welcome</p></main>`);
    const flow = detectFlow(document);
    expect(flow.totalSteps).toBeUndefined();
    expect(flow.currentStep).toBeUndefined();
    expect(flow.kind).toBe("single-page");
  });

  it("does not treat a generic ordered list with an active item but no step signal as a stepper", () => {
    setBody(`<ol><li class="active">Apples</li><li>Oranges</li><li>Pears</li></ol>`);
    const flow = detectFlow(document);
    expect(flow.totalSteps).toBeUndefined();
    expect(flow.kind).toBe("single-page");
  });

  it("does NOT misread numbered pagination as a stepper", () => {
    // The most common active+numbered list on the web. Must stay single-page,
    // even though it has an .active item and sequential numbers.
    setBody(`
      <ul class="pagination">
        <li class="page-item active"><a href="?p=1">1</a></li>
        <li class="page-item"><a href="?p=2">2</a></li>
        <li class="page-item"><a href="?p=3">3</a></li>
      </ul>
      <main><article>Post</article></main>`);
    const flow = detectFlow(document);
    expect(flow.totalSteps).toBeUndefined();
    expect(flow.kind).toBe("single-page");
  });

  it("does NOT misread a task list with a 'in-progress'/'selected' item as a stepper", () => {
    setBody(`
      <ul class="in-progress-tasks">
        <li class="task selected">Design</li>
        <li class="task">Build</li>
        <li class="task">Ship</li>
      </ul>`);
    const flow = detectFlow(document);
    expect(flow.totalSteps).toBeUndefined();
    expect(flow.kind).toBe("single-page");
  });

  it("does NOT misread a 'steps'-substring marketing nav as a stepper (hyphenated)", () => {
    setBody(`
      <nav class="three-steps-nav">
        <a class="nav-link active" href="/">Home</a>
        <a class="nav-link" href="/pricing">Pricing</a>
        <a class="nav-link" href="/docs">Docs</a>
      </nav>`);
    const flow = detectFlow(document);
    expect(flow.totalSteps).toBeUndefined();
    expect(flow.kind).toBe("single-page");
  });

  it("does NOT misread a 'steps'-substring marketing nav as a stepper (space-separated tokens)", () => {
    setBody(`
      <nav class="three steps nav">
        <a class="nav-link active" href="/">Home</a>
        <a class="nav-link" href="/pricing">Pricing</a>
        <a class="nav-link" href="/docs">Docs</a>
      </nav>`);
    const flow = detectFlow(document);
    expect(flow.totalSteps).toBeUndefined();
    expect(flow.kind).toBe("single-page");
  });

  it("does NOT misread a generic '.step' utility-class card grid as a stepper", () => {
    setBody(`
      <div class="cards">
        <div class="step active">Basic</div>
        <div class="step">Pro</div>
        <div class="step">Enterprise</div>
      </div>`);
    const flow = detectFlow(document);
    expect(flow.totalSteps).toBeUndefined();
    expect(flow.kind).toBe("single-page");
  });

  it("picks the active step, not an 'inactive'-classed sibling", () => {
    setBody(`
      <ol class="stepper">
        <li class="inactive">Account</li>
        <li class="active">Payment</li>
        <li class="inactive">Review</li>
      </ol>`);
    const flow = detectFlow(document);
    expect(flow.totalSteps).toBe(3);
    expect(flow.currentStep).toBe(2);
    expect(flow.stepLabel).toBe("Payment");
  });

  it("keeps a 4-digit year in the step label (does not strip it as a step number)", () => {
    setBody(`
      <ol class="stepper">
        <li aria-current="step">2024 Tax Return</li>
        <li>Review</li>
      </ol>`);
    const flow = detectFlow(document);
    expect(flow.stepLabel).toBe("2024 Tax Return");
  });
});
