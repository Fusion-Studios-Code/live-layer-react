/**
 * Direct-to-Supabase Storage upload over plain fetch — no supabase-js in
 * the widget bundle. Keys are random UUIDs (unguessable; spec §5) and the
 * bucket has an hourly server-side purge, so the public URL is a
 * short-lived, signed-ish link.
 */

export interface PageVisionUploadConfig {
  supabaseUrl: string;
  anonKey: string;
  bucket: string;
}

export async function uploadScreenshot(
  blob: Blob,
  cfg: PageVisionUploadConfig,
): Promise<string | null> {
  try {
    // crypto.randomUUID requires a secure context (https/localhost); if it
    // throws, the catch below no-ops gracefully. Deliberately NO
    // Math.random fallback — predictable keys would weaken the
    // unguessable-URL property (spec §5) that makes a public bucket OK.
    const key = `${crypto.randomUUID()}.jpg`;
    const res = await fetch(
      `${cfg.supabaseUrl}/storage/v1/object/${cfg.bucket}/${key}`,
      {
        method: "POST",
        headers: {
          apikey: cfg.anonKey,
          Authorization: `Bearer ${cfg.anonKey}`,
          "Content-Type": "image/jpeg",
        },
        body: blob,
      },
    );
    if (!res.ok) {
      console.warn(`[LiveLayer] page-vision upload failed: HTTP ${res.status}`);
      return null;
    }
    return `${cfg.supabaseUrl}/storage/v1/object/public/${cfg.bucket}/${key}`;
  } catch (err) {
    console.warn("[LiveLayer] page-vision upload error:", err);
    return null;
  }
}
