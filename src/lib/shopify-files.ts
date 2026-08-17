import { fetchWithTimeout } from "./http";
import { adminGraphQL, assertNoUserErrors, type ShopifyAdminCreds } from "./shopify-admin";

/**
 * Uploads an image to the store's Files and returns its public CDN URL.
 *
 * This exists for one reason: Instagram will not accept image bytes, only a URL
 * it can fetch. Shopify's CDN is somewhere this workspace already has
 * credentials for, so composed images go there rather than to a new vendor.
 *
 * Needs the `write_files` scope on the same Admin API app as `read_products`.
 */

const STAGED_UPLOADS = `
  mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets { url resourceUrl parameters { name value } }
      userErrors { field message }
    }
  }`;

const FILE_CREATE = `
  mutation fileCreate($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files { id fileStatus ... on MediaImage { image { url } } }
      userErrors { field message }
    }
  }`;

const FILE_STATUS = `
  query fileStatus($id: ID!) {
    node(id: $id) {
      ... on MediaImage { fileStatus image { url } }
    }
  }`;

type StagedTarget = { url: string; resourceUrl: string; parameters: { name: string; value: string }[] };

const READY_POLL_ATTEMPTS = 20;
const READY_POLL_DELAY_MS = 1500;

export async function uploadImageToShopifyFiles(opts: {
  creds: ShopifyAdminCreds;
  dataUrl: string;
  filename: string;
  alt?: string;
}): Promise<string> {
  const { creds, dataUrl, filename } = opts;

  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) throw new Error("Only base64 data URLs can be uploaded to Shopify Files.");
  const [, mimeType, base64] = match;
  const bytes = Buffer.from(base64, "base64");

  // 1 — ask Shopify where to put the bytes.
  const staged = await adminGraphQL<{
    stagedUploadsCreate: { stagedTargets: StagedTarget[]; userErrors: { message: string }[] };
  }>(creds, STAGED_UPLOADS, {
    input: [{ resource: "FILE", filename, mimeType, httpMethod: "POST" }],
  });
  assertNoUserErrors(staged.stagedUploadsCreate.userErrors, "Shopify staged upload");

  const target = staged.stagedUploadsCreate.stagedTargets[0];
  if (!target) throw new Error("Shopify did not return an upload target.");

  // 2 — post the bytes to the staged target. The parameters are signed and
  //     ordered; the file field must come last.
  const form = new FormData();
  for (const { name, value } of target.parameters) form.set(name, value);
  form.set("file", new Blob([new Uint8Array(bytes)], { type: mimeType }), filename);

  const upload = await fetchWithTimeout(target.url, { method: "POST", body: form }, 180_000);
  if (!upload.ok) {
    throw new Error(`Uploading to Shopify's file storage failed (HTTP ${upload.status}).`);
  }

  // 3 — register the staged file so it becomes a real, servable asset.
  const created = await adminGraphQL<{
    fileCreate: {
      files: { id: string; fileStatus: string; image?: { url?: string } }[];
      userErrors: { message: string }[];
    };
  }>(creds, FILE_CREATE, {
    files: [{ originalSource: target.resourceUrl, contentType: "IMAGE", alt: opts.alt?.slice(0, 512) || "" }],
  });
  assertNoUserErrors(created.fileCreate.userErrors, "Shopify file create");

  const file = created.fileCreate.files[0];
  if (!file?.id) throw new Error("Shopify did not return a created file.");
  if (file.fileStatus === "READY" && file.image?.url) return file.image.url;

  // 4 — Shopify processes the image asynchronously; the CDN URL only exists
  //     once it is READY, and Instagram must be able to fetch it immediately.
  return pollUntilReady(creds, file.id);
}

async function pollUntilReady(creds: ShopifyAdminCreds, id: string): Promise<string> {
  for (let attempt = 0; attempt < READY_POLL_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_DELAY_MS));

    const data = await adminGraphQL<{ node?: { fileStatus?: string; image?: { url?: string } } }>(
      creds,
      FILE_STATUS,
      { id },
    );
    const node = data.node;
    if (node?.fileStatus === "READY" && node.image?.url) return node.image.url;
    if (node?.fileStatus === "FAILED") throw new Error("Shopify failed to process the uploaded image.");
  }
  throw new Error("Shopify is still processing the uploaded image. Try publishing again in a moment.");
}
