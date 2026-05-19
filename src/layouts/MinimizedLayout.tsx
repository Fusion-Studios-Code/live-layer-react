// ─── MinimizedLayout ──────────────────────────────────────────────────
//
// Docked, always-visible small widget. Two renderings based on viewport:
//
//  DESKTOP (≥ breakpoint)
//  ┌──────────────────────────────────────┐  ~240 × 64 pill, corner-docked
//  │ [img] Agent Name        [mic] [⤢] [×]│  Avatar thumb + name + controls.
//  └──────────────────────────────────────┘
//
//  MOBILE (< breakpoint)
//  ┌─────────────────────────────────────────────────────┐  100vw × 72px,
//  │ [img]  ▁▂▅▇▅▂▁ waveform bar       Agent name   [⤢] │  always bottom-docked.
//  └─────────────────────────────────────────────────────┘  Position prop ignored.
//
// Both variants expand to ExpandedLayout on click (anywhere on the bar).
// Mobile waveform uses AudioWaveform with fewer bars for width constraint.
//
// Why these two shapes:
//   - Desktop users expect small unobtrusive widgets in a corner — the pill
//     stays out of the way of the primary content.
//   - Mobile users need full-width taps + audio feedback for one-handed use.
//     Nova's site-embed research showed the bottom bar outperforms corner
//     widgets for engagement on phones.

import type { FC } from "react";
import type { AudioLevelHandle } from "../hooks/useAudioLevel";
import type { AgentState } from "@livelayer/sdk";
import { AudioWaveform } from "../components/AudioWaveform";
import { MicIcon, ExpandIcon, CloseIcon } from "../components/icons";
import type { WidgetPosition } from "../types";

interface Props {
  position: WidgetPosition;
  isMobile: boolean;
  agentName: string;
  avatarImageUrl: string | null;
  agentState: AgentState;
  isMuted: boolean;
  audioLevel: AudioLevelHandle;
  onExpand: () => void;
  onToggleMute: () => void;
  onClose: () => void;
}

export const MinimizedLayout: FC<Props> = ({
  position,
  isMobile,
  agentName,
  avatarImageUrl,
  agentState,
  isMuted,
  audioLevel,
  onExpand,
  onToggleMute,
  onClose,
}) => {
  if (isMobile) {
    // Full-width bottom dock. Entire bar is the tap target; inner buttons
    // stopPropagation so mic toggle + expand don't double-fire.
    return (
      <div
        className="ll-minimized ll-minimized--mobile"
        role="region"
        aria-label={`${agentName} widget`}
      >
        <button
          type="button"
          className="ll-minimized__surface"
          onClick={onExpand}
          aria-label={`Expand ${agentName} widget`}
        >
          {avatarImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarImageUrl}
              alt={agentName}
              className="ll-minimized__avatar"
            />
          ) : (
            <div className="ll-minimized__avatar ll-minimized__avatar--placeholder" />
          )}
          <AudioWaveform
            audioLevel={audioLevel}
            bars={16}
            maxHeight={18}
            className="ll-minimized__waveform"
          />
          <span className="ll-minimized__name">{agentName}</span>
          <div className="ll-minimized__controls">
            <span
              className="ll-minimized__btn"
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onToggleMute();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation();
                  e.preventDefault();
                  onToggleMute();
                }
              }}
              aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
            >
              <MicIcon muted={isMuted} className="ll-minimized__icon" />
            </span>
            <ExpandIcon className="ll-minimized__icon ll-minimized__icon--expand" />
          </div>
        </button>
      </div>
    );
  }

  // Desktop pill — corner-docked.
  return (
    <div
      className="ll-minimized ll-minimized--desktop"
      data-position={position}
      role="region"
      aria-label={`${agentName} widget`}
    >
      <div className="ll-minimized__surface">
        {avatarImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarImageUrl}
            alt={agentName}
            className="ll-minimized__avatar"
          />
        ) : (
          <div className="ll-minimized__avatar ll-minimized__avatar--placeholder" />
        )}
        <div className="ll-minimized__meta">
          <span className="ll-minimized__name">{agentName}</span>
          <span className="ll-minimized__state">
            {agentState === "speaking"
              ? "Speaking"
              : agentState === "thinking"
              ? "Thinking"
              : "Listening"}
          </span>
        </div>
        <div className="ll-minimized__controls">
          <button
            type="button"
            className="ll-minimized__btn"
            onClick={onToggleMute}
            aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
          >
            <MicIcon muted={isMuted} className="ll-minimized__icon" />
          </button>
          <button
            type="button"
            className="ll-minimized__btn"
            onClick={onExpand}
            aria-label={`Expand ${agentName} widget`}
          >
            <ExpandIcon className="ll-minimized__icon" />
          </button>
          <button
            type="button"
            className="ll-minimized__btn ll-minimized__btn--close"
            onClick={onClose}
            aria-label="Close widget"
          >
            <CloseIcon className="ll-minimized__icon" />
          </button>
        </div>
      </div>
    </div>
  );
};
