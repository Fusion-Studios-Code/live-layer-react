# @livelayer/react

Drop-in voice/video AI agent widget for React apps. The full-fidelity widget that powers [app.livelayer.studio](https://app.livelayer.studio), packaged for direct mount in your app's DOM (no iframe).

## Quickstart (5 minutes)

Three files, one published agent, working voice nav.

**1. Install**

```bash
npm install @livelayer/react
# or pnpm add @livelayer/react / yarn add @livelayer/react
```

**2. Get an agent ID** — go to [app.livelayer.studio](https://app.livelayer.studio), publish an agent, copy its ID (looks like `cmobfeluv000bju04ct1cqdb0`).

**3. Mount the widget** (Next.js App Router shown — works the same way in any React app):

```tsx
"use client";

import { AvatarWidget } from "@livelayer/react";
import "@livelayer/react/styles.css";
import { useRouter, usePathname } from "next/navigation";

export default function Layout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <>
      {children}
      <AvatarWidget
        agentId="cmobfeluv000bju04ct1cqdb0"
        pathname={pathname}
        onNavigate={(href) => router.push(href)}
        hideOn={["/privacy", "/terms", "/legal/*"]}
      />
    </>
  );
}
```

That's it. The widget docks bottom-right, the agent can navigate users to other pages by voice, and it stays out of the way on legal pages. The LiveKit session survives every SPA route change.

> **Common gotcha:** if the widget renders unstyled, check that you imported `@livelayer/react/styles.css`. It's a separate import to give consumers the option to scope styles.

---

## Structured data collection (0.12.0)

The agent can run guided, typed Q&A flows backed by LiveKit's [`voice.AgentTask`](https://docs.livekit.io/agents/logic/tasks/) + `beta.workflows.TaskGroup` primitives. **No new components, no special attributes — just write regular HTML forms.** Every `<form>` is auto-discovered.

```tsx
import { AvatarWidget } from "@livelayer/react";

function App() {
  return (
    <>
      <AvatarWidget
        agentId="agent_abc"
        onCollect={(result) => {
          // result.results keyed by field name — ship to your CRM.
          fetch("/api/leads", {
            method: "POST",
            body: JSON.stringify(result),
          });
        }}
      />

      {/* Plain HTML — the agent finds this. */}
      <form>
        <label>Email <input name="email" type="email" required /></label>
        <label>Company <input name="company" /></label>
        <button type="submit">Subscribe</button>
      </form>
    </>
  );
}
```

The agent infers each field's label from the wrapping `<label>` / `aria-label` / `placeholder`, infers the kind from `type=`, runs a TaskGroup when the visitor wants to fill the form by voice, normalizes each spoken answer per-kind, and paints values into the matching `[name="..."]` inputs live as it records each one. `onCollect` fires once with the typed payload when the run finishes.

**Streaming per-field updates** for a progress UI:

```tsx
import { useCollect } from "@livelayer/react";

function Progress() {
  const { fields, isCollecting, lastResult } = useCollect();
  return Object.entries(fields).map(([name, value]) => (
    <div key={name}>{name}: {value}</div>
  ));
}
```

**Opt-out** when you don't want a form / input visible to the agent:

```tsx
<form data-ll-skip>...</form>           // exclude the whole form
<input data-ll-private />               // exclude one input
<form data-ll-intent="request a demo">  // disambiguate (still visible)
```

`type="password"`, `autocomplete="cc-*"`, and `autocomplete="off"` are ALWAYS excluded — you don't have to mark them.

See [docs.livelayer.studio/develop/data-collection](https://docs.livelayer.studio/develop/data-collection) for the full result shape, dashboard-declared field lists, slide-level data collection, capability gating, and webhook delivery.

---

## Recipes

### 1. Voice navigation in Next.js / React Router

Pass your router into `onNavigate`. When the agent emits a `navigate` command, the widget calls your callback. The session never reloads.

```tsx
// Next.js App Router
import { useRouter } from "next/navigation";
const router = useRouter();
<AvatarWidget agentId="..." onNavigate={(href) => router.push(href)} />

// React Router v6
import { useNavigate } from "react-router-dom";
const navigate = useNavigate();
<AvatarWidget agentId="..." onNavigate={navigate} />
```

If you don't pass `onNavigate`, the widget falls back to (1) clicking a matching `<a href="...">` in the DOM (Next.js `<Link>` and React Router `<Link>` both intercept these), then (2) `history.pushState` for plain HTML pages. **It never uses `window.location` — that's a hard reload that would kill the call.**

You also need to register a `navigate` tool on your agent so it can emit the command. In your agent's tool schema:

```json
{
  "name": "navigate",
  "description": "Take the user to a different page on this site.",
  "parameters": {
    "type": "object",
    "properties": { "href": { "type": "string" } },
    "required": ["href"]
  }
}
```

When the LLM calls `navigate({ href: "/pricing" })`, your agent server publishes `{ type: "navigate", href: "/pricing" }` on the data channel. The widget handles the rest.

### 2. Hide on sensitive routes

```tsx
<AvatarWidget
  agentId="..."
  pathname={usePathname()}
  hideOn={["/privacy", "/terms", "/cookies", "/legal/**"]}
/>
```

Glob rules:
- `*` matches one path segment: `/admin/*` → `/admin/users` but not `/admin/users/edit`
- `**` matches any depth: `/admin/**` → `/admin`, `/admin/users`, `/admin/users/edit`
- A `RegExp` or function works too: `hideOn={[/^\/blog\/draft-.+$/, (p) => p.startsWith("/internal")]}`

The LiveKit session **stays alive** while hidden. When the user navigates back to an allowed route, the call resumes seamlessly.

`showOn` is the inverse — restrict to a whitelist. `hideOn` wins on collisions.

### 3. Let the agent see the page

When the agent asks "what's the user looking at?", the widget walks the DOM and sends back a structured snapshot. You don't need to do anything for this to work, but you can guide it with `<LiveLayerRegion>`:

```tsx
import { LiveLayerRegion } from "@livelayer/react";

<LiveLayerRegion id="pricing" intent="show pricing tiers">
  <PricingTable />
</LiveLayerRegion>
```

This renders a `<div data-ll-region="pricing" data-ll-intent="show pricing tiers">` that the page-context extractor surfaces with priority. The `intent` is author-language for the agent.

To register the agent-side tool:

```json
{
  "name": "getPageContext",
  "description": "Snapshot of what the user is currently looking at — useful when they ask 'what is this' or 'show me the X'.",
  "parameters": { "type": "object", "properties": {} }
}
```

When the LLM calls it, your agent publishes `{ type: "request_page_context" }` and waits for the widget's `{ type: "page_context", context: {...} }` response (typically <100ms).

You can override the default extractor entirely:

```tsx
<AvatarWidget
  getPageContext={() => ({
    url: window.location.href,
    pathname: window.location.pathname,
    title: document.title,
    regions: [{ id: "cart", text: cartSummary }],
    visibleText: "",
    visibleLinks: [],
    visibleFields: [],
  })}
/>
```

Or attach extra app state without replacing the walker:

```tsx
<AvatarWidget
  pageContextExtras={{ userId: user.id, cartItemCount: items.length }}
/>
```

### 4. Let the agent click + scroll + fill forms (0.4.0)

**Click anything the agent should be able to trigger**: tag interactive elements with `data-ll-action` (or any selector you want — `button[aria-label="..."]` works too).

```tsx
<button data-ll-action="open-pricing-modal" onClick={openPricing}>
  See pricing
</button>
```

The agent emits `{ type: "click", selector: "[data-ll-action='open-pricing-modal']" }` and the widget triggers a click. **Use `onNavigate` for nav-shaped clicks** — `click` is for buttons, dialog toggles, expand/collapse, etc.

**Page scrolling**: the agent can call `scroll_page` with `direction: "up" | "down" | "top" | "bottom"`. Default behavior scrolls the window by ±1 viewport height. Override with `onScrollPage` for custom scroll containers.

**Forms** — auto-discovered. Just write regular HTML:

```tsx
<form onSubmit={handleSubmit}>
  <label>Name <input name="name" /></label>
  <label>Email <input name="email" type="email" /></label>
  <label>Message <textarea name="message" /></label>
  <button type="submit">Send</button>
</form>
```

The agent sees these in `PageContext.forms` and calls:
- `fill_form` — sets values via the canonical native-setter pattern (your `onChange` listeners fire correctly). Use when the agent already has all the answers.
- `collect_from_page` — runs a guided sub-conversation that asks for each field one at a time, normalizes spoken input per kind (email letter-by-letter, phone digit grouping, etc), and delivers a typed `onCollect` payload. Use when the visitor wants to fill the form by voice. See [Structured data collection](#structured-data-collection-0120) above.
- `submit_form` — calls `form.requestSubmit()`. Publishes `{ type: "form_submitted", formId }` on success or `{ type: "form_submit_blocked", formId, reason: "validation" }` on HTML5 validation failure.

Form IDs are inferred from the form's existing `id` / `name` attribute, falling back to a `data-ll-intent` slug, finally `form_<index>`.

**Opt-out for privacy**: `<form data-ll-skip>...</form>` and `<input data-ll-private />` keep things out of the agent's view. `type="password"`, `autocomplete="cc-*"`, and `autocomplete="off"` are ALWAYS excluded — card fields belong in Stripe Elements; we will not be the rail.

**Routes**: the agent can call `request_routes` to get up to 200 deduped `<a href>` entries from the page (internal flagged separately from external). Useful for "where can I go?" prompts.

### 5. Restrict what the agent can do (0.4.0)

Compliance / safety knob: pass an allowlist.

```tsx
<AvatarWidget
  agentId="..."
  capabilities={["read_page", "navigate", "scroll", "fill_forms"]}
  // not in list: "click", "submit_forms"
/>
```

| Capability | Commands gated |
|---|---|
| `navigate` | `navigate` |
| `scroll` | `scroll_to`, `scroll_page` |
| `click` | `click` |
| `fill_forms` | `fill_form`, `focus_field` |
| `submit_forms` | `submit_form` |
| `read_page` | `request_page_context`, `request_routes` |

Default (`capabilities` undefined) = all enabled. **Recommended starter**: omit `submit_forms` for the first few weeks of production. Filling is reversible, submitting isn't.

### 6. Persist the session across pages (multi-page apps)

For SPAs (Next.js, Remix, React Router), mount the widget at the app root and the session survives route changes automatically. For multi-page apps where the entire React tree unmounts, use `controlledSession` to own the LiveKit Room yourself and keep it alive across reloads. See [the `ControlledSession` interface](src/AvatarWidget.tsx) for the contract.

### 7. Custom branding

```tsx
<AvatarWidget
  branding={{
    primaryColor: "#0ea5e9",
    accentColor: "#f59e0b",
    productName: "Acme Concierge",
    logoUrl: "/logo.png",
  }}
/>
```

---

## API reference

### `<AvatarWidget>` (primary)

All props are optional except `agentId`.

| Prop | Type | Description |
|---|---|---|
| `agentId` | `string` | **Required.** The published agent ID. |
| `apiKey` | `string` | API key for cross-origin auth. Required if your agent isn't public. |
| `baseUrl` | `string` | Base URL of the LiveLayer API. Defaults to `https://app.livelayer.studio`. |
| `pathname` | `string` | Current pathname. **Required for Next.js App Router and React Router v6+.** Pass `usePathname()` / `useLocation().pathname`. |
| `showOn` | `RoutePattern[]` | Render only on matching paths. |
| `hideOn` | `RoutePattern[]` | Never render on matching paths. Wins over `showOn`. |
| `onNavigate` | `(href: string) => void` | Called on agent `navigate` command. Wire to your router. |
| `onScrollToSelector` | `(sel, behavior?) => void` | Called on agent `scroll_to` command. Default: `scrollIntoView({ behavior: "smooth" })`. |
| `onScrollPage` | `(direction, behavior?) => void` | Called on agent `scroll_page` command. Default: `window.scrollBy` / `scrollTo`. |
| `onClick` | `(selector: string) => void` | Called on agent `click` command. Default: `document.querySelector(selector)?.click()`. |
| `getPageContext` | `() => PageContext \| Promise<PageContext>` | Override the default DOM walker. |
| `pageContextExtras` | `Record<string, unknown>` | Extra app state attached to every page context snapshot. |
| `capabilities` | `AgentCapability[]` | Allowlist gating which commands the agent can run. |
| `position` | `"top-left" \| "top-right" \| "bottom-left" \| "bottom-right" \| "custom"` | Where the widget docks. Defaults to `"bottom-right"`. |
| `defaultDisplayMode` | `"hidden" \| "minimized" \| "expanded"` | Initial display mode. |
| `branding` | `BrandingConfig` | Colors, product name, logo. |
| `teamMembers` | `TeamMember[]` | Multi-agent picker. |
| `controlledSession` | `ControlledSession` | Bring-your-own LiveKit Room. |
| `onAgentCommand` | `(cmd) => void` | Receive non-universal data-channel commands. |
| `onAgentEvent` | `(e) => void` | Receive ALL data-channel events (including the universal ones). |

### `<LiveLayerRegion>` (page-context primitive)

```tsx
<LiveLayerRegion id="pricing" intent="show pricing tiers" as="section">
  ...
</LiveLayerRegion>
```

Renders a wrapper element with `data-ll-region` + `data-ll-intent` that the page-context extractor prioritizes.

### `<LiveLayerForm>` + `<LiveLayerField>` (form primitives, 0.4.0)

```tsx
<LiveLayerForm id="signup" intent="create account" onSubmit={handleSubmit}>
  <LiveLayerField name="email" label="Email" type="email" />
  <LiveLayerField name="bio" as="textarea" label="Bio" />
  <LiveLayerField name="role" as="select" label="Role">
    <option value="dev">Developer</option>
    <option value="pm">PM</option>
  </LiveLayerField>
  <button type="submit">Sign up</button>
</LiveLayerForm>
```

Equivalent to raw HTML with `data-ll-form` + `data-ll-field` attributes. Untagged forms remain invisible to the agent.

### Hooks (power users)

`useLiveKitSession`, `useDisplayMode`, `useAgentInfo`, `usePathname`, `useRouteMatch`, `useAudioLevel`, `useMicrophoneState`, `useCameraState`, `useScreenShareState`, `useMediaDevices`, `useTranscript`. All exported from the package root.

### Types

`AvatarWidgetProps`, `RoutePattern`, `PageContext`, `AgentCommand`, `AgentEventDetail`, `TeamMember`, `BrandingConfig`, `WidgetPosition`, `DisplayMode`. All exported from the package root.

---

## Privacy

The default page-context walker **never** extracts:

- Form values (only labels and field types)
- Inputs with `type="password"`
- Inputs with `autocomplete="cc-*"` or `autocomplete="off"`
- Elements (and their subtrees) with `data-ll-private="true"`
- The widget itself (`.ll-widget`)

To redact additional content:

```tsx
<div data-ll-private="true">
  <UserBankAccount />
</div>
```

Or override `getPageContext` entirely to control exactly what reaches the agent.

---

## Migrating from 0.2.x

0.3.0 is **additive**. All existing 0.2.x code continues to work without changes.

**Soft breaking — observability only:** the data-channel commands `navigate`, `scroll_to`, and `request_page_context` are now handled internally by the widget and no longer reach `onAgentCommand`. If you previously observed them via that callback (unlikely — they were never emitted in 0.2.x), switch to `onAgentEvent`, which still fires for every message.

---

## Errors and warnings

Every console message from this package starts with `[LiveLayer]` and includes a doc URL. Examples:

```
[LiveLayer] Agent emitted "navigate" without href. Skipping.
            Check your agent's tool schema.
            See https://livelayer.studio/docs/errors/navigate-missing-href

[LiveLayer] scroll_to: no element matched "#pricing-table".
            The user may be on a different page.
            See https://livelayer.studio/docs/errors/scroll-no-match
```

If you see one of these in production, the doc URL has the explanation and remediation.

---

## Legacy: `<LiveLayerWidget>`

The thin web-component wrapper from 0.1.x is still exported for backwards compatibility. New apps should use `<AvatarWidget>`.

```tsx
import { LiveLayerWidget } from "@livelayer/react";
<LiveLayerWidget agentId="..." />
```

---

## Peer dependencies

- `react` >= 18.0.0
- `react-dom` >= 18.0.0

No router peer dependency. Works with Next.js App Router, Next.js Pages Router, React Router (any version), Remix, TanStack Router, or no router at all.

## License

MIT
