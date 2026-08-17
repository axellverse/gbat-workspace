import { NextResponse } from "next/server";
import {
  clearFailures,
  createSessionToken,
  noteFailure,
  readAuth,
  safeEquals,
  SESSION_COOKIE,
  isSecureRequest,
  SESSION_MAX_AGE_SECONDS,
  throttle,
} from "@/lib/auth";
import { fail } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Exchanges the workspace password for a signed session cookie. */
export async function POST(req: Request) {
  let password = "";
  try {
    ({ password = "" } = (await req.json()) as { password?: string });
  } catch {
    return fail(400, "Invalid request body.");
  }

  // One shared password means one bucket; this only has to slow a human down.
  const brake = throttle("workspace");
  if (brake.blocked) {
    return fail(429, `Too many attempts. Try again in ${brake.retryInSeconds}s.`);
  }

  const auth = await readAuth();
  if (!password || !safeEquals(password, auth.password)) {
    noteFailure("workspace");
    return fail(401, "Wrong password.");
  }
  clearFailures("workspace");

  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: SESSION_COOKIE,
    value: createSessionToken(auth.sessionSecret),
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
    // Secure in production; omitted on plain-http localhost, where the browser
    // would drop the cookie entirely.
    secure: isSecureRequest(req),
  });
  return res;
}
