// ─── extractPageContext ───────────────────────────────────────────────
// Walk the host's DOM and produce a structured snapshot for the agent.
//
// Privacy guarantees (hard-coded — do not relax):
//   - Form values are NEVER read. Only labels and field types.
//   - Inputs with type="password" are excluded entirely.
//   - Inputs with autocomplete="cc-number" / "cc-csc" / "cc-exp*" / "off"
//     are excluded.
//   - Elements with [data-ll-private="true"] (and their subtree) are
//     skipped.
//   - The widget itself (.ll-widget) is skipped.
//
// Output cap: 4 KB total. Priority drop order: regions > headings >
// paragraphs > links > fields. The cap is enforced by progressively
// truncating each section's contribution.
//
// Caching: callers pass the previous result + cache key (pathname +
// scrollY band). If the key matches and < 1s has elapsed, the cached
// result is returned. This is the agent-perceivable cache; the
// IntersectionObserver lives at module scope so it's also reused.

import type { PageContext } from "../types";
import { isFieldFillable, hasPrivateAncestor } from "./fieldPrivacy";
import { detectFlow } from "./detectFlow";

const MAX_OUTPUT_BYTES = 4096;
const MAX_LINKS = 20;
const MAX_FIELDS = 20;
const MAX_REGIONS = 10;
const MAX_FORMS = 10;
const MAX_FIELDS_PER_FORM = 30;
const MAX_OPTIONS_PER_FIELD = 20;
const MAX_PARAGRAPH_CHARS = 500;

const VISUAL_PRIVATE_SELECTORS = [
  "[data-ll-private=\"true\"]",
  ".ll-widget",
  "script",
  "style",
  "noscript",
  "iframe",
];

function isPrivate(el: Element): boolean {
  if (el.getAttribute("aria-hidden") === "true") return true;
  if (el.hasAttribute("hidden")) return true;
  let cur: Element | null = el;
  while (cur) {
    for (const sel of VISUAL_PRIVATE_SELECTORS) {
      if (cur.matches(sel)) return true;
    }
    cur = cur.parentElement;
  }
  return false;
}

function isVisibleInViewport(el: Element): boolean {
  if (typeof window === "undefined") return true;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const vpHeight = window.innerHeight || document.documentElement.clientHeight;
  const vpWidth = window.innerWidth || document.documentElement.clientWidth;
  return (
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < vpHeight &&
    rect.left < vpWidth
  );
}

