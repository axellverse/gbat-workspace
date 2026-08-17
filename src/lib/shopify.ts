import type { Product } from "./types";
import { assertPublicUrl, BROWSER_UA as UA, fetchWithTimeout } from "./http";
import { fetchProductSeo, type ShopifyAdminCreds } from "./shopify-admin";
import { shopifyCreds as shopifyAdminCreds, type Store } from "./secrets";
import { liveProductUrl } from "./stores";

export type { ShopifyAdminCreds };

/* ------------------------------------------------------------------ input */

export type ProductRef =
  | { kind: "storefront"; origin: string; handle: string; url: string }
  | { kind: "adminId"; shop: string; productId: string }
  | { kind: "handle"; handle: string };

/**
 * Accepts any of the shapes a merchant actually has to hand:
 *   https://store.com/products/handle               public product page
 *   https://admin.shopify.com/store/x/products/123  new admin URL
 *   https://x.myshopify.com/admin/products/123      legacy admin URL
 *   just-the-handle                                 needs a configured store
 */
export function parseProductRef(raw: string): ProductRef {
  const input = raw.trim();

  // A bare handle or numeric id, with no scheme and no slashes.
  if (!/[/:]/.test(input)) {
    if (/^\d+$/.test(input)) throw new Error("A bare product ID needs a store domain — set one in Settings.");
    return { kind: "handle", handle: input };
  }

  const url = assertPublicUrl(input.includes("://") ? input : `https://${input}`);
  const host = url.hostname.toLowerCase();

  // https://admin.shopify.com/store/<shop>/products/<id>
  if (host === "admin.shopify.com") {
    const m = url.pathname.match(/\/store\/([^/]+)\/products\/(\d+)/);
    if (!m) throw new Error("That admin URL does not point at a single product.");
    return { kind: "adminId", shop: `${m[1]}.myshopify.com`, productId: m[2] };
  }

  // https://<shop>/admin/products/<id>
  const legacyAdmin = url.pathname.match(/\/admin\/products\/(\d+)/);
  if (legacyAdmin) return { kind: "adminId", shop: host, productId: legacyAdmin[1] };

  const storefront = url.pathname.match(/\/products\/([^/]+)/);
  if (storefront) {
    const handle = decodeURIComponent(storefront[1]);
    return { kind: "storefront", origin: url.origin, handle, url: `${url.origin}/products/${storefront[1]}` };
  }

  throw new Error(
    "URL must point at a product — either a storefront /products/<handle> page or an admin /products/<id> page.",
  );
}

/* ------------------------------------------------------------- formatting */

function absolutise(src: string, origin: string) {
  if (!src) return "";
  if (src.startsWith("//")) return `https:${src}`;
  if (src.startsWith("/")) return `${origin}${src}`;
  return src;
}

/**
 * Only Shopify's own CDN understands the `_1600x` size suffix. Applying it to
 * a third-party image host (which the HTML fallback can surface) 404s.
 */
function upscale(src: string) {
  let host: string;
  let pathname: string;
  try {
    const url = new URL(src);
    host = url.hostname.toLowerCase();
    pathname = url.pathname;
  } catch {
    return src;
  }
  const isShopifyCdn =
    host === "cdn.shopify.com" || host.endsWith(".shopifycdn.com") || pathname.includes("/cdn/shop/");
  if (!isShopifyCdn) return src;
  return src.replace(/(\.(?:jpg|jpeg|png|webp))(\?|$)/i, "_1600x$1$2");
}

function prepImages(sources: (string | undefined)[], origin: string) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const src of sources) {
    if (!src) continue;
    const final = upscale(absolutise(src, origin));
    if (final && !seen.has(final)) {
      seen.add(final);
      out.push(final);
    }
  }
  return out.slice(0, 12);
}

function decodeEntities(text: string) {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&rsquo;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, "&");
}

