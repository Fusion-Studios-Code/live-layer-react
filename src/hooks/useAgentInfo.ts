// ─── useAgentInfo ─────────────────────────────────────────────────────
// Fetch public agent metadata (name + avatar + idle loop) on mount so the
// widget's idle / pre-connect screen can render a blurred avatar preview
// instead of a black rectangle. The session POST still returns the same
// fields, but we want them BEFORE the user clicks play.
//
// Endpoint: GET {baseUrl}/api/widget/agent/{agentId}
// No auth: returns only PUBLISHED agents and public display fields.

import { useEffect, useState } from "react";

export interface AgentInfo {
  id: string;
  name: string;
  avatarImageUrl: string;
  idleLoopUrl: string | null;
  /**
   * 0.5.0 — capability allowlist set by the agent's owner in the
   * Navigation settings tab. null = unrestricted. The widget applies
   * this as the default for its `capabilities` prop unless the
   * consumer overrides explicitly.
   */
  capabilities?: string[] | null;
  /**
   * 0.5.0 — when true, the agent runtime fetches page context before
   * each user turn. Surfaced here for observability; the widget does
   * not need to behave differently based on this (the agent runtime
   * does the work).
   */
  autoPageContext?: boolean;
}

export interface AgentInfoHandle {
  info: AgentInfo | null;
  error: string | null;
  loading: boolean;
}

export function useAgentInfo(
  agentId: string,
  baseUrl: string | undefined,
  /** Skip the fetch (e.g. when consumer has passed avatarImageUrl as a prop). */
  skip = false,
): AgentInfoHandle {
  const [info, setInfo] = useState<AgentInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!skip && !!agentId);

  useEffect(() => {
    if (skip || !agentId) {
      setLoading(false);
      return;
    }

    // We rely on effect dependencies to gate refetches — no `fetchedRef`
    // de-dup guard. A previous version cached "we already started a fetch
    // for this key" in a ref, but under React 19 StrictMode dev double-
    // invocation, the first mount's cleanup aborts the in-flight request
    // BEFORE it resolves; the second mount then sees the ref set and
    // skips, leaving `info` permanently null. Letting the second mount
    // start its own fetch is correct: the cleanup aborts losers and the
    // final winner sets state.
    const controller = new AbortController();
    const base = baseUrl || "https://app.livelayer.studio";
    setLoading(true);
    setError(null);

    fetch(`${base}/api/widget/agent/${encodeURIComponent(agentId)}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((data) => {
        if (controller.signal.aborted) return;
        setInfo(data as AgentInfo);
        setLoading(false);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Agent lookup failed");
        setLoading(false);
      });

    return () => controller.abort();
  }, [agentId, baseUrl, skip]);

  return { info, error, loading };
}
