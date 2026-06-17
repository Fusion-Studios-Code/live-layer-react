import { describe, expect, it, vi } from "vitest";
import {
  publishAppEvent,
  publishPageChanged,
  type AppSignalSink,
} from "./appSignals";

function sink() {
  const sent: Record<string, unknown>[] = [];
  const s: AppSignalSink = {
    sendData: (data) => {
      sent.push(data);
      return Promise.resolve();
    },
  };
  return { s, sent };
}

describe("publishPageChanged", () => {
  it("derives requiredRemaining from unfilled required fields", () => {
    const { s, sent } = sink();
    publishPageChanged(s, {
      page: { id: "core", label: "Your move", route: "/core", index: 2, total: 3 },
      fields: [
        { id: "a", label: "A", required: true, filled: false },
        { id: "b", label: "B", required: true, filled: true },
        { id: "c", label: "C", required: false, filled: false },
      ],
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: "ll_page_changed",
      page: { id: "core", index: 2, total: 3 },
      requiredRemaining: ["a"],
    });
  });

  it("is a no-op for a null sink", () => {
    expect(() =>
      publishPageChanged(null, {
        page: { id: "x", label: "X", route: "/x" },
        fields: [],
      }),
    ).not.toThrow();
  });
});

describe("publishAppEvent", () => {
  it("sends a typed app event with data", () => {
    const { s, sent } = sink();
    publishAppEvent(s, "policy_loaded", { restricted: true });
    expect(sent[0]).toEqual({
      type: "ll_app_event",
      name: "policy_loaded",
      data: { restricted: true },
    });
  });

  it("omits data when not provided", () => {
    const { s, sent } = sink();
    publishAppEvent(s, "intake_complete");
    expect(sent[0]).toEqual({ type: "ll_app_event", name: "intake_complete" });
  });

  it("swallows sink rejections", async () => {
    const s: AppSignalSink = { sendData: () => Promise.reject(new Error("x")) };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => publishAppEvent(s, "e")).not.toThrow();
    await Promise.resolve();
    warn.mockRestore();
  });
});