function stripHtml(html: string) {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function money(amount: number, currency: string) {
  if (!Number.isFinite(amount) || amount <= 0) return "";
  return currency ? `${amount.toFixed(2)} ${currency}` : amount.toFixed(2);
}

/* -------------------------------------------------------------- admin API */

type ShopInfo = { name: string; currency: string; storefrontDomain: string; myshopifyDomain: string };

async function adminFetch(creds: ShopifyAdminCreds, path: string, timeoutMs = 30_000) {
  const url = `https://${creds.domain}/admin/api/${creds.apiVersion}${path}`;
  const res = await fetchWithTimeout(
    url,
    { headers: { "X-Shopify-Access-Token": creds.token, accept: "application/json" } },
    timeoutMs,
  );

  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }

  if (!res.ok) {
    const errors = (parsed as { errors?: unknown })?.errors;
    const detail = typeof errors === "string" ? errors : errors ? JSON.stringify(errors) : "";
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `Shopify rejected the admin token (HTTP ${res.status}). ` +
          `Check the token and that the app has read_products access. ${detail}`.trim(),
      );
    }
    if (res.status === 404) throw new Error(`Shopify returned 404 for ${path} — check the store domain and product.`);
    throw new Error(`Shopify admin request failed (HTTP ${res.status}). ${detail}`.trim());
  }
  return (parsed || {}) as Record<string, unknown>;
}

export async function fetchShopInfo(creds: ShopifyAdminCreds): Promise<ShopInfo> {
  const data = await adminFetch(creds, "/shop.json");
  const shop = (data as { shop?: Record<string, string> }).shop || {};
  return {
    name: shop.name || creds.domain,
    currency: shop.currency || "",
    storefrontDomain: shop.domain || creds.domain,
    myshopifyDomain: shop.myshopify_domain || creds.domain,
  };
}

type AdminProduct = {
  id?: number;
  title?: string;
  handle?: string;
  body_html?: string;
  vendor?: string;
  product_type?: string;
  tags?: string;
  status?: string;
  images?: { src?: string }[];
  variants?: { price?: string; inventory_quantity?: number; inventory_policy?: string }[];
};

