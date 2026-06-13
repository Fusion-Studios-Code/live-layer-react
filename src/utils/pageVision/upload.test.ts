import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { uploadScreenshot } from "./upload";

const cfg = {
  supabaseUrl: "https://proj.supabase.co",
  anonKey: "anon-123",
  bucket: "page-vision",
};

describe("uploadScreenshot", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    mockFetch.mockReset().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", mockFetch);
    vi.stubGlobal("crypto", {
      ...globalThis.crypto,
      randomUUID: () => "11111111-2222-3333-4444-555555555555",
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("POSTs the blob with anon auth and returns the public URL", async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });
    const url = await uploadScreenshot(blob, cfg);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = mockFetch.mock.calls[0];
    expect(calledUrl).toBe(
      "https://proj.supabase.co/storage/v1/object/page-vision/11111111-2222-3333-4444-555555555555.jpg",
    );
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer anon-123");
    expect(init.headers.apikey).toBe("anon-123");
    expect(init.headers["Content-Type"]).toBe("image/jpeg");
    expect(url).toBe(
      "https://proj.supabase.co/storage/v1/object/public/page-vision/11111111-2222-3333-4444-555555555555.jpg",
    );
  });

  it("returns null on HTTP failure and on network throw", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403 });
    expect(await uploadScreenshot(new Blob(), cfg)).toBeNull();
    mockFetch.mockRejectedValueOnce(new Error("offline"));
    expect(await uploadScreenshot(new Blob(), cfg)).toBeNull();
  });
});
