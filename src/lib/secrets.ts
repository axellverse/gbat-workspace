import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Secret.json is the single store for this workspace — API keys, stores,
 * preferences and history. There is no database anywhere in the project.
 *
 * Server-only. Never import this from a "use client" component.
 */

/* ------------------------------------------------------------ global keys */

/**
 * One saved key for a provider. Each provider holds up to three, tried in
 * order, so a dead or rate-limited key never stops the workspace.
 */
export type Credential = {
  id: string;
  /** Free text so an operator can tell two keys apart ("Main", "Backup"). */
  label: string;
  apiKey: string;
  /** OpenAI-compatible providers only; ignored elsewhere. */
  baseUrl: string;
};

export type ProviderKeys = { credentials: Credential[] };

export type ProviderId = "yunwu" | "openai" | "ttapi" | "zyte";

/** Keys that belong to the workspace rather than to any one store. */
export type ApiKeys = Record<ProviderId, ProviderKeys>;

export const PROVIDER_IDS: ProviderId[] = ["yunwu", "openai", "ttapi", "zyte"];

/** Providers that speak the OpenAI chat/images API, in fallback order. */
export const AI_PROVIDERS: ProviderId[] = ["yunwu", "openai"];

export const MAX_CREDENTIALS = 3;

export const PROVIDER_DEFAULT_BASE: Record<ProviderId, string> = {
  yunwu: "https://yunwu.ai/v1",
  openai: "https://api.openai.com/v1",
  ttapi: "https://api.ttapi.io",
  zyte: "",
};

export function blankCredential(index: number): Credential {
  return { id: `cred_${Date.now().toString(36)}_${index}`, label: "", apiKey: "", baseUrl: "" };
}

/* ----------------------------------------------------------------- stores */

export type StoreShopify = { storeDomain: string; adminToken: string; apiVersion: string };
export type StoreBrand = { name: string; accentColor: string };

export type StorePinterest = {
  accessToken: string;
  environment: "production" | "sandbox";
  defaultBoardId: string;
};

export type StoreMeta = {
  /** Long-lived *user* token. The Page token below is derived from it. */
  accessToken: string;
  apiVersion: string;
  pageId: string;
  pageName: string;
  /** Page-scoped token; this is what actually publishes. */
  pageAccessToken: string;
  igUserId: string;
  igUsername: string;
};

export type Store = {
  /** Stable foreign key. Generated once and never rewritten. */
  id: string;
  name: string;
  /** The handle in admin.shopify.com/store/<handle> — how a pasted link finds this store. */
  backendRef: string;
  /** The live storefront domain. Builds the "Shop Now" link customers click. */
  domain: string;
  shopify: StoreShopify;
  brand: StoreBrand;
  social: { pinterest: StorePinterest; meta: StoreMeta };
};

export type Channel = "pinterest" | "instagram" | "facebook";

export type Preferences = {
  textModel: string;
  imageModel: string;
  tone: string;
};

export type ChannelResult = {
  channel: Channel;
  ok: boolean;
  id?: string;
  url?: string;
  error?: string;
};

export type PublishRecord = {
  createdAt: string;
  storeId: string;
  storeName: string;
  title: string;
  productUrl: string;
  thumbnail?: string;
  results: ChannelResult[];
};

/**
 * Running totals for the Product Transfer tool.
 *
 * Counts only — never a title, a price or an image. The tool's promise is that
 * catalogue data it reads is relayed straight to the destination store and
 * never stored, and a tally of how many products moved does not break that.
 */
export type TransferStats = {
  scraped: number;
  scrapedByPlatform: { shopify: number; shopline: number };
  lastScrapeAt: string;
  /** Keyed by store id, so a renamed store keeps its history. */
  pushedByStore: Record<string, { storeName: string; pushed: number; failed: number; lastAt: string }>;
};

/** The shared workspace password and the secret its sessions are signed with. */
export type AuthSettings = { password: string; sessionSecret: string };

