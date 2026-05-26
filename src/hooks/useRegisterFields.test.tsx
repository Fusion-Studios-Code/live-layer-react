import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { useRegisterFields } from "./useRegisterFields";
import {
  getRegisteredFields,
  clearFieldRegistry,
  type FieldManifest,
} from "../index";

beforeEach(() => {
  clearFieldRegistry();
  cleanup();
});

describe("useRegisterFields", () => {
  it("registers fields on mount", () => {
    const fields: FieldManifest[] = [
      { id: "email", label: "Email", kind: "email", value: "", required: true },
    ];
    renderHook(() => useRegisterFields(fields));
    expect(getRegisteredFields().map((f) => f.id)).toEqual(["email"]);
  });

  it("deregisters on unmount", () => {
    const fields: FieldManifest[] = [
      { id: "email", label: "Email", kind: "email", value: "", required: true },
    ];
    const { unmount } = renderHook(() => useRegisterFields(fields));
    expect(getRegisteredFields()).toHaveLength(1);
    unmount();
    expect(getRegisteredFields()).toEqual([]);
  });

  it("re-registers when the fields array changes", () => {
    const initial: FieldManifest[] = [
      { id: "email", label: "Email", kind: "email", value: "", required: true },
    ];
    const next: FieldManifest[] = [
      { id: "email", label: "Email", kind: "email", value: "a@b.com", required: true },
    ];
    const { rerender } = renderHook(
      ({ f }: { f: FieldManifest[] }) => useRegisterFields(f),
      { initialProps: { f: initial } },
    );
    expect(getRegisteredFields()[0].value).toBe("");
    rerender({ f: next });
    expect(getRegisteredFields()[0].value).toBe("a@b.com");
  });

  it("supports multiple distinct hook instances writing different fields", () => {
    const a: FieldManifest[] = [
      { id: "a", label: "A", kind: "text", value: "", required: false },
    ];
    const b: FieldManifest[] = [
      { id: "b", label: "B", kind: "text", value: "", required: false },
    ];
    renderHook(() => useRegisterFields(a));
    renderHook(() => useRegisterFields(b));
    expect(getRegisteredFields().map((f) => f.id).sort()).toEqual(["a", "b"]);
  });

  it("when two hooks register the same id, the second hook wins", () => {
    const v1: FieldManifest[] = [
      { id: "x", label: "From hook 1", kind: "text", value: "", required: false },
    ];
    const v2: FieldManifest[] = [
      { id: "x", label: "From hook 2", kind: "text", value: "", required: false },
    ];
    renderHook(() => useRegisterFields(v1));
    renderHook(() => useRegisterFields(v2));
    expect(getRegisteredFields()[0].label).toBe("From hook 2");
  });
});
