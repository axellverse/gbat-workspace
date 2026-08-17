import { NextResponse } from "next/server";
import { fail } from "@/lib/http";
import { readAuth } from "@/lib/auth";
import { readSecrets } from "@/lib/secrets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The whole configuration as one JSON string, ready to paste into the
 * `GBAT_SECRETS` environment variable.
 *
 * This is how a workspace configured comfortably on a laptop moves to a host
 * with no writable disk: set it up here, export, paste, redeploy.
 *
 * It contains every API key *and* the workspace password, so it is only ever
 * served to an already-signed-in browser.
 */
export async function GET() {
  try {
    const [secrets, auth] = await Promise.all([readSecrets(), readAuth()]);

    // Carry the signing secret across so existing sessions survive the move.
    const payload = { ...secrets, auth };

    return NextResponse.json({
      json: JSON.stringify(payload),
      pretty: JSON.stringify(payload, null, 2),
      base64: Buffer.from(JSON.stringify(payload), "utf8").toString("base64"),
    });
  } catch (err) {
    return fail(500, err instanceof Error ? err.message : "Could not export the configuration.");
  }
}
