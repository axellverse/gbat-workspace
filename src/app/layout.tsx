import type { Metadata, Viewport } from "next";
import SiteHeader from "@/components/SiteHeader";
import { THEME_BOOTSTRAP } from "@/components/ThemeToggle";
import "./globals.css";

export const metadata: Metadata = {
  title: "GBAT Workspace — Axell Group Of Companies",
  description: "Internal tooling for GBAT: multi-store social publishing and product transfer.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f1f4f9" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0f18" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applies the saved theme before the first paint, so switching pages
            never flashes the wrong palette. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body className="flex min-h-screen flex-col antialiased">
        <SiteHeader />
        <div className="flex-1">{children}</div>
        <footer className="mx-auto w-full max-w-7xl px-4 pb-10 pt-8 text-xs leading-relaxed text-muted sm:px-5">
          Internal application · Axell Group Of Companies. Credentials live in
          <code className="mx-1 rounded bg-surface-2 px-1.5 py-0.5">Secret.json</code>
          on this machine — no database, and scraped product data is never stored at all.
        </footer>
      </body>
    </html>
  );
}
