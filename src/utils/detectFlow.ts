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

function cleanLabel(s: string): string {
  return s
    // Strip a leading 1–2 digit step number ("1", "2.", "Step 3:") so the
    // label reads cleanly — but leave 4-digit years ("2024 Tax Return") and
    // grouped figures ("10,000 ft view") intact by bounding to 1–2 digits
    // that are immediately followed by a separator or space.
    .replace(/^\s*(step\s+)?\d{1,2}(?:[.):\-]+\s*|\s+)/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, STEP_LABEL_MAX);
}

function classOf(el: Element): string {
  const c = el.getAttribute("class");
  return c ? c.toLowerCase() : "";
}

// Component-specific signatures that name a stepper/wizard CONTAINER —
// "MuiStepper-root", "ant-steps", "bs-stepper", "step-indicator", "wizard".
// Deliberately NOT a generic "step"/"steps" token, so "three-steps-nav",
// "three steps nav", "pagination", "in-progress-tasks", and lone ".step"
// utility classes do NOT qualify. Tradeoff: a fully-custom stepper with no
// recognizable class is missed — acceptable, it still advances via the
// detected Continue button (just without step numbers).
const STEPPER_CONTAINER_RE = /stepper|wizard|ant-steps|step-indicator/;

function isStepperContainer(el: Element): boolean {
  return STEPPER_CONTAINER_RE.test(classOf(el));
}

/** A precise "this is the current item" marker. Token-bounded so "inactive"
 *  / "deactivated" don't count, and aria-current="page" (nav) is excluded —
 *  only "step"/"true" count as a step-current. */
function isActiveMarker(el: Element): boolean {
  const ac = el.getAttribute("aria-current");
  if (ac === "step" || ac === "true") return true;
  return Array.from(el.classList).some((t) =>
    /(^|[-_])(active|current|selected)([-_]|$)/i.test(t),
  );
}

const ACTIVE_DESCENDANT_SEL =
  '[aria-current="step"],[aria-current="true"],[class*="active"],[class*="Active"],[class*="current"],[class*="Current"],[class*="selected"],[class*="Selected"]';

/** A step item is "current" if it — or a descendant — carries a precise active
 *  marker. The descendant check handles MUI/AntD, which put the active class
 *  on a label nested inside the step (`<Step><StepLabel class="Mui-active">`). */
function itemIsActive(it: Element): boolean {
  if (isActiveMarker(it)) return true;
  return Array.from(it.querySelectorAll(ACTIVE_DESCENDANT_SEL)).some(
    isActiveMarker,
  );
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

  // Signal 3 — a stepper/wizard-CLASSED container (container-first). Match
  // only specific component signatures (stepper / wizard / ant-steps /
  // step-indicator), so pagination, tab strips, breadcrumbs, nav bars,
  // task lists, and lone ".step" utility classes are excluded. Each direct
  // child is a step; the active one is found by climbing into the item
  // (libraries nest the active marker on a label inside the step).
  // The broad `[class*="step"/"wizard"]` query is narrowed by
  // `isStepperContainer`; it also matches step ITEMS (e.g. "ant-steps-item"),
  // which harmlessly fail the >=2-children test and fall through to the real
  // container that appears earlier in document order.
  const containers = Array.from(
    doc.querySelectorAll<HTMLElement>(
      '[class*="step"], [class*="Step"], [class*="wizard"], [class*="Wizard"]',
    ),
  ).filter((el) => !isHidden(el) && isStepperContainer(el));
  for (const container of containers) {
    const items = Array.from(container.children).filter(
      (c) => !isHidden(c) && (c.textContent || "").trim().length > 0,
    );
    if (items.length < 2 || items.length > 12) continue;
    const idx = items.findIndex(itemIsActive);
    if (idx < 0) continue;
    return stepperResult(items, idx);
  }

  return {};
}
