import { NextResponse, type NextRequest } from "next/server";
import { readAuth, SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

/**
 * The lock on the whole workspace.
 *
 * Everything is behind it — pages *and* API routes — because /api/settings
 * hands out every API key, so gating only the UI would protect nothing.
 *
 * Runs on the Node runtime so it can read the signing secret out of
 * Secret.json rather than needing it baked in at build time.
 */
export const config = {
  runtime: "nodejs",
  // Everything except Next's own assets and the favicon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

/** Reachable without a session, or nobody could ever sign in. */
const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/health"];

export default async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return NextResponse.next();
  }

  const { sessionSecret } = await readAuth();
  if (verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value, sessionSecret)) {
    return NextResponse.next();
  }

  // An API caller wants a status it can handle, not a login page.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const login = req.nextUrl.clone();
  login.pathname = "/login";
  // Come back to where they were heading once the password is accepted.
  login.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(login);
}
