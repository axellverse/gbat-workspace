import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readSecrets, writeSecrets } from "./secrets";

/**
 * A single shared password for the whole workspace.
 *
 * The app has no user accounts — it is one internal tool on one machine — so
 * this is a door lock, not an identity system. What it does buy is that a
 * browser left open, or a colleague on the same machine, cannot read every API
 * key out of /api/settings without knowing the password.
 *
 * The password and the signing secret live in Secret.json (0600, git-ignored),
 * so the password can be changed from Settings without touching the source.
 */

export const SESSION_COOKIE = "gbat_session";
export const DEFAULT_PASSWORD = "techkeo";

/** How long a sign-in lasts before the password is asked for again. */
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type AuthConfig = { password: string; sessionSecret: string };

/**
 * Reads the password and signing secret, minting a secret on first run.
 * A fresh install starts with the shipped default until it is changed.
 */
/**
 * The password a saved file does not yet specify: `GBAT_PASSWORD` if the host
 * sets one, otherwise the shipped default. Set it on a deployed instance so it
 * never comes up publicly reachable on a password that is in the README.
 */
function seedPassword(): string {
  return process.env.GBAT_PASSWORD?.trim() || DEFAULT_PASSWORD;
}

/**
 * The signing secret to use when it cannot be persisted.
 *
 * It has to be *derived* rather than random: middleware and route handlers are
 * separate bundles with separate module state, so a random value would differ
 * between them and every freshly issued cookie would be rejected. Deriving it
 * from the password gives both sides the same answer.
 *
 * This grants no access that knowing the password does not already grant, and
 * it only ever applies while storage is broken.
 */
function derivedSecret(password: string): string {
  return createHash("sha256").update(`gbat-ephemeral-session:${password}`).digest("hex");
}

export async function readAuth(): Promise<AuthConfig> {
  const secrets = await readSecrets();
  const auth = secrets.auth;

  if (auth?.sessionSecret && auth.password) {
    return { password: auth.password, sessionSecret: auth.sessionSecret };
  }

  // First run: settle on a password and mint a signing secret so sessions
  // cannot be forged. Written once, then the file is authoritative — changing
  // the password in Settings must not be undone by a stale env var.
  const next: AuthConfig = {
    password: auth?.password || seedPassword(),
    sessionSecret: auth?.sessionSecret || randomBytes(32).toString("hex"),
  };

  try {
    await writeSecrets({ ...secrets, auth: next });
    return next;
  } catch {
    // Storage is broken. Fall back to a derived secret so the password gate
    // still works and the operator can sign in to see what is wrong.
    return { password: next.password, sessionSecret: derivedSecret(next.password) };
  }
}

/** True while the workspace is still on the password shipped in the repo. */
export async function usingDefaultPassword(): Promise<boolean> {
  const { password } = await readAuth();
  return password === DEFAULT_PASSWORD;
}

export async function setPassword(password: string): Promise<void> {
  const secrets = await readSecrets();
  const current = await readAuth();
  await writeSecrets({ ...secrets, auth: { ...current, password } });
}

/**
 * Invalidates every existing session by rotating the signing secret. Used when
 * the password changes, so an old browser cannot stay signed in.
 */
export async function rotateSessionSecret(): Promise<void> {
  const secrets = await readSecrets();
  const current = await readAuth();
  await writeSecrets({ ...secrets, auth: { ...current, sessionSecret: randomBytes(32).toString("hex") } });
}

/** Compares two secrets without leaking their contents through timing. */
export function safeEquals(a: string, b: string): boolean {
  // Hashing first makes the buffers equal length, which timingSafeEqual needs.
  const left = createHash("sha256").update(a, "utf8").digest();
  const right = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(left, right);
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/** `<expiry>.<hmac>` — stateless, so nothing has to be tracked server-side. */
export function createSessionToken(secret: string): string {
  const expiresAt = String(Date.now() + SESSION_TTL_MS);
  return `${expiresAt}.${sign(expiresAt, secret)}`;
}

export function verifySessionToken(token: string | undefined, secret: string): boolean {
  if (!token) return false;

  const [expiresAt, signature] = token.split(".");
  if (!expiresAt || !signature) return false;

  const expiry = Number(expiresAt);
  if (!Number.isFinite(expiry) || expiry < Date.now()) return false;

  return safeEquals(signature, sign(expiresAt, secret));
}

export const SESSION_MAX_AGE_SECONDS = Math.floor(SESSION_TTL_MS / 1000);

/**
 * Whether the browser reached us over https.
 *
 * Behind a reverse proxy the request arrives as plain http, so `req.url` says
 * http even on an https deployment. Trusting `x-forwarded-proto` is what lets
 * the session cookie carry `Secure` in production.
 */
export function isSecureRequest(req: Request): boolean {
  const forwarded = req.headers.get("x-forwarded-proto");
  if (forwarded) return forwarded.split(",")[0].trim() === "https";
  try {
    return new URL(req.url).protocol === "https:";
  } catch {
    return false;
  }
}

/* ------------------------------------------------------- brute-force brake */

const attempts = new Map<string, { count: number; until: number }>();
const MAX_ATTEMPTS = 8;
const LOCKOUT_MS = 60_000;

export function throttle(key: string): { blocked: boolean; retryInSeconds: number } {
  const entry = attempts.get(key);
  if (entry && entry.until > Date.now() && entry.count >= MAX_ATTEMPTS) {
    return { blocked: true, retryInSeconds: Math.ceil((entry.until - Date.now()) / 1000) };
  }
  return { blocked: false, retryInSeconds: 0 };
}

export function noteFailure(key: string): void {
  const entry = attempts.get(key);
  const fresh = !entry || entry.until <= Date.now();
  attempts.set(key, {
    count: fresh ? 1 : entry.count + 1,
    until: Date.now() + LOCKOUT_MS,
  });
}

export function clearFailures(key: string): void {
  attempts.delete(key);
}
