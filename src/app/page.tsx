"use client";

import Link from "next/link";
import { SocialPushStats, TransferStatsPanel } from "@/components/ToolStats";
import { postJson, useWorkspace } from "@/lib/client";

const TOOLS = [
  {
    href: "/social-push",
    name: "Social Push",
    tagline: "One product → three networks",
    description:
      "Paste a Shopify backend link. The store is recognised from the URL, its own accounts are selected, and " +
      "one generated image and caption set go out to Pinterest, Instagram and Facebook.",
    steps: ["Fetch details", "Generate", "Push ×3"],
    accent: "var(--pinterest)",
    glyph: "◆",
  },
  {
    href: "/scraper",
    name: "Product Transfer",
    tagline: "Shopify / Shopline → your store",
    description:
      "Paste live product links in bulk, review exactly what came back — HTML description, meta, variants, " +
      "compare-at prices, variant images — then push the ones you pick into one of your stores.",
    steps: ["Scrape", "Review", "Select", "Push"],
    accent: "var(--scraper)",
    glyph: "▤",
  },
];

export default function HomePage() {
  const { secrets, loaded, reload } = useWorkspace();

  const stores = secrets?.stores ?? [];
  const pushable = stores.filter((store) => store.shopify.storeDomain && store.shopify.adminToken).length;
  const socialReady = stores.filter(
    (store) => store.social.pinterest.accessToken || store.social.meta.pageId,
  ).length;
  const aiKeys =
    (secrets?.apiKeys.yunwu.credentials.length ?? 0) + (secrets?.apiKeys.openai.credentials.length ?? 0);
  const publishes = secrets?.history.publishes ?? [];
  const warnings = secrets?.warnings;
  const transfers = secrets?.history.transfers;

  const posted = publishes.reduce(
    (sum, entry) => sum + entry.results.filter((result) => result.ok).length,
    0,
  );

  const resetHistory = async (kind: "publishes" | "transfers") => {
    await postJson("/api/settings/history", { kind });
    await reload();
  };

  return (
    <main className="mx-auto max-w-7xl px-4 py-10 sm:px-5 sm:py-14">
      {/* deployment warnings — silent when everything is in order */}
      {warnings && !warnings.storageWritable && (
        <div className="note-danger mb-6" role="alert">
          <strong className="font-bold">Settings cannot be saved.</strong> {warnings.storageDetail}
        </div>
      )}
      {warnings?.defaultPassword && (
        <div className="note-warn mb-6">
          <strong className="font-bold">Still on the default password.</strong> Anyone who has seen this
          project knows it.{" "}
          <Link href="/settings?tab=ai" className="underline">
            Change it under Settings → Workspace password
          </Link>
          .
        </div>
      )}

      {/* hero */}
      <section className="relative mb-10 overflow-hidden rounded-3xl border border-line bg-surface px-6 py-12 text-center sm:px-10 sm:py-16">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.08]"
          style={{
            background:
              "radial-gradient(60rem 30rem at 50% -20%, var(--brand), transparent 70%)," +
              "radial-gradient(40rem 20rem at 90% 120%, var(--scraper), transparent 70%)",
          }}
        />
        <div className="relative">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-line bg-surface-2 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-muted">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-brand" aria-hidden />
            Internal application
          </p>
          <h1 className="text-balance text-4xl font-black leading-[1.05] tracking-tight sm:text-6xl">
            GBAT&apos;s Internal Workspace
          </h1>
          <p className="mt-4 text-base font-medium text-muted sm:text-lg">by Axell Group Of Companies</p>
          <p className="mx-auto mt-5 max-w-2xl text-pretty text-sm leading-relaxed text-muted">
            The team&apos;s dropshipping tooling in one place. Every tool is multi-store: add a store once and it
            carries its own Shopify, Pinterest and Meta credentials.
          </p>
        </div>
      </section>

      {/* at a glance */}
      <section className="mb-10 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Stat label="Stores" value={loaded ? String(stores.length) : "—"} hint="configured" href="/settings?tab=stores" />
        <Stat
          label="Ready to push"
          value={loaded ? String(pushable) : "—"}
          hint="with Shopify tokens"
          href="/settings?tab=stores"
        />
        <Stat
          label="Posts published"
          value={loaded ? String(posted) : "—"}
          hint={`${socialReady} store(s) connected`}
          href="/social-push"
        />
        <Stat
          label="Products moved"
          value={loaded ? String(transfers?.scraped ?? 0) : "—"}
          hint={`${aiKeys} AI key(s) with fallback`}
          href="/scraper"
        />
      </section>

      {/* tools */}
      <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-muted">Tools</h2>
      <section className="grid gap-4 sm:gap-5 lg:grid-cols-2">
        {TOOLS.map((tool) => (
          <Link
            key={tool.href}
            href={tool.href}
            className="card group flex flex-col transition hover:-translate-y-0.5 hover:border-brand"
          >
            <div className="mb-4 flex items-center gap-3">
              <span
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-lg text-white"
                style={{ background: tool.accent }}
                aria-hidden
              >
                {tool.glyph}
              </span>
              <span className="min-w-0">
                <span className="block text-base font-bold">{tool.name}</span>
                <span className="block truncate text-xs text-muted">{tool.tagline}</span>
              </span>
            </div>

            <p className="text-sm leading-relaxed text-muted">{tool.description}</p>

            <ul className="mt-4 flex flex-wrap gap-1.5">
              {tool.steps.map((step) => (
                <li key={step} className="chip">
                  {step}
                </li>
              ))}
            </ul>

            <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-brand">
              Open {tool.name}
              <span aria-hidden className="transition group-hover:translate-x-0.5">
                →
              </span>
            </span>
          </Link>
        ))}
      </section>

      {/* per-tool activity */}
      <h2 className="mb-4 mt-10 text-sm font-bold uppercase tracking-wider text-muted">Activity</h2>
      <section className="grid gap-4 sm:gap-5">
        {secrets && (
          <>
            <SocialPushStats
              publishes={publishes}
              stores={stores}
              onClear={() => void resetHistory("publishes")}
            />
            <TransferStatsPanel
              transfers={transfers ?? {
                scraped: 0,
                scrapedByPlatform: { shopify: 0, shopline: 0 },
                lastScrapeAt: "",
                pushedByStore: {},
              }}
              stores={stores}
              onClear={() => void resetHistory("transfers")}
            />
          </>
        )}
      </section>

      {/* settings */}
      <section className="card mt-10 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-bold">Workspace settings</h2>
          <p className="mt-1 max-w-xl text-sm text-muted">
            API keys with up to three fallbacks each, every store&apos;s social accounts, and the Shopify
            credentials behind them.
          </p>
        </div>
        <Link href="/settings" className="btn-ghost">
          Open settings
        </Link>
      </section>
    </main>
  );
}

function Stat({ label, value, hint, href }: { label: string; value: string; hint: string; href: string }) {
  return (
    <Link href={href} className="card-flat transition hover:border-brand">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-1 text-3xl font-black tracking-tight">{value}</p>
      <p className="mt-0.5 text-xs text-muted">{hint}</p>
    </Link>
  );
}