function fieldLabel(el: HTMLElement): string {
  // Priority order matters. Semantic labels — explicit <label for>,
  // aria-label, or a wrapping <label> — are TRUE labels, authored by
  // the developer to describe the field. Placeholder is an EXAMPLE
  // value (e.g. "you@company.com") and only describes the field by
  // accident. We used to short-circuit on placeholder before checking
  // the wrapping <label>, which mis-labelled fields like
  // `<label>Your email <input placeholder="you@company.com" /></label>`
  // as "you@company.com" — the bare-minimum-form case the user
  // explicitly called out. Fixed in 0.14.0.
  const id = el.getAttribute("id");
  if (id) {
    // CSS.escape isn't available in some test envs (jsdom < 22); fall
    // back to attribute-selector quote escaping for ids that don't
    // need full CSS-ident escaping.
    const escapedId =
      typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(id)
        : id.replace(/"/g, '\\"');
    const lbl = document.querySelector(`label[for="${escapedId}"]`);
    if (lbl?.textContent) return lbl.textContent.trim();
  }
  const aria = el.getAttribute("aria-label");
  if (aria) return aria.trim();
  // Wrapping <label> — semantic, beats placeholder. Strip the input's
  // own textual presence (e.g. <option> labels inside a wrapped
  // <select>) by reading the wrapping label's direct text nodes,
  // not the full textContent which includes child content.
  const wrapping = el.closest("label");
  if (wrapping) {
    // Pull the label text without the input's own contribution.
    // Walk direct children; concatenate text nodes and labels of
    // non-form-element children. Far cleaner than the textContent
    // diff, and immune to selects with many options bleeding into
    // the label string.
    const parts: string[] = [];
    for (const node of Array.from(wrapping.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        const t = (node.textContent || "").trim();
        if (t) parts.push(t);
      } else if (node instanceof HTMLElement) {
        // Skip the form control itself (and any form controls).
        if (
          node instanceof HTMLInputElement ||
          node instanceof HTMLTextAreaElement ||
          node instanceof HTMLSelectElement ||
          node instanceof HTMLButtonElement
        ) {
          continue;
        }
        const t = (node.textContent || "").trim();
        if (t) parts.push(t);
      }
    }
    const direct = parts.join(" ").trim();
    if (direct) return direct;
  }
  const placeholder = el.getAttribute("placeholder");
  if (placeholder) return placeholder.trim();
  return "";
}

function clampString(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

/**
 * Turn an `intent` string into a kebab-case slug suitable for use as
 * a stable form id when the form carries no `id` / `name` attribute.
 * Same shape the dashboard's slug helpers use so a "request a demo"
 * intent renders as `request-a-demo` consistently across surfaces.
 */
function intentToSlug(intent: string | null): string | null {
  if (!intent) return null;
  const slug = intent
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || null;
}

/**
 * Best-effort intent inference when the author didn't supply
 * `data-ll-intent`. Looks for, in order:
 *   1. `aria-label` / `aria-labelledby` on the form itself
 *   2. The text of the form's submit button (e.g. "Subscribe",
 *      "Request a demo", "Send")
 *   3. The nearest preceding heading (h1-h4) within the form's
 *      ancestor chain — picks up "Request a demo" sections
 * Returns null when nothing fits — the LLM is fine without an
 * intent hint, it'll just disambiguate from the field list itself.
 */
function inferFormIntent(form: HTMLFormElement): string | null {
  const aria = form.getAttribute("aria-label");
  if (aria) return aria.trim().slice(0, 80);

  const ariaBy = form.getAttribute("aria-labelledby");
  if (ariaBy) {
    const target = document.getElementById(ariaBy);
    if (target?.textContent) return target.textContent.trim().slice(0, 80);
  }

  const submit = form.querySelector<HTMLButtonElement | HTMLInputElement>(
    'button[type="submit"], input[type="submit"], button:not([type])',
  );
  if (submit) {
    const text =
      submit instanceof HTMLInputElement
        ? submit.value
        : (submit.textContent ?? "").trim();
    if (text && text.length < 60 && !/^(submit|ok|continue)$/i.test(text)) {
      return text;
    }
  }

  // Walk up looking for a preceding heading. Cheap heuristic; only
  // checks ancestors, not the entire document, to avoid pulling in
  // page-wide titles like "Home".
  let cur: Element | null = form.parentElement;
  for (let depth = 0; cur && depth < 4; depth++, cur = cur.parentElement) {
    const heading = cur.querySelector("h1, h2, h3, h4");
    if (heading?.textContent) {
      const text = heading.textContent.trim();
      if (text && text.length < 80) return text;
    }
  }
  return null;
}

function bytesOf(s: string): number {
  // Approximation — utf-8 byte count for the ASCII subset is len, but
  // we want a fast cap so we just use length.
  return s.length;
}

interface ExtractOptions {
  /** Override doc — for tests. */
  doc?: Document;
}

export function extractPageContext(
  extras?: Record<string, unknown>,
  opts: ExtractOptions = {},
): PageContext {
  const doc = opts.doc ?? (typeof document !== "undefined" ? document : null);
  if (!doc) {
    return {
      url: "",
      title: "",
      pathname: "/",
      regions: [],
      visibleText: "",
      visibleLinks: [],
      visibleFields: [],
      forms: [],
      extras,
    };
  }

  const url = (typeof window !== "undefined" && window.location.href) || "";
  const pathname = (typeof window !== "undefined" && window.location.pathname) || "/";
  const title = doc.title || "";

  // ── Regions (curated) ──────────────────────────────────────────────
  const regionEls = Array.from(
    doc.querySelectorAll<HTMLElement>("[data-ll-region]"),
  );
  const regions: PageContext["regions"] = [];
  for (const el of regionEls) {
    if (regions.length >= MAX_REGIONS) break;
    if (isPrivate(el)) continue;
    if (!isVisibleInViewport(el)) continue;
    const id = el.getAttribute("data-ll-region") ?? "";
    const intent = el.getAttribute("data-ll-intent") ?? undefined;
    const text = clampString(
      (el.innerText || el.textContent || "").trim(),
      MAX_PARAGRAPH_CHARS * 2,
    );
    if (!id || !text) continue;
    regions.push({ id, intent, text });
  }

  // ── Headings + paragraphs (visible text) ───────────────────────────
  const textNodes: string[] = [];
  const HEADING_TAGS = ["H1", "H2", "H3", "H4", "H5", "H6"];
  const headings = Array.from(
    doc.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6"),
  );
  for (const h of headings) {
    if (isPrivate(h)) continue;
    if (!isVisibleInViewport(h)) continue;
    const text = (h.textContent || "").trim();
    if (text) textNodes.push(`${h.tagName}: ${clampString(text, 200)}`);
  }
  const paragraphs = Array.from(doc.querySelectorAll<HTMLElement>("p, li"));
  for (const p of paragraphs) {
    if (isPrivate(p)) continue;
    if (!isVisibleInViewport(p)) continue;
    // Skip if already covered by a heading
    if (HEADING_TAGS.includes(p.tagName)) continue;
    const text = (p.textContent || "").trim();
    if (text.length > 10) {
      textNodes.push(clampString(text, MAX_PARAGRAPH_CHARS));
    }
  }
  const visibleText = textNodes.join("\n");

  // ── Links ──────────────────────────────────────────────────────────
  const visibleLinks: PageContext["visibleLinks"] = [];
  const anchors = Array.from(doc.querySelectorAll<HTMLAnchorElement>("a[href]"));
  for (const a of anchors) {
    if (visibleLinks.length >= MAX_LINKS) break;
    if (isPrivate(a)) continue;
    if (!isVisibleInViewport(a)) continue;
    const href = a.getAttribute("href") || "";
    const text = (a.textContent || "").trim();
    if (!href || !text) continue;
    visibleLinks.push({ href, text: clampString(text, 100) });
  }

  // ── Form fields (labels + types only; values NEVER) ───────────────
  const visibleFields: PageContext["visibleFields"] = [];
  const fields = Array.from(
    doc.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      "input, textarea, select",
    ),
  );
  for (const f of fields) {
    if (visibleFields.length >= MAX_FIELDS) break;
    if (isPrivate(f)) continue;
    if (!isFieldFillable(f)) continue;
    if (!isVisibleInViewport(f)) continue;
    const label = fieldLabel(f);
    const type =
      f instanceof HTMLInputElement
        ? f.type
        : f.tagName.toLowerCase();
    if (!label) continue;
    visibleFields.push({ label: clampString(label, 100), type });
  }

  // ── Auto-discovered forms (unified-API surface) ─────────────────────
  //
  // Every <form> on the page is agent-visible by default. The customer
  // doesn't have to wrap it in <LiveLayerForm> or sprinkle data-ll-*
  // attributes on its inputs. The agent walks the DOM, finds every
  // form, infers each field's label from <label> / aria-label /
  // placeholder, infers each field's kind from the input `type=`, and
  // surfaces them as a PageContext.forms entry the LLM can target with
  // `fill_form` / `collect_from_page`.
  //
  // Opt-OUT model (the "if no clients exist yet, what's the best
  // syntax?" design). Customers add markup ONLY to keep things out:
  //
  //   <form data-ll-skip>...</form>           — exclude a whole form
  //   <input data-ll-private />               — exclude one input
  //   <input type="password" />               — always excluded
  //   <input autocomplete="cc-number" />      — always excluded (PII)
  //
  // Hint (still optional) for disambiguation when a page has multiple
  // forms and the LLM can't tell them apart from surrounding text:
  //
  //   <form data-ll-intent="request a demo">...</form>
  //
  // Form id resolution: prefer the form's existing `id` attribute,
  // then `name`, then `data-ll-intent` slug, finally a synthesized
  // `form_<index>`. Stable IDs across renders matter because the
  // worker uses them as the target for fill_form / collect_from_page.
  const discoveredForms = Array.from(doc.querySelectorAll<HTMLFormElement>("form"));
  const formsArr: PageContext["forms"] = [];
  let synthFormIdx = 0;
  for (const form of discoveredForms) {
    if (formsArr.length >= MAX_FORMS) break;
    if (hasPrivateAncestor(form)) continue;
    if (form.matches(".ll-widget *, .ll-widget")) continue;

    const id =
      form.getAttribute("id") ||
      form.getAttribute("name") ||
      intentToSlug(form.getAttribute("data-ll-intent")) ||
      `form_${synthFormIdx++}`;
    const intent =
      form.getAttribute("data-ll-intent") ||
      inferFormIntent(form) ||
      undefined;

    // Every input / textarea / select inside the form is a candidate.
    // We deliberately do NOT filter on visibility — a form below the
    // fold is still agent-fillable, the LLM can scroll the page first.
    // Privacy filtering happens per-field via isFieldFillable
    // (password / cc-* / data-ll-private).
    //
    // CHANGED (0.14.0): we used to require `[name]` on every input,
    // which broke fill on React forms that use `id` for <label htmlFor>
    // accessibility but no `name` (extremely common — the Fusion
    // portfolio contact form was the trigger case). We now scan ALL
    // inputs and synthesize a stable agent-callable identifier per
    // field: `name` → `id` → `field_<n>` positional index. The fill
    // resolver (fieldFillKey in fillField.ts logic, mirrored in
    // AvatarWidget.tsx) inverts the same scheme to map the agent's
    // key back to the real DOM element.
    const fieldEls = Array.from(
      form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
        "input, textarea, select",
      ),
    );
    const fieldsOut: PageContext["forms"][number]["fields"] = [];
    let positionalIdx = 0;
    const usedKeys = new Set<string>();
    for (const el of fieldEls) {
      if (fieldsOut.length >= MAX_FIELDS_PER_FORM) break;
      if (!isFieldFillable(el)) continue;
      // Skip submit / button / hidden / image — they're not data inputs.
      // Important: increment positionalIdx ONLY for real data inputs so
      // the `field_<n>` numbering matches what the fill-side resolver
      // computes when it filters the same kinds out.
      if (el instanceof HTMLInputElement) {
        const t = el.type;
        if (t === "submit" || t === "button" || t === "reset" || t === "hidden" || t === "image" || t === "file") continue;
      }
      const rawName = el.getAttribute("name") || "";
      const rawId = el.getAttribute("id") || "";
      // Agent-callable identifier. Priority: name > id > positional.
      // Collisions (e.g. two anonymous fields both falling back to the
      // same id) are rare but we de-dup to keep the values dict keyable.
      let name = rawName || rawId || `field_${positionalIdx}`;
      if (usedKeys.has(name)) {
        name = `${name}__${positionalIdx}`;
      }
      usedKeys.add(name);
      positionalIdx++;
      const label = fieldLabel(el) || name;
      const type =
        el instanceof HTMLInputElement
          ? el.type
          : el.tagName.toLowerCase();
      const entry: PageContext["forms"][number]["fields"][number] = {
        name,
        label: clampString(label, 100),
        type,
      };
      // Required flag — lets the agent prioritize mandatory fields and
      // treat optional ones as "do you want to add anything?" at the end.
      if ((el as HTMLInputElement).required === true) entry.required = true;
      // Placeholder — second-best label source (already used by
      // fieldLabel above when nothing better is available) but the
      // agent also benefits from the verbatim placeholder text as
      // an example value. e.g. placeholder="you@company.com" hints
      // that the field accepts an email, even if `type` is just
      // "text".
      const placeholder = el.getAttribute("placeholder");
      if (placeholder) entry.placeholder = clampString(placeholder.trim(), 100);
      // Proactive HTML5 constraint surfacing (0.14.0). We DO NOT wait
      // for the browser to reject a bad fill and surface the
      // constraint via validationMessage — the agent gets the rules
      // up front and formats correctly the first time. Each attribute
      // is only emitted when actually present on the element, so the
      // PageContext payload stays small for bare-bones forms.
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        // minLength / maxLength are DOM properties (default -1 when
        // unset on input, -1 on textarea). The HTML attribute is the
        // ground truth — read the attribute, parse to number, skip
        // when missing or non-numeric.
        const minLenAttr = el.getAttribute("minlength");
        if (minLenAttr !== null) {
          const n = parseInt(minLenAttr, 10);
          if (!Number.isNaN(n) && n >= 0) entry.minLength = n;
        }
        const maxLenAttr = el.getAttribute("maxlength");
        if (maxLenAttr !== null) {
          const n = parseInt(maxLenAttr, 10);
          if (!Number.isNaN(n) && n >= 0) entry.maxLength = n;
        }
      }
      if (el instanceof HTMLInputElement) {
        // min / max / step are typed as string in the DOM (they can
        // be numeric OR ISO date/time depending on input.type, so we
        // can't safely numeric-parse here — preserve the host's
        // exact attribute value and let the agent interpret).
        const minAttr = el.getAttribute("min");
        if (minAttr !== null) entry.min = clampString(minAttr, 50);
        const maxAttr = el.getAttribute("max");
        if (maxAttr !== null) entry.max = clampString(maxAttr, 50);
        const stepAttr = el.getAttribute("step");
        if (stepAttr !== null) entry.step = clampString(stepAttr, 20);
        // Pattern is a JS regex source string. Clamp generously —
        // realistic patterns are short, anything 200+ chars is a
        // signal something's off.
        const patternAttr = el.getAttribute("pattern");
        if (patternAttr !== null) entry.pattern = clampString(patternAttr, 200);
        // Autocomplete is the semantic-meaning attribute (email,
        // given-name, tel, street-address, postal-code, etc.) — when
        // present, it's strictly more informative than `type` alone.
        // Don't surface "off" / "cc-*" — isFieldFillable would have
        // already filtered those, but defensive belt-and-suspenders.
        const acAttr = (el.getAttribute("autocomplete") || "").toLowerCase();
        if (acAttr && acAttr !== "off" && !acAttr.startsWith("cc-")) {
          entry.autocomplete = clampString(acAttr, 50);
        }
      }
      // Surface choices for <select> so the agent can offer them.
      // Skipped for native <input> with list= attribute (datalist) — those
      // would require a second querySelector and pages rarely use them.
      if (el instanceof HTMLSelectElement) {
        const opts: Array<{ value: string; label: string }> = [];
        for (let i = 0; i < el.options.length; i++) {
          if (opts.length >= MAX_OPTIONS_PER_FIELD) break;
          const o = el.options[i];
          if (!o) continue;
          // Drop the disabled placeholder ("Select a subject...") so the
          // agent doesn't offer it back as a real choice.
          if (o.disabled) continue;
          const value = o.value || "";
          const optLabel = (o.textContent || "").trim() || value;
          if (!value && !optLabel) continue;
          opts.push({ value, label: clampString(optLabel, 60) });
        }
        if (opts.length > 0) entry.options = opts;
      }
      // Live HTML5 validation message — empty string when valid. Lets
      // the agent verify a fill_form by calling get_page_context after
      // and checking each field's validationMessage.
      const vm =
        typeof (el as HTMLInputElement).validationMessage === "string"
          ? (el as HTMLInputElement).validationMessage
          : "";
      if (vm) entry.validationMessage = clampString(vm, 200);
      fieldsOut.push(entry);
    }
    formsArr.push({ id, intent, fields: fieldsOut });
  }

  // ── Apply 4 KB cap with priority drop ──────────────────────────────
  const ctx: PageContext = {
    url,
    title,
    pathname,
    regions,
    visibleText,
    visibleLinks,
    visibleFields,
    forms: formsArr,
    flow: detectFlow(doc),
    extras,
  };

  // Rough budget: drop fields → links → paragraphs (back of visibleText) → headings
  let total =
    bytesOf(JSON.stringify(ctx.regions)) +
    bytesOf(ctx.visibleText) +
    bytesOf(JSON.stringify(ctx.visibleLinks)) +
    bytesOf(JSON.stringify(ctx.visibleFields));
  while (total > MAX_OUTPUT_BYTES && ctx.visibleFields.length > 0) {
    ctx.visibleFields.pop();
    total = bytesOf(JSON.stringify(ctx.visibleFields));
  }
  while (total > MAX_OUTPUT_BYTES && ctx.visibleLinks.length > 0) {
    ctx.visibleLinks.pop();
    total -= 80; // approximation; rough but fast
  }
  if (bytesOf(ctx.visibleText) > MAX_OUTPUT_BYTES) {
    ctx.visibleText = clampString(ctx.visibleText, MAX_OUTPUT_BYTES - 100);
  }

  return ctx;
}

