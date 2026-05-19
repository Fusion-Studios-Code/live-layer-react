// ─── useLiveKitSession ────────────────────────────────────────────────
//
// React wrapper around `@livelayer/sdk`'s `LiveKitSession`. Bridges the
// class's imperative callback API to hook-shaped state.
//
//   ┌──────────────────────────────────────────────────────────────┐
//   │                    Connection lifecycle                       │
//   │                                                               │
//   │   idle ──── connect() ───► connecting ──► connected           │
//   │     ▲                          │              │               │
//   │     │                          ▼              │               │
//   │     │                        error            │               │
//   │     │                                         ▼               │
//   │     └────────── disconnect() ◄────── disconnected             │
//   │                                                               │
//   │  Resume window: after disconnected, canResume is true for     │
//   │  RESUME_WINDOW_MS (5 min). Next connect() passes priorRoomName │
//   │  so the server replays the tail of the prior transcript.       │
//   └──────────────────────────────────────────────────────────────┘
//
// The session owns the LiveKit Room internally; the hook exposes just
// what the widget needs: state + methods + references to the attached
// audio/video elements. Consumers use the refs to wire up the video
// surface (ExpandedLayout) and the audio analyser (useAudioLevel).

import { useCallback, useEffect, useRef, useState } from "react";
import {
  LiveKitSession,
  type AgentConfig,
  type AgentState,
  type ConnectionState,
  type SessionCallbacks,
  type SessionOptions,
  type TranscriptEntry,
} from "@livelayer/sdk";

export interface UseLiveKitSessionResult {
  // ── State ──────────────────────────────────────────────
  connectionState: ConnectionState;
  agentState: AgentState;
  transcript: TranscriptEntry[];
  agentConfig: AgentConfig | null;
  /** Live video <video> element attached by the agent, or null. */
  videoElement: HTMLVideoElement | null;
  /** Remote <audio> element (agent voice), or null. */
  audioElement: HTMLAudioElement | null;
  /** True when the session's resume window is still open. */
  canResume: boolean;
  /** Surface a friendly error string when connect fails. */
  error: string | null;

  // ── Methods ────────────────────────────────────────────
  connect: () => Promise<void>;
  disconnect: () => void;
  /** Access the underlying Room (e.g. to publish mic track). */
  getRoom: () => ReturnType<LiveKitSession["getRoom"]>;

  // ── Raw access ─────────────────────────────────────────
  /** The session instance, if consumers need it. */
  session: LiveKitSession | null;
}

export interface UseLiveKitSessionOptions extends SessionOptions {
  /**
   * Fires for every data channel message from the agent. The hook also
   * interprets recognized state-bearing messages (agent_state) and updates
   * its own state; consumers use this callback to handle everything else.
   */
  onDataMessage?: (msg: Record<string, unknown>) => void;
}

export function useLiveKitSession(
  options: UseLiveKitSessionOptions,
): UseLiveKitSessionResult {
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const [agentState, setAgentState] = useState<AgentState>("idle");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [agentConfig, setAgentConfig] = useState<AgentConfig | null>(null);
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const [canResume, setCanResume] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sessionRef = useRef<LiveKitSession | null>(null);
  const onDataMessageRef = useRef(options.onDataMessage);
  onDataMessageRef.current = options.onDataMessage;

  // Build the session once per agentId/baseUrl change. Changing those values
  // should destroy the current session and spin a new one — simulates the
  // team-member-switch flow where agentId may change at runtime.
  useEffect(() => {
    const callbacks: SessionCallbacks = {
      onConnectionStateChange: (state) => {
        setConnectionState(state);
        if (state === "connected") setError(null);
      },
      onAgentStateChange: setAgentState,
      onTranscript: (entries) => setTranscript([...entries]),
      onAgentConfig: setAgentConfig,
      onAudioTrack: (el) => setAudioElement(el),
      onVideoTrack: (el) => setVideoElement(el),
      onVideoTrackRemoved: () => setVideoElement(null),
      onError: (msg) => setError(msg),
      onDataMessage: (msg) => {
        onDataMessageRef.current?.(msg);
      },
      onResumabilityChange: setCanResume,
    };

    const session = new LiveKitSession(
      {
        agentId: options.agentId,
        baseUrl: options.baseUrl,
        apiKey: options.apiKey,
        sessionEndpoint: options.sessionEndpoint,
        sessionBody: options.sessionBody,
      },
      callbacks,
    );
    sessionRef.current = session;

    // Reset per-session derived state whenever the session is recreated.
    setConnectionState("idle");
    setAgentState("idle");
    setTranscript([]);
    setAgentConfig(null);
    setVideoElement(null);
    setAudioElement(null);
    setCanResume(false);
    setError(null);

    return () => {
      session.destroy?.();
      sessionRef.current = null;
    };
    // Serialize sessionBody so structural changes trigger a reconnect-ready reset.
    // Intentionally NOT depending on onDataMessage (routed via ref).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    options.agentId,
    options.baseUrl,
    options.apiKey,
    options.sessionEndpoint,
    JSON.stringify(options.sessionBody ?? {}),
  ]);

  const connect = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    try {
      await session.connect();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    }
  }, []);

  const disconnect = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    session.disconnect();
  }, []);

  const getRoom = useCallback(() => {
    return sessionRef.current?.getRoom() ?? null;
  }, []);

  return {
    connectionState,
    agentState,
    transcript,
    agentConfig,
    videoElement,
    audioElement,
    canResume,
    error,
    connect,
    disconnect,
    getRoom,
    session: sessionRef.current,
  };
}
