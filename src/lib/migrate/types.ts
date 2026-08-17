/** Types for store-to-store product transfer. Shared by the server and the browser. */

export type SourcePlatform = "shopify" | "shopline";

export type SourceVariant = {
  title: string;
  sku: string;
  barcode: string;
  /** Decimal strings — Shopify's API wants "29.99", not cents. */
  price: string;
  compareAtPrice: string;
  /** Positional option values, aligned with `SourceProduct.options`. */
  optionValues: string[];
  /** The variant's own image, when the source sets one. */
  imageSrc: string;
  available: boolean;
  weight: number | null;
  weightUnit: string;
};

export type SourceOption = { name: string; values: string[] };

export type SourceProduct = {
  sourceUrl: string;
  platform: SourcePlatform;
  handle: string;
  title: string;
  /** Raw HTML, transferred verbatim — never flattened to text. */
  descriptionHtml: string;
  metaTitle: string;
  metaDescription: string;
  vendor: string;
  productType: string;
  tags: string[];
  currency: string;
  images: string[];
  options: SourceOption[];
  variants: SourceVariant[];
  /** Warnings worth showing next to the row, e.g. a missing meta description. */
  notes: string[];
};

export type ScrapeOutcome =
  | { url: string; ok: true; product: SourceProduct }
  | { url: string; ok: false; error: string };

export type PushOutcome = {
  sourceUrl: string;
  title: string;
  ok: boolean;
  productId?: string;
  adminUrl?: string;
  error?: string;
  /** Non-fatal problems, e.g. an image Shopify refused to download. */
  warnings?: string[];
};

export type PushStatus = "DRAFT" | "ACTIVE";
