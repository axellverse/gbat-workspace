import { NextResponse } from "next/server";
import { fail } from "@/lib/http";
import { readSecrets, storeById } from "@/lib/secrets";
import { fetchProduct } from "@/lib/shopify";
import { matchStore, storeLabel } from "@/lib/stores";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Fetches a product and reports which store the link belongs to. The backend
 * URL names its own store, so the caller normally sends no storeId at all.
 */
export async function POST(req: Request) {
  let body: { url?: string; storeId?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return fail(400, "Invalid request body.");
  }

  const url = body.url?.trim();
  if (!url) return fail(400, "Paste a backend product link first.");

  const secrets = await readSecrets();
  const store = (body.storeId ? storeById(secrets, body.storeId) : null) || matchStore(secrets.stores, url);

  if (!store && !secrets.stores.length) {
    return fail(400, "No stores are configured yet. Add one under Settings → Stores.");
  }

  const matched = store ? { id: store.id, name: storeLabel(store) } : null;

  try {
    const { product, via } = await fetchProduct(url, store);
    return NextResponse.json({ product, via, store: matched });
  } catch (err) {
    // Name the store even when the fetch fails — "we found the store but its
    // token is wrong" is a very different problem from "no store matched".
    return fail(400, err instanceof Error ? err.message : "Could not load that product.", {
      detail: matched ? `Resolved to ${matched.name}` : "No store matched this link.",
    });
  }
}