export type Secrets = {
  organisation: { name: string; workspace: string };
  auth: AuthSettings;
  apiKeys: ApiKeys;
  stores: Store[];
  preferences: Preferences;
  history: { publishes: PublishRecord[]; transfers: TransferStats };
};

export const EMPTY_TRANSFER_STATS: TransferStats = {
  scraped: 0,
  scrapedByPlatform: { shopify: 0, shopline: 0 },
  lastScrapeAt: "",
  pushedByStore: {},
};

/**
 * Where Secret.json lives.
 *
 * Locally that is the project root. On a deployed host it must be a directory
 * that survives restarts and redeploys, so `GBAT_DATA_DIR` points at a mounted
 * volume. Without that, every key entered would be lost the next time the
 * container was replaced.
 */
export const DATA_DIR = process.env.GBAT_DATA_DIR?.trim() || process.cwd();
export const SECRET_FILE = path.join(DATA_DIR, "Secret.json");

export const DEFAULT_STORE: Omit<Store, "id"> = {
  name: "",
  backendRef: "",
  domain: "",
  shopify: { storeDomain: "", adminToken: "", apiVersion: "2025-10" },
  brand: { name: "", accentColor: "#1d4ed8" },
  social: {
    pinterest: { accessToken: "", environment: "production", defaultBoardId: "" },
    meta: {
      accessToken: "",
      apiVersion: "v25.0",
      pageId: "",
      pageName: "",
      pageAccessToken: "",
      igUserId: "",
      igUsername: "",
    },
  },
};

export const DEFAULT_SECRETS: Secrets = {
  organisation: {
    name: "Axell Group Of Companies",
    workspace: "GBAT's Internal Workspace",
  },
  // Both are resolved on first read; see lib/auth.ts.
  auth: { password: "", sessionSecret: "" },
  apiKeys: {
    yunwu: { credentials: [] },
    openai: { credentials: [] },
    ttapi: { credentials: [] },
    zyte: { credentials: [] },
  },
  stores: [],
  preferences: {
    textModel: "gpt-4o-mini",
    imageModel: "gpt-image-1",
    tone: "warm, aspirational, concrete",
  },
  history: { publishes: [], transfers: EMPTY_TRANSFER_STATS },
};

type Plain = Record<string, unknown>;

const isPlainObject = (value: unknown): value is Plain =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Overlays a partial file onto the defaults so a hand-edited Secret.json never crashes a page. */
/** Keys that would let a crafted request reach into Object.prototype. */
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function mergeDeep<T>(base: T, patch: unknown): T {
  if (!isPlainObject(patch) || !isPlainObject(base)) {
    return patch === undefined ? base : (patch as T);
  }
  const out: Plain = { ...(base as Plain) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || FORBIDDEN_KEYS.has(key)) continue;
    out[key] = key in out ? mergeDeep((base as Plain)[key], value) : value;
  }
  return out as T;
}

/* -------------------------------------------------------------- store ids */

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

/** A readable id derived from the name, kept unique against the stores already present. */
export function makeStoreId(seed: string, taken: string[]): string {
  const base = `st_${slugify(seed) || "store"}`;
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.includes(candidate)) return candidate;
  }
}

/** Fills in every field a hand-written or partial store entry left out. */
export function normaliseStore(raw: unknown, taken: string[]): Store {
  const merged = mergeDeep({ ...DEFAULT_STORE, id: "" }, raw) as Store;
  const id = merged.id?.trim() || makeStoreId(merged.name || merged.backendRef || merged.domain, taken);
  return { ...merged, id };
}

/* ------------------------------------------------------------- migration */

/** The pre-multi-store shape: one set of credentials at the top level. */
type LegacySecrets = {
  apiKeys?: {
    shopify?: { storeDomain?: string; adminToken?: string; apiVersion?: string };
    pinterest?: { accessToken?: string; environment?: string };
    meta?: Record<string, string>;
  };
  preferences?: { brandName?: string; accentColor?: string; defaultBoardId?: string };
  history?: { pins?: unknown[] };
};

