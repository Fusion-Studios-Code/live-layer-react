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

// ─── Stepper detection (best-effort, false-positive resistant) ──────────
// Reads current/total step position from a wizard's progress indicator.
// Only HIGH-confidence signals count, so an ordinary site nav-bar with an
// ".active" link is NOT misread as a multi-step form: we require an
// aria-current="step", a role="progressbar", or a container/items that
// look step-ish (stepper/wizard/progress class, or sequentially numbered).
// A plain nav with an active link matches none of these and is ignored.

const STEP_LABEL_MAX = 60;
const STEPPER_CLASS_RE = /stepper|wizard|\bsteps?\b|progress/i;

function cleanLabel(s: string): string {
  return s
    // Drop a leading step number ("1", "1.", "Step 1:") for a cleaner label.
    .replace(/^\s*(step\s*)?\d+\s*[.):\-]?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, STEP_LABEL_MAX);
}

function stepperResult(
  items: Element[],
  activeIdx: number,
): { currentStep: number; totalSteps: number; stepLabel?: string } {
  const label = cleanLabel(
    (items[activeIdx] as HTMLElement).innerText ||
      items[activeIdx].textContent ||
      "",
  );
  return {
    totalSteps: items.length,
    currentStep: activeIdx + 1,
    ...(label ? { stepLabel: label } : {}),
  };
}

/** True when each item's visible text starts with 1, 2, 3… in order. */
function hasSequentialNumbers(items: Element[]): boolean {
  let n = 0;
  for (const it of items) {
    const m = (it.textContent || "").trim().match(/^(\d+)/);
    if (!m) return false;
    if (parseInt(m[1], 10) !== n + 1) return false;
    n += 1;
  }
  return n >= 2;
}

function detectStepper(doc: Document): {
  currentStep?: number;
  totalSteps?: number;
  stepLabel?: string;
} {
  // Signal 1 — aria-current="step" among same-tag siblings (unambiguous).
  const current = doc.querySelector('[aria-current="step"]');
  if (current && current.parentElement && !isHidden(current)) {
    const items = Array.from(current.parentElement.children).filter(
      (c) => c.tagName === current.tagName && !isHidden(c),
    );
    const idx = items.indexOf(current);
    if (idx >= 0 && items.length >= 2) return stepperResult(items, idx);
  }

  // Signal 2 — role="progressbar" with numeric value/max.
  const bar = doc.querySelector('[role="progressbar"]');
  if (bar && !isHidden(bar)) {
    const now = Number(bar.getAttribute("aria-valuenow"));
    const max = Number(bar.getAttribute("aria-valuemax"));
    if (Number.isFinite(now) && Number.isFinite(max) && max >= 2) {
      const text = (bar.getAttribute("aria-valuetext") || "").trim();
      return {
        totalSteps: max,
        currentStep: now,
        ...(text ? { stepLabel: cleanLabel(text) } : {}),
      };
    }
  }

  // Signal 3 — an active item whose sibling group looks step-ish. Find an
  // active marker, treat its siblings as steps, and REQUIRE a stepper signal
  // (step/wizard/progress class on the group or items, or sequential numbers)
  // so a plain nav-bar with an ".active" link is rejected.
  const actives = Array.from(
    doc.querySelectorAll<HTMLElement>(
      '[aria-current="step"], [class*="active"], [class*="Active"], [class*="current"], [class*="Current"], [class*="selected"], [class*="Selected"]',
    ),
  ).filter((el) => !isHidden(el));
  for (const active of actives) {
    const parent = active.parentElement;
    if (!parent) continue;
    const items = Array.from(parent.children).filter(
      (c) => !isHidden(c) && (c.textContent || "").trim().length > 0,
    );
    const idx = items.indexOf(active);
    if (idx < 0 || items.length < 2 || items.length > 12) continue;
    const stepSignal =
      STEPPER_CLASS_RE.test(parent.className) ||
      items.some((it) => STEPPER_CLASS_RE.test(it.className)) ||
      hasSequentialNumbers(items);
    if (!stepSignal) continue;
    return stepperResult(items, idx);
  }

  return {};
}
