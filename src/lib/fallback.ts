import type { ResolvedCredential } from "./secrets";

/**
 * Runs a job against each saved key in turn until one succeeds.
 *
 * Only the failures that another key could actually fix cause a retry — a bad
 * request or a rejected prompt fails the same way on every key, and retrying
 * those would just spend money three times.
 */

/** An error carrying the HTTP status a provider replied with. */
export class ProviderError extends Error {
  readonly status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
  }
}

const RETRYABLE_TEXT =
  /quota|rate.?limit|too many requests|insufficient|expired|invalid.?api.?key|unauthorized|authentication|timed out|could not reach|connection|econnreset|socket/i;

export function shouldTryNextKey(error: unknown): boolean {
  const status = error instanceof ProviderError ? error.status : 0;
  // 401/403 wrong key, 429 spent, 5xx provider down — all worth another key.
  if (status === 401 || status === 403 || status === 429 || status >= 500) return true;
  // A 4xx that is not about the key means the request itself is wrong.
  if (status >= 400) return false;
  return RETRYABLE_TEXT.test(error instanceof Error ? error.message : String(error));
}

export type FallbackResult<T> = { value: T; used: ResolvedCredential; attempts: number };

export async function withKeyFallback<T>(
  credentials: ResolvedCredential[],
  missingMessage: string,
  run: (credential: ResolvedCredential) => Promise<T>,
): Promise<FallbackResult<T>> {
  if (!credentials.length) throw new Error(missingMessage);

  const failures: string[] = [];

  for (const [index, credential] of credentials.entries()) {
    try {
      return { value: await run(credential), used: credential, attempts: index + 1 };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push(`${credential.provider} · ${credential.label}: ${message}`);

      const isLast = index === credentials.length - 1;
      if (isLast || !shouldTryNextKey(err)) {
        // Report every key that was tried, so nobody has to guess which failed.
        throw new Error(
          failures.length === 1 ? failures[0] : `All ${failures.length} keys failed — ${failures.join(" | ")}`,
        );
      }
    }
  }

  throw new Error(missingMessage);
}
