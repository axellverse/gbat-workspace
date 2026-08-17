import { NextResponse } from "next/server";
import { fail } from "@/lib/http";
import { pinterestCreds, readSecrets, storeById } from "@/lib/secrets";
import { listBoards } from "@/lib/pinterest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const storeId = new URL(req.url).searchParams.get("storeId") || "";
  const store = storeById(await readSecrets(), storeId);
  if (!store) return fail(400, "Pick a store first — boards belong to that store's Pinterest account.");

  const creds = pinterestCreds(store);
  if (!creds.token) return fail(401, "Add this store's Pinterest access token under Settings → Social API Keys.");

  try {
    return NextResponse.json({ boards: await listBoards(creds) });
  } catch (err) {
    return fail(502, err instanceof Error ? err.message : "Could not load boards.");
  }
}