/**
 * Folds a single-store file into the `stores` array so nobody loses keys they
 * already entered. Runs once — after it writes, `stores` exists and this is a
 * no-op forever after.
 */
function migrate(parsed: unknown): { value: unknown; changed: boolean } {
  if (!isPlainObject(parsed)) return { value: parsed, changed: false };
  const legacy = parsed as LegacySecrets & Plain;

  const alreadyMigrated = Array.isArray(legacy.stores);
  const shopify = legacy.apiKeys?.shopify;
  const pinterest = legacy.apiKeys?.pinterest;
  const meta = legacy.apiKeys?.meta;
  const hasLegacyKeys = Boolean(shopify || pinterest || meta);
  if (alreadyMigrated || !hasLegacyKeys) return { value: parsed, changed: false };

  const domain = (shopify?.storeDomain || "").trim();
  const name = domain.replace(/\.myshopify\.com$/, "") || "Default store";

  const store: Store = {
    ...DEFAULT_STORE,
    id: makeStoreId(name, []),
    name,
    backendRef: name,
    domain: "",
    shopify: {
      storeDomain: domain,
      adminToken: shopify?.adminToken || "",
      apiVersion: shopify?.apiVersion || DEFAULT_STORE.shopify.apiVersion,
    },
    brand: {
      name: legacy.preferences?.brandName || "",
      accentColor: legacy.preferences?.accentColor || DEFAULT_STORE.brand.accentColor,
    },
    social: {
      pinterest: {
        accessToken: pinterest?.accessToken || "",
        environment: pinterest?.environment === "sandbox" ? "sandbox" : "production",
        defaultBoardId: legacy.preferences?.defaultBoardId || "",
      },
      meta: { ...DEFAULT_STORE.social.meta, ...(meta || {}) } as StoreMeta,
    },
  };

  const apiKeys = { ...(legacy.apiKeys as Plain) };
  delete apiKeys.shopify;
  delete apiKeys.pinterest;
  delete apiKeys.meta;

  const preferences = { ...(legacy.preferences as Plain) };
  delete preferences.brandName;
  delete preferences.accentColor;
  delete preferences.defaultBoardId;
  delete preferences.channels;
  delete preferences.scraperEngine;
  delete preferences.respectRobots;

  const history = { ...(legacy.history as Plain) };
  // `pins` was the single-channel history; it has no per-channel results to keep.
  delete history.pins;
  // Scraped catalogue data is never stored any more — it lives in the browser.
  delete history.scrapes;

  return { value: { ...legacy, apiKeys, preferences, history, stores: [store] }, changed: true };
}

/* ------------------------------------------------------------ read / write */

let cache: { mtimeMs: number; value: Secrets } | null = null;

/** Reads Secret.json, creating it from the defaults the first time the app runs. */
export async function readSecrets(): Promise<Secrets> {
  try {
    const stat = await fs.stat(SECRET_FILE);
    if (cache && cache.mtimeMs === stat.mtimeMs) return cache.value;

    const raw = await fs.readFile(SECRET_FILE, "utf8");
    const parsed = raw.trim() ? (JSON.parse(raw) as unknown) : {};
    const migrated = migrate(parsed);
    const value = hydrate(migrated.value);

    // Fold the old shape back to disk once, so the file on disk always matches
    // what the app reads and the migration never has to run again.
    if (migrated.changed) return writeSecrets(value);

    cache = { mtimeMs: stat.mtimeMs, value };
    return value;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      // First run. If the directory cannot be written — the usual cause is a
      // deployment pointed at a path that does not exist — carry on in memory
      // rather than failing every request. /api/health reports the truth, and
      // the UI warns; a workspace that boots and complains is far more use
      // than an Internal Server Error with nothing behind it.
      try {
        await writeSecrets(DEFAULT_SECRETS);
      } catch {
        return DEFAULT_SECRETS;
      }
      return DEFAULT_SECRETS;
    }
    if (err instanceof SyntaxError) {
      throw new Error(
        "Secret.json is not valid JSON. Fix the file by hand (or delete it to start from the defaults).",
      );
    }
    throw err;
  }
}

