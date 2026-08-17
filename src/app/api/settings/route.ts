import { NextResponse } from "next/server";
import { fail } from "@/lib/http";
import { usingDefaultPassword } from "@/lib/auth";
import { checkStorage, readSecrets, toPublicSecrets, updateSecrets, type SecretsPatch } from "@/lib/secrets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The whole workspace reads and writes its configuration through here. */
export async function GET() {
  try {
    // The workspace password and signing secret stay on the server; the two
    // flags below are what the UI needs to warn about them.
    const [secrets, defaultPassword, storage] = await Promise.all([
      readSecrets(),
      usingDefaultPassword(),
      checkStorage(),
    ]);
    return NextResponse.json({
      ...toPublicSecrets(secrets),
      warnings: { defaultPassword, storageWritable: storage.writable, storageDetail: storage.detail },
    });
  } catch (err) {
    return fail(500, err instanceof Error ? err.message : "Could not read Secret.json.");
  }
}

export async function POST(req: Request) {
  let patch: SecretsPatch;
  try {
    patch = (await req.json()) as SecretsPatch;
  } catch {
    return fail(400, "Invalid request body.");
  }

  // History is append-only from the tools themselves, never from the settings form.
  const { apiKeys, preferences, organisation, stores } = patch;

  try {
    return NextResponse.json(toPublicSecrets(await updateSecrets({ apiKeys, preferences, organisation, stores })));
  } catch (err) {
    return fail(500, err instanceof Error ? err.message : "Could not write Secret.json.");
  }
}