// Cache layer (1 second TTL). Keyed by pathname + scrollY + a cheap form
// signature. The form signature matters on a cold load of a client-rendered
// page: an SPA commonly mounts its <form> a few hundred ms after the route
// loads (e.g. behind a preloader), so a page-context read taken during that
// pre-render gap returns zero forms. Without the signature in the key, that
// empty snapshot is served back for the full 1s TTL and the agent never sees
// the form on a cold load — client-side navigation only dodged this because a
// pathname change calls clearPageContextCache() from AvatarWidget. Computing
// the signature is far cheaper than the full extractPageContext walk, so
// gating the cache on it keeps the cache's benefit (rapid repeat reads with an
// unchanged form set still hit) while staying fresh the moment a form appears.
let cached: { key: string; at: number; ctx: PageContext } | null = null;

// Cheap structural fingerprint of the page's forms — notices a form
// mounting/unmounting or gaining/losing fields without doing the full walk.
function formSignature(doc: Document): string {
  const forms = doc.querySelectorAll("form");
  let sig = `f${forms.length}`;
  forms.forEach((f) => {
    sig += `|${f.id || f.getAttribute("name") || ""}:${
      f.querySelectorAll("input,select,textarea").length
    }`;
  });
  return sig;
}

export function getCachedPageContext(
  extras?: Record<string, unknown>,
  opts: ExtractOptions = {},
): PageContext {
  const now = Date.now();
  const doc = opts.doc ?? (typeof document !== "undefined" ? document : null);
  const path =
    (typeof window !== "undefined" && window.location.pathname) || "/";
  const scroll = typeof window !== "undefined" ? window.scrollY : 0;
  const key = `${path}::${scroll}::${doc ? formSignature(doc) : ""}`;
  if (cached && cached.key === key && now - cached.at < 1000) {
    return cached.ctx;
  }
  const ctx = extractPageContext(extras, opts);
  cached = { key, at: now, ctx };
  return ctx;
}

export function clearPageContextCache() {
  cached = null;
}
