import { NextResponse } from "next/server";
import { assertPublicUrl, fail } from "@/lib/http";
import { publishAll, type PublishRequest } from "@/lib/publish";
import { readSecrets, recordPublish, storeById, type Channel } from "@/lib/secrets";
import { storeLabel } from "@/lib/stores";

export const runtime = "nodejs";
// Instagram ingests the image asynchronously and Shopify processes the upload
// before that, so the whole fan-out needs real headroom.
export const maxDuration = 600;

const CHANNELS: Channel[] = ["pinterest", "instagram", "facebook"];

export async function POST(req: Request) {
  let body: Partial<PublishRequest> & { storeId?: string; title?: string; thumbnail?: string };
  try {
    body = await req.json();
  } catch {
    return fail(400, "Invalid request body.");
  }

  const secrets = await readSecrets();
  const store = storeById(secrets, body.storeId || "");
  if (!store) return fail(400, "Unknown store. Fetch a product first so the workspace knows where to publish.");

  const channels = (body.channels || []).filter((c): c is Channel => CHANNELS.includes(c as Channel));
  if (!channels.length) return fail(400, "Pick at least one channel to publish to.");

  if (!body.link?.trim()) return fail(400, "The post needs a destination link.");
  try {
    assertPublicUrl(body.link.trim());
  } catch (err) {
    return fail(400, err instanceof Error ? err.message : "Invalid destination link.");
  }

  if (channels.includes("pinterest") && !body.pinImage) return fail(400, "The pin needs an image.");
  if ((channels.includes("instagram") || channels.includes("facebook")) && !body.socialImage) {
    return fail(400, "Instagram and Facebook need the 4:5 image — generate it first.");
  }
  if (channels.includes("pinterest") && !body.pinterest?.title?.trim()) {
    return fail(400, "The pin needs a title.");
  }

  const request: PublishRequest = {
    channels,
    link: body.link.trim(),
    pinImage: body.pinImage || "",
    socialImage: body.socialImage || "",
    pinterest: {
      boardId: body.pinterest?.boardId || "",
      title: body.pinterest?.title?.trim() || "",
      description: body.pinterest?.description?.trim() || "",
      altText: body.pinterest?.altText?.trim() || "",
    },
    instagram: { caption: body.instagram?.caption?.trim() || "" },
    facebook: { message: body.facebook?.message?.trim() || "" },
  };

  const results = await publishAll(store, request);

  await recordPublish({
    createdAt: new Date().toISOString(),
    storeId: store.id,
    storeName: storeLabel(store),
    title: request.pinterest.title || body.title?.trim() || request.link,
    productUrl: request.link,
    // Data URLs are megabytes; only a remote image is worth keeping in the file.
    thumbnail: body.thumbnail && !body.thumbnail.startsWith("data:") ? body.thumbnail : "",
    results,
  });

  return NextResponse.json({ results });
}
