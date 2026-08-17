"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Spinner } from "@/components/ui";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();

  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const signIn = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || "Could not sign in.");
      }

      // Where they were heading before the gate, defaulting to the home page.
      const next = params.get("next");
      const destination = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
      router.replace(destination);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPassword("");
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4 py-12 sm:px-5">
      <div className="mb-6 text-center">
        <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand text-sm font-black tracking-tight text-brand-ink">
          GB
        </span>
        <h1 className="text-2xl font-black tracking-tight">GBAT&apos;s Internal Workspace</h1>
        <p className="mt-1.5 text-sm text-muted">
          Made with <span aria-label="love">💙</span>, By Axell Group Of Companies
        </p>
      </div>

      <form className="card space-y-4" onSubmit={signIn}>
        <div>
          <label className="label" htmlFor="password">
            Workspace password
          </label>
          <input
            id="password"
            className="field"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
        </div>

        {error && (
          <p className="note-danger text-sm" role="alert">
            {error}
          </p>
        )}

        <button className="btn-primary w-full py-2.5" type="submit" disabled={busy || !password}>
          {busy ? (
            <>
              <Spinner /> Checking…
            </>
          ) : (
            "Sign in"
          )}
        </button>
      </form>

      <p className="mt-5 text-center text-xs leading-relaxed text-muted">
        Internal application. One shared password for the team — change it under Settings once you are in.
      </p>
    </main>
  );
}
