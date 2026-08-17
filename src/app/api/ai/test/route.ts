import { NextResponse } from "next/server";
import { listModels } from "@/lib/ai";
import { withKeyFallback } from "@/lib/fallback";
import { fail } from "@/lib/http";
import { aiCredentials, readSecrets } from "@/lib/secrets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Settings "Test" button. Walks the saved keys in order and reports which one
 * answered, so an operator can see the fallback chain actually working.
 */
export async function GET(req: Request) {
  const secrets = await readSecrets();
  const params = new URL(req.url).searchParams;
  const textModel = params.get("textModel") || secrets.preferences.textModel;
  const imageModel = params.get("imageModel") || secrets.preferences.imageModel;

  try {
    const { value: models, used, attempts } = await withKeyFallback(
      aiCredentials(secrets),
      "Add at least one Yunwu or OpenAI key under Settings → API Keys.",
      (credential) => listModels({ apiKey: credential.apiKey, baseUrl: credential.baseUrl }),
    );

    return NextResponse.json({
      ok: true,
      provider: used.provider,
      label: used.label,
      attempts,
      baseUrl: used.baseUrl,
      modelCount: models.length,
      // An empty catalogue is normal for some relays, so only warn when we got a list.
      textModelFound: models.length === 0 ? null : models.includes(textModel),
      imageModelFound: models.length === 0 ? null : models.includes(imageModel),
    });
  } catch (err) {
    return fail(502, err instanceof Error ? err.message : "Could not reach any AI provider.");
  }
}
