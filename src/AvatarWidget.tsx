"use client";

// ─── AvatarWidget ─────────────────────────────────────────────────────
//
// Top-level orchestrator. Wires hooks to layouts, routes agent commands,
// and manages the state machines for displayMode + team switching.
//
//   ┌────────────────────────── AvatarWidget ─────────────────────────┐
//   │                                                                  │
//   │  Props ─────────────┬──► useDisplayModePersistence ─► displayMode│
//   │                     ├──► useIsMobile               ─► isMobile   │
//   │                     ├──► useLiveKitSession         ─► session    │
//   │                     ├──► useMicrophoneState        ─► mic        │
//   │                     └──► useAudioLevel             ─► audioLevel │
//   │                                                                  │
//   │                            ▼                                     │
//   │                    displayMode switches                          │
//   │                            ▼                                     │
//   │        ┌───────────┬───────────────┬──────────────┐              │
//   │        │  Hidden   │   Minimized   │   Expanded   │              │
//   │        └───────────┴───────────────┴──────────────┘              │
//   │                                                                  │
//   │  Universal agent commands → internal handlers                    │
//   │  Non-universal commands → onAgentCommand(cmd) callback           │
//   │  All commands → onAgentEvent({eventName, data}) for observability│
//   │                                                                  │
//   └──────────────────────────────────────────────────────────────────┘
//
// Display mode state machine:
//
//    ┌──────────┐ toggle ┌───────────┐ toggle ┌──────────┐
//    │  hidden  │◄──────►│ minimized │◄──────►│ expanded │
//    └──────────┘        └───────────┘        └──────────┘
//
// Team switch flow (full reconnect per user decision):
//   user clicks ▼ → onToggleTeamSwitcher
//   user picks Dean → setIsSwitchingTeamMember(true)
//                   → session.disconnect()
//                   → effective agentId changes (via currentTeamMember.agentId)
//                   → useLiveKitSession effect re-runs (new session)
//                   → user connects → setIsSwitchingTeamMember(false)

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import type {
  AgentState,
  ConnectionState,
  TranscriptEntry,
} from "@livelayer/sdk";

/**
 * Fully-controlled session state. When a consumer supplies this, the widget
 * does NOT create its own LiveKitSession — it presents the state you give it
 * and calls your onConnect/onDisconnect/onRawMessage when the user clicks
 * buttons. Use this when you need cross-page persistence, a shared room
 * across multiple widget instances, or any custom session lifecycle.
 *
 * When omitted, the widget manages its own session via useLiveKitSession.
 */
export interface ControlledSession {
  connectionState: ConnectionState;
  agentState: AgentState;
  transcript: TranscriptEntry[];
  videoElement: HTMLVideoElement | null;
  audioElement: HTMLAudioElement | null;
  canResume: boolean;
  error: string | null;
  /** Called when the user clicks the Connect/Start button. */
  onConnect: () => void | Promise<void>;
  /** Called when the user clicks End/Disconnect. */
  onDisconnect: () => void;
  /**
   * Subscribe to data-channel messages from the agent. The widget uses this
   * to route universal commands (state/agent_state) internally and forward
   * everything else via onAgentCommand. Return an unsubscribe function.
   */
  subscribeToDataMessages?: (
    cb: (msg: Record<string, unknown>) => void,
  ) => () => void;

  /**
   * Publish a JSON payload over the host-owned LiveKit data channel.
   * REQUIRED for the typed-message input and any imperative `sendData`
   * calls to actually reach the agent in controlled mode — the widget
   * has no other way to publish since the consumer owns the Room.
   * The host should wire this to its `room.localParticipant.publishData`.
   * No-op when omitted (typed messages silently drop).
   */
  publishData?: (data: Record<string, unknown>) => void | Promise<void>;

  /**
   * Return the host-owned LiveKit Room (or null if not yet connected).
   * Lets the widget's camera + screen-share hooks attach to your Room
   * so the toolbar buttons actually publish tracks. Without this hook
   * the camera and screen-share toggles are no-ops in controlled mode.
   *
   * Microphone is intentionally NOT wired through this — controlled
   * consumers usually manage mic publishing themselves, so the widget
   * leaves it alone to avoid a duplicate-track conflict.
   *
   * Type is `unknown` to keep the package free of a hard livekit-client
   * peerDep — cast to `Room` on the host side.
   */
  getRoom?: () => unknown | null;
}

/**
 * Imperative methods exposed via forwardRef. Consumers attach a ref to
 * <AvatarWidget> and call these methods directly — used when the widget
 * needs to publish data to the agent in response to host-side events
 * (e.g. user clicked a layout button, picked a quiz answer, etc.).
 */
export interface AvatarWidgetHandle {
  /**
   * Publish a JSON-serializable object over the LiveKit data channel
   * (reliable). No-ops if the session isn't connected yet. Returns a
   * promise that resolves when the publish completes; rejects on
   * publish failure (extremely rare in practice — the LiveKit SDK
   * queues unreliable transports automatically).
   */
  sendData: (data: Record<string, unknown>) => Promise<void>;
}

import { ErrorBoundary } from "./ErrorBoundary";
import { useLiveKitSession } from "./hooks/useLiveKitSession";
import { useAudioLevel } from "./hooks/useAudioLevel";
import { useMicrophoneState } from "./hooks/useMicrophoneState";
import { useCameraState } from "./hooks/useCameraState";
import { useScreenShareState } from "./hooks/useScreenShareState";
import { useMediaDevices } from "./hooks/useMediaDevices";
import { useAgentInfo } from "./hooks/useAgentInfo";
import { useDisplayModePersistence } from "./hooks/useDisplayModePersistence";
import { useIsMobile } from "./hooks/useIsMobile";
import { usePathname } from "./hooks/usePathname";
import { useRouteMatch } from "./hooks/useRouteMatch";
import {
  useSoundEffects,
  type SoundEffectsConfig,
} from "./hooks/useSoundEffects";
import { HiddenLayout } from "./layouts/HiddenLayout";
import { MinimizedLayout } from "./layouts/MinimizedLayout";
import { ExpandedLayout } from "./layouts/ExpandedLayout";
import {
  getCachedPageContext,
  clearPageContextCache,
} from "./utils/extractPageContext";
import {
  getCachedRoutes,
  clearRoutesCache,
  normalizeRouteInput,
} from "./utils/extractRoutes";
import { isFieldFillable } from "./utils/fieldPrivacy";
import { fillField } from "./utils/fillField";
import { findFormByLooseId } from "./utils/findFormByLooseId";
import {
  pickScrollContainer,
  getViewportHeight,
  getMaxScroll,
} from "./utils/pickScrollContainer";
import type {
  AgentCommand,
  AgentEventDetail,
  BrandingConfig,
  DisplayMode,
  TeamMember,
  WidgetPosition,
} from "./types";

// Agent commands we handle internally via the SDK's typed callbacks.
// All other commands pass through to onAgentCommand for host-specific logic.
const UNIVERSAL_COMMAND_TYPES = new Set([
  "agent_state",
  "avatar_stream_ready",
  "avatar_active",
  "avatar_idle",
  "bot_ready",
  "agent_error",
  "idle_warning",
  "idle_timeout",
  // 0.3.0 — page-aware commands. Handled internally by the widget.
  // Consumers who want observability subscribe via onAgentEvent (which
  // fires for every message including these).
  "navigate",
  "scroll_to",
  "request_page_context",
  // 0.4.0 — interaction commands
  "scroll_page",
  "click",
  "fill_form",
  "focus_field",
  "submit_form",
  "request_routes",
  // 0.12.0 — structured collection (unified API).
  // Both `task_field_updated` and `task_completed` data-channel commands
  // fan out into a single document-level `ll-collected` CustomEvent
  // (discriminated on phase) that `useCollect()` listens for, plus
  // `onCollect` on AvatarWidget for one-shot delivery. Not bubbled
  // to onAgentCommand.
  "task_field_updated",
  "task_completed",
]);

export interface AvatarWidgetProps {
  // ── Connection ───────────────────────────────────────────────
  agentId: string;
  apiKey?: string;
  baseUrl?: string;
  sessionEndpoint?: string;
  sessionBody?: Record<string, unknown>;

  /**
   * UI sound effects (mirrors the dashboard): a chime on navigate, a
   * confirmation on fill/submit, a soft loop while the agent is
   * thinking. Pass `false` to disable everything, or an object to
   * disable individual categories. Default is enabled.
   */
  soundEffects?: SoundEffectsConfig;

  // ── Mode ─────────────────────────────────────────────────────
  experienceMode?: "WIDGET" | "EMBEDDED";
  autoConnect?: boolean;

  // ── Display state ────────────────────────────────────────────
  displayMode?: DisplayMode;
  defaultDisplayMode?: DisplayMode;
  onDisplayModeChange?: (m: DisplayMode) => void;

