// ─── LiveLayerDebugPanel ──────────────────────────────────────────────
// Floating bottom-left overlay that streams every AgentEvent the
// AvatarWidget emits — useful for verifying that the LLM is actually
// calling tools and the widget is acting on them. Opt-in only — never
// auto-mounts. Render alongside <AvatarWidget> in development:
//
//   <AvatarWidget agentId="..." onAgentEvent={debug.push} />
//   <LiveLayerDebugPanel onMount={(p) => (debug.push = p)} />
//
// or wire onAgentEvent through a small ref:
//
//   const debugRef = useRef<(e: AgentEventDetail) => void>(() => {});
//   <AvatarWidget onAgentEvent={(e) => debugRef.current(e)} />
//   <LiveLayerDebugPanel onMount={(p) => (debugRef.current = p)} />
//
// Toggle visibility with Cmd/Ctrl + Shift + L. Off by default so it
// doesn't clutter prod views; the keyboard shortcut means you can leave
// the component mounted always but invisible until you ask for it.
//
// All styles inline — no theme conflict with the host site.
//
// Implementation note: state updates are buffered + flushed on a
// rAF interval, NOT applied directly from the console-tap callbacks.
// React 19 throws "useInsertionEffect must not schedule updates" if
// you call setState synchronously from inside a console.warn that
// fired during a render phase.

"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { AgentEventDetail } from "../types";

interface DebugEntry {
  id: number;
  ts: number;
  kind: "event" | "warn" | "log";
  type: string;
  data?: Record<string, unknown>;
}

let nextId = 1;

export interface LiveLayerDebugPanelProps {
  /**
   * Receives a `push(event)` function the parent uses to forward
   * AgentEvent payloads from `<AvatarWidget onAgentEvent>`. Called
   * once on mount; the function reference stays stable.
   */
  onMount?: (push: (e: AgentEventDetail) => void) => void;
  /** Force the panel open at startup. Default: hidden, toggle with kb shortcut. */
  defaultOpen?: boolean;
  /** Custom storage key suffix if you mount multiple panels (rare). */
  storageKey?: string;
}

export function LiveLayerDebugPanel({
  onMount,
  defaultOpen = false,
  storageKey = "ll-debug-open",
}: LiveLayerDebugPanelProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [entries, setEntries] = useState<DebugEntry[]>([]);
  const [filter, setFilter] = useState("");
  const [paused, setPaused] = useState(false);
  const expandedRef = useRef<Set<number>>(new Set());

  // Buffer for entries so we never call setState from inside a console
  // tap. Flushed on a 100ms interval — fast enough to feel live.
  const bufferRef = useRef<DebugEntry[]>([]);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  // Hydration: parse localStorage flag for "remember open state"
  useEffect(() => {
    try {
      const v = localStorage.getItem(storageKey);
      if (v === "1") setOpen(true);
      if (v === "0") setOpen(false);
    } catch {
      // ignore (e.g. private mode)
    }
  }, [storageKey]);

  // Persist open state
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, open ? "1" : "0");
    } catch {
      // ignore
    }
  }, [open, storageKey]);

  // Cmd/Ctrl + Shift + L → toggle
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "l"
      ) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Buffer flush — drains bufferRef into state on a fixed interval.
  // Pausing prevents both writes (console tap) AND flushes from changing
  // visible state, but the buffer keeps filling so resume is instant.
  useEffect(() => {
    const interval = setInterval(() => {
      if (bufferRef.current.length === 0) return;
      if (pausedRef.current) return;
      const drained = bufferRef.current.splice(0, bufferRef.current.length);
      setEntries((prev) =>
        [...drained.reverse(), ...prev].slice(0, 200),
      );
    }, 100);
    return () => clearInterval(interval);
  }, []);

  // Push helper for the parent. Stable across renders via ref.
  const onMountCalledRef = useRef(false);
  useEffect(() => {
    if (!onMount || onMountCalledRef.current) return;
    onMountCalledRef.current = true;
    onMount((e: AgentEventDetail) => {
      bufferRef.current.push({
        id: nextId++,
        ts: Date.now(),
        kind: "event",
        type: e.eventName,
        data: e.data,
      });
    });
  }, [onMount]);

  // Tap console.warn / console.log to surface [LiveLayer] lines.
  // Pushes to the buffer ONLY — never setState directly. Restoring
  // both originals on unmount.
  useEffect(() => {
    const origWarn = console.warn;
    const origLog = console.log;
    const tap = (kind: "warn" | "log", origFn: typeof console.warn) =>
      function (this: Console, ...args: unknown[]) {
        try {
          const first = typeof args[0] === "string" ? args[0] : "";
          if (first.startsWith("[LiveLayer]")) {
            bufferRef.current.push({
              id: nextId++,
              ts: Date.now(),
              kind,
              type: first.slice(0, 120),
              data: { args: args.slice(1).map((a) => safe(a)) },
            });
          }
        } catch {
          // never let the tap break the app
        }
        return origFn.apply(this, args);
      };
    console.warn = tap("warn", origWarn);
    console.log = tap("log", origLog);
    return () => {
      console.warn = origWarn;
      console.log = origLog;
    };
  }, []);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Open LiveLayer debug panel (Cmd/Ctrl + Shift + L)"
        aria-label="Open LiveLayer debug panel"
        style={{
          position: "fixed",
          left: 16,
          bottom: 16,
          zIndex: 2_147_483_640,
          background: "#0d0d0d",
          color: "#fff",
          border: "1px solid rgba(255,255,255,0.18)",
          borderRadius: 999,
          padding: "6px 10px",
          font: "500 11px -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
          letterSpacing: "-0.1px",
          cursor: "pointer",
          boxShadow: "0 4px 12px rgba(0,0,0,0.35)",
          opacity: 0.85,
        }}
      >
        🛰 LL debug
      </button>
    );
  }

  const visible = entries.filter((e) => {
    if (!filter) return true;
    const f = filter.toLowerCase();
    return (
      e.type.toLowerCase().includes(f) ||
      JSON.stringify(e.data || {})
        .toLowerCase()
        .includes(f)
    );
  });

  return (
    <div
      style={{
        position: "fixed",
        left: 16,
        bottom: 16,
        zIndex: 2_147_483_640,
        width: 380,
        maxHeight: "60vh",
        background: "#0d0d0d",
        color: "#fff",
        border: "1px solid rgba(255,255,255,0.16)",
        borderRadius: 12,
        boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
        font: "500 11px -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
        letterSpacing: "-0.1px",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "8px 10px",
          background: "rgba(255,255,255,0.04)",
          borderBottom: "1px solid rgba(255,255,255,0.1)",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 12 }}>LiveLayer debug</span>
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>
          {entries.length} event{entries.length === 1 ? "" : "s"}
        </span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => setPaused((p) => !p)}
          style={chipBtn(paused ? "#f59e0b" : "transparent")}
          title="Pause / resume capture"
        >
          {paused ? "▶ resume" : "⏸ pause"}
        </button>
        <button
          type="button"
          onClick={() => {
            setEntries([]);
            bufferRef.current = [];
          }}
          style={chipBtn("transparent")}
          title="Clear buffer"
        >
          clear
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          style={chipBtn("transparent")}
          aria-label="Close"
          title="Close (Cmd/Ctrl + Shift + L)"
        >
          ✕
        </button>
      </div>
      <input
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="filter by type or data…"
        style={{
          margin: 8,
          padding: "6px 8px",
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 6,
          color: "#fff",
          fontSize: 11,
          outline: "none",
        }}
      />
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "0 8px 8px",
        }}
      >
        {visible.length === 0 ? (
          <div
            style={{
              padding: 14,
              fontSize: 11,
              color: "rgba(255,255,255,0.4)",
              lineHeight: 1.5,
            }}
          >
            No events yet. Connect to the agent and trigger a tool call —
            the events will stream in here. You can also dispatch
            commands manually in DevTools:
            <pre
              style={{
                marginTop: 6,
                background: "rgba(255,255,255,0.04)",
                padding: 6,
                borderRadius: 4,
                fontSize: 10,
                whiteSpace: "pre-wrap",
              }}
            >
              {`window.__livelayerSimulateCommand({\n  type: "navigate",\n  href: "/about"\n})`}
            </pre>
          </div>
        ) : (
          visible.map((e) => (
            <DebugRow
              key={e.id}
              entry={e}
              expanded={expandedRef.current.has(e.id)}
              onToggle={() => {
                if (expandedRef.current.has(e.id)) {
                  expandedRef.current.delete(e.id);
                } else {
                  expandedRef.current.add(e.id);
                }
                // force re-render by replacing the array reference
                setEntries((prev) => [...prev]);
              }}
            />
          ))
        )}
      </div>
    </div>
  );
}

