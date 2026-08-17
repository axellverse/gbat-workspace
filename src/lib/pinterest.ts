import type { Board } from "./types";
import { fetchWithTimeout } from "./http";

function apiBase(environment: string) {
  return environment === "sandbox" ? "https://api-sandbox.pinterest.com/v5" : "https://api.pinterest.com/v5";
}

export type PinterestCreds = { token: string; environment: string };

async function pinterest(
  path: string,
  creds: PinterestCreds,
  init: RequestInit = {},
  timeoutMs = 120_000,
): Promise<Record<string, unknown>> {
  const res = await fetchWithTimeout(
    `${apiBase(creds.environment)}${path}`,
    {
      ...init,
      headers: {
        authorization: `Bearer ${creds.token}`,
        "content-type": "application/json",
        ...(init.headers || {}),
      },
    },
    timeoutMs,
  );

  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { message: text.slice(0, 500) };
    }
  }

  if (!res.ok) {
    const p = parsed as { message?: string; error_description?: string } | null;
    const message = p?.message || p?.error_description || `Pinterest request failed (${res.status}).`;
    throw new Error(res.status === 401 ? `${message} — check the access token and its scopes.` : message);
  }
  return (parsed || {}) as Record<string, unknown>;
}

/** Walks the bookmark cursor so accounts with more than one page are complete. */
export async function listBoards(creds: PinterestCreds): Promise<Board[]> {
  const boards: Board[] = [];
  let bookmark = "";

  for (let page = 0; page < 10; page++) {
    const query = `/boards?page_size=100${bookmark ? `&bookmark=${encodeURIComponent(bookmark)}` : ""}`;
    const data = await pinterest(query, creds, { method: "GET" }, 30_000);
    const body = data as { items?: { id: string; name: string; privacy?: string }[]; bookmark?: string | null };

    for (const b of body.items || []) boards.push({ id: b.id, name: b.name, privacy: b.privacy });

    if (!body.bookmark || body.bookmark === bookmark) break;
    bookmark = body.bookmark;
  }
  return boards;
}

export type MediaSource =
  | { source_type: "image_url"; url: string }
  | { source_type: "image_base64"; content_type: string; data: string };

/** Turns either a data URL or a remote image URL into the media_source Pinterest expects. */
export function toMediaSource(image: string): MediaSource {
  const dataUrl = image.match(/^data:([^;]+);base64,(.+)$/s);
  if (dataUrl) return { source_type: "image_base64", content_type: dataUrl[1], data: dataUrl[2] };
  return { source_type: "image_url", url: image };
}

export async function createPin(opts: {
  creds: PinterestCreds;
  boardId: string;
  title: string;
  description: string;
  altText: string;
  link: string;
  image: string;
}): Promise<{ pinId: string; pinUrl: string }> {
  const body: Record<string, unknown> = {
    board_id: opts.boardId,
    title: opts.title.slice(0, 100),
    description: opts.description.slice(0, 800),
    link: opts.link,
    media_source: toMediaSource(opts.image),
  };
  if (opts.altText) body.alt_text = opts.altText.slice(0, 500);

  const data = await pinterest("/pins", opts.creds, { method: "POST", body: JSON.stringify(body) });
  const id = String((data as { id?: string }).id || "");
  return { pinId: id, pinUrl: id ? `https://www.pinterest.com/pin/${id}/` : "" };
}
