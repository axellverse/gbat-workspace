import { publishFacebookPhoto, publishInstagramImage, isDataUrl } from "./meta";
import { createPin } from "./pinterest";
import {
  metaCreds,
  pinterestCreds,
  shopifyCreds,
  type Channel,
  type ChannelResult,
  type Store,
} from "./secrets";
import { uploadImageToShopifyFiles } from "./shopify-files";
import { storeLabel } from "./stores";

/**
 * Pushes one piece of content to Pinterest, Instagram and Facebook.
 *
 * Every channel is independent: a failure is reported against that channel and
 * never stops the others, because a half-published post is still better than a
 * post nobody sees. The UI drives this one channel at a time from three
 * buttons, or all three at once — same path either way.
 */

export type PublishRequest = {
  channels: Channel[];
  /** The live storefront link. Also appended to the captions as "Shop Now". */
  link: string;
  /** 1000x1500 — Pinterest's shape. */
  pinImage: string;
  /** 1080x1350 — the tallest ratio Instagram accepts, and fine for Facebook. */
  socialImage: string;
  pinterest: { boardId: string; title: string; description: string; altText: string };
  instagram: { caption: string };
  facebook: { message: string };
};

/** Every caption carries the buy link, so the post is actionable wherever it lands. */
export function withShopNow(text: string, link: string): string {
  if (!link) return text;
  if (text.includes(link)) return text;
  return [text.trim(), `Shop Now: ${link}`].filter(Boolean).join("\n\n");
}

/**
 * Instagram will only fetch an image from a public URL. Anything already
 * public (a product photo on a CDN) passes straight through; a locally
 * composed image is uploaded to that store's Files first.
 */
async function ensurePublicImageUrl(store: Store, image: string, altText: string): Promise<string> {
  if (!isDataUrl(image)) return image;

  const creds = shopifyCreds(store);
  if (!creds.domain || !creds.token) {
    throw new Error(
      `Instagram can only post an image it can download, and this one was composed locally. Add ` +
        `${storeLabel(store)}'s Shopify domain and Admin API token under Settings → Stores (with the ` +
        `write_files scope) so the workspace can host it, or switch the image to the product photo.`,
    );
  }

  return uploadImageToShopifyFiles({
    creds,
    dataUrl: image,
    filename: `${store.id}-social-${Date.now()}.jpg`,
    alt: altText,
  });
}

async function attempt(
  channel: Channel,
  run: () => Promise<{ id?: string; url?: string }>,
): Promise<ChannelResult> {
  try {
    const { id, url } = await run();
    return { channel, ok: true, id, url };
  } catch (err) {
    return { channel, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function publishAll(store: Store, request: PublishRequest): Promise<ChannelResult[]> {
  const wanted = new Set(request.channels);
  const jobs: Promise<ChannelResult>[] = [];

  if (wanted.has("pinterest")) {
    jobs.push(
      attempt("pinterest", async () => {
        const creds = pinterestCreds(store);
        if (!creds.token) {
          throw new Error(`Add ${storeLabel(store)}'s Pinterest access token under Settings → Social API Keys.`);
        }
        if (!request.pinterest.boardId) throw new Error("Pick a board to publish to.");

        const pin = await createPin({
          creds,
          boardId: request.pinterest.boardId,
          title: request.pinterest.title,
          // Pinterest has a real link field, but the description is what gets
          // read aloud in feeds — carry the link in both.
          description: withShopNow(request.pinterest.description, request.link),
          altText: request.pinterest.altText,
          link: request.link,
          image: request.pinImage,
        });
        return { id: pin.pinId, url: pin.pinUrl };
      }),
    );
  }

  if (wanted.has("facebook")) {
    jobs.push(
      attempt("facebook", () =>
        publishFacebookPhoto({
          creds: metaCreds(store),
          message: withShopNow(request.facebook.message, request.link),
          image: request.socialImage,
        }),
      ),
    );
  }

  if (wanted.has("instagram")) {
    jobs.push(
      attempt("instagram", async () => {
        const imageUrl = await ensurePublicImageUrl(store, request.socialImage, request.pinterest.altText);
        return publishInstagramImage({
          creds: metaCreds(store),
          caption: withShopNow(request.instagram.caption, request.link),
          imageUrl,
        });
      }),
    );
  }

  const results = await Promise.all(jobs);

  // Keep a stable order in the UI regardless of which finished first.
  const order: Channel[] = ["pinterest", "instagram", "facebook"];
  return results.sort((a, b) => order.indexOf(a.channel) - order.indexOf(b.channel));
}
