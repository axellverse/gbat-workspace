import type { Store } from "./secrets";

/**
 * Works out which configured store a pasted link belongs to.
 *
 * This is the hinge of the Social Push flow: the backend URL already names the
 * store, so nobody has to pick an account before posting. Pure functions with
 * no I/O, so the browser can run them on every keystroke.
 */

export type UrlIdentity =
  | { kind: "admin"; shopHandle: string; host: string; productId: string }
  | { kind: "storefront"; host: string; handle: string }
  | null;

function stripWww(host: string): string {
  return host.replace(/^www\./, "");
}

/** Like `parseProductRef` in shopify.ts, but never throws — it is called while typing. */
export function identifyUrl(raw: string): UrlIdentity {
  const input = (raw || "").trim();
  if (!input || !/[./]/.test(input)) return null;

  let url: URL;
  try {
    url = new URL(input.includes("://") ? input : `https://${input}`);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const host = url.hostname.toLowerCase();

  // https://admin.shopify.com/store/<handle>/products/<id>
  if (host === "admin.shopify.com") {
    const match = url.pathname.match(/\/store\/([^/]+)(?:\/products\/(\d+))?/);
    if (!match) return null;
    return { kind: "admin", shopHandle: match[1].toLowerCase(), host, productId: match[2] || "" };
  }

  // https://<shop>.myshopify.com/admin/products/<id>
  if (/\/admin(\/|$)/.test(url.pathname)) {
    return {
      kind: "admin",
      shopHandle: host.split(".")[0],
      host,
      productId: url.pathname.match(/\/admin\/products\/(\d+)/)?.[1] || "",
    };
  }

  const handle = url.pathname.match(/\/products\/([^/]+)/)?.[1];
  if (!handle) return null;
  return { kind: "storefront", host, handle: decodeURIComponent(handle) };
}

/** Every string a store can legitimately be recognised by. */
function aliases(store: Store): string[] {
  const shopDomain = store.shopify.storeDomain.trim().toLowerCase();
  return [
    store.backendRef.trim().toLowerCase(),
    shopDomain,
    shopDomain.replace(/\.myshopify\.com$/, ""),
    stripWww(store.domain.trim().toLowerCase()),
  ].filter(Boolean);
}

/**
 * Returns the store a URL belongs to, or null when nothing matches. Admin links
 * match on the store handle, storefront links on the live domain.
 */
export function matchStore(stores: Store[], raw: string): Store | null {
  const identity = identifyUrl(raw);
  if (!identity) return null;

  const wanted =
    identity.kind === "admin"
      ? [identity.shopHandle, identity.host]
      : [stripWww(identity.host)];

  return (
    stores.find((store) => {
      const known = aliases(store);
      return wanted.some((candidate) => candidate && known.includes(candidate));
    }) || null
  );
}

/**
 * The link a customer clicks. Prefers the store's configured live domain over
 * the myshopify one, which is what Shopify reports but nobody advertises.
 */
export function liveProductUrl(store: Store | null, handle: string, fallbackUrl = ""): string {
  const domain = stripWww((store?.domain || "").trim().toLowerCase());
  if (!domain || !handle) return fallbackUrl;
  return `https://${domain}/products/${handle}`;
}

/** The label shown next to the URL field once a store is recognised. */
export function storeLabel(store: Store): string {
  return store.name || store.backendRef || store.shopify.storeDomain || store.id;
}
