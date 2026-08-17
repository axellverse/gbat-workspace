import { fetchWithTimeout } from "./http";

/** Shared Shopify Admin GraphQL transport. Used by the SEO fetch and the Files upload. */

export type ShopifyAdminCreds = { domain: string; token: string; apiVersion: string };

/**
 * Shopify answers with `errors` as an array of objects for query problems, but
 * as a bare string for authentication ones ("[API] Invalid API key…").
 */
type GraphQLResponse<T> = { data?: T; errors?: unknown };

function describeErrors(errors: unknown): string {
  if (!errors) return "";
  if (typeof errors === "string") return errors;
  if (Array.isArray(errors)) {
    return errors
      .map((entry) =>
        typeof entry === "string" ? entry : String((entry as { message?: string })?.message ?? ""),
      )
      .filter(Boolean)
      .join("; ");
  }
  const message = (errors as { message?: string }).message;
  return message || JSON.stringify(errors);
}

export async function adminGraphQL<T>(
  creds: ShopifyAdminCreds,
  query: string,
  variables: Record<string, unknown>,
  timeoutMs = 60_000,
): Promise<T> {
  const res = await fetchWithTimeout(
    `https://${creds.domain}/admin/api/${creds.apiVersion}/graphql.json`,
    {
      method: "POST",
      headers: { "X-Shopify-Access-Token": creds.token, "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
    },
    timeoutMs,
  );

  const text = await res.text();
  let parsed: GraphQLResponse<T>;
  try {
    parsed = JSON.parse(text) as GraphQLResponse<T>;
  } catch {
    throw new Error(`Shopify returned a non-JSON response (HTTP ${res.status}).`);
  }

  const problem = describeErrors(parsed.errors);

  if (res.status === 401 || res.status === 403 || /invalid api key|access token/i.test(problem)) {
    throw new Error(
      `Shopify rejected the admin token for ${creds.domain}. Check the domain and token, and that the app has ` +
        `the scopes it needs — read_products to read, write_products to create, write_files to upload images.` +
        (problem ? ` (${problem})` : ""),
    );
  }
  if (res.status === 404) {
    throw new Error(
      `Shopify has no store at ${creds.domain} (HTTP 404). Check the Shopify domain under Settings → Store API Keys.`,
    );
  }
  if (problem) throw new Error(problem);
  if (!parsed.data) throw new Error(`Shopify returned no data (HTTP ${res.status}).`);
  return parsed.data;
}

/** Surfaces Shopify's per-mutation userErrors, which do not set an HTTP status. */
export function assertNoUserErrors(errors: unknown, what: string) {
  const problem = describeErrors(errors);
  if (problem) throw new Error(`${what}: ${problem}`);
}

const PRODUCT_SEO = `
  query productSeo($id: ID!) {
    product(id: $id) {
      handle
      onlineStoreUrl
      seo { title description }
    }
  }`;

export type ProductSeo = {
  handle: string;
  onlineStoreUrl: string;
  seoTitle: string;
  seoDescription: string;
};

/**
 * The SEO meta description is not on the REST product payload, so it takes its
 * own small GraphQL round trip. A failure here is never fatal — the caller
 * falls back to the store description.
 */
export async function fetchProductSeo(
  creds: ShopifyAdminCreds,
  productId: string,
): Promise<ProductSeo | null> {
  const data = await adminGraphQL<{
    product?: { handle?: string; onlineStoreUrl?: string; seo?: { title?: string; description?: string } };
  }>(creds, PRODUCT_SEO, { id: `gid://shopify/Product/${productId}` }, 30_000);

  const product = data.product;
  if (!product) return null;
  return {
    handle: product.handle || "",
    onlineStoreUrl: product.onlineStoreUrl || "",
    seoTitle: product.seo?.title || "",
    seoDescription: product.seo?.description || "",
  };
}