  // ── Positioning ──────────────────────────────────────────────
  position?: WidgetPosition;
  mobileBreakpoint?: number | false;

  // ── Persistence ──────────────────────────────────────────────
  persistKey?: string;
  disablePersistence?: boolean;

  // ── Team switching ───────────────────────────────────────────
  teamMembers?: TeamMember[];
  currentTeamMemberId?: string;
  onTeamMemberChange?: (m: TeamMember) => void;

  // ── Content overrides ────────────────────────────────────────
  avatarImageUrl?: string;
  idleLoopUrl?: string;
  greeting?: string;
  agentName?: string;

  // ── Branding ─────────────────────────────────────────────────
  branding?: BrandingConfig;

  // ── Capability toggles ───────────────────────────────────────
  allowCamera?: boolean;
  allowScreenShare?: boolean;
  allowTyping?: boolean;
  allowMic?: boolean;

  // ── Chrome toggles ───────────────────────────────────────────
  /**
   * Show the minimize ("—") button in the expanded layout's header.
   * Default `true`. Set to `false` on hosts where minimize doesn't
   * make sense — e.g. fullscreen `/a/<slug>` (the widget IS the
   * experience) or tightly-embedded marketing slots.
   */
  showMinimize?: boolean;

  /**
   * Show the close ("×") button in the expanded layout's header
   * (both the active topbar and the idle header). Default `true`.
   * Set to `false` on hosts where dismissing the widget makes no
   * sense — fullscreen `/a/<slug>` experiences are the canonical
   * case (the widget IS the page; there's nowhere for it to go),
   * and any host that wraps the widget in its own dismiss UI.
   */
  showClose?: boolean;

  /**
   * Hide the top header (agent name, language, state) and the
   * bottom media-control bar. Used in tight embedded slots where
   * the video should fill the surface (e.g. the marketing fork
   * card at ~180×260). The close button still renders so visitors
   * can dismiss the widget. Default `false`.
   */
  chromeless?: boolean;

  /**
   * Container element that the floating chrome (HiddenLayout side-tab,
   * MinimizedLayout pill / bottom-bar) portals into. Default is
   * `document.body` — the side-tab anchors to the viewport edge, which
   * is the right behavior for a globally-docked widget like fssn.co
   * or the marketing customization avatar.
   *
   * Pass an HTMLElement (or its ref's `.current`) to scope the floating
   * chrome to a specific container — e.g. a fork-demo card on a
   * marketing page where the side-tab should sit at the card's edge,
   * not the page edge. The container needs `position: relative` for
   * the chrome's absolute positioning to anchor correctly.
   *
   * Default: `null` → document.body.
   */
  floatingChromeContainer?: HTMLElement | null;

  /**
   * Compact bottom toolbar that hides the top header (agent name +
   * language + state pills) and tucks secondary controls (camera,
   * screen-share, speaker, language, typing) behind an overflow
   * menu (•••) anchored to the toolbar. Mic and end-call stay
   * visible. Pair with `experienceMode="EMBEDDED"` for tight slots
   * like a mobile-corner customization avatar where the standard
   * chrome would obscure the video.
   *
   * Default: false (preserves existing layout for all callers).
   */
  compactControls?: boolean;

  // ── Transforming overlay ─────────────────────────────────────
  /**
   * When true, render a centered spinner + label overlay above the video
   * and any other state overlays (Connecting, Loading avatar, etc.).
   *
   * Caller-controlled — flip this on while the consumer's app is in the
   * middle of a swap operation that the widget can't observe directly
   * (avatar URL change, voice change, agent handoff in progress, etc.).
   * The overlay wins over connection-state overlays for as long as the
   * caller keeps it true.
   */
  transforming?: boolean;
  /**
   * Optional caption shown beneath the spinner when `transforming` is true.
   * Defaults to "Transforming…".
   */
  transformingLabel?: string;

  // ── Route filtering (0.3.0) ──────────────────────────────────
  /**
   * Patterns where the widget MAY render. If set, widget renders ONLY on
   * matching paths. See `RoutePattern` for accepted forms (string globs,
   * RegExp, or function predicate). Mutually compatible with `hideOn`.
   *
   * Pass `pathname` alongside this prop in Next.js / React Router apps.
   */
  showOn?: import("./types").RoutePattern[];

  /**
   * Patterns where the widget will NEVER render. Wins over showOn.
   * Common safe defaults: `["/privacy", "/terms", "/legal/*"]`.
   */
  hideOn?: import("./types").RoutePattern[];

  /**
   * Current pathname. REQUIRED for Next.js App Router and React Router v6+
   * because their internal routers update before window.location does.
   *
   * @example
   * import { usePathname } from "next/navigation";
   * <AvatarWidget pathname={usePathname()} hideOn={["/privacy"]} />
   */
  pathname?: string;

  // ── Navigation (0.3.0) ───────────────────────────────────────
  /**
   * Called when the agent emits a `navigate` command. Wire to your
   * router. If omitted, the widget falls back to (1) clicking a
   * matching anchor (so Next/RR Link interceptors fire) and then
   * (2) `history.pushState` for plain HTML sites. `window.location`
   * is NEVER used — that would trigger a full reload and kill the
   * session.
   */
  onNavigate?: (href: string) => void;

  /**
   * Called when the agent emits a `scroll_to` command. Default:
   * scrolls the matched element into view smoothly. Override to
   * customize easing or skip the scroll entirely.
   */
  onScrollToSelector?: (selector: string, behavior?: "smooth" | "instant") => void;

  // ── Page context (0.3.0) ─────────────────────────────────────
  /**
   * Override the default DOM walker. Receives the consumer's
   * `pageContextExtras` and returns a structured context for the
   * agent. Useful for filtering sensitive content or prepending app
   * state that's not in the DOM.
   */
  getPageContext?: (
    extras?: Record<string, unknown>,
  ) => import("./types").PageContext | Promise<import("./types").PageContext>;

  /** Free-form metadata bag the agent should always know about. */
  pageContextExtras?: Record<string, unknown>;

  /**
   * Override the default DOM walker for the agent's `request_routes`
   * command. Use this when your real route list lives in a database
   * (dynamic project pages, blog posts, etc.) that's not reflected in
   * the page's `<a href>` elements. Each entry can include richer
   * `title` / `description` than a raw href, so the agent can match
   * user intent ("take me to that healthcare project") without
   * scraping content.
   *
   * @example
   * <AvatarWidget
   *   getRoutes={async () => {
   *     const projects = await fetch("/api/projects").then(r => r.json());
   *     return [
   *       { href: "/", title: "Home" },
   *       { href: "/work", title: "All projects" },
   *       ...projects.map(p => ({
   *         href: `/work/${p.slug}`,
   *         title: p.name,
   *         description: p.tags?.join(", "),
   *       })),
   *     ];
   *   }}
   * />
   */
  getRoutes?: () =>
    | import("./utils/extractRoutes").RouteEntryInput[]
    | Promise<import("./utils/extractRoutes").RouteEntryInput[]>;

  // ── Interaction (0.4.0) ──────────────────────────────────────
  /**
   * Called on agent `scroll_page` commands. Default: scrolls window
   * by ±1 viewport height (or to top/bottom). Override to scroll a
   * custom container.
   */
  onScrollPage?: (
    direction: "up" | "down" | "top" | "bottom",
    behavior?: "smooth" | "instant",
  ) => void;

  /**
   * Called on agent `click` commands. Default: dispatches click on
   * the matched element. Override to add safety checks or block
   * specific selectors. **Use `onNavigate` for nav-shaped clicks** —
   * `click` here is for non-nav buttons / dialogs / state toggles.
   */
  onClick?: (selector: string) => void;

  // ── Capabilities (0.4.0) ─────────────────────────────────────
  /**
   * Restrict what the agent's commands can do. If undefined, ALL
   * capabilities are allowed (default — matches 0.3.x behavior).
   *
   * Available capabilities:
   *   "navigate"     — navigate command
   *   "scroll"       — scroll_to + scroll_page
   *   "click"        — click
   *   "fill_forms"   — fill_form + focus_field
   *   "submit_forms" — submit_form
   *   "read_page"    — request_page_context + request_routes
   */
  capabilities?: import("./types").AgentCapability[];

  // ── Lifecycle callbacks ──────────────────────────────────────
  onConnect?: () => void;
  onDisconnect?: () => void;
  onTranscript?: (entries: TranscriptEntry[]) => void;
  onAgentState?: (state: AgentState) => void;
  onConnectionStateChange?: (state: ConnectionState) => void;

  // ── Event bridge ─────────────────────────────────────────────
  onAgentEvent?: (e: AgentEventDetail) => void;
  onAgentCommand?: (cmd: AgentCommand) => void;