function DebugRow({
  entry,
  expanded,
  onToggle,
}: {
  entry: DebugEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const colorByType = (() => {
    if (entry.kind === "warn") return "#f59e0b";
    if (entry.type.startsWith("[LiveLayer]")) return "#94a3b8";
    if (
      entry.type === "navigate" ||
      entry.type === "scroll_page" ||
      entry.type === "scroll_to" ||
      entry.type === "click"
    )
      return "#22c55e";
    if (
      entry.type === "fill_form" ||
      entry.type === "submit_form" ||
      entry.type === "focus_field"
    )
      return "#a78bfa";
    if (
      entry.type === "request_page_context" ||
      entry.type === "request_routes"
    )
      return "#38bdf8";
    if (entry.type === "agent_state") return "#facc15";
    return "#cbd5e1";
  })();
  const time = new Date(entry.ts).toLocaleTimeString("en-US", {
    hour12: false,
  });
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        textAlign: "left",
        background: "transparent",
        border: 0,
        color: "#fff",
        width: "100%",
        padding: "6px 4px",
        cursor: "pointer",
        borderBottom: "1px solid rgba(255,255,255,0.04)",
        fontSize: 11,
        lineHeight: 1.4,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span
          style={{
            color: "rgba(255,255,255,0.4)",
            fontVariantNumeric: "tabular-nums",
            fontSize: 10,
          }}
        >
          {time}
        </span>
        <span
          style={{
            color: colorByType,
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          {entry.type.length > 50
            ? entry.type.slice(0, 50) + "…"
            : entry.type}
        </span>
      </div>
      {expanded && entry.data && (
        <pre
          style={{
            marginTop: 6,
            padding: 6,
            background: "rgba(255,255,255,0.04)",
            borderRadius: 4,
            fontSize: 10,
            overflowX: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
          }}
        >
          {JSON.stringify(entry.data, null, 2)}
        </pre>
      )}
    </button>
  );
}

function chipBtn(bg: string): CSSProperties {
  return {
    background: bg,
    color: "#fff",
    border: "1px solid rgba(255,255,255,0.16)",
    borderRadius: 999,
    padding: "3px 8px",
    fontSize: 10,
    cursor: "pointer",
  };
}

function safe(v: unknown): unknown {
  try {
    if (v instanceof Error) return { message: v.message, stack: v.stack };
    JSON.stringify(v);
    return v;
  } catch {
    return String(v);
  }
}