/** Applies the defaults and gives every store a complete, id-bearing record. */
function hydrate(parsed: unknown): Secrets {
  const merged = mergeDeep(DEFAULT_SECRETS, parsed);
  const taken: string[] = [];
  const stores = (Array.isArray(merged.stores) ? merged.stores : []).map((store) => {
    const normalised = normaliseStore(store, taken);
    taken.push(normalised.id);
    return normalised;
  });

  const apiKeys = {} as ApiKeys;
  for (const provider of PROVIDER_IDS) {
    apiKeys[provider] = { credentials: normaliseCredentials(merged.apiKeys?.[provider], provider) };
  }
  return { ...merged, apiKeys, stores };
}

/**
 * Accepts both shapes: the current `{credentials: [...]}` and the original
 * single `{apiKey, baseUrl}` a file may still be carrying.
 */
function normaliseCredentials(raw: unknown, provider: ProviderId): Credential[] {
  if (!raw || typeof raw !== "object") return [];
  const node = raw as Plain;

  const list = Array.isArray(node.credentials)
    ? node.credentials
    : node.apiKey || node.baseUrl
      ? [{ apiKey: node.apiKey, baseUrl: node.baseUrl, label: "Key 1" }]
      : [];

  return list
    .slice(0, MAX_CREDENTIALS)
    .map((entry, index) => {
      const credential = (entry && typeof entry === "object" ? entry : {}) as Plain;
      return {
        id: String(credential.id || `cred_${provider}_${index + 1}`),
        label: String(credential.label || ""),
        apiKey: String(credential.apiKey || ""),
        baseUrl: String(credential.baseUrl || ""),
      };
    })
    // A saved-but-empty row is noise; the Settings form adds blanks on demand.
    .filter((credential) => credential.apiKey || credential.baseUrl || credential.label);
}

/** Writes the whole file atomically so a crash mid-write cannot truncate it. */
export async function writeSecrets(next: Secrets): Promise<Secrets> {
  const body = `${JSON.stringify(next, null, 2)}\n`;
  const temp = `${SECRET_FILE}.${process.pid}.tmp`;

  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    // 0600: the file is full of live API keys, so keep it owner-only.
    await fs.writeFile(temp, body, { encoding: "utf8", mode: 0o600 });
    await fs.rename(temp, SECRET_FILE);
    await fs.chmod(SECRET_FILE, 0o600).catch(() => undefined);
  } catch (err) {
    throw new Error(describeStorageFailure(err));
  }

  cache = null;
  return next;
}

/**
 * A read-only or vanishing filesystem is the single most likely way a deploy
 * goes wrong, and the raw errno tells an operator nothing. Name the cause.
 */
function describeStorageFailure(err: unknown): string {
  const code = (err as NodeJS.ErrnoException)?.code;

  if (code === "EROFS" || code === "EACCES" || code === "EPERM") {
    return (
      `Cannot write ${SECRET_FILE} — the filesystem is read-only or not writable by this process. ` +
      `On a deployed host, mount a persistent volume and set GBAT_DATA_DIR to it. Serverless platforms ` +
      `(Vercel, Netlify) cannot store settings this way at all.`
    );
  }
  if (code === "ENOSPC") return `Cannot write ${SECRET_FILE} — the disk is full.`;
  if (code === "ENOENT") return `Cannot write ${SECRET_FILE} — ${DATA_DIR} does not exist and could not be created.`;
  return `Cannot write ${SECRET_FILE} — ${err instanceof Error ? err.message : String(err)}`;
}

export type StorageHealth = { writable: boolean; dataDir: string; detail: string };

/**
 * Proves settings can actually be saved. Worth calling right after a deploy:
 * a host that silently discards writes looks perfectly healthy otherwise.
 */