function fromAdminProduct(p: AdminProduct, shop: ShopInfo): Product {
  const origin = `https://${shop.storefrontDomain}`;
  const prices = (p.variants || []).map((v) => parseFloat(v.price || "")).filter((n) => Number.isFinite(n));
  const inStock = (p.variants || []).some((v) => (v.inventory_quantity ?? 0) > 0 || v.inventory_policy === "continue");

  return {
    sourceUrl: p.handle ? `${origin}/products/${p.handle}` : origin,
    handle: p.handle || "",
    title: p.title || "",
    description: stripHtml(p.body_html || ""),
    metaDescription: "",
    vendor: p.vendor || "",
    productType: p.product_type || "",
    tags: (p.tags || "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    price: money(prices.length ? Math.min(...prices) : NaN, shop.currency),
    currency: shop.currency,
    available: inStock,
    images: prepImages((p.images || []).map((i) => i.src), origin),
  };
}

export async function fetchViaAdmin(
  creds: ShopifyAdminCreds,
  ref: { productId?: string; handle?: string },
): Promise<Product> {
  const shop = await fetchShopInfo(creds);

  if (ref.productId) {
    const data = await adminFetch(creds, `/products/${ref.productId}.json`);
    const product = (data as { product?: AdminProduct }).product;
    if (!product?.title) throw new Error("That product ID returned no product.");
    return withSeo(creds, fromAdminProduct(product, shop), String(product.id || ref.productId));
  }

  const data = await adminFetch(creds, `/products.json?handle=${encodeURIComponent(ref.handle || "")}&limit=1`);
  const product = (data as { products?: AdminProduct[] }).products?.[0];
  if (!product?.title) throw new Error(`No product with the handle “${ref.handle}” exists in ${shop.name}.`);
  return withSeo(creds, fromAdminProduct(product, shop), String(product.id || ""));
}

/**
 * The SEO meta description lives only on the GraphQL product, so it takes a
 * second small call. Losing it must never lose the product, so a failure here
 * is swallowed — the copywriter falls back to the store description.
 */
async function withSeo(creds: ShopifyAdminCreds, product: Product, productId: string): Promise<Product> {
  if (!productId) return product;
  try {
    const seo = await fetchProductSeo(creds, productId);
    if (!seo) return product;
    return {
      ...product,
      metaDescription: seo.seoDescription,
      handle: product.handle || seo.handle,
      sourceUrl: seo.onlineStoreUrl || product.sourceUrl,
    };
  } catch {
    return product;
  }
}

/* --------------------------------------------------------- public reading */

async function shopCurrency(origin: string): Promise<string> {
  try {
    const res = await fetchWithTimeout(`${origin}/meta.json`, { headers: { "user-agent": UA } }, 8000);
    if (!res.ok) return "";
    const meta = (await res.json()) as { currency?: string };
    return meta.currency || "";
  } catch {
    return "";
  }
}

/** `/products/<handle>.js` — the richest public endpoint, prices are in cents. */
async function fromJsEndpoint(origin: string, handle: string, sourceUrl: string): Promise<Product | null> {
  const res = await fetchWithTimeout(`${origin}/products/${handle}.js`, {
    headers: { "user-agent": UA, accept: "application/json" },
  });
  if (!res.ok) return null;
  if (!(res.headers.get("content-type") || "").includes("json")) return null;

  const p = (await res.json()) as {
    title?: string;
    description?: string;
    vendor?: string;
    type?: string;
    tags?: string[];
    price?: number;
    available?: boolean;
    images?: string[];
    featured_image?: string;
  };
  if (!p.title) return null;

  const currency = await shopCurrency(origin);
  return {
    sourceUrl,
    handle,
    title: p.title,
    description: stripHtml(p.description || ""),
    metaDescription: "",
    vendor: p.vendor || "",
    productType: p.type || "",
    tags: p.tags || [],
    price: money((p.price ?? 0) / 100, currency),
    currency,
    available: p.available !== false,
    images: prepImages(p.images?.length ? p.images : [p.featured_image], origin),
  };
}

/** `/products/<handle>.json` — the fallback, prices are decimal strings. */
async function fromJsonEndpoint(origin: string, handle: string, sourceUrl: string): Promise<Product | null> {
  const res = await fetchWithTimeout(`${origin}/products/${handle}.json`, {
    headers: { "user-agent": UA, accept: "application/json" },
  });
  if (!res.ok) return null;
  if (!(res.headers.get("content-type") || "").includes("json")) return null;

  const body = (await res.json()) as {
    product?: {
      title?: string;
      body_html?: string;
      vendor?: string;
      product_type?: string;
      tags?: string | string[];
      images?: { src?: string }[];
      variants?: { price?: string; available?: boolean }[];
    };
  };
  const p = body.product;
  if (!p?.title) return null;

  const currency = await shopCurrency(origin);
  const tags = Array.isArray(p.tags)
    ? p.tags
    : (p.tags || "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
  const prices = (p.variants || []).map((v) => parseFloat(v.price || "")).filter((n) => Number.isFinite(n));

  return {
    sourceUrl,
    handle,
    title: p.title,
    description: stripHtml(p.body_html || ""),
    metaDescription: "",
    vendor: p.vendor || "",
    productType: p.product_type || "",
    tags,
    price: money(prices.length ? Math.min(...prices) : NaN, currency),
    currency,
    available: p.variants?.some((v) => v.available !== false) ?? true,
    images: prepImages((p.images || []).map((i) => i.src), origin),
  };
}

function metaTag(html: string, property: string) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]*content=["']([^"']*)["']`, "i");
  const alt = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${property}["']`, "i");
  return html.match(re)?.[1] || html.match(alt)?.[1] || "";
}

