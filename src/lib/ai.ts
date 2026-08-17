import type { PinContent, Product } from "./types";
import { ProviderError } from "./fallback";
import { fetchWithTimeout } from "./http";

/**
 * OpenAI-compatible client. The workspace points it at Yunwu by default, but
 * any relay (or OpenAI itself) works — only the base URL changes.
 */

export type AiCreds = { apiKey: string; baseUrl: string };

async function call(creds: AiCreds, path: string, body: unknown, timeoutMs: number) {
  const res = await fetchWithTimeout(
    `${creds.baseUrl}${path}`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${creds.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    timeoutMs,
  );

  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Relay providers sometimes answer with an HTML error page.
    throw new ProviderError(
      `${new URL(creds.baseUrl).host} returned a non-JSON response (HTTP ${res.status}). ` +
        `Check the base URL — it should end in /v1.`,
      res.status,
    );
  }
  if (!res.ok) {
    const message = (parsed as { error?: { message?: string } | string; message?: string })?.error;
    const detail = typeof message === "string" ? message : message?.message;
    throw new ProviderError(
      detail || (parsed as { message?: string }).message || `Request failed (HTTP ${res.status}).`,
      res.status,
    );
  }
  return parsed as Record<string, unknown>;
}

export async function listModels(creds: AiCreds): Promise<string[]> {
  const res = await fetchWithTimeout(
    `${creds.baseUrl}/models`,
    { headers: { authorization: `Bearer ${creds.apiKey}` } },
    30_000,
  );
  const text = await res.text();
  let parsed: { data?: { id?: string }[]; error?: { message?: string } };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ProviderError(
      `${new URL(creds.baseUrl).host} did not return JSON for /models (HTTP ${res.status}). ` +
        `The base URL is probably wrong — it usually ends in /v1.`,
      res.status,
    );
  }
  if (!res.ok) {
    throw new ProviderError(parsed.error?.message || `/models failed (HTTP ${res.status}).`, res.status);
  }
  return (parsed.data || []).map((m) => m.id || "").filter(Boolean);
}

const PIN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "description", "altText", "hashtags", "imagePrompt", "instagramCaption", "facebookMessage"],
  properties: {
    title: { type: "string", description: "Pin title, max 100 characters, no hashtags." },
    description: {
      type: "string",
      description: "Pin description, 150-450 characters, keyword-rich, ends with a soft call to action.",
    },
    altText: { type: "string", description: "Literal description of the pin image for screen readers, max 500 chars." },
    hashtags: { type: "array", items: { type: "string" }, description: "4-8 lowercase hashtags without the # symbol." },
    imagePrompt: {
      type: "string",
      description:
        "A prompt for an image model describing a vertical 2:3 Pinterest pin for this product: scene, styling, " +
        "lighting, mood, palette. No text overlays, no logos, no words in the image.",
    },
    instagramCaption: {
      type: "string",
      description:
        "Instagram caption, 100-800 characters. A hook in the first line (it is the only line shown before " +
        "'more'), then the detail, then a call to action. Do NOT include hashtags here; they are appended " +
        "separately. No markdown, no links — links are dead text on Instagram.",
    },
    facebookMessage: {
      type: "string",
      description:
        "Facebook Page post, 80-400 characters. Conversational and plain-spoken, written to be read in a feed " +
        "of friends' posts. At most one hashtag, and only if it is a real brand tag. No emoji walls.",
    },
  },
} as const;

const SYSTEM_PROMPT =
  "You are a social marketing specialist for ecommerce brands, writing one product's content for three networks " +
  "at once. Pinterest copy is search-led: natural keyword phrases people actually type, concrete benefits over " +
  "adjectives, no clickbait. Instagram copy is a hook first and a story second. Facebook copy is conversational " +
  "and the least promotional of the three. Never repeat the same sentences across the three — each network gets " +
  "its own register. Never invent claims, materials, sizes, discounts or shipping terms that are not in the " +
  "supplied product data.";

const SHAPE_HINT =
  "\n\nReply with ONLY a JSON object, no markdown fence, using exactly these keys:\n" +
  `{"title": string (<=100 chars), "description": string (150-450 chars), "altText": string (<=500 chars), ` +
  `"hashtags": string[] (4-8 lowercase tags, no # prefix), "imagePrompt": string (a vertical 2:3 product ` +
  `photography prompt with no text or logos in the image), "instagramCaption": string (100-800 chars, hook ` +
  `first, no hashtags, no links), "facebookMessage": string (80-400 chars, conversational)}`;

/** Pulls the JSON object out of a reply that may be fenced or prefaced with prose. */
function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? raw).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start !== -1 && end > start) return JSON.parse(candidate.slice(start, end + 1));
    throw new Error("The model did not return JSON.");
  }
}

function unsupportedFormat(err: unknown) {
  const message = err instanceof Error ? err.message.toLowerCase() : "";
  return (
    message.includes("response_format") ||
    message.includes("json_schema") ||
    message.includes("json schema") ||
    message.includes("not supported") ||
    message.includes("unsupported") ||
    message.includes("invalid_request")
  );
}

