// ─── useCollect ──────────────────────────────────────────────────────
//
// Subscribes to the unified collection event stream the LiveLayer
// agent publishes when it walks a visitor through a structured Q&A
// (page form, dashboard-declared field list, or slide form). One hook,
// one event shape, three sources.
//
// Typical usage:
//
//   const { fields, lastResult, isCollecting } = useCollect();
//
//   <input value={fields.email ?? ""} readOnly />
//   <input value={fields.phone ?? ""} readOnly />
//
//   useEffect(() => {
//     if (lastResult) shipToBackend(lastResult);
//   }, [lastResult]);
//
// Or — far more common — just pass `onCollect` to <AvatarWidget>:
//
//   <AvatarWidget agentId="..." onCollect={(r) => shipToBackend(r)} />
//
// Use this hook ONLY when you need streaming per-field updates (live
// sidebar, progress UI). For one-shot delivery, `onCollect` is enough.

import { useCallback, useEffect, useRef, useState } from "react";

export interface CollectedField {
  fieldId: string;
  fieldName: string;
  value: string;
  kind: string;
  source: "agent" | "slide" | "page";
  slideId?: string;
  formId?: string;
}

export interface CollectedResult {
  sessionId: string;
  startedAt: string;
  endedAt: string;
  source: "agent" | "slide" | "page";
  slideId?: string;
  formId?: string;
  results: Record<string, CollectedField>;
  summary?: string;
}

export interface UseCollectOptions {
  /**
   * Fires for every field as it's recorded. Use for live progress UI.
   * Omit if you only care about the final payload — that's what
   * `<AvatarWidget onCollect />` is for.
   */
  onFieldUpdate?: (update: CollectedField) => void;
  /**
   * Fires once when a collection run finishes. Same payload the
   * `<AvatarWidget onCollect />` prop receives — they're equivalent.
   */
  onComplete?: (result: CollectedResult) => void;
  /**
   * Restrict to one source. `"page"` ignores slide / agent flows;
   * `"slide"` ignores page-form / agent-level flows; `"agent"`
   * ignores everything except dashboard-declared field lists. Default
   * `"all"` listens to every source.
   */
  source?: "all" | "agent" | "slide" | "page";
}

export interface UseCollectHandle {
  /** Field name → most-recent value. Resets when a new run starts. */
  fields: Record<string, string>;
  /** True between the first field update and the completion event. */
  isCollecting: boolean;
  /** Most recent completed result; null until at least one run finishes. */
  lastResult: CollectedResult | null;
  /** Clear the running snapshot manually (e.g. on slide change). */
  reset: () => void;
}

export function useCollect(
  options: UseCollectOptions = {},
): UseCollectHandle {
  const { onFieldUpdate, onComplete, source = "all" } = options;

  const [fields, setFields] = useState<Record<string, string>>({});
  const [isCollecting, setIsCollecting] = useState(false);
  const [lastResult, setLastResult] = useState<CollectedResult | null>(null);

  // Stash latest callbacks in refs so consumers can inline functions
  // without retriggering the document-event subscription effect below.
  const onFieldUpdateRef = useRef(onFieldUpdate);
  const onCompleteRef = useRef(onComplete);
  const sourceRef = useRef(source);
  useEffect(() => {
    onFieldUpdateRef.current = onFieldUpdate;
    onCompleteRef.current = onComplete;
    sourceRef.current = source;
  }, [onFieldUpdate, onComplete, source]);

  const reset = useCallback(() => {
    setFields({});
    setIsCollecting(false);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handle = (e: Event) => {
      const detail = (
        e as CustomEvent<
          | ({ phase: "field" } & CollectedField)
          | ({ phase: "complete"; result: CollectedResult })
        >
      ).detail;
      if (!detail) return;

      if (detail.phase === "field") {
        if (
          sourceRef.current !== "all" &&
          detail.source !== sourceRef.current
        ) {
          return;
        }
        setIsCollecting(true);
        setFields((prev) =>
          prev[detail.fieldName] === detail.value
            ? prev
            : { ...prev, [detail.fieldName]: detail.value },
        );
        try {
          onFieldUpdateRef.current?.(detail);
        } catch (err) {
          console.warn("[LiveLayer] useCollect onFieldUpdate threw.", err);
        }
        return;
      }

      if (detail.phase === "complete") {
        const result = detail.result;
        if (
          sourceRef.current !== "all" &&
          result.source !== sourceRef.current
        ) {
          return;
        }
        setLastResult(result);
        setIsCollecting(false);
        try {
          onCompleteRef.current?.(result);
        } catch (err) {
          console.warn("[LiveLayer] useCollect onComplete threw.", err);
        }
      }
    };
    document.addEventListener("ll-collected", handle as EventListener);
    return () =>
      document.removeEventListener("ll-collected", handle as EventListener);
  }, []);

  return { fields, isCollecting, lastResult, reset };
}
