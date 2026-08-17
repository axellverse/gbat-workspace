import { NextResponse } from "next/server";
import {
  createSessionToken,
  readAuth,
  rotateSessionSecret,
  safeEquals,
  SESSION_COOKIE,
  isSecureRequest,
  SESSION_MAX_AGE_SECONDS,
  setPassword,
} from "@/lib/auth";
import { fail } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIN_LENGTH = 6;

/**
 * Changes the workspace password. Every other session is signed out, because a
 * password change usually means somebody should no longer have access.
 */
export async function POST(req: Request) {
  let body: { current?: string; next?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return fail(400, "Invalid request body.");
  }

  const auth = await readAuth();
  if (!body.current || !safeEquals(body.current, auth.password)) {
    return fail(401, "The current password is wrong.");
  }

  const next = (body.next || "").trim();
  if (next.length < MIN_LENGTH) return fail(400, `The new password must be at least ${MIN_LENGTH} characters.`);
  if (safeEquals(next, auth.password)) return fail(400, "That is already the password.");

  await setPassword(next);
  await rotateSessionSecret();

  // Rotating the secret invalidated this browser too, so hand it a fresh one.
  const refreshed = await readAuth();
  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: SESSION_COOKIE,
    value: createSessionToken(refreshed.sessionSecret),
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
    secure: isSecureRequest(req),
  });
  return res;
}
