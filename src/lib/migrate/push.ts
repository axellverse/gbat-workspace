import { adminGraphQL, assertNoUserErrors, type ShopifyAdminCreds } from "@/lib/shopify-admin";
import type { PushOutcome, PushStatus, SourceProduct } from "./types";

/**
 * Creates a product on the destination Shopify store.
 *
 * `productSet` is the mutation built for exactly this job: it takes the
 * product, its options, every variant and all media in one synchronous call,
 * so a transfer either lands whole or fails whole. Needs `write_products`.
 *
 * Images are handed over as source URLs — Shopify downloads them itself, so
 * nothing has to be re-uploaded from this machine.
 */

const PRODUCT_SET = `
  mutation transferProduct($input: ProductSetInput!) {
    productSet(input: $input, synchronous: true) {
      product {
        id
        handle
        title
        media(first: 50) { nodes { ... on MediaImage { id } mediaErrors { message } } }
        variants(first: 100) { nodes { id title } }
      }
      userErrors { field message }
    }
  }`;

type ProductSetResponse = {
  productSet: {
    product: {
      id: string;
      handle: string;
      title: string;
      media: { nodes: { id?: string; mediaErrors?: { message: string }[] }[] };
      variants: { nodes: { id: string; title: string }[] };
    } | null;
    userErrors: { field?: string[]; message: string }[];
  };
};

type FileInput = { originalSource: string; contentType: "IMAGE"; alt?: string };

/**
 * Builds the file list once, so a variant image that also appears in the
 * gallery is sent as a single asset rather than uploaded twice.
 */
function buildFiles(product: SourceProduct): { files: FileInput[]; known: Set<string> } {
  const known = new Set<string>();
  const files: FileInput[] = [];

  const add = (src: string) => {
    if (!src || known.has(src)) return;
    known.add(src);
    files.push({ originalSource: src, contentType: "IMAGE", alt: product.title.slice(0, 512) });
  };

  for (const image of product.images) add(image);
  for (const variant of product.variants) add(variant.imageSrc);

  return { files, known };
}

function buildVariants(product: SourceProduct, options: { name: string }[]) {
  return product.variants.map((variant) => {
    const input: Record<string, unknown> = {};

    if (variant.price) input.price = variant.price;
    // Shopify rejects a compare-at price that is not above the price.
    if (variant.compareAtPrice && Number(variant.compareAtPrice) > Number(variant.price || 0)) {
      input.compareAtPrice = variant.compareAtPrice;
    }
    if (variant.sku) input.sku = variant.sku;
    if (variant.barcode) input.barcode = variant.barcode;

    // Positional values map onto the option names in the same order.
    if (options.length) {
      const optionValues = options
        .map((option, index) => ({ optionName: option.name, name: variant.optionValues[index] }))
        .filter((value) => value.name);
      if (optionValues.length === options.length) input.optionValues = optionValues;
    }

    if (variant.imageSrc) {
      input.file = { originalSource: variant.imageSrc, contentType: "IMAGE" };
    }
    return input;
  });
}

export async function pushProductToShopify(opts: {
  creds: ShopifyAdminCreds;
  product: SourceProduct;
  status: PushStatus;
}): Promise<PushOutcome> {
  const { creds, product, status } = opts;
  const base: PushOutcome = { sourceUrl: product.sourceUrl, title: product.title, ok: false };

  try {
    const { files } = buildFiles(product);
    // Only offer options that every variant can satisfy; a mismatch is fatal
    // to the whole mutation, and a single-variant product needs none at all.
    const usable = product.options.filter((option) => option.values.length > 0);
    const options = product.variants.every((v) => v.optionValues.length >= usable.length) ? usable : [];

    const input: Record<string, unknown> = {
      title: product.title,
      descriptionHtml: product.descriptionHtml,
      handle: product.handle,
      status,
      variants: buildVariants(product, options),
    };

    if (product.vendor) input.vendor = product.vendor;
    if (product.productType) input.productType = product.productType;
    if (product.tags.length) input.tags = product.tags;
    if (files.length) input.files = files;
    if (options.length) {
      input.productOptions = options.map((option) => ({
        name: option.name,
        values: option.values.map((value) => ({ name: value })),
      }));
    }
    if (product.metaTitle || product.metaDescription) {
      input.seo = {
        title: product.metaTitle.slice(0, 70) || undefined,
        description: product.metaDescription.slice(0, 320) || undefined,
      };
    }

    const data = await adminGraphQL<ProductSetResponse>(creds, PRODUCT_SET, { input }, 180_000);
    assertNoUserErrors(data.productSet.userErrors, "Shopify rejected the product");

    const created = data.productSet.product;
    if (!created?.id) throw new Error("Shopify returned no product.");

    // Media is fetched over the network by Shopify, so an unreachable image
    // fails on its side after the product itself was created.
    const warnings = created.media.nodes
      .flatMap((node) => node.mediaErrors || [])
      .map((mediaError) => `Image rejected: ${mediaError.message}`);

    if (created.variants.nodes.length !== product.variants.length) {
      warnings.push(
        `Source had ${product.variants.length} variants, the new product has ${created.variants.nodes.length}.`,
      );
    }

    const numericId = created.id.split("/").pop() || "";
    return {
      ...base,
      ok: true,
      productId: created.id,
      adminUrl: `https://${creds.domain}/admin/products/${numericId}`,
      warnings: warnings.length ? warnings : undefined,
    };
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : String(err) };
  }
}