export async function checkStorage(): Promise<StorageHealth> {
  const probe = path.join(DATA_DIR, `.gbat-write-probe-${process.pid}`);
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(probe, "ok", { encoding: "utf8", mode: 0o600 });
    await fs.unlink(probe);
    return { writable: true, dataDir: DATA_DIR, detail: "Settings can be saved." };
  } catch (err) {
    return { writable: false, dataDir: DATA_DIR, detail: describeStorageFailure(err) };
  }
}

/** Everything except the credentials that must not leave the server. */
export type PublicSecrets = Omit<Secrets, "auth">;

export function toPublicSecrets(secrets: Secrets): PublicSecrets {
  const { auth: _auth, ...rest } = secrets;
  return rest;
}

export type SecretsPatch = {
  apiKeys?: Partial<{ [K in keyof ApiKeys]: Partial<ApiKeys[K]> }>;
  preferences?: Partial<Preferences>;
  organisation?: Partial<Secrets["organisation"]>;
  /** Replaces the whole list — the Settings form always sends every store. */
  stores?: unknown[];
};

export async function updateSecrets(patch: SecretsPatch): Promise<Secrets> {
  const current = await readSecrets();
  const merged = mergeDeep(current, { ...patch, stores: undefined } as unknown);

  if (patch.stores) {
    const taken: string[] = [];
    merged.stores = patch.stores.map((store) => {
      const normalised = normaliseStore(store, taken);
      taken.push(normalised.id);
      return normalised;
    });
  }
  return writeSecrets(merged);
}

const HISTORY_LIMIT = 100;

export async function recordPublish(entry: PublishRecord): Promise<void> {
  const current = await readSecrets();
  await writeSecrets({
    ...current,
    history: { ...current.history, publishes: [entry, ...current.history.publishes].slice(0, HISTORY_LIMIT) },
  });
}

export type HistoryKind = "publishes" | "transfers";

export async function clearHistory(kind: HistoryKind): Promise<Secrets> {
  const current = await readSecrets();
  const history =
    kind === "publishes"
      ? { ...current.history, publishes: [] }
      : { ...current.history, transfers: structuredClone(EMPTY_TRANSFER_STATS) };
  return writeSecrets({ ...current, history });
}

/** Adds one scrape run to the running totals. */
export async function recordScrapeRun(byPlatform: { shopify: number; shopline: number }): Promise<void> {
  const current = await readSecrets();
  const transfers = current.history.transfers;
  const total = byPlatform.shopify + byPlatform.shopline;
  if (!total) return;

  await writeSecrets({
    ...current,
    history: {
      ...current.history,
      transfers: {
        ...transfers,
        scraped: transfers.scraped + total,
        scrapedByPlatform: {
          shopify: transfers.scrapedByPlatform.shopify + byPlatform.shopify,
          shopline: transfers.scrapedByPlatform.shopline + byPlatform.shopline,
        },
        lastScrapeAt: new Date().toISOString(),
      },
    },
  });
}

/** Adds one push run to the running totals for a destination store. */
export async function recordTransferPush(entry: {
  storeId: string;
  storeName: string;
  pushed: number;
  failed: number;
}): Promise<void> {
  const current = await readSecrets();
  const transfers = current.history.transfers;
  const existing = transfers.pushedByStore[entry.storeId];

  await writeSecrets({
    ...current,
    history: {
      ...current.history,
      transfers: {
        ...transfers,
        pushedByStore: {
          ...transfers.pushedByStore,
          [entry.storeId]: {
            storeName: entry.storeName,
            pushed: (existing?.pushed || 0) + entry.pushed,
            failed: (existing?.failed || 0) + entry.failed,
            lastAt: new Date().toISOString(),
          },
        },
      },
    },
  });
}

/* ------------------------------------------------------- global accessors */

export const DEFAULT_AI_BASE = "https://api.openai.com/v1";

/** A usable credential plus where it came from, for error messages. */
export type ResolvedCredential = { provider: ProviderId; label: string; apiKey: string; baseUrl: string };

