// ─── useTranscript ────────────────────────────────────────────────────
// Incremental transcript store. LiveKit streams segments by id; later
// segments with the same id replace prior (partial → final). The hook
// preserves insertion order so the UI renders a linear conversation log.

import { useCallback, useState } from "react";

export interface TranscriptEntry {
  id: string;
  role: "agent" | "user";
  text: string;
  final: boolean;
}

export interface TranscriptHandle {
  entries: TranscriptEntry[];
  /** Add or update a segment by id. */
  pushSegment: (segment: TranscriptEntry) => void;
  /** Reset the buffer (e.g. on team-member switch). */
  clear: () => void;
  /** Latest entry, or null if empty. */
  latest: TranscriptEntry | null;
}

export function useTranscript(): TranscriptHandle {
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);

  const pushSegment = useCallback((segment: TranscriptEntry) => {
    setEntries((prev) => {
      const idx = prev.findIndex((e) => e.id === segment.id);
      if (idx >= 0) {
        const next = prev.slice();
        next[idx] = segment;
        return next;
      }
      return [...prev, segment];
    });
  }, []);

  const clear = useCallback(() => setEntries([]), []);

  return {
    entries,
    pushSegment,
    clear,
    latest: entries.length > 0 ? entries[entries.length - 1] : null,
  };
}
