import { NextResponse } from "next/server";
import { checkStorage } from "@/lib/secrets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Deployment check. Deliberately reachable without signing in, so a platform
 * health probe works and so a misconfigured volume can be spotted before
 * anyone types a single API key into a host that will throw it away.
 *
 * Reports no secrets — only whether settings can be written, and where.
 */
export async function GET() {
  const storage = await checkStorage();

  return NextResponse.json(
    {
      ok: storage.writable,
      storage: {
        writable: storage.writable,
        dataDir: storage.dataDir,
        detail: storage.detail,
      },
    },
    { status: storage.writable ? 200 : 503 },
  );
}
