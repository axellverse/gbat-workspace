import { NextResponse } from "next/server";
import { fail } from "@/lib/http";
import { listAccounts } from "@/lib/meta";
import { metaCreds, readSecrets, storeById } from "@/lib/secrets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Settings uses this both as the Meta "Test connection" button and as the
 * source for one store's Page / Instagram account pickers.
 */
export async function GET(req: Request) {
  const storeId = new URL(req.url).searchParams.get("storeId") || "";
  const store = storeById(await readSecrets(), storeId);
  if (!store) return fail(400, "Unknown store. Save the store first, then connect its accounts.");

  const creds = metaCreds(store);
  if (!creds.userToken) return fail(400, "Add this store's Meta access token first.");

  try {
    const accounts = await listAccounts(creds);
    if (!accounts.length) {
      return fail(
        422,
        "That token works but administers no Facebook Pages. Publishing needs a Page — and, for Instagram, " +
          "an Instagram Business or Creator account linked to it.",
      );
    }
    return NextResponse.json({ accounts });
  } catch (err) {
    return fail(502, err instanceof Error ? err.message : "Could not reach the Meta Graph API.");
  }
}
