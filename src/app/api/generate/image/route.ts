import { NextResponse } from "next/server";
import { generatePinImage } from "@/lib/ai";
import { withKeyFallback } from "@/lib/fallback";
import { fail } from "@/lib/http";
import { aiCredentials, readSecrets } from "@/lib/secrets";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  const secrets = await readSecrets();

  let body: { prompt?: string };
  try {
    body = await req.json();
  } catch {
    return fail(400, "Invalid request body.");
  }
  const prompt = body.prompt?.trim();
  if (!prompt) return fail(400, "There is no image prompt to render yet.");

  try {
    const { value: image, used } = await withKeyFallback(
      aiCredentials(secrets),
      "Add at least one Yunwu or OpenAI key under Settings → API Keys.",
      (credential) =>
        generatePinImage({
          creds: { apiKey: credential.apiKey, baseUrl: credential.baseUrl },
          model: secrets.preferences.imageModel.trim() || "gpt-image-1",
          prompt:
            `Vertical 2:3 Pinterest pin image. ${prompt}\n\n` +
            "Photographic, high detail, clean composition with breathing room. " +
            "Do not render any text, letters, words, watermarks or logos in the image.",
        }),
    );
    return NextResponse.json({ ...image, provider: used.provider, key: used.label });
  } catch (err) {
    return fail(502, err instanceof Error ? err.message : "Image generation failed.");
  }
}
