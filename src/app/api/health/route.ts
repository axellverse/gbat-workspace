import { NextResponse } from "next/server";
import { checkStorage, configSource, readSecrets } from "@/lib/secrets";

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
  // Reading first settles which source the configuration came from.
  await readSecrets().catch(() => undefined);
  const source = configSource();
  const storage = await checkStorage();

  // Configured from the environment is a perfectly healthy state — there is
  // simply nothing to write, so an unwritable disk is not a fault there.
  const ok = source === "env" || storage.writable;

  return NextResponse.json(
    {
      ok,
      configSource: source,
      settingsEditable: storage.writable,
      storage: { writable: storage.writable, dataDir: storage.dataDir, detail: storage.detail },
      detail:
        source === "env"
          ? "Configured from GBAT_SECRETS. Settings are read-only; edit the variable and redeploy to change them."
          : storage.detail,
    },
    { status: ok ? 200 : 503 },
  );
}
