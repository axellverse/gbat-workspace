import { assertPublicUrlResolves, fail, fetchWithTimeout } from "@/lib/http";

export const runtime = "nodejs";

/** No image the workspace shows should be bigger than this. */
const MAX_BYTES = 20 * 1024 * 1024;

/**
 * Serves a remote image from our own origin so the canvas composer can export
 * it, and so previews do not leak a referer to the source store.
 *
 * It fetches a URL the caller chose, so it resolves the host first and refuses
 * anything pointing inside the network.
 */
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("url");
  if (!raw) return fail(400, "Missing url parameter.");

  try {
    await assertPublicUrlResolves(raw);
  } catch (err) {
    return fail(400, err instanceof Error ? err.message : "Invalid url.");
  }

  try {
    const res = await fetchWithTimeout(raw, { headers: { accept: "image/*" }, redirect: "follow" }, 30_000);
    if (!res.ok) return fail(502, `Image host returned ${res.status}.`);

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) return fail(415, "That URL is not an image.");

    const declared = Number(res.headers.get("content-length") || 0);
    if (declared > MAX_BYTES) return fail(413, "That image is too large to proxy.");

    // Buffer rather than stream so an undeclared length cannot run away with us.
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > MAX_BYTES) return fail(413, "That image is too large to proxy.");

    return new Response(bytes, {
      headers: {
        "content-type": contentType,
        "content-length": String(bytes.byteLength),
        "cache-control": "public, max-age=3600",
        // The bytes come from a third party; never let a browser sniff them
        // into something executable.
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; img-src 'self' data:; sandbox",
      },
    });
  } catch {
    return fail(502, "Could not fetch that image.");
  }
}
