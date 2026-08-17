import { NextResponse } from "next/server";
import { fail } from "@/lib/http";
import { readSecrets, shopifyCreds, storeById } from "@/lib/secrets";
import { fetchShopInfo } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Settings "Test" button: proves one store's domain + admin token pair works. */
export async function GET(req: Request) {
  const storeId = new URL(req.url).searchParams.get("storeId") || "";
  const store = storeById(await readSecrets(), storeId);
  if (!store) return fail(400, "Unknown store. Save the store first, then test it.");

  const admin = shopifyCreds(store);
  if (!admin.domain) return fail(400, "Add this store's Shopify domain (e.g. mystore.myshopify.com).");
  if (!admin.token) return fail(400, "Add this store's Shopify Admin API access token.");

  try {
    const shop = await fetchShopInfo(admin);
    return NextResponse.json({
      ok: true,
      shop: shop.name,
      storefront: shop.storefrontDomain,
      currency: shop.currency,
      apiVersion: admin.apiVersion,
    });
  } catch (err) {
    return fail(502, err instanceof Error ? err.message : "Could not reach the Shopify Admin API.");
  }
}
