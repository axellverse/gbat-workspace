import { NextResponse } from "next/server";
import { fail } from "@/lib/http";
import { clearHistory, toPublicSecrets, type HistoryKind } from "@/lib/secrets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS: HistoryKind[] = ["publishes", "transfers"];

/** Resets one of the counters shown on the home page. */
export async function POST(req: Request) {
  let kind: unknown;
  try {
    ({ kind } = (await req.json()) as { kind?: unknown });
  } catch {
    return fail(400, "Invalid request body.");
  }
  if (!KINDS.includes(kind as HistoryKind)) {
    return fail(400, "kind must be either 'publishes' or 'transfers'.");
  }

  try {
    return NextResponse.json(toPublicSecrets(await clearHistory(kind as HistoryKind)));
  } catch (err) {
    return fail(500, err instanceof Error ? err.message : "Could not write Secret.json.");
  }
}
