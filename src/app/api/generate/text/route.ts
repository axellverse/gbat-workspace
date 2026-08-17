import { NextResponse } from "next/server";
import { generatePinContent } from "@/lib/ai";
import { withKeyFallback } from "@/lib/fallback";
import { fail } from "@/lib/http";
import { aiCredentials, readSecrets } from "@/lib/secrets";
import { getStyle } from "@/lib/styles";
import type { Product } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  const secrets = await readSecrets();

  let body: { product?: Product; brief?: string; style?: string };
  try {
    body = await req.json();
  } catch {
    return fail(400, "Invalid request body.");
  }
  if (!body.product?.title) return fail(400, "Load a product before generating content.");

  const style = getStyle(body.style);

  try {
    const { value: content, used } = await withKeyFallback(
      aiCredentials(secrets),
      "Add at least one Yunwu or OpenAI key under Settings → API Keys.",
      (credential) =>
        generatePinContent({
          creds: { apiKey: credential.apiKey, baseUrl: credential.baseUrl },
          model: secrets.preferences.textModel.trim() || "gpt-4o-mini",
          product: body.product!,
          tone: secrets.preferences.tone.trim() || "warm, aspirational, concrete",
          extraBrief: body.brief?.trim() || "",
          styleLabel: style.label,
          styleGuidance: style.copyGuidance,
        }),
    );
    return NextResponse.json({ content, provider: used.provider, key: used.label, style: style.id });
  } catch (err) {
    return fail(502, err instanceof Error ? err.message : "Content generation failed.");
  }
}
