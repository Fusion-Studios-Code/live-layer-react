// The hook forwards publishMicrophone to the SDK session. Left unset, the
// SDK keeps its default and publishes the microphone itself.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const created = vi.hoisted(() => ({ options: [] as Record<string, unknown>[] }));

vi.mock("@livelayer/sdk", () => ({
  LiveKitSession: class {
    constructor(options: Record<string, unknown>) {
      created.options.push(options);
    }
    destroy() {}
  },
}));

import { useLiveKitSession } from "./useLiveKitSession";

describe("useLiveKitSession publishMicrophone", () => {
  beforeEach(() => {
    created.options = [];
  });

  it("passes publishMicrophone: false through to the SDK session", () => {
    renderHook(() => useLiveKitSession({ agentId: "a", baseUrl: "https://example.test", publishMicrophone: false }));
    expect(created.options.at(-1)).toMatchObject({ agentId: "a", publishMicrophone: false });
  });

  it("leaves it undefined when unset, so the SDK default (publish) applies", () => {
    renderHook(() => useLiveKitSession({ agentId: "a", baseUrl: "https://example.test" }));
    expect(created.options.at(-1)?.publishMicrophone).toBeUndefined();
  });
});