function resolveProvider(secrets: Secrets, provider: ProviderId): ResolvedCredential[] {
  return secrets.apiKeys[provider].credentials
    .filter((credential) => credential.apiKey.trim())
    .map((credential, index) => ({
      provider,
      label: credential.label.trim() || `Key ${index + 1}`,
      apiKey: credential.apiKey.trim(),
      baseUrl: normaliseBaseUrl(credential.baseUrl || PROVIDER_DEFAULT_BASE[provider]),
    }));
}

/**
 * Every OpenAI-compatible key, Yunwu first then OpenAI. Callers walk the list
 * until one works, so a spent quota on the first is invisible to the operator.
 * `.env` still seeds a key for headless use.
 */
export function aiCredentials(secrets: Secrets): ResolvedCredential[] {
  const saved = AI_PROVIDERS.flatMap((provider) => resolveProvider(secrets, provider));
  if (saved.length) return saved;

  const fromEnv = process.env.YUNWU_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim() || "";
  if (!fromEnv) return [];
  return [
    {
      provider: "yunwu",
      label: "from .env",
      apiKey: fromEnv,
      baseUrl: normaliseBaseUrl(process.env.YUNWU_BASE_URL || PROVIDER_DEFAULT_BASE.yunwu),
    },
  ];
}

export function zyteCredentials(secrets: Secrets): ResolvedCredential[] {
  const saved = resolveProvider(secrets, "zyte");
  if (saved.length) return saved;

  const fromEnv = process.env.ZYTE_API_KEY?.trim();
  return fromEnv ? [{ provider: "zyte", label: "from .env", apiKey: fromEnv, baseUrl: "" }] : [];
}

/** Relays are pasted with or without the `/v1` suffix, and sometimes as a full endpoint. */
export function normaliseBaseUrl(raw: string): string {
  const trimmed = (raw || "").trim().replace(/\/+$/, "");
  if (!trimmed) return DEFAULT_AI_BASE;

  let url: URL;
  try {
    url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  } catch {
    return DEFAULT_AI_BASE;
  }
  const pathname = url.pathname
    .replace(/\/+$/, "")
    .replace(/\/(chat\/completions|completions|images\/generations|models|responses)$/, "");

  return pathname ? `${url.origin}${pathname}` : `${url.origin}/v1`;
}

/* -------------------------------------------------------- store accessors */

/** Accepts `mystore`, `mystore.myshopify.com`, or a full admin URL. */
export function normaliseShopDomain(raw: string): string {
  const trimmed = (raw || "").trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!trimmed) return "";
  return trimmed.includes(".") ? trimmed.toLowerCase() : `${trimmed.toLowerCase()}.myshopify.com`;
}

export function shopifyCreds(store: Store) {
  return {
    domain: normaliseShopDomain(store.shopify.storeDomain),
    token: store.shopify.adminToken.trim(),
    apiVersion: store.shopify.apiVersion.trim() || "2025-10",
  };
}

export function pinterestCreds(store: Store) {
  return {
    token: store.social.pinterest.accessToken.trim(),
    environment: store.social.pinterest.environment,
  };
}

export type MetaCreds = {
  userToken: string;
  pageToken: string;
  pageId: string;
  igUserId: string;
  apiVersion: string;
};

export function metaCreds(store: Store): MetaCreds {
  const meta = store.social.meta;
  const userToken = meta.accessToken.trim();
  return {
    userToken,
    // Publishing needs a Page-scoped token; fall back to the user token so a
    // manually pasted Page token still works without running discovery.
    pageToken: meta.pageAccessToken.trim() || userToken,
    pageId: meta.pageId.trim(),
    igUserId: meta.igUserId.trim(),
    apiVersion: meta.apiVersion.trim() || "v25.0",
  };
}

export function storeById(secrets: Secrets, id: string): Store | null {
  return secrets.stores.find((store) => store.id === id) || null;
}
