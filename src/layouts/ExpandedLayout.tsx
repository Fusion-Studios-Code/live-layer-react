// ─── ExpandedLayout ───────────────────────────────────────────────────
//
// The full widget surface — matches the Studio agent editor experience.
//
// Visual structure (back to front, z-stacked):
//
//   Layer 0  Full-bleed <AvatarImage> fills the frame.
//   Layer 1  Live LiveKit <video> (appended via avatarVideoContainerRef),
//            cross-fades in when the avatar track arrives.
//   Layer 2  Overlay UI — rounded pills on black/40 glass backdrop:
//              top-left:  agent-name pill, language pill, state pill
//              top-right: close X
//              bottom:    transcript line, media toolbar, message input
//   Layer 3  Local PIP for camera / screen share (bottom-right, above toolbar)
//   Layer 4  Connecting / loading / autoplay / resume overlays
//
// The widget body has NO card chrome in the connected state — glass pills
// sit directly on the avatar. The header returns to solid white only on
// mobile sheet mode (see styles.css for the .ll-expanded--mobile override).

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FC, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { AgentState, ConnectionState, TranscriptEntry } from "@livelayer/sdk";
import { AvatarImage } from "../components/AvatarImage";
import { LiveLayerMarkIcon } from "../components/icons/LiveLayerMarkIcon";
import type { BrandingConfig, TeamMember, WidgetPosition } from "../types";
import type {
  DragHandleProps,
  ResizeHandleProps,
} from "../hooks/useDragAndResize";
import { CompactToolbar } from "./CompactToolbar";

interface Props {
  position: WidgetPosition;
  isMobile: boolean;

  // Content
  agentName: string;
  avatarImageUrl: string | null;
  idleLoopUrl: string | null;
  greeting: string | null;
  branding: BrandingConfig;

  // Team switching (optional)
  teamMembers?: TeamMember[];
  currentTeamMemberId?: string;
  isSwitchingTeamMember?: boolean;
  teamSwitcherOpen: boolean;
  onToggleTeamSwitcher: () => void;
  onSelectTeamMember: (id: string) => void;

  // Language (display-only for now; dropdown renders "English")
  languageMenuOpen: boolean;
  onToggleLanguageMenu: () => void;

  // Connection state
  connectionState: ConnectionState;
  agentState: AgentState;
  transcript: TranscriptEntry[];
  canResume: boolean;
  needsUserGesture: boolean;
  error: string | null;

  // Mic
  isMuted: boolean;
  micError: string | null;
  micDevices: MediaDeviceInfo[];
  activeMicId: string;

  // Camera
  isCameraEnabled: boolean;
  cameraPreviewEl: HTMLVideoElement | null;
  cameraDevices: MediaDeviceInfo[];
  activeCameraId: string;

  // Screen share
  isScreenShareEnabled: boolean;
  screenPreviewEl: HTMLVideoElement | null;

  // Speaker
  isSpeakerMuted: boolean;

  // Capability toggles from host
  allowCamera: boolean;
  allowScreenShare: boolean;
  allowTyping: boolean;

  // Chrome toggles from host (defaults preserve 0.7.x behavior)
  showMinimize?: boolean;
  showClose?: boolean;
  chromeless?: boolean;
  /**
   * Compact toolbar mode — hides the top header pills + minimize/end-call,
   * tucks secondary controls behind a ••• overflow popover, and only
   * shows the message input when the user toggles "Type" inside the
   * popover. Use for tight embedded slots like a 180×260 mobile slot.
   */
  compactControls?: boolean;

  // Transforming overlay — caller-controlled, wins over connection overlays.
  transforming: boolean;
  transformingLabel: string;

  // LiveKit video container (the orchestrator mounts the agent video here)
  avatarVideoContainerRef: RefObject<HTMLDivElement | null>;
  // The actual <video> element streaming the agent. Used to detect when
  // the avatar is *actually* playing frames (vs. just having its track
  // attached) so we can keep the connecting spinner up through the
  // LemonSlice warmup window.
  agentVideoEl: HTMLVideoElement | null;

  // Callbacks
  onConnect: () => void;
  onDisconnect: () => void;
  onRetry: () => void;
  onResumeAudio: () => void;
  onToggleMute: () => void;
  onSwitchMicDevice: (deviceId: string) => void;
  onToggleCamera: () => void;
  onSwitchCameraDevice: (deviceId: string) => void;
  onToggleScreenShare: () => void;
  onToggleSpeaker: () => void;
  onSendMessage: (text: string) => void;
  onMinimize: () => void;
  onClose: () => void;
  onClearMicError: () => void;

  // ── Drag + resize (optional) ──────────────────────────────────
  // Spread onto the header (drag handle) and a corner grip (resize).
  // The handlers are no-ops when the feature is disabled, and the
  // `data-ll-drag-handle` / `data-ll-resize-handle` attributes are
  // undefined then so the cursor / touch-action CSS doesn't apply.
  // Both optional so existing callers / tests that don't pass them keep
  // working unchanged.
  dragHandleProps?: DragHandleProps;
  resizeHandleProps?: ResizeHandleProps;
}

