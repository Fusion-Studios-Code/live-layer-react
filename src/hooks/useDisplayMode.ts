// ─── useDisplayMode ───────────────────────────────────────────────────
// Pure controlled/uncontrolled state machine for the widget's display mode.
// Valid transitions are any → any — the widget is always in exactly one of
// three states.
//
//   ┌──────────┐          ┌───────────┐          ┌──────────┐
//   │  HIDDEN  │ ◄──────► │ MINIMIZED │ ◄──────► │ EXPANDED │
//   └──────────┘          └───────────┘          └──────────┘
//
// Controlled mode: caller supplies `value` + `onChange`. Hook returns
//   `[value, onChange]` so the widget renders the controlled value and
//   changes flow through the caller's handler.
// Uncontrolled mode: caller supplies optional `defaultValue` + optional
//   `onChange`. Hook owns internal state and fires `onChange` on every
//   transition.
//
// No persistence here — see useDisplayModePersistence for that wrapper.

import { useCallback, useState } from "react";

export type DisplayMode = "hidden" | "minimized" | "expanded";

interface Options {
  value?: DisplayMode;
  defaultValue?: DisplayMode;
  onChange?: (next: DisplayMode) => void;
}

export function useDisplayMode({
  value,
  defaultValue = "expanded",
  onChange,
}: Options = {}): [DisplayMode, (next: DisplayMode) => void] {
  const isControlled = value !== undefined;
  const [internal, setInternal] = useState<DisplayMode>(defaultValue);

  const current = isControlled ? value : internal;

  const setMode = useCallback(
    (next: DisplayMode) => {
      if (next === current) return; // no-op transition
      if (!isControlled) setInternal(next);
      onChange?.(next);
    },
    [current, isControlled, onChange],
  );

  return [current, setMode];
}
