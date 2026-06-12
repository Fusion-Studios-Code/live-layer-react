// ─── @livelayer/react — public API ────────────────────────────────────

// Primary widget (v0.2.0): the full-fidelity AvatarWidget.
export { AvatarWidget } from "./AvatarWidget";
export type {
  AvatarWidgetProps,
  AvatarWidgetHandle,
  ControlledSession,
} from "./AvatarWidget";

// UI sound effects config (mirrors the dashboard's chime/confirmation/thinking).
export type { SoundEffectsConfig } from "./hooks/useSoundEffects";

// Legacy thin wrapper kept for backwards compatibility with v0.1.x.
// Consumers using <LiveLayerWidget> continue to work; we recommend
// migrating to <AvatarWidget> for the rich UX.
export { LiveLayerWidget } from "./LiveLayerWidget";
export type {
  LiveLayerWidgetProps,
  AgentEventDetail as LegacyAgentEventDetail,
} from "./LiveLayerWidget";

// Error boundary (exported so consumers can wrap with their own fallback)
export { ErrorBoundary } from "./ErrorBoundary";

// Shared types
export type {
  WidgetPosition,
  DisplayMode,
  AgentCommand,
  AgentEventDetail,
  TeamMember,
  BrandingConfig,
  RoutePattern,
  PageContext,
  FlowContext,
  FlowControl,
  AgentCapability,
} from "./types";

// Page-aware components (0.3.0)
export { LiveLayerRegion } from "./components/LiveLayerRegion";
export type { LiveLayerRegionProps } from "./components/LiveLayerRegion";

// Structured collection (0.12.0 — unified API).
//
// No wrapper components. Customers write regular HTML forms; the agent
// auto-discovers them (extractPageContext walks every `<form>` and
// surfaces every `[name]` input). Values paint into the matching
// `[name="..."]` inputs as the agent records them. Use `onCollect`
// on <AvatarWidget /> for one-shot delivery; use `useCollect()` for
// streaming per-field updates and progress UI.
//
// Opt-out attributes:
//   <form data-ll-skip>               — exclude this form
//   <input data-ll-private />         — exclude this input
//   <form data-ll-intent="…">         — disambiguation hint
//   <input type="password" />         — always excluded
//   <input autocomplete="cc-*" />     — always excluded (PII)
export { useCollect } from "./hooks/useCollect";
export type {
  UseCollectOptions,
  UseCollectHandle,
  CollectedField,
  CollectedResult,
} from "./hooks/useCollect";

// Debug overlay (0.5.2) — opt-in floating panel that streams every
// AgentEvent in real time. Mount alongside <AvatarWidget> in
// development to verify tool calls. Off by default; toggle with
// Cmd/Ctrl + Shift + L.
export { LiveLayerDebugPanel } from "./components/LiveLayerDebugPanel";
export type { LiveLayerDebugPanelProps } from "./components/LiveLayerDebugPanel";

// Page-context utilities (0.3.0) — power users who want to extract
// context outside the widget's automatic agent responses.
export {
  extractPageContext,
  getCachedPageContext,
  clearPageContextCache,
} from "./utils/extractPageContext";

// Routes utilities (0.4.0) — DOM-walked sitemap, exposed for power users.
export {
  extractRoutes,
  getCachedRoutes,
  clearRoutesCache,
  normalizeRouteInput,
} from "./utils/extractRoutes";
export type {
  ExtractedRoute,
  RouteEntryInput,
} from "./utils/extractRoutes";

// Route helpers (0.3.0) — exposed for consumers building their own
// route-aware containers around the widget.
export { usePathname } from "./hooks/usePathname";
export {
  useRouteMatch,
  shouldRenderAtPath,
  matchesPattern,
} from "./hooks/useRouteMatch";

// Re-export session types from the SDK so consumers don't need a second install
export type {
  AgentState,
  ConnectionState,
  TranscriptEntry,
  AgentConfig,
} from "@livelayer/sdk";

// v0.13.0 — manifest field registration (paired with @livelayer/sdk
// v0.8.0). Use when the SDK's auto-discovery can't see your fields —
// controlled inputs that don't fire native `input` events, fields not
// in the DOM yet, headless combobox values, etc.
//
//   useRegisterFields(fields)    — declarative; re-registers on change
//   <FieldProvider fields={...}> — JSX-style equivalent
//   registerFields(fields)       — imperative; re-exported from the SDK
//   setFieldValue(id, value)     — patch a single value; from the SDK
//
// Programmatic registrations WIN on id conflict with auto-discovered
// DOM fields, so this is the right escape hatch for "the agent keeps
// seeing my React state wrong."
export { useRegisterFields } from "./hooks/useRegisterFields";
export { FieldProvider } from "./components/FieldProvider";
export type { FieldProviderProps } from "./components/FieldProvider";
export {
  registerFields,
  setFieldValue,
  clearFieldRegistry,
  getRegisteredFields,
} from "@livelayer/sdk";
export type {
  FieldManifest,
  FieldKind,
  FieldOption,
} from "@livelayer/sdk";

// Hooks — exposed for power users who want to build custom widget chrome
// around the same underlying primitives.
export { useLiveKitSession } from "./hooks/useLiveKitSession";
export type {
  UseLiveKitSessionOptions,
  UseLiveKitSessionResult,
} from "./hooks/useLiveKitSession";
export { useAudioLevel } from "./hooks/useAudioLevel";
export type { AudioLevelHandle } from "./hooks/useAudioLevel";
export { useMicrophoneState } from "./hooks/useMicrophoneState";
export type { MicrophoneStateHandle } from "./hooks/useMicrophoneState";
export { useCameraState } from "./hooks/useCameraState";
export type { CameraStateHandle } from "./hooks/useCameraState";
export { useScreenShareState } from "./hooks/useScreenShareState";
export type { ScreenShareStateHandle } from "./hooks/useScreenShareState";
export { useMediaDevices } from "./hooks/useMediaDevices";
export type { MediaDevicesHandle } from "./hooks/useMediaDevices";
export { useAgentInfo } from "./hooks/useAgentInfo";
export type { AgentInfo, AgentInfoHandle } from "./hooks/useAgentInfo";

// Page vision (0.25.0) — opt-in page-screenshot capture for the agent at
// flow start / route change / step change. The widget wires this from the
// server-side agent-info config automatically; `usePageVision` is exposed
// for power users driving captures around a custom session.
export { usePageVision } from "./hooks/usePageVision";
export type {
  PageVisionClientConfig,
  CaptureReason,
} from "./utils/pageVision/controller";
export { useTranscript } from "./hooks/useTranscript";
export type { TranscriptHandle } from "./hooks/useTranscript";
export { useDisplayMode } from "./hooks/useDisplayMode";
export { useDisplayModePersistence } from "./hooks/useDisplayModePersistence";
export { useIsMobile } from "./hooks/useIsMobile";
