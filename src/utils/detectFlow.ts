// ─── detectFlow ───────────────────────────────────────────────────────
// Runtime DOM inference of a multi-step (wizard) flow: forward/back/submit
// controls + (in A3) stepper position. Black-box — no host markup required.
// Maintains a logical-id → live-node registry so the widget can trigger a
// control by id without a fragile CSS selector crossing the wire.

import type { FlowContext, FlowControl } from "../types";
import { hasPrivateAncestor } from "./fieldPrivacy";

const ADVANCE_RE = /\b(continue|next|proceed|move\s*on|forward)\b|→|›/i;
const BACK_RE = /\b(back|previous|prev|go\s*back)\b|←|‹/i;
const SUBMIT_RE = /\b(submit|finish|done|complete|send)\b/i;

const registry = new Map<string, Element>();

/** Resolve a previously-detected control to its live DOM node, or null. */
export function resolveFlowControl(id: string): Element | null {
  const el = registry.get(id);
  return el && el.isConnected ? el : null;
}

function isHidden(el: Element): boolean {
  // Excludes [data-ll-private], [data-ll-skip], AND the widget's own
  // .ll-widget chrome — same exclusion every DOM scraper here uses.
  if (hasPrivateAncestor(el)) return true;
  if ((el as HTMLElement).hidden) return true;
  if (el.getAttribute("aria-hidden") === "true") return true;
  const cs =
    typeof window !== "undefined" && window.getComputedStyle
      ? window.getComputedStyle(el as HTMLElement)
      : null;
  if (cs && (cs.display === "none" || cs.visibility === "hidden")) return true;
  return false;
}

function isDisabled(el: Element): boolean {
  if ((el as HTMLButtonElement).disabled) return true;
  if (el.getAttribute("aria-disabled") === "true") return true;
  return false;
}

function controlText(el: Element): string {
  return (
    (el as HTMLElement).innerText ||
    el.textContent ||
    el.getAttribute("aria-label") ||
    (el as HTMLInputElement).value ||
    ""
  ).trim();
}

/** Candidate clickable controls: buttons + role=button + submit inputs. */
function candidates(doc: Document): Element[] {
  const sel =
    'button, [role="button"], input[type="submit"], input[type="button"]';
  return Array.from(doc.querySelectorAll(sel)).filter(
    (el) => !isHidden(el) && !isDisabled(el),
  );
}

export function detectFlow(doc: Document): FlowContext {
  registry.clear();

  const els = candidates(doc);
  let advance: FlowControl | undefined;
  let back: FlowControl | undefined;
  let submit: FlowControl | undefined;

  for (const el of els) {
    const text = controlText(el);
    if (!text || text.length > 40) continue;
    const isSubmitEl =
      el.getAttribute("type") === "submit" ||
      (el.tagName === "BUTTON" &&
        !el.getAttribute("type") &&
        !!el.closest("form"));

    if (!advance && ADVANCE_RE.test(text) && !BACK_RE.test(text)) {
      advance = { id: "ll-advance", label: text };
      registry.set("ll-advance", el);
    } else if (!back && BACK_RE.test(text)) {
      back = { id: "ll-back", label: text };
      registry.set("ll-back", el);
    } else if (!submit && (SUBMIT_RE.test(text) || isSubmitEl)) {
      submit = { id: "ll-submit", label: text };
      registry.set("ll-submit", el);
    }
  }

  const stepper = detectStepper(doc);

  const kind: FlowContext["kind"] =
    advance || stepper.totalSteps ? "multi-step" : "single-page";

  return { kind, advance, back, submit, ...stepper };
}

// Replaced with a real implementation in Task A3.
function detectStepper(_doc: Document): {
  currentStep?: number;
  totalSteps?: number;
  stepLabel?: string;
} {
  return {};
}
