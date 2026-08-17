"use client";

import { useCallback, useEffect, useState } from "react";
import type { PublicSecrets, SecretsPatch } from "./secrets";

/** Deployment problems the signed-in UI should surface, not the values behind them. */
export type Warnings = {
  defaultPassword: boolean;
  configSource: "file" | "env" | "default";
  readOnly: boolean;
  storageWritable: boolean;
  storageDetail: string;
};

export type Workspace = PublicSecrets & { warnings?: Warnings };

/**
 * Browser side of Secret.json. Nothing is kept in localStorage — every page
 * reads the same file through /api/settings, so the two tools always agree.
 */

async function unwrap<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({ error: "Unreadable response from the server." }))) as unknown;
  if (!res.ok) {
    const body = data as { error?: string; hint?: string };
    const err = new Error(body.error || `Request failed (${res.status}).`);
    if (body.hint) (err as Error & { hint?: string }).hint = body.hint;
    throw err;
  }
  return data as T;
}

export async function getJson<T>(url: string): Promise<T> {
  return unwrap<T>(await fetch(url));
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  return unwrap<T>(
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export function useWorkspace() {
  const [secrets, setSecrets] = useState<Workspace | null>(null);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    try {
      setSecrets(await getJson<Workspace>("/api/settings"));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** Persists a patch to Secret.json and adopts the file the server wrote back. */
  const save = useCallback(async (patch: SecretsPatch) => {
    const next = await postJson<Workspace>("/api/settings", patch);
    setSecrets(next);
    return next;
  }, []);

  return { secrets, save, reload, error, loaded: secrets !== null };
}
