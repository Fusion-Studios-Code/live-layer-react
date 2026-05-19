// ─── AgentStatePill ───────────────────────────────────────────────────
// Small pill showing the agent's current state (idle / listening /
// thinking / speaking). Used in the expanded widget top-right corner.
//
// Colors come from CSS custom properties set on .ll-widget:
//   --ll-color-idle, --ll-color-listening, --ll-color-thinking,
//   --ll-color-speaking, --ll-color-chrome-bg, --ll-color-chrome-fg

import type { FC } from "react";
import type { AgentState } from "@livelayer/sdk";

interface Props {
  state: AgentState;
  className?: string;
}

const LABEL: Record<AgentState, string> = {
  idle: "Idle",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
};

export const AgentStatePill: FC<Props> = ({ state, className }) => {
  const cls = ["ll-pill", `ll-pill--${state}`, className].filter(Boolean).join(" ");
  return (
    <div className={cls} data-agent-state={state}>
      <span className="ll-pill__dot" />
      <span className="ll-pill__label">{LABEL[state]}</span>
    </div>
  );
};
