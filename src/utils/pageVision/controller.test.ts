import { describe, it, expect, vi } from "vitest";
import { PageVisionController } from "./controller";
import { THUMB_SIZE } from "./dedup";

function thumb(value: number): Uint8Array {
  return new Uint8Array(THUMB_SIZE * THUMB_SIZE).fill(value);
}

function makeController(over: Partial<ConstructorParameters<typeof PageVisionController>[0]> = {}) {
  const published: Array<Record<string, unknown>> = [];
  const deps = {
    config: {
      enabled: true,
      captureOn: ["flow_start", "route_change", "step_change"] as Array<
        "flow_start" | "route_change" | "step_change"
      >,
      maxWidth: 1024,
      jpegQuality: 0.7,
      upload: { supabaseUrl: "https://s", anonKey: "k", bucket: "page-vision" },
    },
    capture: vi.fn().mockResolvedValue({ blob: new Blob(), thumb: thumb(100), width: 10, height: 10 }),
    upload: vi.fn().mockResolvedValue("https://s/storage/v1/object/public/page-vision/a.jpg"),
    publish: (p: Record<string, unknown>) => published.push(p),
    ...over,
  };
  return { c: new PageVisionController(deps), deps, published };
}

describe("PageVisionController", () => {
  it("captures, uploads, publishes the envelope", async () => {
    const { c, published } = makeController();
    await c.trigger("flow_start", "/home");
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      type: "page_screenshot",
      url: "https://s/storage/v1/object/public/page-vision/a.jpg",
      route: "/home",
      reason: "flow_start",
    });
    expect(typeof published[0].hash).toBe("string");
    expect(typeof published[0].capturedAt).toBe("number");
  });

  it("skips reasons not in captureOn", async () => {
    const { c, deps, published } = makeController();
    deps.config.captureOn = ["flow_start"];
    await c.trigger("route_change", "/x");
    expect(published).toHaveLength(0);
  });

  it("dedups visually-identical captures, allows changed ones", async () => {
    const { c, deps, published } = makeController();
    await c.trigger("flow_start", "/a");
    await c.trigger("route_change", "/b"); // identical thumb(100) → deduped
    expect(published).toHaveLength(1);
    (deps.capture as ReturnType<typeof vi.fn>).mockResolvedValue({
      blob: new Blob(), thumb: thumb(200), width: 10, height: 10,
    });
    await c.trigger("route_change", "/c");
    expect(published).toHaveLength(2);
  });

  it("does not remember a thumb when upload fails (retries next trigger)", async () => {
    const { c, deps, published } = makeController();
    (deps.upload as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    await c.trigger("flow_start", "/a");
    expect(published).toHaveLength(0);
    await c.trigger("route_change", "/a"); // same thumb, but lastThumb unset → retried
    expect(published).toHaveLength(1);
  });

  it("ignores overlapping triggers while one is in flight", async () => {
    const { c, deps, published } = makeController();
    let release!: (v: { blob: Blob; thumb: Uint8Array; width: number; height: number } | null) => void;
    (deps.capture as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      new Promise((r) => { release = r; }),
    );
    const first = c.trigger("flow_start", "/a");
    const second = c.trigger("route_change", "/b"); // dropped — in flight
    release({ blob: new Blob(), thumb: thumb(1), width: 1, height: 1 });
    await Promise.all([first, second]);
    expect(published).toHaveLength(1);
  });

  // ── Carry-forward 1: republishLast ────────────────────────────────────
  it("republishLast re-publishes the same envelope after a successful trigger", async () => {
    const { c, published } = makeController();
    await c.trigger("flow_start", "/home");
    expect(published).toHaveLength(1);
    const first = { ...published[0] };
    c.republishLast();
    expect(published).toHaveLength(2);
    expect(published[1]).toEqual(first);
  });

  it("republishLast is a no-op before any trigger", () => {
    const { c, published } = makeController();
    c.republishLast();
    expect(published).toHaveLength(0);
  });

  // ── Carry-forward 2: empty upload config guard ────────────────────────
  it("skips capture/upload/publish when upload.supabaseUrl is empty", async () => {
    const { c, deps, published } = makeController({
      config: {
        enabled: true,
        captureOn: ["flow_start", "route_change", "step_change"],
        maxWidth: 1024,
        jpegQuality: 0.7,
        upload: { supabaseUrl: "", anonKey: "k", bucket: "page-vision" },
      },
    });
    await c.trigger("flow_start", "/home");
    expect(deps.capture).not.toHaveBeenCalled();
    expect(deps.upload).not.toHaveBeenCalled();
    expect(published).toHaveLength(0);
  });

  it("skips when upload.anonKey is empty", async () => {
    const { c, deps, published } = makeController({
      config: {
        enabled: true,
        captureOn: ["flow_start", "route_change", "step_change"],
        maxWidth: 1024,
        jpegQuality: 0.7,
        upload: { supabaseUrl: "https://s", anonKey: "", bucket: "page-vision" },
      },
    });
    await c.trigger("flow_start", "/home");
    expect(deps.capture).not.toHaveBeenCalled();
    expect(published).toHaveLength(0);
  });

  it("skips when upload.bucket is empty", async () => {
    const { c, deps, published } = makeController({
      config: {
        enabled: true,
        captureOn: ["flow_start", "route_change", "step_change"],
        maxWidth: 1024,
        jpegQuality: 0.7,
        upload: { supabaseUrl: "https://s", anonKey: "k", bucket: "" },
      },
    });
    await c.trigger("flow_start", "/home");
    expect(deps.capture).not.toHaveBeenCalled();
    expect(published).toHaveLength(0);
  });
});
