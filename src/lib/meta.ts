import { fetchWithTimeout } from "./http";
import type { MetaCreds } from "./secrets";

/**
 * Facebook Pages and Instagram Business publishing, both on the Graph API.
 *
 * The two differ in one way that shapes everything above them: Facebook accepts
 * the image bytes, Instagram only accepts a URL it can fetch itself. See
 * `ensurePublicImageUrl` in lib/publish.ts for how that gap is bridged.
 */

const GRAPH = "https://graph.facebook.com";

export type GraphError = { message: string; type?: string; code?: number; error_user_msg?: string };

/** Meta's error bodies bury the useful sentence in `error_user_msg`. */
function describe(body: unknown, status: number): string {
  const error = (body as { error?: GraphError } | null)?.error;
  if (!error) return `Graph API request failed (HTTP ${status}).`;
  const detail = error.error_user_msg || error.message || `HTTP ${status}`;
  return error.code ? `${detail} (code ${error.code})` : detail;
}

async function graph<T>(
  creds: Pick<MetaCreds, "apiVersion">,
  path: string,
  init: RequestInit & { query?: Record<string, string | undefined> } = {},
  timeoutMs = 60_000,
): Promise<T> {
  const url = new URL(`${GRAPH}/${creds.apiVersion}${path}`);
  for (const [key, value] of Object.entries(init.query || {})) {
    if (value !== undefined && value !== "") url.searchParams.set(key, value);
  }

  const res = await fetchWithTimeout(url.toString(), { method: init.method, body: init.body }, timeoutMs);
  const text = await res.text();

  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Graph API returned a non-JSON response (HTTP ${res.status}).`);
  }
  if (!res.ok) throw new Error(describe(parsed, res.status));
  return parsed as T;
}

/* ------------------------------------------------------------- discovery */

export type MetaAccount = {
  pageId: string;
  pageName: string;
  pageAccessToken: string;
  igUserId: string;
  igUsername: string;
};

/**
 * Lists the Pages this user token administers, with the Instagram Business
 * account linked to each. Settings uses it so nobody has to paste raw IDs.
 */
export async function listAccounts(creds: MetaCreds): Promise<MetaAccount[]> {
  const data = await graph<{
    data?: {
      id: string;
      name: string;
      access_token?: string;
      instagram_business_account?: { id: string; username?: string };
    }[];
  }>(creds, "/me/accounts", {
    query: {
      access_token: creds.userToken,
      fields: "id,name,access_token,instagram_business_account{id,username}",
      limit: "100",
    },
  });

  return (data.data || []).map((page) => ({
    pageId: page.id,
    pageName: page.name,
    pageAccessToken: page.access_token || "",
    igUserId: page.instagram_business_account?.id || "",
    igUsername: page.instagram_business_account?.username || "",
  }));
}

/* -------------------------------------------------------------- Facebook */

export type PublishedPost = { id: string; url: string };

/**
 * Posts a photo to a Page. Unlike Instagram, Facebook takes the bytes, so a
 * locally composed image needs no hosting at all.
 */
export async function publishFacebookPhoto(opts: {
  creds: MetaCreds;
  message: string;
  image: string;
}): Promise<PublishedPost> {
  const { creds, message, image } = opts;
  if (!creds.pageId) throw new Error("Pick the Facebook Page to publish to in Settings.");

  // Page photo posts have no link field, so the caller folds the buy link into
  // the message itself (see `withShopNow` in publish.ts).
  const caption = message.slice(0, 63_206);

  let response: { id?: string; post_id?: string };

  if (isDataUrl(image)) {
    const form = new FormData();
    form.set("access_token", creds.pageToken);
    form.set("caption", caption);
    form.set("source", dataUrlToBlob(image), "post.jpg");
    response = await graph(creds, `/${creds.pageId}/photos`, { method: "POST", body: form }, 180_000);
  } else {
    response = await graph(
      creds,
      `/${creds.pageId}/photos`,
      { method: "POST", query: { access_token: creds.pageToken, caption, url: image } },
      180_000,
    );
  }

  // `post_id` is the feed story; `id` is the photo node. Prefer the story.
  const id = response.post_id || response.id || "";
  return { id, url: id ? `https://www.facebook.com/${id.replace("_", "/posts/")}` : "" };
}

/* ------------------------------------------------------------- Instagram */

const CONTAINER_POLL_ATTEMPTS = 20;
const CONTAINER_POLL_DELAY_MS = 3000;

/**
 * Two-step publish: create a media container from a public JPEG URL, wait for
 * Instagram to finish ingesting it, then publish the container.
 */
export async function publishInstagramImage(opts: {
  creds: MetaCreds;
  caption: string;
  imageUrl: string;
}): Promise<PublishedPost> {
  const { creds, caption, imageUrl } = opts;
  if (!creds.igUserId) throw new Error("Pick the Instagram account to publish to in Settings.");
  if (isDataUrl(imageUrl)) {
    throw new Error("Instagram needs a public image URL — the image was not uploaded to a host first.");
  }

  const container = await graph<{ id?: string }>(
    creds,
    `/${creds.igUserId}/media`,
    {
      method: "POST",
      query: { access_token: creds.pageToken, image_url: imageUrl, caption: caption.slice(0, 2200) },
    },
    180_000,
  );
  if (!container.id) throw new Error("Instagram did not return a media container.");

  await waitForContainer(creds, container.id);

  const published = await graph<{ id?: string }>(
    creds,
    `/${creds.igUserId}/media_publish`,
    { method: "POST", query: { access_token: creds.pageToken, creation_id: container.id } },
    180_000,
  );
  if (!published.id) throw new Error("Instagram did not return a published media id.");

  const permalink = await graph<{ permalink?: string }>(creds, `/${published.id}`, {
    query: { access_token: creds.pageToken, fields: "permalink" },
  }).catch(() => ({ permalink: undefined }));

  return { id: published.id, url: permalink.permalink || `https://www.instagram.com/${published.id}/` };
}

/** Instagram downloads the image asynchronously; publishing early fails. */
async function waitForContainer(creds: MetaCreds, containerId: string): Promise<void> {
  for (let attempt = 0; attempt < CONTAINER_POLL_ATTEMPTS; attempt++) {
    const status = await graph<{ status_code?: string; status?: string }>(creds, `/${containerId}`, {
      query: { access_token: creds.pageToken, fields: "status_code,status" },
    });

    if (status.status_code === "FINISHED") return;
    if (status.status_code === "ERROR" || status.status_code === "EXPIRED") {
      throw new Error(
        `Instagram could not process the image (${status.status_code}). ${status.status || ""}`.trim() +
          " It must be a JPEG on a publicly reachable URL, under 8MB, with an aspect ratio between 4:5 and 1.91:1.",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, CONTAINER_POLL_DELAY_MS));
  }
  throw new Error("Instagram is still processing the image after a minute. Try publishing again shortly.");
}

/* ----------------------------------------------------------------- utils */

export function isDataUrl(value: string): boolean {
  return value.startsWith("data:");
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) throw new Error("That image is not a base64 data URL.");
  return new Blob([Buffer.from(match[2], "base64")], { type: match[1] });
}
