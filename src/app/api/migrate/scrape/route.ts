import { NextResponse } from "next/server";
import { BROWSER_UA, fail, fetchWithTimeout } from "@/lib/http";
import { scrapeSourceProduct } from "@/lib/migrate/source";
import type { ScrapeOutcome } from "@/lib/migrate/types";
import { fetchViaZyte } from "@/lib/migrate/zyte";
import { readSecrets, recordScrapeRun, zyteCredentials } from "@/lib/secrets";
import type { ResolvedCredential } from "@/lib/secrets";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Reads products from live Shopify/Shopline storefronts and hands them back.
 *
 * Deliberately stateless: nothing is written to Secret.json or anywhere else.
 * Scraped catalogue data lives only in the browser tab that asked for it.
 */

const MAX_URLS = 100;
const CONCURRENCY = 4;

export async function POST(req: Request) {
  let body: { urls?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return fail(400, "Invalid request body.");
  }

  const urls = Array.from(
    new Set(
      (Array.isArray(body.urls) ? body.urls : [])
        .map((url) => String(url ?? "").trim())
        .filter(Boolean),
    ),
  );

  if (!urls.length) return fail(400, "Paste at least one product link.");
  if (urls.length > MAX_URLS) {
    return fail(400, `That is ${urls.length} links — ${MAX_URLS} at a time is the limit.`);
  }

  const fetcher = buildFetcher(zyteCredentials(await readSecrets()));

  // A few at a time: fast enough to feel instant, gentle enough not to look
  // like an attack to the source store.
  const results: ScrapeOutcome[] = [];
  for (let i = 0; i < urls.length; i += CONCURRENCY) {
    const batch = urls.slice(i, i + CONCURRENCY);
    results.push(
      ...(await Promise.all(
        batch.map(async (url): Promise<ScrapeOutcome> => {
          try {
            return { url, ok: true, product: await scrapeSourceProduct(url, { fetcher }) };
          } catch (err) {
            return { url, ok: false, error: err instanceof Error ? err.message : String(err) };
          }
        }),
      )),
    );
  }

  // Counts only — the products themselves are never written anywhere.
  const scraped = { shopify: 0, shopline: 0 };
  for (const result of results) {
    if (result.ok) scraped[result.product.platform] += 1;
  }
  await recordScrapeRun(scraped);

  return NextResponse.json({ results });
}

/**
 * Plain HTTP, falling back to Zyte when a storefront turns us away and a key
 * is configured. Every saved Zyte key is tried in turn. Most Shopify and
 * Shopline stores never need the fallback at all.
 */
function buildFetcher(zyteKeys: ResolvedCredential[]) {
  return async (url: string) => {
    const direct = await fetchWithTimeout(
      url,
      {
        headers: {
          "user-agent": BROWSER_UA,
          accept: "application/json,text/html,*/*",
          "accept-language": "en-US,en;q=0.9",
        },
        redirect: "follow",
      },
      30_000,
    ).catch(() => null);

    const blocked = !direct || direct.status === 403 || direct.status === 429 || direct.status >= 500;
    if (!blocked) return { ok: direct.ok, status: direct.status, body: await direct.text() };

    if (!zyteKeys.length) {
      if (!direct) throw new Error("The source store could not be reached.");
      return { ok: direct.ok, status: direct.status, body: await direct.text() };
    }

    let lastError: unknown;
    for (const credential of zyteKeys) {
      try {
        const viaZyte = await fetchViaZyte(url, credential.apiKey);
        return { ok: true, status: 200, body: viaZyte.html };
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Every Zyte key failed.");
  };
}
