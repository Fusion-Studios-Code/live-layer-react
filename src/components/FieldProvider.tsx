// ─── <FieldProvider> ─────────────────────────────────────────────────
//
// Declarative context wrapper around useRegisterFields. Place at the
// top of a React tree to register fields without having to call the
// hook in every component:
//
//   import { FieldProvider } from "@livelayer/react";
//
//   <FieldProvider fields={[
//     { id: "email", label: "Email", kind: "email", value: email, required: true },
//   ]}>
//     <BookingForm />
//   </FieldProvider>
//
// The fields prop accepts the SAME `FieldManifest[]` shape as the
// SDK's `registerFields()`. Re-registers whenever the array changes
// (serialized into a dep key) and deregisters on unmount.

import { type ReactNode } from "react";
import type { FieldManifest } from "@livelayer/sdk";
import { useRegisterFields } from "../hooks/useRegisterFields";

export interface FieldProviderProps {
  fields: FieldManifest[];
  children: ReactNode;
}

export function FieldProvider({ fields, children }: FieldProviderProps) {
  useRegisterFields(fields);
  // The hook handles all the work; this component is a thin DOM-less
  // pass-through so consumers can put it in their JSX tree.
  return <>{children}</>;
}
