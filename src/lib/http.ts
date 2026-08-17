import { NextResponse } from "next/server";

/** Shared server helpers: uniform error bodies, timeouts, and SSRF guards. */

export function fail(status: number, error: string, extra?: { kind?: string; hint?: string; detail?: unknown }) {
  const body: Record<string, unknown> = { error };
  if (extra?.kind) body.kind = extra.kind;
  if (extra?.hint) body.hint = extra.hint;
  if (extra?.detail !== undefined) {
    body.detail = typeof extra.detail === "string" ? extra.detail : safeStringify(extra.detail);
  }
  return NextResponse.json(body, { status });
}

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const BLOCKED_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "metadata.google.internal"]);

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".");
  if (parts.length !== 4) return false;
  const octets = parts.map((part) => Number.parseInt(part, 10));
  if (octets.some((octet) => !Number.isFinite(octet) || octet < 0 || octet > 255)) return false;
  const [a, b] = octets;

  return (
    a === 0 || // "this network"
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, incl. cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224 // multicast and reserved
  );
}

/** Expands `::` and returns the eight 16-bit groups, or null if unparseable. */
function expandIpv6(address: string): number[] | null {
  let text = address;

  // A trailing dotted quad (::ffff:127.0.0.1) becomes two hex groups.
  const tail = text.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    const octets = tail[1].split(".").map((part) => Number.parseInt(part, 10));
    if (octets.some((octet) => !Number.isFinite(octet) || octet > 255)) return null;
    const hex = `${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
    text = text.slice(0, tail.index) + hex;
  }

  const [head, rest, ...extra] = text.split("::");
  if (extra.length) return null;

  const left = head ? head.split(":").filter(Boolean) : [];
  const right = rest !== undefined && rest ? rest.split(":").filter(Boolean) : [];
  const missing = 8 - left.length - right.length;
  if (rest === undefined && missing !== 0) return null;
  if (missing < 0) return null;

  const groups = [...left, ...Array(rest === undefined ? 0 : missing).fill("0"), ...right];
  if (groups.length !== 8) return null;

  const parsed = groups.map((group) => Number.parseInt(group || "0", 16));
  return parsed.some((group) => !Number.isFinite(group) || group < 0 || group > 0xffff) ? null : parsed;
}

/**
 * Every range that must never be reachable from a user-supplied URL.
 *
 * IPv6 needs real parsing rather than a prefix match: the WHATWG URL parser
 * canonicalises `[::ffff:169.254.169.254]` to `[::ffff:a9fe:a9fe]`, so a
 * string check for the dotted form walks straight past cloud metadata.
 */
function isPrivateAddress(address: string): boolean {
  const ip = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (!ip) return true;

  if (!ip.includes(":")) return isPrivateIpv4(ip);

  const groups = expandIpv6(ip);
  if (!groups) return true; // unparseable is not worth the benefit of the doubt

  const allZero = groups.every((group) => group === 0);
  if (allZero) return true; // ::
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return true; // ::1

  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible carry a v4 address.
  const mappedPrefix = groups.slice(0, 5).every((group) => group === 0);
  if (mappedPrefix && (groups[5] === 0xffff || groups[5] === 0)) {
    const v4 = [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join(".");
    return isPrivateIpv4(v4);
  }

  const first = groups[0];
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

/** Rejects non-http(s) schemes and obvious internal targets by name alone. */
export function assertPublicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("That does not look like a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https URLs are supported.");
  }
  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host) || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("That host is not allowed.");
  }
  if (isPrivateAddress(host)) {
    throw new Error("Private network addresses are not allowed.");
  }
  return url;
}

/**
 * The name check above is not enough on its own: `evil.com` can resolve to
 * 169.254.169.254 and walk straight into cloud metadata. Resolving first and
 * checking every answer closes that door before any request is made.
 */
export async function assertPublicUrlResolves(raw: string): Promise<URL> {
  const url = assertPublicUrl(raw);

  // A literal IP was already checked by name.
  if (/^[\d.]+$/.test(url.hostname) || url.hostname.includes(":")) return url;

  const { lookup } = await import("node:dns/promises");
  let addresses: { address: string }[];
  try {
    addresses = await lookup(url.hostname, { all: true });
  } catch {
    throw new Error(`${url.hostname} does not resolve.`);
  }

  if (!addresses.length) throw new Error(`${url.hostname} does not resolve.`);
  if (addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error(`${url.hostname} resolves to a private network address, which is not allowed.`);
  }
  return url;
}

export async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 60_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    const host = (() => {
      try {
        return new URL(url).host;
      } catch {
        return url;
      }
    })();
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`The request to ${host} timed out after ${Math.round(ms / 1000)}s.`);
    }
    // Node's fetch reports DNS/TLS/refused-connection as a bare "fetch failed".
    if (err instanceof Error && /fetch failed/i.test(err.message)) {
      const cause = (err as { cause?: { code?: string } }).cause?.code;
      const hint =
        cause === "ENOTFOUND"
          ? "the host does not resolve"
          : cause === "ECONNREFUSED"
            ? "the connection was refused"
            : cause === "CERT_HAS_EXPIRED" || cause === "UNABLE_TO_VERIFY_LEAF_SIGNATURE"
              ? "its TLS certificate could not be verified"
              : "the connection failed";
      throw new Error(`Could not reach ${host} — ${hint}. Check the URL is right and reachable from this machine.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
