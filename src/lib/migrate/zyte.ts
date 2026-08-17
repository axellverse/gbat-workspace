import { fetchWithTimeout } from "@/lib/http";

export class ZyteError extends Error {}

/**
 * Zyte API — a hosted fetch that renders the page and handles the anti-bot
 * layer on the far side. Used only as a fallback when a storefront refuses a
 * plain request, because it bills per call.
 *
 * https://docs.zyte.com/zyte-api/usage/browser.html
 */

const ENDPOINT = "https://api.zyte.com/v1/extract";

export async function fetchViaZyte(url: string, apiKey: string): Promise<{ html: string; finalUrl: string }> {
  if (!apiKey) throw new ZyteError("No Zyte API key is configured.");

  // Zyte uses HTTP basic auth with the key as the username and no password.
  const authorization = `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;

  const res = await fetchWithTimeout(
    ENDPOINT,
    {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ url, browserHtml: true }),
    },
    180_000,
  );

  const text = await res.text();
  let parsed: { browserHtml?: string; url?: string; detail?: string; title?: string; type?: string };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    throw new ZyteError(`Zyte returned a non-JSON response (HTTP ${res.status}).`);
  }

  if (!res.ok) {
    const detail = parsed.detail || parsed.title || `HTTP ${res.status}`;
    if (res.status === 401 || res.status === 403) {
      throw new ZyteError(`Zyte rejected the API key (HTTP ${res.status}). ${detail}`);
    }
    if (res.status === 429) throw new ZyteError(`Zyte is rate limiting this account. ${detail}`);
    throw new ZyteError(`Zyte could not fetch that page. ${detail}`);
  }

  if (!parsed.browserHtml) throw new ZyteError("Zyte returned no HTML for that URL.");
  return { html: parsed.browserHtml, finalUrl: parsed.url || url };
}