export async function generatePinContent(opts: {
  creds: AiCreds;
  model: string;
  product: Product;
  tone: string;
  extraBrief: string;
  /** The chosen post style's angle, applied to all three channels at once. */
  styleGuidance?: string;
  styleLabel?: string;
}): Promise<PinContent> {
  const { creds, model, product, tone, extraBrief, styleGuidance, styleLabel } = opts;

  const productBrief = [
    `Title: ${product.title}`,
    product.vendor && `Brand: ${product.vendor}`,
    product.productType && `Category: ${product.productType}`,
    product.price && `Price: ${product.price}`,
    product.tags.length ? `Tags: ${product.tags.slice(0, 20).join(", ")}` : "",
    `Product page: ${product.sourceUrl}`,
    "",
    "Store description:",
    product.description.slice(0, 3000) || "(none provided)",
  ]
    .filter(Boolean)
    .join("\n");

  const userPrompt =
    `Write the content for one product post, in three versions — Pinterest, Instagram and Facebook.\n\n` +
    (styleLabel ? `Post style: ${styleLabel}\n` : "") +
    (styleGuidance ? `How this style works: ${styleGuidance}\n` : "") +
    `Tone: ${tone}\n` +
    (extraBrief ? `Extra brief from the marketer: ${extraBrief}\n` : "") +
    `\nThe style above sets the angle. Keep that same angle across all three channels while respecting each ` +
    `network's own register.\n\n${productBrief}`;

  const base = {
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
  };

  const hinted = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userPrompt + SHAPE_HINT },
  ];

  // Relay providers vary in what they accept, so degrade rather than fail:
  // strict schema -> plain JSON mode -> free text we parse ourselves.
  const attempts: Record<string, unknown>[] = [
    {
      ...base,
      response_format: { type: "json_schema", json_schema: { name: "pin_content", strict: true, schema: PIN_SCHEMA } },
    },
    { ...base, messages: hinted, response_format: { type: "json_object" } },
    { ...base, messages: hinted },
  ];

  let lastError: unknown;
  for (const [index, body] of attempts.entries()) {
    try {
      const data = await call(creds, "/chat/completions", body, 90_000);
      const raw = (data as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content;
      if (!raw) throw new Error("The model returned an empty completion.");
      const parsed = extractJson(raw) as Partial<PinContent>;
      if (!parsed.title || !parsed.description) throw new Error("The model's JSON was missing a title or description.");

      const description = String(parsed.description).slice(0, 800);
      return {
        title: String(parsed.title).slice(0, 100),
        description,
        altText: String(parsed.altText || parsed.description).slice(0, 500),
        hashtags: (Array.isArray(parsed.hashtags) ? parsed.hashtags : [])
          .map((h) => String(h).replace(/^#/, "").trim())
          .filter(Boolean)
          .slice(0, 8),
        imagePrompt: String(parsed.imagePrompt || `Styled product photography of ${product.title}`),
        // A model that ignored the extra keys still gets a usable post.
        instagramCaption: String(parsed.instagramCaption || description).slice(0, 2000),
        facebookMessage: String(parsed.facebookMessage || description).slice(0, 2000),
      };
    } catch (err) {
      lastError = err;
      const isLast = index === attempts.length - 1;
      // Only fall back when the provider rejected the request shape.
      if (!isLast && !unsupportedFormat(err) && !(err instanceof Error && err.message.includes("JSON"))) throw err;
      if (isLast) break;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Content generation failed.");
}

/** Pinterest wants tall images; each model exposes a different portrait size. */
function portraitSize(model: string) {
  if (model.startsWith("dall-e-3")) return "1024x1792";
  if (model.startsWith("dall-e-2")) return "1024x1024";
  return "1024x1536";
}

export async function generatePinImage(opts: {
  creds: AiCreds;
  model: string;
  prompt: string;
}): Promise<{ dataUrl: string; mimeType: string }> {
  const { creds, model, prompt } = opts;

  const core = { model, prompt, n: 1 };
  const attempts: Record<string, unknown>[] = model.startsWith("dall-e")
    ? [
        { ...core, size: portraitSize(model), response_format: "b64_json" },
        { ...core, size: portraitSize(model) },
      ]
    : [
        { ...core, size: portraitSize(model), quality: "high" },
        { ...core, size: portraitSize(model) },
        // Some relays only proxy the square size.
        { ...core, size: "1024x1024" },
      ];

  let lastError: unknown;
  for (const [index, body] of attempts.entries()) {
    try {
      const data = await call(creds, "/images/generations", body, 180_000);
      const first = (data as { data?: { b64_json?: string; url?: string }[] }).data?.[0];

      if (first?.b64_json) {
        return { dataUrl: `data:image/png;base64,${first.b64_json}`, mimeType: "image/png" };
      }
      if (first?.url) {
        const res = await fetchWithTimeout(first.url, {}, 60_000);
        if (!res.ok) throw new Error(`Could not download the generated image (HTTP ${res.status}).`);
        const mimeType = res.headers.get("content-type")?.split(";")[0] || "image/png";
        const buf = Buffer.from(await res.arrayBuffer());
        return { dataUrl: `data:${mimeType};base64,${buf.toString("base64")}`, mimeType };
      }
      throw new Error("The image model returned no image.");
    } catch (err) {
      lastError = err;
      if (index === attempts.length - 1) break;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Image generation failed.");
}