  // ── Structured data collection (0.12.0 — unified API) ───────
  /**
   * Fires once when the agent finishes a structured collection run.
   * One callback covers every collection surface:
   *
   *   - `source: "page"`  — agent walked the visitor through an
   *                          on-page <form> (auto-discovered). The
   *                          values already painted into the matching
   *                          inputs live as they were recorded.
   *   - `source: "agent"` — dashboard-declared field list (Behavior →
   *                          Data collection in the agent editor).
   *   - `source: "slide"` — slide-level form_fields (slide editor's
   *                          Data collection toggle).
   *
   * Typical use: ship the typed payload to your backend.
   *
   *   <AvatarWidget
   *     agentId="..."
   *     onCollect={(r) => fetch("/api/leads", { method: "POST",
   *       body: JSON.stringify(r) })}
   *   />
   *
   * For streaming per-field updates use the `useCollect()` hook
   * instead. Don't write to `<input value=...>` from inside this
   * callback — the SDK already auto-painted matching inputs by their
   * `name` attribute before this fires.
   */
  onCollect?: (result: {
    sessionId: string;
    startedAt: string;
    endedAt: string;
    source: "agent" | "slide" | "page";
    slideId?: string;
    formId?: string;
    results: Record<
      string,
      { fieldId: string; fieldName: string; value: string; kind: string }
    >;
    summary?: string;
  }) => void;

  // ── Controlled session (advanced) ────────────────────────────
  /**
   * When provided, the widget does not create its own LiveKit session.
   * The consumer owns connection lifecycle. Use for cross-page
   * persistence, shared rooms, or integration with existing Room logic.
   */
  controlledSession?: ControlledSession;

  // ── Container ────────────────────────────────────────────────
  className?: string;
  style?: CSSProperties;
  zIndex?: number;
}

