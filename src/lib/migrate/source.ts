import { assertPublicUrl, assertPublicUrlResolves, BROWSER_UA, fetchWithTimeout } from "@/lib/http";
import type { SourceOption, SourceProduct, SourceVariant, SourcePlatform } from "./types";

/**
 * Reads a product from a live Shopify or Shopline storefront.
 *
 * Both platforms publish the full product as JSON, which is why this tool can
 * transfer variants, compare-at prices and per-variant images accurately —
 * there is no HTML guesswork involved. Only the SEO meta description is not in
 * the JSON, so it comes from one extra fetch of the rendered page.
 *
 *   Shopify   GET {origin}/products/{handle}.js
 *   Shopline  GET {origin}/api/product/products.json?handle={handle}
 */

type Json = Record<string, unknown>;

const HEADERS = {
  "user-agent": BROWSER_UA,
  accept: "application/json,text/plain,*/*",
  "accept-language": "en-US,en;q=0.9",
};

/* ------------------------------------------------------------------ input */

export type ParsedSourceUrl = { origin: string; handle: string; pageUrl: string; hint: SourcePlatform | null };

export function parseSourceUrl(raw: string): ParsedSourceUrl {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Empty URL.");

  const url = assertPublicUrl(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  const match = url.pathname.match(/\/products\/([^/?#]+)/);
  if (!match) {
    throw new Error("That is not a product link — it needs a /products/<handle> path.");
  }

  const handle = decodeURIComponent(match[1]).replace(/\.(js|json)$/i, "");
  const host = url.hostname.toLowerCase();
  const hint: SourcePlatform | null = host.endsWith(".myshopline.com")
    ? "shopline"
    : host.endsWith(".myshopify.com")
      ? "shopify"
      : null;

  return { origin: url.origin, handle, pageUrl: `${url.origin}/products/${match[1]}`, hint };
}

/* -------------------------------------------------------------- utilities */

/** Both platforms report money in the smallest currency unit. */
function money(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number") return Number.isFinite(value) ? (value / 100).toFixed(2) : "";

  const raw = String(value).trim();
  if (!raw) return "";
  // A value that already carries a decimal point is a real amount, not cents.
  if (raw.includes(".")) {
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed.toFixed(2) : "";
  }
  const cents = Number.parseInt(raw, 10);
  return Number.isFinite(cents) ? (cents / 100).toFixed(2) : "";
}

function absolute(src: unknown, origin: string): string {
  const raw = typeof src === "string" ? src.trim() : "";
  if (!raw) return "";
  if (raw.startsWith("//")) return `https:${raw}`;
  if (raw.startsWith("/")) return `${origin}${raw}`;
  return raw;
}

/** Variant images arrive as a URL, or as an object wrapping one. */
function imageOf(value: unknown, origin: string): string {
  if (typeof value === "string") return absolute(value, origin);
  if (value && typeof value === "object") {
    const node = value as Json;
    return absolute(node.src ?? node.url ?? node.image ?? "", origin);
  }
  return "";
}

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

function toList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Shopify's `.js` returns options as objects on new themes and strings on old ones. */
function readOptions(value: unknown): SourceOption[] {
  return toList(value)
    .map((entry) => {
      if (typeof entry === "string") return { name: entry, values: [] };
      if (entry && typeof entry === "object") {
        const node = entry as Json;
        return {
          name: text(node.name),
          values: toList(node.values).map(text).filter(Boolean),
        };
      }
      return { name: "", values: [] };
    })
    .filter((option) => option.name);
}

/** option1…option5 on both platforms; Shopify also mirrors them into `options`. */
function readVariantOptions(node: Json): string[] {
  const positional = [node.option1, node.option2, node.option3, node.option4, node.option5]
    .map(text)
    .filter(Boolean);
  if (positional.length) return positional;
  return toList(node.options).map(text).filter(Boolean);
}

function readVariant(raw: unknown, origin: string): SourceVariant | null {
  if (!raw || typeof raw !== "object") return null;
  const node = raw as Json;

  const weight = Number(node.weight);
  return {
    title: text(node.title ?? node.name ?? node.public_title),
    sku: text(node.sku),
    barcode: text(node.barcode),
    price: money(node.price),
    compareAtPrice: money(node.compare_at_price),
    optionValues: readVariantOptions(node),
    imageSrc: imageOf(node.featured_image ?? node.image, origin),
    available: node.available !== false,
    weight: Number.isFinite(weight) && weight > 0 ? weight : null,
    weightUnit: text(node.weight_unit),
  };
}

/**
 * Every option must list every value its variants actually use, or Shopify
 * rejects the product. Sources are not always consistent, so rebuild the lists
 * from the variants and keep the source's names and ordering.
 */
function reconcileOptions(options: SourceOption[], variants: SourceVariant[]): SourceOption[] {
  const width = Math.max(options.length, ...variants.map((v) => v.optionValues.length), 0);
  if (!width) return [];

  const out: SourceOption[] = [];
  for (let i = 0; i < width; i++) {
    const seen = new Set<string>();
    const values: string[] = [];

    for (const value of options[i]?.values ?? []) {
      if (value && !seen.has(value)) {
        seen.add(value);
        values.push(value);
      }
    }
    for (const variant of variants) {
      const value = variant.optionValues[i];
      if (value && !seen.has(value)) {
        seen.add(value);
        values.push(value);
      }
    }
    out.push({ name: options[i]?.name || `Option ${i + 1}`, values });
  }
  return out.filter((option) => option.values.length);
}

/* ---------------------------------------------------------------- fetching */

type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; body: string }>;

async function directFetch(url: string): Promise<{ ok: boolean; status: number; body: string }> {
  const res = await fetchWithTimeout(url, { headers: HEADERS, redirect: "follow" }, 30_000);
  return { ok: res.ok, status: res.status, body: await res.text() };
}

function parseJson(body: string): Json | null {
  try {
    const parsed = JSON.parse(body) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Json) : null;
  } catch {
    return null;
  }
}

/* ----------------------------------------------------------- the platforms */

function fromShopify(node: Json, origin: string, ref: ParsedSourceUrl): SourceProduct {
  const variants = toList(node.variants)
    .map((v) => readVariant(v, origin))
    .filter((v): v is SourceVariant => v !== null);

  const images = toList(node.images)
    .map((i) => imageOf(i, origin))
    .filter(Boolean);

  return {
    sourceUrl: ref.pageUrl,
    platform: "shopify",
    handle: text(node.handle) || ref.handle,
    title: text(node.title),
    descriptionHtml: text(node.description ?? node.body_html),
    metaTitle: "",
    metaDescription: "",
    vendor: text(node.vendor),
    productType: text(node.type ?? node.product_type),
    tags: toList(node.tags).map(text).filter(Boolean),
    currency: "",
    images,
    options: reconcileOptions(readOptions(node.options), variants),
    variants,
    notes: [],
  };
}

function fromShopline(node: Json, origin: string, ref: ParsedSourceUrl): SourceProduct {
  const variants = toList(node.variants)
    .map((v) => readVariant(v, origin))
    .filter((v): v is SourceVariant => v !== null);

  const images = toList(node.images)
    .map((i) => imageOf(i, origin))
    .filter(Boolean);

  const brand = node.brand;
  const vendor = brand && typeof brand === "object" ? text((brand as Json).name) : text(brand);

  return {
    sourceUrl: ref.pageUrl,
    platform: "shopline",
    handle: text(node.handle) || ref.handle,
    title: text(node.title),
    descriptionHtml: text(node.description ?? node.body_html),
    metaTitle: "",
    metaDescription: "",
    vendor,
    productType: text(node.product_type ?? node.type),
    tags: toList(node.tags).map(text).filter(Boolean),
    currency: "",
    images,
    options: reconcileOptions(readOptions(node.options), variants),
    variants,
    notes: [],
  };
}

/**
 * The shop's own currency, from the public storefront metadata.
 *
 * This matters more than it looks: Shopify picks a market from the caller's
 * geography and returns *that* market's prices, so the same product can come
 * back as 26.95 or 2613.10 depending on where the request lands. Pinning the
 * request to the shop's base currency is what makes a transfer reproducible.
 */
const currencyCache = new Map<string, string>();

async function shopCurrency(origin: string, get: Fetcher): Promise<string> {
  const cached = currencyCache.get(origin);
  if (cached !== undefined) return cached;

  let currency = "";
  try {
    const res = await get(`${origin}/meta.json`);
    if (res.ok) currency = text((parseJson(res.body) || {}).currency);
  } catch {
    /* the endpoint is Shopify-only and optional */
  }
  currencyCache.set(origin, currency);
  return currency;
}

function withCurrency(url: string, currency: string): string {
  return currency ? `${url}${url.includes("?") ? "&" : "?"}currency=${encodeURIComponent(currency)}` : url;
}

async function tryShopify(ref: ParsedSourceUrl, get: Fetcher): Promise<SourceProduct | null> {
  const currency = await shopCurrency(ref.origin, get);
  const res = await get(
    withCurrency(`${ref.origin}/products/${encodeURIComponent(ref.handle)}.js`, currency),
  );
  if (!res.ok) return null;
  const node = parseJson(res.body);
  if (!node || !text(node.title)) return null;

  const product = fromShopify(node, ref.origin, ref);
  product.currency = currency;
  return product;
}

async function tryShopline(ref: ParsedSourceUrl, get: Fetcher): Promise<SourceProduct | null> {
  const res = await get(
    `${ref.origin}/api/product/products.json?handle=${encodeURIComponent(ref.handle)}`,
  );
  if (!res.ok) return null;

  const body = parseJson(res.body);
  if (!body) return null;

  // The endpoint answers with a one-element list, or the bare product.
  const first = toList(body.products)[0] ?? body.product ?? body;
  if (!first || typeof first !== "object") return null;
  const node = first as Json;
  if (!text(node.title)) return null;

  return fromShopline(node, ref.origin, ref);
}

/* --------------------------------------------------------- SEO enrichment */

function metaTag(html: string, name: string): string {
  const byProperty = new RegExp(
    `<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)["']`,
    "i",
  );
  const byContent = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${name}["']`,
    "i",
  );
  return html.match(byProperty)?.[1] || html.match(byContent)?.[1] || "";
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&rsquo;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, "&");
}

/** The SEO fields live only in the rendered page, so they take one extra GET. */
async function addSeo(product: SourceProduct, get: Fetcher): Promise<void> {
  try {
    const res = await get(product.sourceUrl);
    if (!res.ok) {
      product.notes.push("Could not read the page for its SEO meta description.");
      return;
    }
    const html = res.body;

    product.metaDescription = decodeEntities(
      metaTag(html, "description") || metaTag(html, "og:description"),
    ).trim();
    product.metaTitle = decodeEntities(
      metaTag(html, "og:title") || html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || "",
    ).trim();

    if (!product.currency) {
      product.currency =
        metaTag(html, "og:price:currency") ||
        metaTag(html, "product:price:currency") ||
        html.match(/"currency"\s*:\s*"([A-Z]{3})"/)?.[1] ||
        "";
    }

    if (!product.metaDescription) product.notes.push("No SEO meta description on the source page.");
  } catch {
    product.notes.push("Could not read the page for its SEO meta description.");
  }
}

/* ------------------------------------------------------------ entry point */

export async function scrapeSourceProduct(
  rawUrl: string,
  options: { fetcher?: Fetcher } = {},
): Promise<SourceProduct> {
  const ref = parseSourceUrl(rawUrl);
  // The host is caller-supplied, so confirm where it actually points.
  await assertPublicUrlResolves(ref.pageUrl);
  const get = options.fetcher || directFetch;

  // Try the platform the hostname suggests first, then the other one.
  const order =
    ref.hint === "shopline" ? [tryShopline, tryShopify] : [tryShopify, tryShopline];

  let product: SourceProduct | null = null;
  for (const attempt of order) {
    try {
      product = await attempt(ref, get);
      if (product) break;
    } catch {
      /* try the other platform */
    }
  }

  if (!product) {
    throw new Error(
      "Neither the Shopify nor the Shopline product endpoint answered for that link. " +
        "Check it is a live product page on one of those platforms.",
    );
  }
  if (!product.variants.length) {
    throw new Error(`“${product.title}” came back with no variants, so there is nothing to transfer.`);
  }

  await addSeo(product, get);

  if (!product.images.length) product.notes.push("The source product has no images.");
  return product;
}
