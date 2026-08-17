import { NextResponse } from "next/server";
import { fail } from "@/lib/http";
import { usingDefaultPassword } from "@/lib/auth";
import {
  checkStorage,
  configSource,
  readSecrets,
  toPublicSecrets,
  updateSecrets,
  type SecretsPatch,
} from "@/lib/secrets";

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
    const source = configSource();
    return NextResponse.json({
      ...toPublicSecrets(secrets),
      warnings: {
        defaultPassword,
        configSource: source,
        // Env- and repo-configured instances with no writable disk cannot
        // save; that is expected, not a fault.
        readOnly: source === "env" || source === "repo",
        storageWritable: storage.writable,
        storageDetail: storage.detail,
      },
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

  const source = configSource();
  if (source === "env" || source === "repo") {
    return fail(
      409,
      source === "env"
        ? "This instance is configured from GBAT_SECRETS, so settings cannot be saved here. Use Export " +
            "configuration, paste the result into that variable, and redeploy."
        : "This instance has no writable disk, so it is running from workspace.config.json. Use Export " +
            "configuration, commit the updated file, and redeploy.",
    );
  }

  // History is append-only from the tools themselves, never from the settings form.
  const { apiKeys, preferences, organisation, stores } = patch;

  try {
    return NextResponse.json(toPublicSecrets(await updateSecrets({ apiKeys, preferences, organisation, stores })));
  } catch (err) {
    return fail(500, err instanceof Error ? err.message : "Could not write Secret.json.");
  }
}