const AvatarWidgetInner = forwardRef<AvatarWidgetHandle, AvatarWidgetProps>(
  function AvatarWidgetInner(props, ref) {
  const {
    agentId: agentIdProp,
    apiKey,
    baseUrl = "https://app.livelayer.studio",
    sessionEndpoint,
    sessionBody,
    soundEffects,
    experienceMode = "WIDGET",
    autoConnect = false,
    displayMode: controlledDisplayMode,
    defaultDisplayMode = "expanded",
    onDisplayModeChange,
    position = "bottom-right",
    mobileBreakpoint = 640,
    persistKey = "ll-widget",
    disablePersistence = false,
    teamMembers,
    currentTeamMemberId: controlledTeamMemberId,
    onTeamMemberChange,
    idleLoopUrl: idleLoopUrlProp,
    greeting: greetingProp,
    avatarImageUrl: avatarImageUrlProp,
    agentName: agentNameProp,
    branding = {},
    allowCamera = true,
    allowScreenShare = true,
    allowTyping = true,
    showMinimize: showMinimizeProp,
    showClose: showCloseProp,
    chromeless = false,
    floatingChromeContainer = null,
    compactControls = false,
    transforming = false,
    transformingLabel = "Transforming…",
    showOn,
    hideOn,
    pathname: controlledPathname,
    onNavigate,
    onScrollToSelector,
    getPageContext: getPageContextProp,
    pageContextExtras,
    getRoutes: getRoutesProp,
    onScrollPage,
    onClick: onClickProp,
    capabilities,
    onConnect,
    onDisconnect,
    onTranscript,
    onAgentState,
    onConnectionStateChange,
    onAgentEvent,
    onAgentCommand,
    onCollect,
    controlledSession,
    className,
    style,
    zIndex = 2_147_483_647,
  } = props;

  // ── Route filtering (0.3.0) ──────────────────────────────────
  // Hooks ALWAYS run (rules of hooks). The conditional `return null`
  // happens after the hook block so the LiveKit session, mic state,
  // etc. stay alive when the widget is hidden by route. This is the
  // critical correctness property: navigating to /privacy and back
  // preserves an active call.
  const pathname = usePathname(controlledPathname);
  const shouldRender = useRouteMatch(pathname, showOn, hideOn);

  // Bust both caches on pathname change so a new page's snapshot
  // doesn't return stale content.
  useEffect(() => {
    clearPageContextCache();
    clearRoutesCache();
  }, [pathname]);

  // ── Team member state (controlled or uncontrolled) ───────────
  const isControlledTeam = controlledTeamMemberId !== undefined;
  const [internalTeamMemberId, setInternalTeamMemberId] = useState<
    string | undefined
  >(() => controlledTeamMemberId ?? teamMembers?.[0]?.id);
  const currentTeamMemberId = isControlledTeam
    ? controlledTeamMemberId
    : internalTeamMemberId;
  const currentTeamMember = useMemo(
    () => teamMembers?.find((m) => m.id === currentTeamMemberId) ?? null,
    [teamMembers, currentTeamMemberId],
  );

  // Effective agentId: team member override wins, else top-level prop.
  const agentId = currentTeamMember?.agentId ?? agentIdProp;

  // ── Display mode ─────────────────────────────────────────────
  // Both WIDGET and EMBEDDED modes honor displayMode. In EMBEDDED, the
  // host owns positioning of the EXPANDED layout (it fills the host's
  // slot). When displayMode flips to MINIMIZED or HIDDEN, the package
  // PORTALS those layouts to document.body so their `position: fixed`
  // chrome anchors to the viewport — necessary because EMBEDDED hosts
  // commonly wrap the slot in a transformed ancestor (translateZ /
  // translate3d / scale), which would otherwise capture the
  // fixed-position chrome and pin it to the slot rather than the
  // viewport edge. Persistence still skipped in embedded so each
  // mount is its own scope.
  //
  // 0.10.1: EMBEDDED now locks displayMode to "expanded" in addition
  // to the CSS-side lock. The minimize / hide buttons in embedded
  // mode have no meaningful destination — there's nowhere to
  // minimize TO when the widget is rendered inline in a host slot —
  // and previously, clicking them flipped displayMode and triggered
  // the floating chrome to portal to document.body, which looked
  // like a stray chevron tab on the side of the page in
  // full-screen / slide-editor hosts. Force-locking here means even
  // a legacy controlled-mode caller can't drive displayMode away
  // from "expanded" while in EMBEDDED.
  const isEmbedded = experienceMode === "EMBEDDED";
  const [displayModeRaw, setDisplayModeRaw] = useDisplayModePersistence({
    value: controlledDisplayMode,
    defaultValue: defaultDisplayMode,
    onChange: onDisplayModeChange,
    persistKey,
    disablePersistence: isEmbedded || disablePersistence,
  });
  const displayMode: DisplayMode = isEmbedded ? "expanded" : displayModeRaw;
  const setDisplayMode: (m: DisplayMode) => void = isEmbedded
    ? () => {
        // EMBEDDED is locked to expanded — silently swallow the
        // minimize/hide call so existing chrome buttons don't crash,
        // they just become no-ops. Hosts that genuinely need to
        // minimize should mount the widget in WIDGET mode.
      }
    : setDisplayModeRaw;

  // EMBEDDED defaults the minimize / close affordances to OFF — when
  // the widget is locked to expanded, those buttons have nothing to
  // do, and rendering them invited the bug where users clicked them
  // expecting "close the preview" and got a portaled chevron tab on
  // the page edge. Hosts can still opt back in by passing the props
  // explicitly. WIDGET mode keeps the original true/true defaults.
  const showMinimize =
    showMinimizeProp ?? (isEmbedded ? false : true);
  const showClose = showCloseProp ?? (isEmbedded ? false : true);

  // ── Responsive ───────────────────────────────────────────────
  const isMobile = useIsMobile(mobileBreakpoint);

  // ── Audio level (shared) ─────────────────────────────────────
  const audioLevel = useAudioLevel();

  // ── Mic state ────────────────────────────────────────────────
  const mic = useMicrophoneState();

  // ── Camera / screen share / device list ──────────────────────
  const camera = useCameraState();
  const screen = useScreenShareState();
  const devices = useMediaDevices();

  // ── Local UI state ───────────────────────────────────────────
  const [needsUserGesture, setNeedsUserGesture] = useState(false);
  const [isSwitchingTeamMember, setIsSwitchingTeamMember] = useState(false);
  const [teamSwitcherOpen, setTeamSwitcherOpen] = useState(false);
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const [speakerMuted, setSpeakerMuted] = useState(false);

  // ── UI sound effects (chime / confirmation / thinking loop) ──
  // Mirrors lib/audio/play-sound.ts in the dashboard. Reads MP3s from
  // ${baseUrl}/audio/* — same files served from the live-layer Next.js
  // public folder. Per-agent admin disable plumbs through `soundEffects`.
  const sounds = useSoundEffects({ baseUrl, config: soundEffects });
  // Keep a ref so handleDataMessage doesn't have to list `sounds` in
  // its deps — same pattern as the other onXxxRef hooks in this file.
  const soundsRef = useRef(sounds);
  soundsRef.current = sounds;

  // ── Page-aware command refs ──────────────────────────────────
  // These refs hold the latest prop values so the long-lived
  // handleDataMessage callback doesn't churn identity (and trigger
  // re-renders / re-subscriptions) every time a parent re-renders.
  const onNavigateRef = useRef(onNavigate);
  const onScrollToSelectorRef = useRef(onScrollToSelector);
  const onScrollPageRef = useRef(onScrollPage);
  const onClickPropRef = useRef(onClickProp);
  const getPageContextRef = useRef(getPageContextProp);
  const pageContextExtrasRef = useRef(pageContextExtras);
  const getRoutesRef = useRef(getRoutesProp);
  const capabilitiesRef = useRef(capabilities);
  const roomGetterRef = useRef<(() => unknown) | null>(null);
  onNavigateRef.current = onNavigate;
  onScrollToSelectorRef.current = onScrollToSelector;
  onScrollPageRef.current = onScrollPage;
  onClickPropRef.current = onClickProp;
  getPageContextRef.current = getPageContextProp;
  pageContextExtrasRef.current = pageContextExtras;
  getRoutesRef.current = getRoutesProp;
  // Resolve capabilities: explicit prop wins, then prefetched agent
  // info (set by the agent owner in the Navigation tab), then undefined
  // (= unrestricted). The capabilitiesRef is what the data-channel
  // handler reads at command-dispatch time.
  capabilitiesRef.current = capabilities;

  // Capability gate. Returns true if the command is allowed under the
  // current allowlist. `undefined` = unrestricted (matches 0.3.x).
  function isAllowed(cap: import("./types").AgentCapability): boolean {
    const list = capabilitiesRef.current;
    if (!list) return true;
    return list.includes(cap);
  }
  function blockedWarn(cmdType: string, cap: string) {
    console.warn(
      `[LiveLayer] Agent command "${cmdType}" blocked — capability "${cap}" not in allowlist. ` +
        "See https://livelayer.studio/docs/react/capabilities",
    );
  }

  // ── Data-channel routing ─────────────────────────────────────
  const handleDataMessage = useCallback(
    (msg: Record<string, unknown>) => {
      const cmd = msg as unknown as AgentCommand;
      if (!cmd.type || typeof cmd.type !== "string") return;

      // Fire onAgentEvent for ALL messages — observability / telemetry.
      onAgentEvent?.({ eventName: cmd.type, data: msg });

      // Internal handlers for the 0.3.0 page-aware commands. These are
      // in UNIVERSAL_COMMAND_TYPES so they don't bubble up to
      // onAgentCommand. Consumers who want observability subscribe via
      // onAgentEvent (which fired above).
      if (cmd.type === "navigate") {
        if (!isAllowed("navigate")) {
          blockedWarn("navigate", "navigate");
          return;
        }
        const href = typeof cmd.href === "string" ? cmd.href : null;
        if (!href) {
          console.warn(
            "[LiveLayer] Agent emitted \"navigate\" without href. Skipping. " +
              "Check your agent's tool schema. " +
              "See https://livelayer.studio/docs/errors/navigate-missing-href",
          );
          return;
        }
        // Page-change chime — fired now that we know we're committed
        // to navigating. Mirrors the dashboard sound pattern.
        soundsRef.current.playPageChange();
        // 1. Consumer's router callback wins.
        if (onNavigateRef.current) {
          try {
            onNavigateRef.current(href);
          } catch (err) {
            console.warn(
              `[LiveLayer] onNavigate threw for "${href}". Falling back. Error:`,
              err,
            );
          }
          return;
        }
        // 2. Synthetic click on a matching anchor — Next.js / Remix /
        //    React Router intercept clicks at the document level.
        if (typeof document !== "undefined") {
          const anchor = document.querySelector<HTMLAnchorElement>(
            `a[href="${href.replace(/"/g, '\\"')}"]`,
          );
          if (anchor) {
            anchor.click();
            return;
          }
        }
        // 3. history.pushState — works on plain SPAs without a router
        //    library. Never use window.location, that's a hard reload.
        if (typeof window !== "undefined" && typeof history !== "undefined") {
          try {
            history.pushState({}, "", href);
            window.dispatchEvent(new PopStateEvent("popstate"));
          } catch (err) {
            console.warn(
              `[LiveLayer] history.pushState fallback failed for "${href}". ` +
                "Pass an onNavigate prop to use your router directly. " +
                "See https://livelayer.studio/docs/react/navigation",
              err,
            );
          }
        }
        return;
      }

      if (cmd.type === "scroll_to") {
        if (!isAllowed("scroll")) {
          blockedWarn("scroll_to", "scroll");
          return;
        }
        const selector =
          typeof cmd.selector === "string" ? cmd.selector : null;
        if (!selector) return;
        const behavior =
          cmd.behavior === "instant" ? "instant" : "smooth";
        if (onScrollToSelectorRef.current) {
          try {
            onScrollToSelectorRef.current(
              selector,
              behavior as "smooth" | "instant",
            );
          } catch (err) {
            console.warn("[LiveLayer] onScrollToSelector threw.", err);
          }
          return;
        }
        if (typeof document !== "undefined") {
          let el: Element | null = null;
          try {
            el = document.querySelector(selector);
          } catch {
            console.warn(
              `[LiveLayer] scroll_to: invalid selector "${selector}".`,
            );
            return;
          }
          if (!el) {
            console.warn(
              `[LiveLayer] scroll_to: no element matched "${selector}". ` +
                "The user may be on a different page. " +
                "See https://livelayer.studio/docs/errors/scroll-no-match",
            );
            return;
          }
          el.scrollIntoView({
            behavior: behavior as ScrollBehavior,
            block: "start",
          });
        }
        return;
      }

      if (cmd.type === "request_page_context") {
        if (!isAllowed("read_page")) {
          blockedWarn("request_page_context", "read_page");
          return;
        }
        // Echo the requestId on every response so the agent's
        // publishAndAwait correlates concurrent calls correctly.
        const requestId =
          typeof cmd.requestId === "string" ? cmd.requestId : undefined;
        const sender = roomGetterRef.current?.();
        const publish = (payload: Record<string, unknown>) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const room = sender as any;
          const localParticipant = room?.localParticipant;
          if (!localParticipant?.publishData) return;
          try {
            const out = requestId ? { ...payload, requestId } : payload;
            const data = new TextEncoder().encode(JSON.stringify(out));
            void localParticipant.publishData(data, { reliable: true });
          } catch (err) {
            console.warn("[LiveLayer] publishData failed.", err);
          }
        };

        const extras = pageContextExtrasRef.current;
        const custom = getPageContextRef.current;
        try {
          if (custom) {
            const maybe = custom(extras);
            if (maybe instanceof Promise) {
              publish({ type: "page_context_pending" });
              maybe
                .then((ctx) => publish({ type: "page_context", context: ctx }))
                .catch((err) => {
                  console.warn(
                    "[LiveLayer] getPageContext rejected; falling back to default walker.",
                    err,
                  );
                  publish({
                    type: "page_context",
                    context: getCachedPageContext(extras),
                  });
                });
              return;
            }
            publish({ type: "page_context", context: maybe });
            return;
          }
          publish({
            type: "page_context",
            context: getCachedPageContext(extras),
          });
        } catch (err) {
          console.warn(
            "[LiveLayer] page-context extraction threw. Sending empty context.",
            err,
          );
          publish({
            type: "page_context",
            context: { url: "", title: "", pathname: "/", regions: [], visibleText: "", visibleLinks: [], visibleFields: [], forms: [], extras },
          });
        }
        return;
      }

      // ── 0.4.0 — interaction commands ─────────────────────────
      if (cmd.type === "scroll_page") {
        if (!isAllowed("scroll")) {
          blockedWarn("scroll_page", "scroll");
          return;
        }
        const direction = cmd.direction;
        if (
          direction !== "up" &&
          direction !== "down" &&
          direction !== "top" &&
          direction !== "bottom"
        ) {
          console.warn(
            `[LiveLayer] scroll_page: invalid direction "${String(direction)}". ` +
              "Expected up | down | top | bottom.",
          );
          return;
        }
        const behavior = cmd.behavior === "instant" ? "instant" : "smooth";
        if (onScrollPageRef.current) {
          try {
            onScrollPageRef.current(
              direction,
              behavior as "smooth" | "instant",
            );
          } catch (err) {
            console.warn("[LiveLayer] onScrollPage threw.", err);
          }
          return;
        }
        if (typeof window === "undefined") return;
        const opts: ScrollToOptions = { behavior: behavior as ScrollBehavior };
        // Detect the actual scroll container. Many Next.js / portfolio
        // sites lock body height (overflow:hidden) and put scroll on an
        // inner div — naive `window.scrollBy` does nothing there.
        // Strategy: if the document scrolling element actually moves,
        // use it. Otherwise fall back to the largest scrollable element
        // currently in view.
        const target = pickScrollContainer();
        const scrollByPx = (deltaY: number) => {
          if (target instanceof Window) {
            target.scrollBy({ top: deltaY, ...opts });
          } else {
            target.scrollBy({ top: deltaY, ...opts });
          }
        };
        const scrollToY = (y: number) => {
          if (target instanceof Window) {
            target.scrollTo({ top: y, ...opts });
          } else {
            target.scrollTo({ top: y, ...opts });
          }
        };
        if (direction === "up") {
          scrollByPx(-getViewportHeight(target));
        } else if (direction === "down") {
          scrollByPx(getViewportHeight(target));
        } else if (direction === "top") {
          scrollToY(0);
        } else {
          scrollToY(getMaxScroll(target));
        }
        return;
      }

      if (cmd.type === "click") {
        if (!isAllowed("click")) {
          blockedWarn("click", "click");
          return;
        }
        const selector =
          typeof cmd.selector === "string" ? cmd.selector : null;
        if (!selector) {
          console.warn("[LiveLayer] click: missing selector.");
          return;
        }
        if (onClickPropRef.current) {
          try {
            onClickPropRef.current(selector);
          } catch (err) {
            console.warn("[LiveLayer] onClick threw.", err);
          }
          return;
        }
        if (typeof document === "undefined") return;
        let el: Element | null = null;
        try {
          el = document.querySelector(selector);
        } catch {
          console.warn(
            `[LiveLayer] click: invalid selector "${selector}".`,
          );
          return;
        }
        if (!el) {
          console.warn(
            `[LiveLayer] click: no element matched "${selector}". ` +
              "See https://livelayer.studio/docs/errors/click-no-match",
          );
          return;
        }
        // Privacy: never click into private subtrees.
        if (el.closest('[data-ll-private="true"], .ll-widget')) {
          console.warn(
            `[LiveLayer] click: refusing to click element inside a private subtree.`,
          );
          return;
        }
        (el as HTMLElement).click?.();
        return;
      }

      if (cmd.type === "fill_form" || cmd.type === "focus_field") {
        if (!isAllowed("fill_forms")) {
          blockedWarn(cmd.type, "fill_forms");
          return;
        }
        if (typeof document === "undefined") return;
        // Confirmation chime on fill (focus_field is just keyboard
        // movement, no chime — would feel noisy).
        if (cmd.type === "fill_form") {
          soundsRef.current.playConfirmation();
        }
        const formId = typeof cmd.formId === "string" ? cmd.formId : null;
        if (!formId) {
          console.warn(`[LiveLayer] ${cmd.type}: missing formId.`);
          return;
        }
        const form = findFormByLooseId(document, formId);
        if (!form) {
          console.warn(
            `[LiveLayer] ${cmd.type}: no <form> matched id="${formId}" (or matching name / data-ll-intent slug). ` +
              "Forms are auto-discovered — make sure the form has an `id`, `name`, or `data-ll-intent` attribute the agent observed in PageContext.forms.",
          );
          return;
        }
        if (form.closest('[data-ll-private="true"], [data-ll-skip], .ll-widget')) {
          console.warn(
            `[LiveLayer] ${cmd.type}: refusing to touch a form in a private / opted-out subtree.`,
          );
          return;
        }

        if (cmd.type === "focus_field") {
          const fieldName =
            typeof cmd.fieldName === "string" ? cmd.fieldName : null;
          if (!fieldName) {
            console.warn(`[LiveLayer] focus_field: missing fieldName.`);
            return;
          }
          const fld = form.querySelector<
            HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
          >(`[name="${fieldName.replace(/"/g, '\\"')}"]`);
          if (!fld) {
            console.warn(
              `[LiveLayer] focus_field: no input with name="${fieldName}" in form "${formId}".`,
            );
            return;
          }
          if (!isFieldFillable(fld)) {
            console.warn(
              `[LiveLayer] focus_field: field "${fieldName}" is privacy-protected and not focusable.`,
            );
            return;
          }
          fld.focus();
          return;
        }

        // fill_form
        const values =
          cmd.values && typeof cmd.values === "object"
            ? (cmd.values as Record<string, string>)
            : null;
        if (!values) {
          console.warn(`[LiveLayer] fill_form: missing or invalid values.`);
          return;
        }
        for (const [name, raw] of Object.entries(values)) {
          if (typeof raw !== "string") continue;
          const fld = form.querySelector<
            HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
          >(`[name="${name.replace(/"/g, '\\"')}"]`);
          if (!fld) {
            console.warn(
              `[LiveLayer] fill_form: no input with name="${name}" in form "${formId}". Skipping.`,
            );
            continue;
          }
          if (!isFieldFillable(fld)) {
            console.warn(
              `[LiveLayer] fill_form: field "${name}" is privacy-protected (password / cc-* / private). Skipping.`,
            );
            continue;
          }
          try {
            fillField(fld, raw);
          } catch (err) {
            console.warn(
              `[LiveLayer] fill_form: failed to set "${name}".`,
              err,
            );
          }
        }
        return;
      }

      if (cmd.type === "submit_form") {
        if (!isAllowed("submit_forms")) {
          blockedWarn("submit_form", "submit_forms");
          return;
        }
        if (typeof document === "undefined") return;
        const formId = typeof cmd.formId === "string" ? cmd.formId : null;
        if (!formId) {
          console.warn(`[LiveLayer] submit_form: missing formId.`);
          return;
        }
        // Confirmation chime — fired BEFORE submit; if validation
        // blocks, the chime still feels right because the agent did
        // the right thing, browser is just enforcing constraints.
        soundsRef.current.playConfirmation();
        const form = findFormByLooseId(document, formId);
        if (!form) {
          console.warn(
            `[LiveLayer] submit_form: no <form> matched id="${formId}" (or matching name / data-ll-intent slug).`,
          );
          return;
        }
        if (form.closest('[data-ll-private="true"], [data-ll-skip], .ll-widget')) {
          console.warn(
            `[LiveLayer] submit_form: refusing to submit a form in a private / opted-out subtree.`,
          );
          return;
        }
        // Listen for the submit event so we can publish form_submitted /
        // form_submit_blocked back to the agent. requestSubmit fires the
        // submit event AND runs HTML5 validation; if validation fails,
        // submit never fires and we time out → form_submit_blocked.
        const requestId =
          typeof cmd.requestId === "string" ? cmd.requestId : undefined;
        const sender = roomGetterRef.current?.();
        const publishResp = (payload: Record<string, unknown>) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const room = sender as any;
          const lp = room?.localParticipant;
          if (!lp?.publishData) return;
          try {
            const out = requestId ? { ...payload, requestId } : payload;
            const data = new TextEncoder().encode(JSON.stringify(out));
            void lp.publishData(data, { reliable: true });
          } catch {
            // best effort
          }
        };
        let fired = false;
        const onSubmit = () => {
          fired = true;
          publishResp({ type: "form_submitted", formId });
        };
        form.addEventListener("submit", onSubmit, { once: true });
        try {
          if (typeof form.requestSubmit === "function") {
            form.requestSubmit();
          } else {
            form.submit();
          }
        } catch (err) {
          console.warn("[LiveLayer] submit_form: requestSubmit threw.", err);
          form.removeEventListener("submit", onSubmit);
          publishResp({
            type: "form_submit_blocked",
            formId,
            reason: "exception",
          });
          return;
        }
        // Give the browser a tick for validation + submit. If the
        // submit event hasn't fired by then, treat as blocked.
        setTimeout(() => {
          if (!fired) {
            form.removeEventListener("submit", onSubmit);
            publishResp({
              type: "form_submit_blocked",
              formId,
              reason: "validation",
            });
          }
        }, 500);
        return;
      }

      if (cmd.type === "request_routes") {
        if (!isAllowed("read_page")) {
          blockedWarn("request_routes", "read_page");
          return;
        }
        const requestId =
          typeof cmd.requestId === "string" ? cmd.requestId : undefined;
        const sender = roomGetterRef.current?.();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const room = sender as any;
        const lp = room?.localParticipant;
        if (!lp?.publishData) return;

        const publish = (routes: import("./utils/extractRoutes").ExtractedRoute[]) => {
          try {
            const payload = requestId
              ? { type: "routes", routes, requestId }
              : { type: "routes", routes };
            const data = new TextEncoder().encode(JSON.stringify(payload));
            void lp.publishData(data, { reliable: true });
          } catch (err) {
            console.warn("[LiveLayer] request_routes: publishData failed.", err);
          }
        };

        // Consumer-supplied route source wins. This is the right answer
        // for sites with dynamic routes from a DB — the page DOM may
        // only have the prev/next nav links, but the consumer can fetch
        // the canonical list (e.g. /api/projects) and return it here.
        const custom = getRoutesRef.current;
        if (custom) {
          try {
            const result = custom();
            const handle = (input: unknown) => {
              if (!Array.isArray(input)) {
                publish([]);
                return;
              }
              publish(input.map(normalizeRouteInput).slice(0, 200));
            };
            if (result instanceof Promise) {
              result.then(handle).catch((err) => {
                console.warn(
                  "[LiveLayer] getRoutes rejected; falling back to DOM walker.",
                  err,
                );
                publish(getCachedRoutes());
              });
            } else {
              handle(result);
            }
          } catch (err) {
            console.warn(
              "[LiveLayer] getRoutes threw; falling back to DOM walker.",
              err,
            );
            publish(getCachedRoutes());
          }
          return;
        }

        // Default: walk the current page's <a href> elements.
        try {
          publish(getCachedRoutes());
        } catch (err) {
          console.warn("[LiveLayer] request_routes: extractRoutes threw.", err);
        }
        return;
      }

      // 0.12.0 — unified collection event. The agent emits two
      // data-channel command types under the hood
      // (task_field_updated mid-flow, task_completed at the end), but
      // both fan out to a single document-level `ll-collected` event
      // discriminated on `phase`. The `useCollect()` hook listens to
      // that single event and exposes both phases as one ergonomic
      // surface; `onCollect` (this prop) only fires on phase=complete
      // because that's the 95% case (ship the payload to a backend).
      //
      // The SDK has already auto-painted matching `[name="..."]`
      // inputs by the time these events arrive, so consumers don't
      // need to wire the input bridge themselves.
      if (cmd.type === "task_field_updated") {
        if (!isAllowed("collect_data")) {
          blockedWarn("task_field_updated", "collect_data");
          return;
        }
        const detail = {
          phase: "field" as const,
          fieldId: typeof cmd.fieldId === "string" ? cmd.fieldId : "",
          fieldName:
            typeof cmd.fieldName === "string"
              ? cmd.fieldName
              : typeof cmd.fieldId === "string"
                ? cmd.fieldId
                : "",
          value: typeof cmd.value === "string" ? cmd.value : "",
          kind: typeof cmd.kind === "string" ? cmd.kind : "text",
          source:
            cmd.source === "slide"
              ? ("slide" as const)
              : cmd.source === "page"
                ? ("page" as const)
                : ("agent" as const),
          ...(typeof cmd.slideId === "string"
            ? { slideId: cmd.slideId }
            : {}),
          ...(typeof cmd.formId === "string" ? { formId: cmd.formId } : {}),
        };
        if (typeof document !== "undefined") {
          try {
            document.dispatchEvent(
              new CustomEvent("ll-collected", { detail }),
            );
          } catch {
            /* swallow */
          }
        }
        return;
      }

      if (cmd.type === "task_completed") {
        if (!isAllowed("collect_data")) {
          blockedWarn("task_completed", "collect_data");
          return;
        }
        const raw = (cmd as Record<string, unknown>).result;
        if (!raw || typeof raw !== "object") {
          console.warn(
            "[LiveLayer] task_completed missing `result` payload.",
          );
          return;
        }
        if (typeof document !== "undefined") {
          try {
            document.dispatchEvent(
              new CustomEvent("ll-collected", {
                detail: { phase: "complete", result: raw },
              }),
            );
          } catch {
            /* swallow */
          }
        }
        try {
          onCollect?.(
            raw as Parameters<NonNullable<typeof onCollect>>[0],
          );
        } catch (err) {
          console.warn("[LiveLayer] onCollect threw.", err);
        }
        return;
      }

      // Non-universal commands forward to the consumer.
      if (!UNIVERSAL_COMMAND_TYPES.has(cmd.type)) {
        onAgentCommand?.(cmd);
      }
    },
    [onAgentCommand, onAgentEvent, onCollect],
  );

  // ── LiveKit session ──────────────────────────────────────────
  // Hook always runs (rules of hooks). When controlledSession is provided,
  // we pass dummy options so the hook does nothing useful; the unified
  // `session` var below reads from controlledSession instead.
  const internalSession = useLiveKitSession({
    agentId: controlledSession ? "__controlled__" : agentId,
    baseUrl,
    apiKey,
    sessionEndpoint,
    sessionBody,
    onDataMessage: controlledSession ? undefined : handleDataMessage,
  });

  // Subscribe to controlled session's data messages (if provided).
  useEffect(() => {
    if (!controlledSession?.subscribeToDataMessages) return;
    return controlledSession.subscribeToDataMessages(handleDataMessage);
  }, [controlledSession, handleDataMessage]);

  // Bind the room-getter ref so the data-channel handler can publish
  // page-context responses without listing `session` in its deps.
  roomGetterRef.current = () => internalSession.getRoom?.();

  // Dev-only: expose a window helper so `docs/testing/widget-command-smoke.md`
  // can dispatch synthetic agent commands without going through LiveKit.
  // Gated to local hostnames so this never appears in production.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const host = window.location?.hostname || "";
    const isLocal =
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host.endsWith(".local") ||
      host.endsWith(".test");
    if (!isLocal) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__livelayerSimulateCommand = (
      cmd: Record<string, unknown>,
    ) => {
      try {
        handleDataMessage(cmd);
      } catch (err) {
        console.warn("[LiveLayer] simulate-command threw:", err);
      }
    };
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).__livelayerSimulateCommand;
    };
  }, [handleDataMessage]);

  // Unified session view. Shape is identical across both modes for the
  // rest of the component. connect/disconnect route to the right owner.
  const session = useMemo(() => {
    if (controlledSession) {
      return {
        connectionState: controlledSession.connectionState,
        agentState: controlledSession.agentState,
        transcript: controlledSession.transcript,
        videoElement: controlledSession.videoElement,
        audioElement: controlledSession.audioElement,
        canResume: controlledSession.canResume,
        error: controlledSession.error,
        agentConfig: null,
        connect: async () => {
          await controlledSession.onConnect();
        },
        disconnect: () => controlledSession.onDisconnect(),
        // Dummy getRoom for shape compatibility — controlled consumers own the Room.
        // Internal session's getRoom returns null when no real connect has happened,
        // so we reuse its reference for type consistency.
        getRoom: internalSession.getRoom,
        isControlled: true as const,
      };
    }
    return {
      connectionState: internalSession.connectionState,
      agentState: internalSession.agentState,
      transcript: internalSession.transcript,
      videoElement: internalSession.videoElement,
      audioElement: internalSession.audioElement,
      canResume: internalSession.canResume,
      error: internalSession.error,
      agentConfig: internalSession.agentConfig,
      connect: internalSession.connect,
      disconnect: internalSession.disconnect,
      getRoom: internalSession.getRoom,
      isControlled: false as const,
    };
  }, [controlledSession, internalSession]);

  // ── Imperative handle (forwardRef) ───────────────────────────
  // sendData publishes a JSON-serialized payload over the LiveKit data
  // channel (reliable). Used by hosts that need to notify the agent of
  // user-driven events the widget can't observe — e.g. /a/<slug>
  // sending `user_navigated` when the visitor uses Back/Continue, or
  // `quiz_response` when they pick an answer. No-ops when the session
  // isn't connected; swallows publish errors with console.warn so a
  // single missed message doesn't crash the host app.
  //
  // Hold a ref to `session` so the imperative method's closure stays
  // stable across re-renders — useImperativeHandle's deps are empty,
  // and we don't want the consumer's stored ref to become stale just
  // because the widget re-rendered.
  const sessionRef = useRef(session);
  sessionRef.current = session;
  // Mirror sessionRef for the controlled-publish path.
  const controlledSessionRef = useRef(controlledSession);
  controlledSessionRef.current = controlledSession;
  useImperativeHandle(
    ref,
    () => ({
      sendData: async (data: Record<string, unknown>) => {
        // Controlled mode: host owns the Room, route through their hook.
        const ctrl = controlledSessionRef.current;
        if (ctrl?.publishData) {
          try {
            await ctrl.publishData(data);
          } catch (err) {
            console.warn("[AvatarWidget] sendData (controlled) failed:", err);
          }
          return;
        }
        const room = sessionRef.current?.getRoom?.();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const lp = (room as any)?.localParticipant;
        if (!lp?.publishData) return;
        try {
          const payload = new TextEncoder().encode(JSON.stringify(data));
          await lp.publishData(payload, { reliable: true });
        } catch (err) {
          console.warn("[AvatarWidget] sendData failed:", err);
        }
      },
    }),
    [],
  );

  // ── Video element attachment ─────────────────────────────────
  // The session creates a <video> element when the agent publishes a
  // video track; we append it to a container owned by the ExpandedLayout.
  const avatarVideoContainerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = session.videoElement;
    const container = avatarVideoContainerRef.current;
    if (!el || !container) return;
    container.appendChild(el);
    return () => {
      if (el.parentNode === container) {
        container.removeChild(el);
      }
    };
  }, [session.videoElement]);

  // ── Audio element attachment + autoplay check ────────────────
  useEffect(() => {
    const el = session.audioElement;
    if (!el) return;
    audioLevel.attach(el);

    // Autoplay policy: if the element can't auto-play, surface the
    // "Tap to enable audio" overlay. The user gesture to tap re-plays.
    const promise = el.play();
    if (promise && typeof promise.catch === "function") {
      promise.catch((err) => {
        if (err?.name === "NotAllowedError") {
          setNeedsUserGesture(true);
        }
      });
    }

    return () => {
      audioLevel.detach();
    };
    // audioLevel is a stable object across renders — attach/detach are
    // memoized inside the hook. Safe to omit from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.audioElement]);

  // ── Mic setup on room ready ──────────────────────────────────
  // Mic is only set up for internally-managed sessions — controlled
  // consumers usually own mic publishing themselves (V2's OnboardingRoom
  // is one) and a duplicate setupMic would cause a track-publish conflict.
  useEffect(() => {
    if (session.isControlled) return;
    if (session.connectionState !== "connected") return;
    const room = session.getRoom();
    if (!room) return;
    void mic.setupMic(room).catch(() => {
      // error already stored in mic.micError
    });
    return () => {
      mic.teardownMic();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.isControlled, session.connectionState]);

  // ── Camera + screen-share + mic-room + device enumeration ────
  // These run in BOTH internal and controlled mode. In controlled mode
  // we read the host's Room via `controlledSession.getRoom()` so the
  // toolbar buttons actually publish tracks instead of being no-ops.
  // mic.attachRoom binds the room ref without publishing — the package
  // doesn't own the audio track in controlled mode (V2 does), but the
  // mic hook still needs the Room reference for toggle/switchDevice
  // to work via LocalParticipant.setMicrophoneEnabled and
  // room.switchActiveDevice.
  useEffect(() => {
    if (session.connectionState !== "connected") return;
    const room = session.isControlled
      ? (controlledSession?.getRoom?.() as
          | Parameters<typeof camera.attachRoom>[0]
          | null
          | undefined)
      : session.getRoom();
    if (!room) return;
    camera.attachRoom(room);
    screen.attachRoom(room);
    if (session.isControlled) {
      mic.attachRoom(room);
    }
    void devices.refresh();
    return () => {
      camera.teardown();
      screen.teardown();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.isControlled, session.connectionState, controlledSession]);

  // ── Speaker mute (audio element muted prop) ──────────────────
  useEffect(() => {
    const el = session.audioElement;
    if (!el) return;
    el.muted = speakerMuted;
  }, [session.audioElement, speakerMuted]);

  // ── Send a typed message to the agent over the data channel ──
  // In controlled mode the host owns the Room, so we route through
  // controlledSession.publishData. Without that hook the typed message
  // silently drops — the internal session's getRoom returns null in
  // controlled mode (no real connect happened on the package side).
  const handleSendMessage = useCallback((text: string) => {
    const payload = { type: "user_message", text };
    if (controlledSession?.publishData) {
      try {
        void controlledSession.publishData(payload);
      } catch {
        // best effort — ignore
      }
      return;
    }
    const room = session.getRoom();
    if (!room) return;
    try {
      const data = new TextEncoder().encode(JSON.stringify(payload));
      void room.localParticipant.publishData(data, { reliable: true });
    } catch {
      // best effort — ignore
    }
  }, [session, controlledSession]);

  const toggleSpeaker = useCallback(() => {
    setSpeakerMuted((v) => !v);
  }, []);

  // ── Lifecycle callback forwarding ────────────────────────────
  useEffect(() => {
    onConnectionStateChange?.(session.connectionState);
    if (session.connectionState === "connected") {
      onConnect?.();
    } else if (session.connectionState === "disconnected") {
      onDisconnect?.();
    }
  }, [session.connectionState, onConnect, onDisconnect, onConnectionStateChange]);

  useEffect(() => {
    onTranscript?.(session.transcript);
  }, [session.transcript, onTranscript]);

  useEffect(() => {
    onAgentState?.(session.agentState);
  }, [session.agentState, onAgentState]);

  // ── Thinking-sound loop ──────────────────────────────────────
  // Mirrors the dashboard pattern: a soft loop at low volume while the
  // agent is computing, silent otherwise. Disabled (or torn down) when
  // the consumer passes soundEffects={false} or { thinking: false }.
  useEffect(() => {
    sounds.setThinking(session.agentState === "thinking");
  }, [session.agentState, sounds]);

  // ── Autoconnect on first mount (or first allowed route) ──────
  // Defer if the widget is route-hidden — autoConnecting on a
  // hidden route would bill the user for an invisible session. The
  // first time we render an allowed route, the effect re-runs and
  // fires the connect.
  //
  // Controlled-mode note: until 0.10.9, autoConnect was a no-op when
  // a `controlledSession` was provided ("consumer decides when to
  // connect"). That assumption broke for the dashboard editor preview,
  // where the consumer explicitly opts in via `autoConnect={true}` and
  // expects the widget to connect on mount. `session.connect()` in
  // controlled mode routes to `controlledSession.onConnect`, which is
  // the consumer's own connect handler — so honoring autoConnect here
  // just calls the handler the consumer asked us to call. Consumers
  // who want manual control omit `autoConnect` (default false).
  const autoConnectedRef = useRef(false);
  useEffect(() => {
    if (!autoConnect || autoConnectedRef.current) return;
    if (!shouldRender) return;
    if (session.connectionState !== "idle") return;
    autoConnectedRef.current = true;
    void session.connect();
  }, [autoConnect, session.connectionState, session, shouldRender]);

  // ── Team switching ───────────────────────────────────────────
  const handleSelectTeamMember = useCallback(
    (id: string) => {
      const member = teamMembers?.find((m) => m.id === id);
      if (!member) return;
      setTeamSwitcherOpen(false);
      if (id === currentTeamMemberId) return;

      setIsSwitchingTeamMember(true);
      session.disconnect();
      if (!isControlledTeam) {
        setInternalTeamMemberId(id);
      }
      onTeamMemberChange?.(member);
    },
    [
      teamMembers,
      currentTeamMemberId,
      session,
      isControlledTeam,
      onTeamMemberChange,
    ],
  );

  // Clear switching flag once the new session reaches connected.
  useEffect(() => {
    if (isSwitchingTeamMember && session.connectionState === "connected") {
      setIsSwitchingTeamMember(false);
    }
  }, [session.connectionState, isSwitchingTeamMember]);

  // Close team dropdown on ESC.
  useEffect(() => {
    if (!teamSwitcherOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTeamSwitcherOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [teamSwitcherOpen]);

  // ── Prefetch public agent info for idle state ────────────────
  // We fetch as soon as we know the agentId so the idle screen has an
  // avatar to show. Skip when the consumer has already supplied the
  // avatarImageUrl (they already know what to render) or when we're in
  // controlled mode (consumer owns lifecycle).
  const shouldSkipAgentInfo =
    !!avatarImageUrlProp ||
    !!currentTeamMember?.avatarImageUrl ||
    session.isControlled;
  const prefetchedAgent = useAgentInfo(agentId, baseUrl, shouldSkipAgentInfo);

  // Resolve capabilities precedence: explicit prop > server-published
  // agent config > undefined (= unrestricted). Re-assign the ref every
  // render so the data-channel handler always sees the latest decision.
  if (capabilities === undefined && prefetchedAgent.info?.capabilities) {
    capabilitiesRef.current = prefetchedAgent.info.capabilities as
      | import("./types").AgentCapability[];
  }

  // ── Derived render values ────────────────────────────────────
  const agentName =
    currentTeamMember?.name ??
    agentNameProp ??
    session.agentConfig?.name ??
    prefetchedAgent.info?.name ??
    "Live Layer";
  const avatarImageUrl =
    currentTeamMember?.avatarImageUrl ??
    avatarImageUrlProp ??
    session.agentConfig?.avatarImageUrl ??
    prefetchedAgent.info?.avatarImageUrl ??
    null;
  const idleLoopUrl =
    idleLoopUrlProp ??
    session.agentConfig?.idleLoopUrl ??
    prefetchedAgent.info?.idleLoopUrl ??
    null;
  const greeting = greetingProp ?? null;

  // ── Control callbacks for layouts ────────────────────────────
  const handleExpand = useCallback(() => setDisplayMode("expanded"), [setDisplayMode]);
  const handleMinimize = useCallback(
    () => setDisplayMode("minimized"),
    [setDisplayMode],
  );
  // Hide = "the call is over." Disconnects the LiveKit room (if connected)
  // and drops the widget to the edge-tab state. Minimize is the
  // session-preserving variant; consumers must use that one when they
  // want the call to keep running. We disconnect unconditionally — even
  // from minimized → hidden — because the hidden tab is documented as
  // "session ended." Idle disconnect is a no-op so this is safe to call
  // from any starting state.
  const handleHide = useCallback(() => {
    session.disconnect();
    setDisplayMode("hidden");
  }, [session, setDisplayMode]);

  const handleResumeAudio = useCallback(() => {
    const el = session.audioElement;
    if (!el) return;
    el.play()
      .then(() => setNeedsUserGesture(false))
      .catch(() => {
        // still blocked — leave overlay up
      });
  }, [session.audioElement]);

  const handleRetry = useCallback(() => {
    setNeedsUserGesture(false);
    void session.connect();
  }, [session]);

  // ── Styling vars from branding ───────────────────────────────
  // Embedded mode lets the host container manage stacking (the floating-
  // widget z-index would otherwise punch through whatever sits above the
  // host card).
  const cssVars: CSSProperties = {
    ...style,
    ...(isEmbedded ? {} : { zIndex }),
  };
  // CSS custom properties (typed as any because CSSProperties doesn't
  // officially support custom props — standard React escape hatch).
  const brandingVars = cssVars as CSSProperties & Record<string, string>;
  if (branding.primaryColor) brandingVars["--ll-color-primary"] = branding.primaryColor;
  if (branding.accentColor) brandingVars["--ll-color-accent"] = branding.accentColor;
  if (branding.backgroundColor) brandingVars["--ll-color-bg"] = branding.backgroundColor;
  if (branding.textColor) brandingVars["--ll-color-fg"] = branding.textColor;

  const containerClasses = [
    "ll-widget",
    `ll-widget--${displayMode}`,
    `ll-widget--${isMobile ? "mobile" : "desktop"}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  // Route filter: hide UI on excluded paths. Hooks above already ran,
  // so the LiveKit session, mic state, etc. all stay alive — the call
  // continues seamlessly when the user navigates back to an allowed
  // route. Tests assert on this transition.
  if (!shouldRender) return null;

  // Two render slots:
  //   • mainContent stays at the host's chosen DOM location. In WIDGET
  //     mode it's the floating fixed-position widget; in EMBEDDED mode
  //     it's the inline host slot (filled by ExpandedLayout). Always
  //     rendered so its descendants — the LiveKit video container ref,
  //     the connection-state side effects — keep a stable mount point.
  //   • floatingContent renders only for the hidden/minimized layouts
  //     and is always portaled to document.body so the chrome's
  //     `position: fixed` styles anchor to the viewport. Necessary
  //     because EMBEDDED hosts commonly wrap their slot in a
  //     transformed ancestor (translateZ, scale), which captures
  //     fixed-position descendants and pins them to the slot rather
  //     than the viewport edge — that's why the side-tab and
  //     audio-waveform pill used to be unreachable in EMBEDDED.
  const mainContent = (
    <div
      className={containerClasses}
      style={brandingVars}
      data-display-mode={displayMode}
      data-position={position}
      data-experience-mode={experienceMode === "EMBEDDED" ? "embedded" : "widget"}
    >
      {displayMode === "expanded" && (
        <ExpandedLayout
          position={position}
          isMobile={isMobile}
          agentName={agentName}
          avatarImageUrl={avatarImageUrl}
          idleLoopUrl={idleLoopUrl}
          greeting={greeting}
          branding={branding}
          teamMembers={teamMembers}
          currentTeamMemberId={currentTeamMemberId}
          isSwitchingTeamMember={isSwitchingTeamMember}
          teamSwitcherOpen={teamSwitcherOpen}
          onToggleTeamSwitcher={() => setTeamSwitcherOpen((v) => !v)}
          onSelectTeamMember={handleSelectTeamMember}
          connectionState={session.connectionState}
          agentState={session.agentState}
          transcript={session.transcript}
          isMuted={mic.isMuted}
          micDevices={devices.mics}
          activeMicId={mic.activeDeviceId}
          isCameraEnabled={camera.isEnabled}
          cameraPreviewEl={camera.previewEl}
          cameraDevices={devices.cameras}
          activeCameraId={camera.activeDeviceId}
          isScreenShareEnabled={screen.isEnabled}
          screenPreviewEl={screen.previewEl}
          isSpeakerMuted={speakerMuted}
          allowCamera={allowCamera}
          allowScreenShare={allowScreenShare}
          allowTyping={allowTyping}
          showMinimize={showMinimize}
          showClose={showClose}
          chromeless={chromeless}
          compactControls={compactControls}
          transforming={transforming}
          transformingLabel={transformingLabel}
          languageMenuOpen={languageMenuOpen}
          onToggleLanguageMenu={() => setLanguageMenuOpen((v) => !v)}
          needsUserGesture={needsUserGesture}
          canResume={session.canResume}
          micError={mic.micError}
          error={session.error}
          avatarVideoContainerRef={avatarVideoContainerRef}
          agentVideoEl={session.videoElement}
          onConnect={() => void session.connect()}
          onDisconnect={() => session.disconnect()}
          onRetry={handleRetry}
          onResumeAudio={handleResumeAudio}
          onToggleMute={mic.toggleMute}
          onSwitchMicDevice={(id) => void mic.switchDevice(id)}
          onToggleCamera={() => void camera.toggle()}
          onSwitchCameraDevice={(id) => void camera.switchDevice(id)}
          onToggleScreenShare={() => void screen.toggle()}
          onToggleSpeaker={toggleSpeaker}
          onSendMessage={handleSendMessage}
          onMinimize={handleMinimize}
          onClose={handleHide}
          onClearMicError={mic.clearError}
        />
      )}
    </div>
  );

  // In EMBEDDED mode displayMode is locked to "expanded", so isFloating
  // is always false here — but we belt-and-brace the check anyway so a
  // future regression that frees displayMode can't accidentally portal
  // a chevron tab onto an editor / fullscreen host's page edge.
  const isFloating =
    !isEmbedded &&
    (displayMode === "hidden" || displayMode === "minimized");
  const floatingContent = isFloating ? (
    <div
      className={[
        "ll-widget",
        "ll-widget--floating",
        `ll-widget--${displayMode}`,
        `ll-widget--${isMobile ? "mobile" : "desktop"}`,
      ].join(" ")}
      style={brandingVars}
      data-display-mode={displayMode}
      data-position={position}
    >
      {displayMode === "hidden" && (
        <HiddenLayout
          position={position}
          isMobile={isMobile}
          isSpeaking={session.agentState === "speaking"}
          // Reopen directly to expanded — minimized is an intentional
          // intermediate state, not a transit stop. Two-click reopen
          // felt unfinished in user testing.
          onExpand={() => setDisplayMode("expanded")}
          label={`Open ${agentName} widget`}
          avatarImageUrl={avatarImageUrl}
          agentName={agentName}
          containerEl={floatingChromeContainer}
        />
      )}
      {displayMode === "minimized" && (
        <MinimizedLayout
          position={position}
          isMobile={isMobile}
          agentName={agentName}
          avatarImageUrl={avatarImageUrl}
          agentState={session.agentState}
          isMuted={mic.isMuted}
          audioLevel={audioLevel}
          onExpand={handleExpand}
          onToggleMute={mic.toggleMute}
          onClose={handleHide}
        />
      )}
    </div>
  ) : null;

  // Portal the floating chrome to the host-supplied container if one
  // is provided (e.g. a fork-demo card that wants its side-tab scoped
  // to the card's edges), otherwise document.body for a viewport-edge
  // anchor.
  const portalTarget =
    floatingChromeContainer ??
    (typeof document !== "undefined" ? document.body : null);

  return (
    <>
      {mainContent}
      {floatingContent && portalTarget && createPortal(floatingContent, portalTarget)}
    </>
  );
  },
);
AvatarWidgetInner.displayName = "AvatarWidgetInner";

/**
 * LiveLayer agent widget. Renders a voice/video avatar agent embed with
 * three display modes (expanded, minimized, hidden), responsive
 * layouts, team-member switching, and full branding.
 *
 * Import the stylesheet once in your app:
 *   import "@livelayer/react/styles.css";
 */
export const AvatarWidget = forwardRef<AvatarWidgetHandle, AvatarWidgetProps>(
  function AvatarWidget(props, ref) {
    return (
      <ErrorBoundary>
        <AvatarWidgetInner {...props} ref={ref} />
      </ErrorBoundary>
    );
  },
);
AvatarWidget.displayName = "AvatarWidget";
