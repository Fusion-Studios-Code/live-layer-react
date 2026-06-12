import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { createRef, useState } from "react";
import {
  AvatarWidget,
  type AvatarWidgetHandle,
  type ControlledSession,
} from "./AvatarWidget";
import type { AgentCommand, AgentEventDetail } from "./types";
import type { PageVisionClientConfig } from "./utils/pageVision/controller";

// Page-vision capture + upload are mocked so jsdom never touches canvas or
// the network. The widget wires usePageVision → PageVisionController →
// these two modules; with them stubbed the whole capture chain runs
// synchronously under the rAF/idle stubs below.
vi.mock("./utils/pageVision/capture", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("./utils/pageVision/capture")>();
  return {
    ...real,
    capturePageImage: vi.fn().mockResolvedValue({
      blob: new Blob([new Uint8Array([1])], { type: "image/jpeg" }),
      thumb: new Uint8Array(32 * 32).fill(7),
      width: 10,
      height: 10,
    }),
  };
});
vi.mock("./utils/pageVision/upload", () => ({
  uploadScreenshot: vi
    .fn()
    .mockResolvedValue(
      "https://s/storage/v1/object/public/page-vision/t.jpg",
    ),
}));

// Minimal ControlledSession factory. Tests override the fields they care
// about. Defaults produce a disconnected, no-op session.
function makeControlledSession(
  overrides: Partial<ControlledSession> = {},
): ControlledSession {
  return {
    connectionState: "idle",
    agentState: "idle",
    transcript: [],
    videoElement: null,
    audioElement: null,
    canResume: false,
    error: null,
    onConnect: vi.fn(),
    onDisconnect: vi.fn(),
    ...overrides,
  };
}

// Helpers that exercise the package without touching LiveKit.
function renderWithControlled(
  override: Partial<ControlledSession> = {},
  props: Partial<Parameters<typeof AvatarWidget>[0]> = {},
) {
  const session = makeControlledSession(override);
  const { container } = render(
    <AvatarWidget
      agentId="test-agent"
      controlledSession={session}
      defaultDisplayMode="expanded"
      {...props}
    />,
  );
  return { session, container };
}

