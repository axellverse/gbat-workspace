"use client";

import Link from "next/link";
import type { Channel, PublishRecord, Store, TransferStats } from "@/lib/secrets";

/** The per-tool activity tables on the home page. */

const CHANNELS: Channel[] = ["pinterest", "instagram", "facebook"];
const CHANNEL_LABEL: Record<Channel, string> = {
  pinterest: "Pinterest",
  instagram: "Instagram",
  facebook: "Facebook",
};

type StoreRow = {
  storeId: string;
  storeName: string;
  posted: Record<Channel, number>;
  failed: Record<Channel, number>;
  lastAt: string;
};

/**
 * Rolls the publish log into a store × platform grid. The log already carries
 * a per-channel result for every run, so nothing extra had to be recorded.
 */
function byStore(publishes: PublishRecord[], stores: Store[]): StoreRow[] {
  const rows = new Map<string, StoreRow>();

  for (const entry of publishes) {
    const row =
      rows.get(entry.storeId) ??
      ({
        storeId: entry.storeId,
        storeName: entry.storeName,
        posted: { pinterest: 0, instagram: 0, facebook: 0 },
        failed: { pinterest: 0, instagram: 0, facebook: 0 },
        lastAt: entry.createdAt,
      } satisfies StoreRow);

    for (const result of entry.results) {
      if (result.ok) row.posted[result.channel] += 1;
      else row.failed[result.channel] += 1;
    }
    // The log is newest-first, so the first sighting is the latest run.
    if (entry.createdAt > row.lastAt) row.lastAt = entry.createdAt;

    // A store renamed since the run should show its current name.
    row.storeName = stores.find((store) => store.id === entry.storeId)?.name || row.storeName;
    rows.set(entry.storeId, row);
  }

  return [...rows.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

export function SocialPushStats({
  publishes,
  stores,
  onClear,
}: {
  publishes: PublishRecord[];
  stores: Store[];
  onClear: () => void;
}) {
  const rows = byStore(publishes, stores);
  const totals = CHANNELS.map((channel) => rows.reduce((sum, row) => sum + row.posted[channel], 0));
  const grandTotal = totals.reduce((a, b) => a + b, 0);

  return (
    <section className="card">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold">Social Push · posts by store and platform</h3>
          <p className="mt-0.5 text-xs text-muted">
            {grandTotal} post{grandTotal === 1 ? "" : "s"} published across {rows.length} store
            {rows.length === 1 ? "" : "s"}
          </p>
        </div>
        <span className="flex items-center gap-1">
          <Link href="/social-push" className="btn-quiet">
            Open tool
          </Link>
          {rows.length > 0 && (
            <button className="btn-quiet" onClick={onClear}>
              Reset
            </button>
          )}
        </span>
      </header>

      {!rows.length ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">
          Nothing published yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-surface-2 text-left text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="px-3 py-2 font-semibold">Store</th>
                {CHANNELS.map((channel) => (
                  <th key={channel} className="px-3 py-2 text-right font-semibold">
                    {CHANNEL_LABEL[channel]}
                  </th>
                ))}
                <th className="px-3 py-2 text-right font-semibold">Last push</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.storeId} className={i % 2 ? "bg-surface-2" : ""}>
                  <td className="px-3 py-2 font-medium">{row.storeName}</td>
                  {CHANNELS.map((channel) => (
                    <td key={channel} className="px-3 py-2 text-right tabular-nums">
                      <span className={row.posted[channel] ? "font-semibold" : "text-muted"}>
                        {row.posted[channel]}
                      </span>
                      {row.failed[channel] > 0 && (
                        <span
                          className="ml-1.5 text-xs"
                          style={{ color: "var(--danger)" }}
                          title={`${row.failed[channel]} failed`}
                        >
                          ✕{row.failed[channel]}
                        </span>
                      )}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right text-xs text-muted">
                    {new Date(row.lastAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-line bg-surface-2 text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Total</th>
                {totals.map((total, i) => (
                  <td key={CHANNELS[i]} className="px-3 py-2 text-right font-bold tabular-nums text-ink">
                    {total}
                  </td>
                ))}
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}

export function TransferStatsPanel({
  transfers,
  stores,
  onClear,
}: {
  transfers: TransferStats;
  stores: Store[];
  onClear: () => void;
}) {
  const rows = Object.entries(transfers.pushedByStore)
    .map(([storeId, entry]) => ({
      ...entry,
      storeId,
      // A store renamed since the push should show its current name.
      storeName: stores.find((store) => store.id === storeId)?.name || entry.storeName,
    }))
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt));

  const pushed = rows.reduce((sum, row) => sum + row.pushed, 0);
  const failed = rows.reduce((sum, row) => sum + row.failed, 0);
  const hasActivity = transfers.scraped > 0 || rows.length > 0;

  return (
    <section className="card">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold">Product Transfer · scraped and pushed</h3>
          <p className="mt-0.5 text-xs text-muted">Counts only — no product data is ever stored.</p>
        </div>
        <span className="flex items-center gap-1">
          <Link href="/scraper" className="btn-quiet">
            Open tool
          </Link>
          {hasActivity && (
            <button className="btn-quiet" onClick={onClear}>
              Reset
            </button>
          )}
        </span>
      </header>

      <div className="mb-4 grid grid-cols-3 gap-3">
        <Figure label="Scraped" value={transfers.scraped} hint="products read" />
        <Figure label="Pushed" value={pushed} hint="created in Shopify" />
        <Figure label="Failed" value={failed} hint="rejected" danger={failed > 0} />
      </div>

      {transfers.scraped > 0 && (
        <p className="mb-4 flex flex-wrap gap-1.5">
          <span className="chip">Shopify sources: {transfers.scrapedByPlatform.shopify}</span>
          <span className="chip">Shopline sources: {transfers.scrapedByPlatform.shopline}</span>
          {transfers.lastScrapeAt && (
            <span className="chip">Last scrape: {new Date(transfers.lastScrapeAt).toLocaleString()}</span>
          )}
        </p>
      )}

      {!rows.length ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">
          Nothing pushed to a store yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[440px] text-sm">
            <thead className="bg-surface-2 text-left text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="px-3 py-2 font-semibold">Destination store</th>
                <th className="px-3 py-2 text-right font-semibold">Pushed</th>
                <th className="px-3 py-2 text-right font-semibold">Failed</th>
                <th className="px-3 py-2 text-right font-semibold">Last push</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.storeId} className={i % 2 ? "bg-surface-2" : ""}>
                  <td className="px-3 py-2 font-medium">{row.storeName}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{row.pushed}</td>
                  <td
                    className="px-3 py-2 text-right tabular-nums"
                    style={row.failed ? { color: "var(--danger)" } : undefined}
                  >
                    {row.failed || "—"}
                  </td>
                  <td className="px-3 py-2 text-right text-xs text-muted">
                    {new Date(row.lastAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Figure({
  label,
  value,
  hint,
  danger,
}: {
  label: string;
  value: number;
  hint: string;
  danger?: boolean;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface-2 px-3 py-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p>
      <p
        className="mt-0.5 text-2xl font-black tabular-nums"
        style={danger ? { color: "var(--danger)" } : undefined}
      >
        {value}
      </p>
      <p className="text-[11px] text-muted">{hint}</p>
    </div>
  );
}
