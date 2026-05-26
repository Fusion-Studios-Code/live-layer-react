// ─── useRegisterFields ───────────────────────────────────────────────
//
// Declarative wrapper around the SDK's `registerFields()` programmatic
// registry. Use this when the host React app has fields the SDK's
// auto-discovery can't see — typically because they're behind a
// controlled-input library that does NOT fire native `input` events
// (some date/time pickers, some headless combobox libraries).
//
// Typical usage:
//
//   import { useRegisterFields } from "@livelayer/react";
//
//   function BookingForm() {
//     const [destination, setDestination] = useState("");
//     const [date, setDate] = useState("");
//
//     useRegisterFields([
//       { id: "destination", label: "Where to?", kind: "text",
//         value: destination, required: true },
//       { id: "date",        label: "When?",    kind: "date",
//         value: date,        required: true },
//     ]);
//
//     return <form>...</form>;
//   }
//
// The hook re-registers whenever the field array changes (so values
// stay current). On unmount it deregisters everything the hook
// registered. Programmatic registrations WIN against DOM-discovered
// fields with the same id, so this is the right escape hatch for
// "the agent keeps reading my React state wrong".

import { useEffect } from "react";
import { registerFields, type FieldManifest } from "@livelayer/sdk";

/**
 * Register a set of fields with the LiveLayer SDK. Stable across
 * re-renders by depending on the SERIALIZED field list (so consumers
 * can inline the array literal without memoizing).
 */
export function useRegisterFields(fields: FieldManifest[]): void {
  // Stringify the array to derive a stable dep key. Cheap (the
  // manifest is small) and means callers don't have to memoize.
  const key = JSON.stringify(fields);

  useEffect(() => {
    const deregister = registerFields(fields);
    return deregister;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
