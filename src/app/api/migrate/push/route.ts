import { NextResponse } from "next/server";
import { fail } from "@/lib/http";
import { pushProductToShopify } from "@/lib/migrate/push";
import type { PushOutcome, PushStatus, SourceProduct } from "@/lib/migrate/types";
import { readSecrets, recordTransferPush, shopifyCreds, storeById } from "@/lib/secrets";
import { fetchShopInfo } from "@/lib/shopify";

export const runtime = "nodejs";
export const maxDuration = 600;

/**
 * Creates the selected products on a destination Shopify store.
 *
 * The products come from the browser in the request body — the server never
 * stored them, so this is purely a relay from one store to another.
 */

const MAX_PRODUCTS = 100;

export async function POST(req: Request) {
  let body: { storeId?: string; products?: SourceProduct[]; status?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return fail(400, "Invalid request body.");
  }

  const store = storeById(await readSecrets(), body.storeId || "");
  if (!store) return fail(400, "Pick a destination store.");

  const creds = shopifyCreds(store);
  if (!creds.domain || !creds.token) {
    return fail(400, `${store.name || "That store"} has no Shopify Admin API credentials. Add them under Settings → Store API Keys.`);
  }

  const products = Array.isArray(body.products) ? body.products : [];
  if (!products.length) return fail(400, "Select at least one product to push.");
  if (products.length > MAX_PRODUCTS) {
    return fail(400, `That is ${products.length} products — ${MAX_PRODUCTS} at a time is the limit.`);
  }

  const status: PushStatus = body.status === "ACTIVE" ? "ACTIVE" : "DRAFT";

  // Prices transfer as plain numbers, so a currency mismatch silently changes
  // what every product costs. Say so rather than let it pass unnoticed.
  const destinationCurrency = await fetchShopInfo(creds)
    .then((shop) => shop.currency)
    .catch(() => "");

  // Sequential on purpose: Shopify downloads every image during the call, so
  // parallel pushes hit the API rate limit long before they finish faster.
  const results: PushOutcome[] = [];
  for (const product of products) {
    const outcome = await pushProductToShopify({ creds, product, status });

    if (
      outcome.ok &&
      product.currency &&
      destinationCurrency &&
      product.currency !== destinationCurrency
    ) {
      outcome.warnings = [
        ...(outcome.warnings || []),
        `Prices were read in ${product.currency} but this store sells in ${destinationCurrency} — ` +
          `the numbers transferred unchanged and were not converted.`,
      ];
    }
    results.push(outcome);
  }

  await recordTransferPush({
    storeId: store.id,
    storeName: store.name || store.shopify.storeDomain,
    pushed: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
  });

  return NextResponse.json({ results });
}
