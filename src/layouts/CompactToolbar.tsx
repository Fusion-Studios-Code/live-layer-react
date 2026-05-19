// ─── CompactToolbar ──────────────────────────────────────────────────────────
//
// A three-button bottom toolbar for compactControls mode:
//
//   🎤   ⋯   ❌
//
// Secondary controls (camera, screen share, speaker, typing, language) are
// tucked behind the ••• button which opens an OverflowPopover above the bar.
//
// Intended to be rendered inside ExpandedLayout when compactControls=true.
// Task 3 will wire it there.

import { useRef, useState, type FC } from "react";
import { OverflowPopover } from "../components/OverflowPopover";
import {
  MicGlyph,
  VideoGlyph,
  ScreenShareGlyph,
  SpeakerGlyph,
  PhoneDownGlyph,
} from "./ExpandedLayout";

interface CompactToolbarProps {
  // Mic
  isMuted: boolean;
  onToggleMute: () => void;

  // Camera
  isCameraEnabled: boolean;
  onToggleCamera: () => void;
  allowCamera: boolean;

  // Screen share
  isScreenShareEnabled: boolean;
  onToggleScreenShare: () => void;
  allowScreenShare: boolean;

  // Speaker
  isSpeakerMuted: boolean;
  onToggleSpeaker: () => void;

  // Typing input visibility — controlled by the parent layout so it can
  // render the actual <input> outside this component, above the toolbar.
  allowTyping: boolean;
  isTypingOpen: boolean;
  onToggleTyping: () => void;

  // End call
  onDisconnect: () => void;
}

export const CompactToolbar: FC<CompactToolbarProps> = ({
  isMuted,
  onToggleMute,
  isCameraEnabled,
  onToggleCamera,
  allowCamera,
  isScreenShareEnabled,
  onToggleScreenShare,
  allowScreenShare,
  isSpeakerMuted,
  onToggleSpeaker,
  allowTyping,
  isTypingOpen,
  onToggleTyping,
  onDisconnect,
}) => {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <div
        className="ll-toolbar ll-toolbar--compact"
        data-testid="compact-toolbar"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className={`ll-tool ${isMuted ? "is-muted" : ""}`}
          onClick={onToggleMute}
          aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
        >
          <MicGlyph muted={isMuted} />
        </button>

        <button
          ref={triggerRef}
          type="button"
          className={`ll-tool ${popoverOpen ? "is-on" : ""}`}
          onClick={() => setPopoverOpen((o) => !o)}
          aria-label="More controls"
          aria-haspopup="menu"
          aria-expanded={popoverOpen}
        >
          <OverflowDotsGlyph />
        </button>

        <button
          type="button"
          className="ll-tool ll-tool--danger"
          onClick={onDisconnect}
          aria-label="End conversation"
        >
          <PhoneDownGlyph />
        </button>
      </div>

      <OverflowPopover
        open={popoverOpen}
        onClose={() => setPopoverOpen(false)}
        anchorRef={triggerRef}
      >
        {allowCamera && (
          <button
            type="button"
            className={`ll-overflow-popover__item ${isCameraEnabled ? "is-on" : ""}`}
            onClick={() => {
              onToggleCamera();
              setPopoverOpen(false);
            }}
          >
            <VideoGlyph />
            <span>{isCameraEnabled ? "Stop camera" : "Start camera"}</span>
          </button>
        )}
        {allowScreenShare && (
          <button
            type="button"
            className={`ll-overflow-popover__item ${isScreenShareEnabled ? "is-on" : ""}`}
            onClick={() => {
              onToggleScreenShare();
              setPopoverOpen(false);
            }}
          >
            <ScreenShareGlyph />
            <span>{isScreenShareEnabled ? "Stop sharing" : "Share screen"}</span>
          </button>
        )}
        <button
          type="button"
          className={`ll-overflow-popover__item ${isSpeakerMuted ? "is-on" : ""}`}
          onClick={() => {
            onToggleSpeaker();
            setPopoverOpen(false);
          }}
        >
          <SpeakerGlyph muted={isSpeakerMuted} />
          <span>{isSpeakerMuted ? "Unmute speaker" : "Mute speaker"}</span>
        </button>
        {allowTyping && (
          <button
            type="button"
            className={`ll-overflow-popover__item ${isTypingOpen ? "is-on" : ""}`}
            onClick={() => {
              onToggleTyping();
              setPopoverOpen(false);
            }}
          >
            <TypeGlyph />
            <span>{isTypingOpen ? "Hide typing" : "Type a message"}</span>
          </button>
        )}
        <button
          type="button"
          className="ll-overflow-popover__item is-active"
          disabled
          aria-current="true"
        >
          <span className="ll-overflow-popover__lang-code">EN</span>
          <span>English</span>
        </button>
      </OverflowPopover>
    </>
  );
};

// ─── New glyphs (defined here, not in ExpandedLayout) ────────────────────────

/** Three horizontal filled dots — the ••• overflow trigger. */
function OverflowDotsGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <circle cx="6" cy="12" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="18" cy="12" r="1.5" />
    </svg>
  );
}

/** Chat bubble outline — represents "Type a message". */
function TypeGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
