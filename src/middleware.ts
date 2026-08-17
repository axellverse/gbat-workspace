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

  let sessionSecret: string;
  try {
    ({ sessionSecret } = await readAuth());
  } catch (err) {
    // Middleware runs on every request, so anything thrown here takes the whole
    // app down as a bare "Internal Server Error". Say what is actually wrong
    // and point at the endpoint that diagnoses it.
    const detail = err instanceof Error ? err.message : String(err);
    return new NextResponse(
      pathname.startsWith("/api/")
        ? JSON.stringify({ error: "Workspace storage is unavailable.", detail })
        : `Workspace storage is unavailable.\n\n${detail}\n\nOpen /api/health for the full diagnosis.`,
      {
        status: 503,
        headers: {
          "content-type": pathname.startsWith("/api/") ? "application/json" : "text/plain; charset=utf-8",
        },
      },
    );
  }

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