describe("AvatarWidget (controlledSession API)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders the expanded layout with the agent name", () => {
    renderWithControlled({}, { agentName: "Test Guide" });
    expect(
      screen.getByRole("dialog", { name: /test guide widget/i }),
    ).toBeInTheDocument();
  });

  it("shows the Start button when session is idle + disconnected", () => {
    renderWithControlled({ connectionState: "idle" });
    // Two affordances render when idle: the large play-overlay and the
    // bottom CTA. Both should reach the user.
    const buttons = screen.getAllByRole("button", {
      name: /start video call/i,
    });
    expect(buttons.length).toBeGreaterThanOrEqual(2);
  });

  it("calls controlledSession.onConnect when the Start button is clicked", () => {
    const onConnect = vi.fn();
    const { session } = renderWithControlled({ onConnect });
    // Both the play-overlay button and the bottom CTA fire onConnect.
    // Click the first match; behavior is identical.
    const buttons = screen.getAllByRole("button", {
      name: /start video call/i,
    });
    buttons[0].click();
    expect(session.onConnect).toHaveBeenCalledTimes(1);
  });

  it("offers Resume-session copy when canResume is true", () => {
    renderWithControlled({
      connectionState: "disconnected",
      canResume: true,
    });
    // 0.10.x renders BOTH a central play-overlay AND a bottom CTA with
    // the same aria-label so users with hidden chrome still get the
    // affordance — match length-1+ instead of unique.
    expect(
      screen.getAllByRole("button", { name: /resume session/i }).length,
    ).toBeGreaterThan(0);
  });

  it("shows 'Click to reconnect' when disconnected without resume eligibility", () => {
    renderWithControlled({
      connectionState: "disconnected",
      canResume: false,
    });
    expect(
      screen.getAllByRole("button", { name: /reconnect to agent/i }).length,
    ).toBeGreaterThan(0);
  });

  it("renders both the latest user and the latest agent transcript line as separate pills", () => {
    renderWithControlled({
      connectionState: "connected",
      agentState: "speaking",
      transcript: [
        { id: "1", role: "user", text: "Hello there", final: true },
        { id: "2", role: "agent", text: "How can I help?", final: true },
      ],
    });
    // Both speakers' latest lines render as their own pills — no swap.
    expect(screen.getByText(/how can i help/i)).toBeInTheDocument();
    expect(screen.getByText(/hello there/i)).toBeInTheDocument();
  });

  it("paints the orange caption glow on the agent pill, not the user pill", () => {
    renderWithControlled({
      connectionState: "connected",
      agentState: "speaking",
      transcript: [
        { id: "1", role: "user", text: "Hello there", final: true },
        { id: "2", role: "agent", text: "How can I help?", final: true },
      ],
    });
    const agentPill = screen
      .getByText(/how can i help/i)
      .closest(".ll-expanded__transcript");
    const userPill = screen
      .getByText(/hello there/i)
      .closest(".ll-expanded__transcript");
    expect(agentPill).toHaveClass("ll-expanded__transcript--agent");
    expect(agentPill).toHaveAttribute("data-role", "agent");
    expect(userPill).not.toHaveClass("ll-expanded__transcript--agent");
    expect(userPill).toHaveAttribute("data-role", "user");
  });

  it("uses the latest line per role even when older entries from the same role exist", () => {
    renderWithControlled({
      connectionState: "connected",
      agentState: "listening",
      transcript: [
        { id: "1", role: "agent", text: "First reply", final: true },
        { id: "2", role: "user", text: "First question", final: true },
        { id: "3", role: "agent", text: "Second reply", final: true },
        { id: "4", role: "user", text: "Follow up", final: true },
      ],
    });
    expect(screen.getByText(/second reply/i)).toBeInTheDocument();
    expect(screen.getByText(/follow up/i)).toBeInTheDocument();
    expect(screen.queryByText(/first reply/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/first question/i)).not.toBeInTheDocument();
  });

  it("renders only the user pill when the agent hasn't spoken yet", () => {
    renderWithControlled({
      connectionState: "connected",
      agentState: "listening",
      transcript: [
        { id: "1", role: "user", text: "Anyone there?", final: true },
      ],
    });
    expect(screen.getByText(/anyone there/i)).toBeInTheDocument();
    expect(
      document.querySelectorAll(".ll-expanded__transcript--agent").length,
    ).toBe(0);
  });

  it("calls onDisconnect when End conversation is clicked", () => {
    const onDisconnect = vi.fn();
    const { session } = renderWithControlled({
      connectionState: "connected",
      onDisconnect,
    });
    screen.getByRole("button", { name: /end conversation/i }).click();
    expect(session.onDisconnect).toHaveBeenCalledTimes(1);
  });

  it("surfaces connection errors via the error prop in the banner", () => {
    renderWithControlled({
      connectionState: "error",
      error: "Network unavailable",
    });
    expect(screen.getByText(/network unavailable/i)).toBeInTheDocument();
  });

  describe("data message routing", () => {
    it("invokes subscribeToDataMessages when controlledSession provides it", () => {
      const unsubscribe = vi.fn();
      const subscribeToDataMessages = vi.fn().mockReturnValue(unsubscribe);
      const { unmount } = render(
        <AvatarWidget
          agentId="test-agent"
          controlledSession={makeControlledSession({ subscribeToDataMessages })}
        />,
      );
      expect(subscribeToDataMessages).toHaveBeenCalledTimes(1);
      // Return value is the cleanup — should be called on unmount.
      unmount();
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    });

    it("forwards non-universal commands to onAgentCommand", () => {
      const onAgentCommand = vi.fn();
      // Grab the subscriber the widget installs so we can push messages in.
      let subscriber: ((msg: Record<string, unknown>) => void) | null = null;
      const subscribeToDataMessages = vi.fn((cb) => {
        subscriber = cb;
        return () => {
          subscriber = null;
        };
      });

      render(
        <AvatarWidget
          agentId="test-agent"
          controlledSession={makeControlledSession({ subscribeToDataMessages })}
          onAgentCommand={onAgentCommand}
        />,
      );

      expect(subscriber).not.toBeNull();
      act(() => {
        subscriber!({ type: "fill_field", fieldId: "business_name", value: "Acme" });
      });
      expect(onAgentCommand).toHaveBeenCalledWith({
        type: "fill_field",
        fieldId: "business_name",
        value: "Acme",
      } as unknown as AgentCommand);
    });

    it("does NOT forward universal commands to onAgentCommand", () => {
      const onAgentCommand = vi.fn();
      let subscriber: ((msg: Record<string, unknown>) => void) | null = null;
      render(
        <AvatarWidget
          agentId="test-agent"
          controlledSession={makeControlledSession({
            subscribeToDataMessages: (cb) => {
              subscriber = cb;
              return () => {};
            },
          })}
          onAgentCommand={onAgentCommand}
        />,
      );
      act(() => {
        subscriber!({ type: "agent_state", state: "thinking" });
        subscriber!({ type: "avatar_active" });
        subscriber!({ type: "idle_warning", timeoutInMs: 5000 });
      });
      expect(onAgentCommand).not.toHaveBeenCalled();
    });

    it("fires onAgentEvent for every message, universal or not", () => {
      const onAgentEvent = vi.fn();
      let subscriber: ((msg: Record<string, unknown>) => void) | null = null;
      render(
        <AvatarWidget
          agentId="test-agent"
          controlledSession={makeControlledSession({
            subscribeToDataMessages: (cb) => {
              subscriber = cb;
              return () => {};
            },
          })}
          onAgentEvent={onAgentEvent}
        />,
      );
      act(() => {
        subscriber!({ type: "agent_state", state: "speaking" });
        subscriber!({ type: "fill_field", fieldId: "name", value: "x" });
      });
      expect(onAgentEvent).toHaveBeenCalledTimes(2);
      const calls = onAgentEvent.mock.calls.map(
        (c) => (c[0] as AgentEventDetail).eventName,
      );
      expect(calls).toEqual(["agent_state", "fill_field"]);
    });

    it("ignores messages with no type field", () => {
      const onAgentCommand = vi.fn();
      const onAgentEvent = vi.fn();
      let subscriber: ((msg: Record<string, unknown>) => void) | null = null;
      render(
        <AvatarWidget
          agentId="test-agent"
          controlledSession={makeControlledSession({
            subscribeToDataMessages: (cb) => {
              subscriber = cb;
              return () => {};
            },
          })}
          onAgentCommand={onAgentCommand}
          onAgentEvent={onAgentEvent}
        />,
      );
      act(() => {
        subscriber!({ noType: true });
        subscriber!({ type: 42 as unknown as string });
      });
      expect(onAgentCommand).not.toHaveBeenCalled();
      expect(onAgentEvent).not.toHaveBeenCalled();
    });
  });

  describe("lifecycle callbacks", () => {
    it("fires onConnect when connectionState flips to connected", () => {
      const onConnectCb = vi.fn();
      function Harness() {
        const [state, setState] = useState<"idle" | "connected">("idle");
        return (
          <>
            <button onClick={() => setState("connected")}>go</button>
            <AvatarWidget
              agentId="a"
              onConnect={onConnectCb}
              controlledSession={makeControlledSession({ connectionState: state })}
            />
          </>
        );
      }
      render(<Harness />);
      expect(onConnectCb).not.toHaveBeenCalled();
      act(() => screen.getByText("go").click());
      expect(onConnectCb).toHaveBeenCalledTimes(1);
    });

    it("fires onTranscript with the new entries", () => {
      const onTranscript = vi.fn();
      function Harness() {
        const [t, setT] = useState<
          { id: string; role: "user" | "agent"; text: string; final: boolean }[]
        >([]);
        return (
          <>
            <button
              onClick={() =>
                setT([{ id: "1", role: "agent", text: "hi", final: true }])
              }
            >
              add
            </button>
            <AvatarWidget
              agentId="a"
              onTranscript={onTranscript}
              controlledSession={makeControlledSession({ transcript: t })}
            />
          </>
        );
      }
      render(<Harness />);
      // Initial render fires with empty array.
      expect(onTranscript).toHaveBeenCalledWith([]);
      act(() => screen.getByText("add").click());
      expect(onTranscript).toHaveBeenLastCalledWith([
        { id: "1", role: "agent", text: "hi", final: true },
      ]);
    });

    it("fires onAgentState when state changes", () => {
      const onAgentState = vi.fn();
      function Harness() {
        const [s, setS] =
          useState<"idle" | "listening" | "speaking">("idle");
        return (
          <>
            <button onClick={() => setS("speaking")}>talk</button>
            <AvatarWidget
              agentId="a"
              onAgentState={onAgentState}
              controlledSession={makeControlledSession({ agentState: s })}
            />
          </>
        );
      }
      render(<Harness />);
      expect(onAgentState).toHaveBeenCalledWith("idle");
      act(() => screen.getByText("talk").click());
      expect(onAgentState).toHaveBeenLastCalledWith("speaking");
    });
  });

  describe("transforming overlay", () => {
    it("renders the overlay with default label when transforming is true", () => {
      renderWithControlled({}, { transforming: true });
      // role=status is unique to the transforming overlay in the widget.
      expect(screen.getByRole("status")).toBeInTheDocument();
      expect(screen.getByText(/transforming/i)).toBeInTheDocument();
    });

    it("uses a custom transformingLabel when provided", () => {
      renderWithControlled(
        {},
        { transforming: true, transformingLabel: "Updating avatar…" },
      );
      expect(screen.getByText(/updating avatar/i)).toBeInTheDocument();
      // Default label should not also render.
      expect(screen.queryByText(/^transforming…$/i)).not.toBeInTheDocument();
    });

    it("does not render the overlay when transforming is false", () => {
      renderWithControlled({}, { transforming: false });
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("does not render the overlay when transforming is omitted", () => {
      renderWithControlled({});
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
  });

  describe("display mode", () => {
    it("respects displayMode in controlled mode", () => {
      const onDisplayModeChange = vi.fn();
      render(
        <AvatarWidget
          agentId="a"
          controlledSession={makeControlledSession()}
          displayMode="hidden"
          onDisplayModeChange={onDisplayModeChange}
        />,
      );
      // Hidden layout renders a button to open; no expanded region.
      expect(
        screen.queryByRole("region", { name: /widget/i }),
      ).not.toBeInTheDocument();
      // A hidden-mode affordance is present.
      expect(screen.getByRole("button")).toBeInTheDocument();
    });

    it("fires onDisplayModeChange when the user minimizes", () => {
      const onDisplayModeChange = vi.fn();
      render(
        <AvatarWidget
          agentId="a"
          controlledSession={makeControlledSession()}
          defaultDisplayMode="expanded"
          onDisplayModeChange={onDisplayModeChange}
        />,
      );
      screen.getByRole("button", { name: /minimize widget/i }).click();
      expect(onDisplayModeChange).toHaveBeenCalledWith("minimized");
    });
  });

  describe("imperative sendData ref", () => {
    it("exposes a sendData function via ref", () => {
      const ref = createRef<AvatarWidgetHandle>();
      render(
        <AvatarWidget
          ref={ref}
          agentId="test-agent"
          controlledSession={makeControlledSession()}
          defaultDisplayMode="expanded"
        />,
      );
      expect(typeof ref.current?.sendData).toBe("function");
    });

    it("no-ops gracefully before the session is connected", async () => {
      const ref = createRef<AvatarWidgetHandle>();
      render(
        <AvatarWidget
          ref={ref}
          agentId="test-agent"
          controlledSession={makeControlledSession()}
          defaultDisplayMode="expanded"
        />,
      );
      // sendData should resolve cleanly even when there's no connected
      // room — no Room means no localParticipant means an early return.
      await expect(
        ref.current?.sendData({ type: "noop" }),
      ).resolves.toBeUndefined();
    });
  });

  describe("compactControls", () => {
    it("renders the compact toolbar and hides the topbar when compactControls=true", () => {
      const { container } = renderWithControlled(
        { connectionState: "connected", agentState: "listening" },
        { compactControls: true, agentName: "Compact Guide" },
      );

      // Compact toolbar IS in the document.
      const compactToolbar = container.querySelector('[data-testid="compact-toolbar"]');
      expect(compactToolbar).toBeTruthy();

      // The topbar agent-name pill is NOT rendered. The standard topbar lives
      // at .ll-expanded__topbar and contains the agent name pill (.ll-hpill).
      const topbar = container.querySelector(".ll-expanded__topbar");
      expect(topbar).toBeNull();

      // The standard 5-tool toolbar is also gone (replaced by CompactToolbar).
      // The standard toolbar has class .ll-toolbar but NOT the .ll-toolbar--compact modifier.
      const standardToolbars = Array.from(container.querySelectorAll(".ll-toolbar"))
        .filter((el) => !el.classList.contains("ll-toolbar--compact"));
      expect(standardToolbars.length).toBe(0);
    });

    it("toggles the overflow popover when ••• is clicked", () => {
      renderWithControlled(
        { connectionState: "connected", agentState: "listening" },
        { compactControls: true },
      );

      // The popover renders via createPortal into document.body so it can
      // escape the consumer's overflow:hidden / clip-path / transform
      // ancestors (the marketing customization slot wraps the widget in a
      // rounded overflow:hidden container — without the portal the popover
      // gets sliced when it opens upward). Query document.body, not the
      // RTL container, since the portaled node lives outside it.

      // Popover starts closed.
      expect(document.body.querySelector(".ll-overflow-popover")).toBeNull();

      // Find the ••• button by aria-label.
      const trigger = screen.getByRole("button", { name: /more controls/i });
      expect(trigger).toBeTruthy();

      // Open popover.
      act(() => {
        trigger.click();
      });

      // Popover IS rendered now, with menu items.
      const popover = document.body.querySelector(".ll-overflow-popover");
      expect(popover).toBeTruthy();
      expect(popover?.textContent).toMatch(/speaker/i);
      expect(popover?.textContent).toMatch(/english/i);

      // Clicking outside closes it. Dispatch mousedown on document so
      // the portaled popover's listener (which lives on document) fires.
      act(() => {
        document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      });
      expect(document.body.querySelector(".ll-overflow-popover")).toBeNull();
    });

    it("preserves the standard layout when compactControls is false or omitted", () => {
      const { container } = renderWithControlled(
        { connectionState: "connected", agentState: "listening" },
        { agentName: "Standard Guide" }, // compactControls omitted
      );

      // Standard topbar IS rendered.
      expect(container.querySelector(".ll-expanded__topbar")).toBeTruthy();
      // Compact toolbar is NOT rendered.
      expect(container.querySelector('[data-testid="compact-toolbar"]')).toBeNull();
      // Compact status pill is NOT rendered.
      expect(container.querySelector(".ll-compact-status")).toBeNull();
      // Standard 5-tool toolbar IS rendered.
      expect(container.querySelector(".ll-toolbar")).toBeTruthy();
    });
  });

  describe("draggable / resizable", () => {
    // useIsMobile reads matchMedia; jsdom's default returns matches:false
    // (desktop). Install a controllable stub so we can flip to mobile.
    function setMobile(isMobile: boolean) {
      window.matchMedia = ((query: string) => ({
        matches: isMobile,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      })) as unknown as typeof window.matchMedia;
    }

    it("enables drag + resize by default on desktop (handles + grip render)", () => {
      setMobile(false);
      const { container } = renderWithControlled({ connectionState: "idle" });
      // Idle header carries the drag handle attribute.
      expect(
        container.querySelector("[data-ll-drag-handle]"),
      ).toBeTruthy();
      // Resize grip renders.
      expect(
        container.querySelector(".ll-expanded__resize-grip"),
      ).toBeTruthy();
      expect(
        container.querySelector("[data-ll-resize-handle]"),
      ).toBeTruthy();
    });

    it("disables drag + resize by default on mobile (no handle attr, no grip)", () => {
      setMobile(true);
      const { container } = renderWithControlled({ connectionState: "idle" });
      expect(
        container.querySelector("[data-ll-drag-handle]"),
      ).toBeNull();
      expect(
        container.querySelector(".ll-expanded__resize-grip"),
      ).toBeNull();
    });

    it("honors an explicit draggable override on mobile", () => {
      setMobile(true);
      const { container } = renderWithControlled(
        { connectionState: "idle" },
        { draggable: true },
      );
      expect(
        container.querySelector("[data-ll-drag-handle]"),
      ).toBeTruthy();
    });

    it("honors an explicit resizable override on mobile", () => {
      setMobile(true);
      const { container } = renderWithControlled(
        { connectionState: "idle" },
        { resizable: true },
      );
      expect(
        container.querySelector(".ll-expanded__resize-grip"),
      ).toBeTruthy();
    });

    it("force-disables drag + resize on desktop when passed false", () => {
      setMobile(false);
      const { container } = renderWithControlled(
        { connectionState: "idle" },
        { draggable: false, resizable: false },
      );
      expect(
        container.querySelector("[data-ll-drag-handle]"),
      ).toBeNull();
      expect(
        container.querySelector(".ll-expanded__resize-grip"),
      ).toBeNull();
    });

    it("never sets an inline position/size at first paint (no-flash)", () => {
      setMobile(false);
      const { container } = renderWithControlled({ connectionState: "idle" });
      const root = container.querySelector(".ll-widget");
      // No geometry yet → no inline override. The corner-anchoring + CSS
      // sizing stay in charge. (The branding/zIndex inline style may exist,
      // but none of the geometry keys should.)
      const style = (root as HTMLElement).style;
      expect(style.top).toBe("");
      expect(style.left).toBe("");
      expect(style.width).toBe("");
      expect(style.height).toBe("");
      expect(root).not.toHaveClass("ll-widget--has-geometry");
    });

    it("does not render drag handle or grip in EMBEDDED mode", () => {
      setMobile(false);
      const { container } = renderWithControlled(
        { connectionState: "idle" },
        { experienceMode: "EMBEDDED", draggable: true, resizable: true },
      );
      // Embedded host owns size/position — feature is force-disabled even
      // with explicit true props.
      expect(
        container.querySelector("[data-ll-drag-handle]"),
      ).toBeNull();
      expect(
        container.querySelector(".ll-expanded__resize-grip"),
      ).toBeNull();
    });
  });

  // ─── Boot-up avatar blur (0.21.0) ───────────────────────────────────
  //
  // LemonSlice video element shows up before the agent actually starts
  // talking. Without a signal for the gap, the avatar looks frozen
  // (static-ish first frame, no lip-sync) for 1-2s. Blur until first
  // agentState=speaking, with a 5s safety release for non-greeting
  // agents.

  describe("boot-up avatar blur", () => {
    function makeVideo(): HTMLVideoElement {
      return document.createElement("video");
    }

    it("applies blur(8px) to the video element on first appearance", () => {
      const video = makeVideo();
      const { rerender } = render(
        <AvatarWidget
          agentId="t"
          controlledSession={makeControlledSession()}
          defaultDisplayMode="expanded"
        />,
      );
      expect(video.style.filter).toBe("");

      rerender(
        <AvatarWidget
          agentId="t"
          controlledSession={makeControlledSession({
            connectionState: "connected",
            videoElement: video,
          })}
          defaultDisplayMode="expanded"
        />,
      );
      expect(video.style.filter).toBe("blur(8px)");
    });

    it("clears the blur on first agentState=speaking", () => {
      const video = makeVideo();
      const { rerender } = render(
        <AvatarWidget
          agentId="t"
          controlledSession={makeControlledSession({
            connectionState: "connected",
            videoElement: video,
          })}
          defaultDisplayMode="expanded"
        />,
      );
      expect(video.style.filter).toBe("blur(8px)");

      rerender(
        <AvatarWidget
          agentId="t"
          controlledSession={makeControlledSession({
            connectionState: "connected",
            agentState: "speaking",
            videoElement: video,
          })}
          defaultDisplayMode="expanded"
        />,
      );
      expect(video.style.filter).toBe("");
    });

    it("clears the blur after the 5s safety timeout", () => {
      vi.useFakeTimers();
      const video = makeVideo();
      render(
        <AvatarWidget
          agentId="t"
          controlledSession={makeControlledSession({
            connectionState: "connected",
            videoElement: video,
          })}
          defaultDisplayMode="expanded"
        />,
      );
      expect(video.style.filter).toBe("blur(8px)");

      act(() => {
        vi.advanceTimersByTime(5_000);
      });
      expect(video.style.filter).toBe("");
      vi.useRealTimers();
    });

    it("does not blur when blurUntilFirstSpeech is false", () => {
      const video = makeVideo();
      render(
        <AvatarWidget
          agentId="t"
          controlledSession={makeControlledSession({
            connectionState: "connected",
            videoElement: video,
          })}
          defaultDisplayMode="expanded"
          blurUntilFirstSpeech={false}
        />,
      );
      expect(video.style.filter).toBe("");
    });
  });

  // ─── Multi-step flow commands (0.22.0) ──────────────────────────────
  describe("flow commands", () => {
    function renderWithSubscriber() {
      let subscriber: ((msg: Record<string, unknown>) => void) | null = null;
      render(
        <AvatarWidget
          agentId="test-agent"
          controlledSession={makeControlledSession({
            subscribeToDataMessages: (cb) => {
              subscriber = cb;
              return () => {};
            },
          })}
        />,
      );
      return () => subscriber;
    }

    it("advance_step clicks the detected Continue control", () => {
      document.body.innerHTML = `<button id="cta">Continue</button>`;
      const getSub = renderWithSubscriber();
      const btn = document.getElementById("cta")!;
      const clicked = vi.fn();
      btn.addEventListener("click", clicked);

      act(() => {
        getSub()!({ type: "advance_step" });
      });
      expect(clicked).toHaveBeenCalledTimes(1);
    });

    it("submit_flow clicks the detected submit control", () => {
      document.body.innerHTML = `<form><input name="a" /><button type="submit" id="sub">Finish</button></form>`;
      const getSub = renderWithSubscriber();
      const btn = document.getElementById("sub")!;
      const clicked = vi.fn();
      btn.addEventListener("click", clicked);

      act(() => {
        getSub()!({ type: "submit_flow" });
      });
      expect(clicked).toHaveBeenCalledTimes(1);
    });

    it("advance_step is a no-op (no throw) when there is no Continue control", () => {
      document.body.innerHTML = `<main><p>Just text</p></main>`;
      const getSub = renderWithSubscriber();
      expect(() =>
        act(() => {
          getSub()!({ type: "advance_step" });
        }),
      ).not.toThrow();
    });
  });

});

describe("AvatarWidget page-vision integration", () => {
  const pageVisionConfig: PageVisionClientConfig = {
    enabled: true,
    captureOn: ["flow_start", "route_change", "step_change"],
    maxWidth: 1024,
    jpegQuality: 0.7,
    upload: {
      supabaseUrl: "https://x.supabase.co",
      anonKey: "anon",
      bucket: "page-vision",
    },
  };

  beforeEach(() => {
    window.localStorage.clear();
    // The capture waits one rAF (paint) + one idle slot before firing;
    // make both immediate so the trigger chain runs inside the act() that
    // flips the connection state.
    vi.stubGlobal(
      "requestAnimationFrame",
      (cb: FrameRequestCallback): number => {
        cb(0);
        return 0;
      },
    );
    vi.stubGlobal(
      "requestIdleCallback",
      (cb: IdleRequestCallback): number => {
        cb({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline);
        return 0;
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("publishes a flow_start page_screenshot after the session connects", async () => {
    // Records every payload the widget publishes over the (controlled)
    // data channel — publishDataMessage routes through this in controlled
    // mode, and the page-vision hook publishes through publishDataMessage.
    const published: Record<string, unknown>[] = [];
    const publishData = vi.fn((p: Record<string, unknown>) => {
      published.push(p);
    });

    function Harness() {
      const [state, setState] = useState<"idle" | "connected">("idle");
      return (
        <>
          <button onClick={() => setState("connected")}>connect</button>
          <AvatarWidget
            agentId="test-agent"
            pageVision={pageVisionConfig}
            controlledSession={makeControlledSession({
              connectionState: state,
              // Agent goes live so the hook's agentReady republish path is
              // also exercised; the flow_start capture itself fires off the
              // connect transition regardless.
              agentState: state === "connected" ? "listening" : "idle",
              publishData,
            })}
          />
        </>
      );
    }

    render(<Harness />);
    // Nothing published before connect.
    expect(
      published.some((p) => p.type === "page_screenshot"),
    ).toBe(false);

    // Drive to connected — fires the flow_start capture chain.
    await act(async () => {
      screen.getByText("connect").click();
      // Let the mocked capture→upload→publish microtasks settle.
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(
        published.some(
          (p) =>
            p.type === "page_screenshot" && p.reason === "flow_start",
        ),
      ).toBe(true),
    );
  });
});