export const ExpandedLayout: FC<Props> = ({
  position,
  isMobile,
  agentName,
  avatarImageUrl,
  idleLoopUrl,
  greeting,
  branding,
  teamMembers,
  currentTeamMemberId,
  isSwitchingTeamMember,
  teamSwitcherOpen,
  onToggleTeamSwitcher,
  onSelectTeamMember,
  languageMenuOpen,
  onToggleLanguageMenu,
  connectionState,
  agentState,
  transcript,
  canResume,
  needsUserGesture,
  error,
  isMuted,
  micError,
  micDevices,
  activeMicId,
  isCameraEnabled,
  cameraPreviewEl,
  cameraDevices,
  activeCameraId,
  isScreenShareEnabled,
  screenPreviewEl,
  isSpeakerMuted,
  allowCamera,
  allowScreenShare,
  allowTyping,
  showMinimize = true,
  showClose = true,
  chromeless = false,
  compactControls = false,
  transforming,
  transformingLabel,
  avatarVideoContainerRef,
  agentVideoEl,
  onConnect,
  onDisconnect,
  onRetry,
  onResumeAudio,
  onToggleMute,
  onSwitchMicDevice,
  onToggleCamera,
  onSwitchCameraDevice,
  onToggleScreenShare,
  onToggleSpeaker,
  onSendMessage,
  onMinimize,
  onClose,
  onClearMicError,
  dragHandleProps,
  resizeHandleProps,
}) => {
  const hasTeamSwitcher = (teamMembers?.length ?? 0) > 1;
  const isActive =
    connectionState === "connecting" || connectionState === "connected";
  const isConnected = connectionState === "connected";
  const isIdleish =
    connectionState === "idle" ||
    connectionState === "disconnected" ||
    connectionState === "error";

  // Avatar warmup — track whether the LemonSlice video stream is actually
  // playing frames. The room can reach "connected" several seconds before
  // the avatar render pipeline pushes its first frame; during that window
  // we'd otherwise drop the spinner and reveal the static portrait, which
  // looks frozen. Keep the connecting overlay up until either:
  //   - the <video> element fires `playing` / `loadeddata`, or
  //   - the warmup bail timer fires (so voice-only agents that never
  //     publish video, or a stalled pipeline, don't strand the UI).
  const [agentVideoReady, setAgentVideoReady] = useState(false);
  useEffect(() => {
    if (!agentVideoEl) {
      setAgentVideoReady(false);
      return;
    }
    if (!agentVideoEl.paused && agentVideoEl.readyState >= 2) {
      setAgentVideoReady(true);
      return;
    }
    setAgentVideoReady(false);
    const onReady = () => setAgentVideoReady(true);
    agentVideoEl.addEventListener("playing", onReady);
    agentVideoEl.addEventListener("loadeddata", onReady);
    return () => {
      agentVideoEl.removeEventListener("playing", onReady);
      agentVideoEl.removeEventListener("loadeddata", onReady);
    };
  }, [agentVideoEl]);

  // Reveal the avatar ONLY once the agent has actually started SPEAKING.
  // The room reaches "connected" and the agent reports "listening" (and
  // LemonSlice may even push idle video frames) several seconds before the
  // agent says its first word. Dropping the overlay at that point revealed a
  // frozen, silent portrait — "we're looking at a still image". Track first
  // speech; once true it stays true until the session ends.
  const [hasSpoken, setHasSpoken] = useState(false);
  useEffect(() => {
    if (agentState === "speaking") setHasSpoken(true);
  }, [agentState]);
  useEffect(() => {
    if (connectionState === "disconnected" || connectionState === "idle") {
      setHasSpoken(false);
    }
  }, [connectionState]);

  // Drop the connecting overlay the moment the agent STARTS SPEAKING — even if
  // the LemonSlice video hasn't published its first frame yet. The greeting now
  // plays on the agent's direct audio (voice-first, ~1-2s) while the talking-
  // head renders in the background (~10s of LemonSlice cold-start). The old gate
  // held the "Connecting…" spinner + blur over the ENTIRE greeting (it waited
  // for hasSpoken AND agentVideoReady), so the agent looked stuck mid-sentence
  // with a blurred caption. Instead, reveal the crisp composite portrait +
  // caption as soon as it talks; the live video cross-fades in over the still
  // when its frames arrive (see .ll-expanded__video opacity, gated on
  // agentVideoReady). Mirrors the reference demo's clean voice-first boot.
  // We still do NOT reveal on mere "connected"/"listening" (a silent still) —
  // only once it has actually spoken.

  // Bail covers the case where the agent never reports "speaking" (voice-only
  // agent with no greeting, or a stalled pipeline): reveal the portrait after a
  // margin rather than stranding on the spinner forever.
  const [warmupBailedOut, setWarmupBailedOut] = useState(false);
  useEffect(() => {
    if (!isConnected) {
      setWarmupBailedOut(false);
      return;
    }
    if (hasSpoken) return;
    const t = setTimeout(() => setWarmupBailedOut(true), 12000);
    return () => clearTimeout(t);
  }, [isConnected, hasSpoken]);

  const showConnectingOverlay =
    connectionState === "connecting" ||
    (isConnected && !hasSpoken && !warmupBailedOut);

  // Local camera / screen PIP host — we append the LiveKit-produced <video>
  // into these divs so the orchestrator retains ownership of the elements
  // (no React re-render re-mounts them and drops the stream).
  const camPipRef = useRef<HTMLDivElement | null>(null);
  const screenPipRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const host = camPipRef.current;
    if (!host) return;
    host.innerHTML = "";
    if (cameraPreviewEl) {
      cameraPreviewEl.style.width = "100%";
      cameraPreviewEl.style.height = "100%";
      cameraPreviewEl.style.objectFit = "cover";
      cameraPreviewEl.style.transform = "scaleX(-1)";
      host.appendChild(cameraPreviewEl);
    }
  }, [cameraPreviewEl]);
  useEffect(() => {
    const host = screenPipRef.current;
    if (!host) return;
    host.innerHTML = "";
    if (screenPreviewEl) {
      screenPreviewEl.style.width = "100%";
      screenPreviewEl.style.height = "100%";
      screenPreviewEl.style.objectFit = "contain";
      host.appendChild(screenPreviewEl);
    }
  }, [screenPreviewEl]);

  // Device menus (mic / camera) — simple outside-click-to-close.
  // Refs for the chevron buttons so the portaled DeviceMenu can
  // anchor itself via getBoundingClientRect.
  const [micMenuOpen, setMicMenuOpen] = useState(false);
  const [camMenuOpen, setCamMenuOpen] = useState(false);
  const micChevronRef = useRef<HTMLButtonElement | null>(null);
  const camChevronRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!micMenuOpen && !camMenuOpen && !languageMenuOpen && !teamSwitcherOpen) return;
    const handler = () => {
      setMicMenuOpen(false);
      setCamMenuOpen(false);
      // Parent owns team + language menu state; trigger a close.
      if (languageMenuOpen) onToggleLanguageMenu();
      if (teamSwitcherOpen) onToggleTeamSwitcher();
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [
    micMenuOpen,
    camMenuOpen,
    languageMenuOpen,
    teamSwitcherOpen,
    onToggleLanguageMenu,
    onToggleTeamSwitcher,
  ]);

  // Compact-mode typing panel toggle — hidden by default; user opens via
  // the "Type" item in the OverflowPopover.
  const [isTypingOpen, setIsTypingOpen] = useState(false);
  const handleToggleTyping = useCallback(() => setIsTypingOpen((v) => !v), []);

  // Message input ref — we clear it after submit.
  const [messageDraft, setMessageDraft] = useState("");
  const handleSend = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const text = messageDraft.trim();
      if (!text) return;
      onSendMessage(text);
      setMessageDraft("");
    },
    [messageDraft, onSendMessage],
  );

  const productName = branding.productName || "Live Layer";
  // "Powered by LiveLayer" mark + link to livelayer.studio. Hidden for premium
  // / white-label customers via the explicit `branding.hideBranding` flag (set
  // by the host, or folded in from the server-derived `AgentInfo.hideBranding`
  // — e.g. the owning org's plan). Also kept hidden by the legacy heuristic
  // that a host who set a custom `productName` is white-labeling.
  const showLiveLayerMark = !branding.hideBranding && !branding.productName;

  // Two-pill captions for deaf-friendly UX. We render the latest user STT
  // and the latest agent caption as separate pills so the conversation
  // reads as a real two-voice exchange, not a single line that swaps
  // owner. Agent pill picks up the orange glow; user pill is plain.
  // Pre-conversation we show the configured greeting in the agent slot
  // (so the avatar is "introducing itself"); user slot stays empty.
  let latestAgent: TranscriptEntry | null = null;
  let latestUser: TranscriptEntry | null = null;
  for (let i = transcript.length - 1; i >= 0; i--) {
    const entry = transcript[i];
    if (!latestAgent && entry.role === "agent") latestAgent = entry;
    else if (!latestUser && entry.role === "user") latestUser = entry;
    if (latestAgent && latestUser) break;
  }
  // When the user hasn't connected yet, fall back to the configured
  // greeting in the agent slot — that's the avatar "introducing itself"
  // before the call starts. After connect, only render captions that
  // actually came over the wire (no synthetic greeting mixed in).
  const agentPillText = isConnected
    ? latestAgent?.text || null
    : greeting || null;
  const userPillText = isConnected ? latestUser?.text || null : null;

  const classes = [
    "ll-expanded",
    isMobile ? "ll-expanded--mobile" : "ll-expanded--desktop",
  ].join(" ");

  return (
    <div
      className={classes}
      data-position={position}
      data-state={isConnected ? "connected" : isActive ? "connecting" : "idle"}
      role="dialog"
      aria-label={`${agentName} widget`}
    >
      {/* ── Background (always visible) ──────────────────────── */}
      <div className="ll-expanded__bg">
        {avatarImageUrl ? (
          <AvatarImage
            src={avatarImageUrl}
            alt={agentName}
            className="ll-expanded__bg-img"
          />
        ) : (
          <div className="ll-expanded__bg-fallback">
            <span className="ll-expanded__bg-initial">
              {agentName?.charAt(0)?.toUpperCase() || "A"}
            </span>
          </div>
        )}
        {idleLoopUrl && !isConnected && (
          <video
            className="ll-expanded__bg-idle"
            src={idleLoopUrl}
            autoPlay
            loop
            muted
            playsInline
          />
        )}
      </div>

      {/* ── Live LiveKit video (cross-fades over background) ──
          Hidden (opacity 0) until the LemonSlice stream actually pushes
          frames (agentVideoReady), so the composite poster shows through
          during the voice-first greeting instead of a black pre-frame
          <video>. Fades in over the still once frames arrive. */}
      <div
        ref={avatarVideoContainerRef}
        className="ll-expanded__video"
        data-ready={agentVideoReady}
      />

      {/* ── Connecting overlay ─────────────────────────────────
          Stays up through the LemonSlice warmup window — see
          showConnectingOverlay above. */}
      {showConnectingOverlay && (
        <div className="ll-expanded__overlay ll-expanded__overlay--connecting">
          <div className="ll-expanded__spinner" />
          <p className="ll-expanded__overlay-text">
            {isSwitchingTeamMember ? "Switching..." : "Connecting..."}
          </p>
        </div>
      )}

      {/* ── Autoplay gesture overlay ───────────────────────── */}
      {needsUserGesture && isConnected && (
        <button
          type="button"
          className="ll-expanded__overlay ll-expanded__overlay--gesture"
          onClick={onResumeAudio}
        >
          <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M3 9v6h4l5 5V4L7 9H3zm13.54.12a5 5 0 0 1 0 5.76l-1.41-1.41a3 3 0 0 0 0-2.94L16.54 9.12z" />
          </svg>
          <p className="ll-expanded__overlay-text">Tap to enable audio</p>
        </button>
      )}

      {/* ── Transforming overlay (caller-controlled) ──────────
          Wins over every other state overlay. Surface this when the
          consumer's app is mid-swap (avatar URL change, voice change,
          agent handoff in progress) and the widget can't observe the
          swap directly. Higher z-index than the connecting/gesture
          overlays so it stays on top while a reconnect is in flight. */}
      {transforming && (
        <div
          className="ll-expanded__overlay ll-expanded__overlay--transforming"
          role="status"
          aria-live="polite"
          aria-label={transformingLabel}
        >
          <div className="ll-expanded__spinner" />
          <p className="ll-expanded__overlay-text">{transformingLabel}</p>
        </div>
      )}

      {/* ── Top bar (pills on glass) ───────────────────────── */}
      {isActive ? (
        <>
          {!compactControls && (
            <div className="ll-expanded__topbar" {...dragHandleProps}>
              {!chromeless && (
              <div className="ll-expanded__topbar-left">
                {/* Agent-name pill with optional dropdown */}
                <div className="ll-expanded__pill-wrap">
                  <button
                    type="button"
                    className="ll-hpill"
                    onClick={(e) => {
                      if (!hasTeamSwitcher) return;
                      e.stopPropagation();
                      onToggleTeamSwitcher();
                    }}
                    aria-haspopup={hasTeamSwitcher ? "listbox" : undefined}
                    aria-expanded={hasTeamSwitcher ? teamSwitcherOpen : undefined}
                  >
                    <span className="ll-hpill__label">{agentName}</span>
                    {hasTeamSwitcher && <ChevronDown />}
                  </button>
                  {hasTeamSwitcher && teamSwitcherOpen && (
                    <div
                      className="ll-hmenu"
                      onClick={(e) => e.stopPropagation()}
                      role="listbox"
                    >
                      {teamMembers?.map((m) => (
                        <button
                          type="button"
                          key={m.id}
                          className={`ll-hmenu__item ${
                            m.id === currentTeamMemberId ? "is-active" : ""
                          }`}
                          onClick={() => onSelectTeamMember(m.id)}
                          role="option"
                          aria-selected={m.id === currentTeamMemberId}
                        >
                          {m.avatarImageUrl && (
                            <img
                              src={m.avatarImageUrl}
                              alt=""
                              className="ll-hmenu__avatar"
                            />
                          )}
                          <span className="ll-hmenu__name">{m.name}</span>
                          {m.role && (
                            <span className="ll-hmenu__role">{m.role}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Language pill — compact ISO-code variant. Showing "EN"
                    instead of "English" reclaims ~50px in the topbar so the
                    agent name has room to breathe; full name still appears
                    in the dropdown when expanded. */}
                <div className="ll-expanded__pill-wrap">
                  <button
                    type="button"
                    className="ll-hpill ll-hpill--compact"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleLanguageMenu();
                    }}
                    aria-haspopup="listbox"
                    aria-expanded={languageMenuOpen}
                    aria-label="Language: English"
                    title="Language: English"
                  >
                    <span className="ll-hpill__label">EN</span>
                    <ChevronDown />
                  </button>
                  {languageMenuOpen && (
                    <div
                      className="ll-hmenu"
                      onClick={(e) => e.stopPropagation()}
                      role="listbox"
                    >
                      <button
                        type="button"
                        className="ll-hmenu__item is-active"
                        role="option"
                        aria-selected
                      >
                        <span className="ll-hmenu__name">English</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* State label — "listening" / "thinking" / "speaking" */}
                <span
                  className={`ll-expanded__state ll-expanded__state--${agentState}`}
                >
                  {agentState}
                </span>
              </div>
              )}
              {/* Active-state header actions: Minimize keeps the session alive
                  and shrinks to the docked pill; the red X ends the call and
                  fully dismisses to the edge tab. Two distinct affordances so
                  users don't accidentally hang up when they meant to tuck the
                  widget out of sight. */}
              <div className="ll-expanded__header-actions">
                {showMinimize !== false && (
                  <button
                    type="button"
                    className="ll-hbtn"
                    onClick={onMinimize}
                    aria-label="Minimize widget"
                    title="Minimize"
                  >
                    <MinimizeLine />
                  </button>
                )}
                {showClose !== false && (
                  <button
                    type="button"
                    className="ll-hbtn ll-hbtn--danger"
                    onClick={onClose}
                    aria-label="End call"
                    title="End call"
                  >
                    <CloseX />
                  </button>
                )}
              </div>
            </div>
          )}
          {compactControls && (
            <div className="ll-compact-status" data-state={agentState}>
              <span className="ll-compact-status__dot" aria-hidden />
              <span className="ll-compact-status__label">{agentState}</span>
            </div>
          )}
        </>
      ) : (
        // Idle-state header. In compactControls mode (mobile WIDGET +
        // every EMBEDDED card) we keep the header mounted but strip the
        // brand pill and the minimize button — the surface is too small
        // for either, AND there's nothing meaningful to minimize FROM
        // before a session starts. The X close button stays so visitors
        // can always dismiss; making the whole header disappear (the
        // pre-0.18.0 behavior) left users no way out short of scrolling
        // the page itself.
        (
          <div className="ll-expanded__header ll-expanded__header--idle" {...dragHandleProps}>
            {!compactControls && (
              showLiveLayerMark ? (
                <a
                  className="ll-expanded__brand ll-expanded__brand--link"
                  href="https://livelayer.studio?utm_source=widget&utm_medium=brand-badge"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Powered by LiveLayer — opens livelayer.studio in a new tab"
                  title="Powered by LiveLayer — visit livelayer.studio"
                >
                  <LiveLayerMarkIcon size={14} className="ll-expanded__brand-mark" />
                  <span>{productName}</span>
                </a>
              ) : (
                <span className="ll-expanded__brand">{productName}</span>
              )
            )}
            <div className="ll-expanded__header-actions">
              {!compactControls && showMinimize !== false && (
                <button
                  type="button"
                  className="ll-hbtn ll-hbtn--ghost"
                  onClick={onMinimize}
                  aria-label="Minimize widget"
                >
                  <MinimizeLine />
                </button>
              )}
              {showClose !== false && (
                <button
                  type="button"
                  className="ll-hbtn ll-hbtn--danger"
                  onClick={onClose}
                  aria-label="Close widget"
                >
                  <CloseX />
                </button>
              )}
            </div>
          </div>
        )
      )}

      {/* ── Idle center play button ─────────────────────────── */}
      {/* Three labels by state:
          - canResume true            → "Restart paused session"
          - disconnected, no resume   → "Reconnect to agent"
          - everything else (idle)    → "Start video call"
          The bottom CTA uses the same label so both affordances reach
          the user with identical copy. Tests assert on aria-label. */}
      {/* Three labels by state:
          - canResume true            → "Restart paused session"
          - disconnected, no resume   → "Reconnect to agent"
          - everything else (idle)    → "Start video call"
          The central play overlay shows on every idleish state EXCEPT
          error (errors have their own retry CTA). Bottom CTA stays as
          the textual fallback so users with the central button hidden
          (e.g. by host CSS) still have an affordance. Tests assert at
          least one button matches the resume / reconnect labels. */}
      {isIdleish && (() => {
        const idleLabel = canResume
          ? "Resume session"
          : connectionState === "disconnected"
            ? "Reconnect to agent"
            : "Start video call";
        const showCentralOverlay = !error;
        return (
          <>
            {/* Central play affordance. The label below the circle was
                stacking with the bottom CTA's identical copy AND a
                separate "Pick up where you left off" sublabel — three
                pieces of overlapping text on resume. Drop the label on
                desktop (icon-only); compact mode has no bottom CTA, so
                it keeps the label as its single affordance. */}
            {showCentralOverlay && (
              <button
                type="button"
                className="ll-expanded__play"
                onClick={onConnect}
                aria-label={idleLabel}
              >
                <div className="ll-expanded__play-circle">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <polygon points="6 3 20 12 6 21 6 3" />
                  </svg>
                </div>
                {compactControls && (
                  <span className="ll-expanded__play-label">{idleLabel}</span>
                )}
              </button>
            )}
            {!compactControls && (
              <div className="ll-expanded__bottom ll-expanded__bottom--idle">
                {greeting && (
                  <div className="ll-expanded__transcript">
                    <p className="ll-expanded__transcript-text">{greeting}</p>
                  </div>
                )}
                <button
                  type="button"
                  className="ll-expanded__cta"
                  onClick={onConnect}
                  aria-label={idleLabel}
                >
                  {idleLabel}
                </button>
              </div>
            )}
          </>
        );
      })()}

      {/* ── Local PIP (camera / screen share preview) ───────── */}
      <div
        className={`ll-expanded__pip ${
          isActive && (isCameraEnabled || isScreenShareEnabled)
            ? "is-visible"
            : ""
        }`}
      >
        <div
          ref={screenPipRef}
          className={isScreenShareEnabled ? "ll-expanded__pip-host" : "ll-expanded__pip-host is-hidden"}
        />
        <div
          ref={camPipRef}
          className={
            !isScreenShareEnabled && isCameraEnabled
              ? "ll-expanded__pip-host"
              : "ll-expanded__pip-host is-hidden"
          }
        />
      </div>

      {/* ── Bottom: transcript + toolbar + message input ────── */}
      {isActive ? (
        <div className="ll-expanded__bottom">
          {/* Two-pill captions stack. Agent pill (orange glow) sits on top
              so the most "live" voice is closest to the avatar; user pill
              sits closer to the toolbar / message input where their next
              action goes. Either pill is omitted when its slot is empty
              (e.g. before the first agent reply, only user pill shows). */}
          {/* Captions are hidden in compactControls mode — on a 140×210
              corner slot they bury the avatar's face. The status pill
              already conveys live state; audio is the primary channel. */}
          {!compactControls && agentPillText && (
            <div
              className="ll-expanded__transcript ll-expanded__transcript--agent"
              data-role="agent"
            >
              <p className="ll-expanded__transcript-text">{agentPillText}</p>
            </div>
          )}
          {!compactControls && userPillText && (
            <div
              className="ll-expanded__transcript ll-expanded__transcript--user"
              data-role="user"
            >
              <p className="ll-expanded__transcript-text">{userPillText}</p>
            </div>
          )}

          {/* Toolbar: screen / camera / mic / speaker */}
          {!chromeless && !compactControls && (
          <div className="ll-toolbar" onClick={(e) => e.stopPropagation()}>
            {allowScreenShare && (
              <button
                type="button"
                className={`ll-tool ${isScreenShareEnabled ? "is-on" : ""}`}
                onClick={onToggleScreenShare}
                aria-label={isScreenShareEnabled ? "Stop sharing screen" : "Share screen"}
                title={isScreenShareEnabled ? "Stop sharing" : "Share screen"}
              >
                <ScreenShareGlyph />
              </button>
            )}

            {allowCamera && (
              <div className="ll-tool-split">
                <button
                  type="button"
                  className={`ll-tool ll-tool--left ${isCameraEnabled ? "is-on" : ""}`}
                  onClick={onToggleCamera}
                  aria-label={isCameraEnabled ? "Turn off camera" : "Turn on camera"}
                  title={isCameraEnabled ? "Stop camera" : "Start camera"}
                >
                  <VideoGlyph />
                </button>
                <button
                  ref={camChevronRef}
                  type="button"
                  className={`ll-tool ll-tool--right ${isCameraEnabled ? "is-on" : ""}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setCamMenuOpen((v) => !v);
                    setMicMenuOpen(false);
                  }}
                  aria-label="Camera devices"
                  aria-haspopup="listbox"
                  aria-expanded={camMenuOpen}
                >
                  <ChevronDown />
                </button>
                {camMenuOpen && cameraDevices.length > 0 && (
                  <DeviceMenu
                    label="Camera"
                    devices={cameraDevices}
                    activeId={activeCameraId}
                    anchorRef={camChevronRef}
                    onPick={(id) => {
                      setCamMenuOpen(false);
                      onSwitchCameraDevice(id);
                    }}
                  />
                )}
              </div>
            )}

            <div className="ll-tool-split">
              <button
                type="button"
                className={`ll-tool ll-tool--left ${isMuted ? "is-muted" : ""}`}
                onClick={onToggleMute}
                aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
                title={isMuted ? "Unmute" : "Mute"}
              >
                <MicGlyph muted={isMuted} />
              </button>
              <button
                ref={micChevronRef}
                type="button"
                className={`ll-tool ll-tool--right ${isMuted ? "is-muted" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setMicMenuOpen((v) => !v);
                  setCamMenuOpen(false);
                }}
                aria-label="Microphone devices"
                aria-haspopup="listbox"
                aria-expanded={micMenuOpen}
              >
                <ChevronDown />
              </button>
              {micMenuOpen && micDevices.length > 0 && (
                <DeviceMenu
                  label="Microphone"
                  devices={micDevices}
                  activeId={activeMicId}
                  anchorRef={micChevronRef}
                  onPick={(id) => {
                    setMicMenuOpen(false);
                    onSwitchMicDevice(id);
                  }}
                />
              )}
            </div>

            <button
              type="button"
              className={`ll-tool ${isSpeakerMuted ? "is-muted" : ""}`}
              onClick={onToggleSpeaker}
              aria-label={isSpeakerMuted ? "Unmute speaker" : "Mute speaker"}
              title={isSpeakerMuted ? "Unmute speaker" : "Mute speaker"}
            >
              <SpeakerGlyph muted={isSpeakerMuted} />
            </button>

            {/* End conversation lives at the right edge of the toolbar
                row — same height/shape as the other tools, red tint to
                signal the destructive action. The header X also ends
                the call; this is the in-context affordance for users
                who don't look up at the header chrome. */}
            <button
              type="button"
              className="ll-tool ll-tool--danger"
              onClick={onDisconnect}
              aria-label="End conversation"
              title="End conversation"
            >
              <PhoneDownGlyph />
            </button>
          </div>
          )}
          {!chromeless && compactControls && (
            <CompactToolbar
              isMuted={isMuted}
              onToggleMute={onToggleMute}
              isCameraEnabled={isCameraEnabled}
              onToggleCamera={onToggleCamera}
              allowCamera={allowCamera}
              isScreenShareEnabled={isScreenShareEnabled}
              onToggleScreenShare={onToggleScreenShare}
              allowScreenShare={allowScreenShare}
              isSpeakerMuted={isSpeakerMuted}
              onToggleSpeaker={onToggleSpeaker}
              allowTyping={allowTyping}
              isTypingOpen={isTypingOpen}
              onToggleTyping={handleToggleTyping}
              onDisconnect={onDisconnect}
            />
          )}

          {!chromeless && allowTyping && (compactControls ? isTypingOpen : true) && (
            <form className="ll-message-input" onSubmit={handleSend}>
              <input
                type="text"
                className="ll-message-input__field"
                placeholder="Message..."
                value={messageDraft}
                onChange={(e) => setMessageDraft(e.target.value)}
                aria-label="Message the agent"
              />
              {messageDraft.trim() && (
                <button
                  type="submit"
                  className="ll-message-input__send"
                  aria-label="Send message"
                >
                  <SendGlyph />
                </button>
              )}
            </form>
          )}

          {/* End conversation moved into the toolbar row above (0.5.8) —
              consolidates with the other media controls instead of
              floating at the bottom of the panel. */}
        </div>
      ) : null /* idle-state bottom rendered by the play button block above */}

      {/* ── Error banner (single place; copy varies by error code) ─────
          The SDK emits machine-readable codes so we can show the right
          message and action. Plain strings fall through as-is. */}
      {(() => {
        // Mic-publish error from useMicrophoneState (post-connect): showing
        // the raw message is fine since it's already human-readable.
        if (micError && connectionState !== "error") {
          return (
            <div className="ll-expanded__banner" role="alert">
              <span>{micError}</span>
              <button
                type="button"
                className="ll-expanded__banner-x"
                onClick={onClearMicError}
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          );
        }
        if (!error || connectionState !== "error") return null;
        let title = "Failed to connect";
        let cta = "Try again";
        if (error === "MIC_PERMISSION_DENIED") {
          title = "Microphone blocked. Allow access to talk.";
        } else if (error === "MIC_NOT_FOUND") {
          title = "No microphone found. Plug one in + retry.";
        } else if (error === "MIC_UNAVAILABLE") {
          title = "Mic unavailable. Check other apps using it.";
        } else if (error === "AGENT_TIMEOUT") {
          title = "Agent didn't pick up. Try again.";
        } else if (error === "CONNECT_FAILED") {
          title = "Connection failed. Check your network.";
        } else if (error.length < 80) {
          // Raw string from consumer / future codes.
          title = error;
        }
        return (
          <div className="ll-expanded__banner ll-expanded__banner--error" role="alert">
            <span>{title}</span>
            <button
              type="button"
              className="ll-expanded__banner-retry"
              onClick={onRetry}
            >
              {cta}
            </button>
          </div>
        );
      })()}

      {/* ── Resize grip (bottom-right corner) ─────────────────────
          Rendered only when the host enabled resizing — gated on the
          presence of the data attribute the hook sets. Pointer events
          are owned by useDragAndResize; the diagonal lines are the
          standard corner-grip affordance. aria-hidden + a generous hit
          area via CSS keep it a pointer-only nicety (keyboard users get
          the default CSS sizing). */}
      {resizeHandleProps?.["data-ll-resize-handle"] !== undefined && (
        <div
          className="ll-expanded__resize-grip"
          {...resizeHandleProps}
          aria-hidden
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <line x1="11" y1="4" x2="4" y2="11" />
            <line x1="11" y1="8" x2="8" y2="11" />
          </svg>
        </div>
      )}
    </div>
  );
};

// ─── Inline SVG glyphs ────────────────────────────────────────────────
// Inline so the package ships one file + the CSS. Strokes use currentColor.

function ChevronDown() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function CloseX() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function MinimizeLine() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

export function ScreenShareGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

export function VideoGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M23 7l-7 5 7 5V7z" />
      <rect x="1" y="5" width="15" height="14" rx="2" />
    </svg>
  );
}

export function MicGlyph({ muted }: { muted: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      {muted && <line x1="1" y1="1" x2="23" y2="23" />}
    </svg>
  );
}

export function SpeakerGlyph({ muted }: { muted: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      {muted ? (
        <line x1="23" y1="9" x2="17" y2="15" />
      ) : (
        <>
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
        </>
      )}
    </svg>
  );
}

function SendGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

/**
 * Phone-receiver-pointing-down glyph — universal "hang up / end call"
 * affordance. Used on the toolbar's End conversation button.
 *
 * viewBox is padded to -4 -4 32 32 so the 135° rotation doesn't clip
 * the receiver corners outside the bounds. The unrotated path fills
 * 0 0 24 24 tightly; rotating around (12,12) pushes corners ~2 units
 * past each edge, which was visibly clipping on the right side. Stroke
 * is bumped to 2 to compensate for the wider viewBox / smaller render.
 */
export function PhoneDownGlyph() {
  return (
    <svg width="16" height="16" viewBox="-4 -4 32 32" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path
        d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.93.37 1.84.71 2.7a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.38-1.38a2 2 0 0 1 2.11-.45c.86.34 1.77.58 2.7.71A2 2 0 0 1 22 16.92z"
        transform="rotate(135 12 12)"
      />
    </svg>
  );
}

interface DeviceMenuProps {
  label: string;
  devices: MediaDeviceInfo[];
  activeId: string;
  onPick: (id: string) => void;
  /**
   * Trigger button (the chevron) the menu anchors to. The menu is
   * portaled to document.body so it escapes the toolbar split's
   * overflow:hidden — without that escape, the dropdown rendered
   * inside `.ll-tool-split { overflow: hidden }` and got clipped
   * to a 40px-tall pill, invisible.
   */
  anchorRef: RefObject<HTMLElement | null>;
}

const DeviceMenu: FC<DeviceMenuProps> = ({
  label,
  devices,
  activeId,
  onPick,
  anchorRef,
}) => {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const compute = () => {
      const a = anchorRef.current;
      if (!a) return;
      const rect = a.getBoundingClientRect();
      // Anchor menu's bottom edge ~8px above the chevron's top, centered
      // on the chevron horizontally. Clamp so it doesn't run off either
      // viewport edge on tight slots.
      const minLeft = 16 + 110; // 220px min-width / 2 + viewport gutter
      const maxLeft = window.innerWidth - 16 - 110;
      const center = rect.left + rect.width / 2;
      setPos({
        top: rect.top - 8,
        left: Math.max(minLeft, Math.min(maxLeft, center)),
      });
    };
    compute();
    window.addEventListener("scroll", compute, true);
    window.addEventListener("resize", compute);
    return () => {
      window.removeEventListener("scroll", compute, true);
      window.removeEventListener("resize", compute);
    };
  }, [anchorRef]);

  if (pos === null) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="ll-device-menu ll-device-menu--floating"
      onClick={(e) => e.stopPropagation()}
      role="listbox"
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        // translate up by 100% so its BOTTOM edge sits at pos.top.
        transform: "translate(-50%, -100%)",
      }}
    >
      <p className="ll-device-menu__label">{label}</p>
      {devices.map((d, idx) => {
        const isActive = activeId === d.deviceId;
        return (
          <button
            type="button"
            key={d.deviceId || idx}
            className={`ll-device-menu__item ${isActive ? "is-active" : ""}`}
            onClick={() => onPick(d.deviceId)}
            role="option"
            aria-selected={isActive}
          >
            {isActive && <span className="ll-device-menu__dot">●</span>}
            <span className="ll-device-menu__name">
              {d.label || `${label} ${idx + 1}`}
            </span>
          </button>
        );
      })}
    </div>,
    document.body,
  );
};
