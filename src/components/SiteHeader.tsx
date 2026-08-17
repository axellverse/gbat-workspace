"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import ThemeToggle from "./ThemeToggle";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/social-push", label: "Social Push" },
  { href: "/scraper", label: "Product Transfer" },
  { href: "/settings", label: "Settings" },
];

export default function SiteHeader() {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // Navigating should always close the small-screen menu.
  useEffect(() => setOpen(false), [pathname]);

  // The sign-in screen is behind no nav — there is nowhere to go from it.
  if (pathname === "/login") return null;

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  const signOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  };

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-5">
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand text-xs font-black tracking-tight text-brand-ink">
            GB
          </span>
          <span className="leading-tight">
            <span className="block text-sm font-bold">GBAT Workspace</span>
            <span className="hidden text-[11px] text-muted sm:block">Axell Group Of Companies</span>
          </span>
        </Link>

        <nav className="ml-auto hidden items-center gap-1 md:flex">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={isActive(link.href) ? "nav-link-active" : "nav-link"}
              aria-current={isActive(link.href) ? "page" : undefined}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 md:ml-2">
          <ThemeToggle />
          <button
            className="btn-ghost hidden h-9 px-3 md:inline-flex"
            onClick={signOut}
            title="Sign out of the workspace"
          >
            Sign out
          </button>
          <button
            className="btn-ghost h-9 px-3 md:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? "Close menu" : "Open menu"}
          >
            <span aria-hidden>{open ? "✕" : "☰"}</span>
          </button>
        </div>
      </div>

      {open && (
        <nav className="border-t border-line bg-surface px-4 py-2 md:hidden">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`block rounded-lg px-3 py-2.5 text-sm ${
                isActive(link.href) ? "bg-brand-soft font-semibold text-brand" : "text-muted hover:bg-surface-2"
              }`}
              aria-current={isActive(link.href) ? "page" : undefined}
            >
              {link.label}
            </Link>
          ))}
          <button
            className="mt-1 block w-full rounded-lg px-3 py-2.5 text-left text-sm text-muted hover:bg-surface-2"
            onClick={signOut}
          >
            Sign out
          </button>
        </nav>
      )}
    </header>
  );
}