/** Last resort: read Open Graph + JSON-LD off the rendered page. */
async function fromHtml(origin: string, handle: string, sourceUrl: string): Promise<Product | null> {
  const res = await fetchWithTimeout(sourceUrl, { headers: { "user-agent": UA } });
  if (!res.ok) return null;
  // A missing handle usually redirects to a collection or the home page; that
  // page has perfectly valid OG tags, so check where we actually landed.
  if (!new URL(res.url || sourceUrl).pathname.includes("/products/")) return null;

  const html = await res.text();
  const rawTitle = metaTag(html, "og:title") || html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || "";
  const title = decodeEntities(rawTitle).trim();
  if (!title) return null;

  const images: string[] = [];
  for (const m of html.matchAll(/<meta[^>]+(?:property|name)=["']og:image["'][^>]*content=["']([^"']+)["']/gi)) {
    images.push(m[1]);
  }

  let price = metaTag(html, "og:price:amount") || metaTag(html, "product:price:amount");
  const currency =
    metaTag(html, "og:price:currency") || metaTag(html, "product:price:currency") || (await shopCurrency(origin));

  const ld = html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (ld && !price) {
    try {
      const parsed = JSON.parse(ld) as Record<string, unknown>;
      const offers = (parsed.offers ?? {}) as Record<string, unknown>;
      const p = Array.isArray(offers) ? (offers[0] as Record<string, unknown>)?.price : offers.price;
      if (p) price = String(p);
    } catch {
      /* malformed JSON-LD is common; the OG tags above are enough */
    }
  }

  return {
    sourceUrl,
    handle,
    title,
    description: stripHtml(metaTag(html, "og:description") || metaTag(html, "description")),
    metaDescription: decodeEntities(metaTag(html, "description")).trim(),
    vendor: decodeEntities(metaTag(html, "og:site_name")),
    productType: "",
    tags: [],
    price: price ? money(parseFloat(price), currency) : "",
    currency,
    available: true,
    images: prepImages(images, origin),
  };
}

/* ------------------------------------------------------------ entry point */

export type FetchResult = { product: Product; via: "storefront" | "admin" };

/**
 * Rewrites the product link to the store's configured live domain. Shopify
 * reports whatever domain it knows about, which is often the myshopify one —
 * not what we want under a "Shop Now" button.
 */
function withLiveLink(product: Product, store: Store | null): Product {
  const live = liveProductUrl(store, product.handle, product.sourceUrl);
  return live === product.sourceUrl ? product : { ...product, sourceUrl: live };
}

/**
 * The `.js` and `.json` storefront endpoints carry no SEO fields, so a product
 * read that way arrives without its meta description. One cheap GET of the
 * rendered page recovers it; failing is fine, the field is optional.
 */
async function withStorefrontMeta(product: Product, pageUrl: string): Promise<Product> {
  if (product.metaDescription) return product;
  try {
    const res = await fetchWithTimeout(pageUrl, { headers: { "user-agent": UA } }, 12_000);
    if (!res.ok) return product;
    const html = await res.text();
    const description = decodeEntities(metaTag(html, "description") || metaTag(html, "og:description")).trim();
    return description ? { ...product, metaDescription: description } : product;
  } catch {
    return product;
  }
}

/**
 * Public endpoints first (no credentials, freshest storefront data); the Admin
 * API is the fallback that also covers password-protected and draft products.
 *
 * `store` supplies the admin credentials and the live domain. Passing null
 * still works for anonymous public storefront reads.
 */
export async function fetchProduct(raw: string, store: Store | null): Promise<FetchResult> {
  const ref = parseProductRef(raw);
  const admin = store ? shopifyAdminCreds(store) : null;
  const hasAdmin = Boolean(admin?.domain && admin.token);

  if (ref.kind === "adminId") {
    if (!hasAdmin) {
      throw new Error(
        "That is a backend link, so it needs this store's Shopify Admin API credentials. Add the store " +
          "under Settings → Stores, or paste the public /products/<handle> link instead.",
      );
    }
    // The URL names the store the product lives in, so it wins over the setting.
    const creds = { ...admin!, domain: ref.shop || admin!.domain };
    return { product: withLiveLink(await fetchViaAdmin(creds, { productId: ref.productId }), store), via: "admin" };
  }

  if (ref.kind === "handle") {
    if (!hasAdmin) {
      throw new Error("A bare handle needs a configured store, or paste the full product URL.");
    }
    return { product: withLiveLink(await fetchViaAdmin(admin!, { handle: ref.handle }), store), via: "admin" };
  }

  for (const loader of [fromJsEndpoint, fromJsonEndpoint, fromHtml]) {
    try {
      const product = await loader(ref.origin, ref.handle, ref.url);
      if (product) {
        const enriched = await withStorefrontMeta(product, ref.url);
        return { product: withLiveLink(enriched, store), via: "storefront" };
      }
    } catch {
      /* try the next loader */
    }
  }

  // Storefront is closed (password page, hidden product, draft) — try the admin API.
  if (hasAdmin) {
    try {
      return { product: withLiveLink(await fetchViaAdmin(admin!, { handle: ref.handle }), store), via: "admin" };
    } catch (err) {
      throw new Error(
        `The storefront did not expose that product, and the Admin API also failed: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  throw new Error(
    "Could not read that product from the public storefront. If the store is password-protected or the " +
      "product is a draft, add its Shopify domain and Admin API token under Settings → Stores.",
  );
}
