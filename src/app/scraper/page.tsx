"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import ProductModal from "@/components/ProductModal";
import { Empty, Note, PageHeader, Spinner, Step } from "@/components/ui";
import { postJson, useWorkspace } from "@/lib/client";
import type { PushOutcome, PushStatus, ScrapeOutcome, SourceProduct } from "@/lib/migrate/types";

/**
 * Store-to-store product transfer. Everything scraped lives in this component's
 * state and nowhere else — no server storage, no localStorage. Closing the tab
 * discards it.
 */

type Row = {
  key: string;
  product: SourceProduct;
  selected: boolean;
  push?: PushOutcome;
};

function proxied(src: string) {
  return `/api/proxy-image?url=${encodeURIComponent(src)}`;
}

function priceRange(product: SourceProduct): string {
  const prices = product.variants.map((v) => Number(v.price)).filter((n) => Number.isFinite(n) && n > 0);
  if (!prices.length) return "—";
  const min = Math.min(...prices).toFixed(2);
  const max = Math.max(...prices).toFixed(2);
  return min === max ? min : `${min} – ${max}`;
}

export default function TransferToolPage() {
  const { secrets, loaded, error: settingsError } = useWorkspace();

  const [input, setInput] = useState("");
  const [scraping, setScraping] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [rows, setRows] = useState<Row[]>([]);
  const [failures, setFailures] = useState<{ url: string; error: string }[]>([]);
  const [preview, setPreview] = useState<SourceProduct | null>(null);

  const [storeId, setStoreId] = useState("");
  const [status, setStatus] = useState<PushStatus>("DRAFT");

  const stores = secrets?.stores ?? [];
  const pushable = stores.filter((store) => store.shopify.storeDomain && store.shopify.adminToken);
  const selected = rows.filter((row) => row.selected);

  const urls = useMemo(
    () =>
      input
        .split(/[\n,\s]+/)
        .map((url) => url.trim())
        .filter(Boolean),
    [input],
  );

  const scrape = async () => {
    if (!urls.length) return;
    setScraping(true);
    setError("");
    setNotice("");
    setFailures([]);

    try {
      const { results } = await postJson<{ results: ScrapeOutcome[] }>("/api/migrate/scrape", { urls });

      const ok = results.filter((r): r is Extract<ScrapeOutcome, { ok: true }> => r.ok);
      const bad = results.filter((r): r is Extract<ScrapeOutcome, { ok: false }> => !r.ok);

      // Re-scraping a link replaces its row rather than duplicating it.
      setRows((current) => {
        const next = new Map(current.map((row) => [row.key, row]));
        for (const { product } of ok) {
          next.set(product.sourceUrl, { key: product.sourceUrl, product, selected: true });
        }
        return [...next.values()];
      });
      setFailures(bad.map((r) => ({ url: r.url, error: r.error })));
      setNotice(`Scraped ${ok.length} of ${results.length} link(s).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setScraping(false);
    }
  };

  const push = async () => {
    if (!storeId) return setError("Pick a destination store.");
    if (!selected.length) return setError("Select at least one product.");

    setPushing(true);
    setError("");
    setNotice("");

    try {
      const { results } = await postJson<{ results: PushOutcome[] }>("/api/migrate/push", {
        storeId,
        status,
        products: selected.map((row) => row.product),
      });

      const byUrl = new Map(results.map((result) => [result.sourceUrl, result]));
      setRows((current) =>
        current.map((row) => (byUrl.has(row.key) ? { ...row, push: byUrl.get(row.key) } : row)),
      );

      const ok = results.filter((r) => r.ok).length;
      const destination = stores.find((s) => s.id === storeId)?.name || "the store";
      if (ok === results.length) setNotice(`Pushed ${ok} product(s) to ${destination} as ${status.toLowerCase()}.`);
      else setError(`${ok} of ${results.length} pushed — see the Result column.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPushing(false);
    }
  };

  const toggle = (key: string, on: boolean) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, selected: on } : row)));

  const toggleAll = (on: boolean) => setRows((current) => current.map((row) => ({ ...row, selected: on })));

  const clearAll = () => {
    setRows([]);
    setFailures([]);
    setNotice("");
    setError("");
  };

  if (!loaded) {
    return (
      <main className="mx-auto max-w-6xl px-5 py-10">
        {settingsError ? <Note tone="danger">{settingsError}</Note> : <Empty>Loading workspace…</Empty>}
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-5 py-8">
      <PageHeader
        eyebrow="Scraping Tool"
        title="Shopify / Shopline → Shopify"
        description="Paste live product links, review what came back, then push the ones you want into one of your stores."
        actions={
          <Link href="/settings?tab=stores" className="btn-ghost">
            ⚙ Stores
          </Link>
        }
      />

      {error && <Note tone="danger">{error}</Note>}
      {notice && <Note tone="ok">{notice}</Note>}

      {/* 1 — scrape */}
      <section className="card mb-6">
        <Step n={1} title="Live product links" />
        <textarea
          className="field min-h-28 resize-y font-mono text-xs"
          placeholder={"https://store.com/products/handle\nhttps://other.myshopline.com/products/handle\n… one per line"}
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button className="btn-primary" onClick={scrape} disabled={scraping || !urls.length}>
            {scraping ? (
              <>
                <Spinner /> Scraping {urls.length}…
              </>
            ) : (
              `Scrape ${urls.length || ""} link${urls.length === 1 ? "" : "s"}`.trim()
            )}
          </button>
          {rows.length > 0 && (
            <button className="btn-quiet" onClick={clearAll}>
              Clear results
            </button>
          )}
          <p className="text-xs text-muted">
            Shopify and Shopline storefronts. Nothing is saved — results live in this tab only.
          </p>
        </div>

        {failures.length > 0 && (
          <div className="note-danger mt-4 space-y-1 text-xs">
            {failures.map((failure) => (
              <p key={failure.url}>
                <span className="font-mono">{failure.url}</span> — {failure.error}
              </p>
            ))}
          </div>
        )}
      </section>

      {/* 2 — review */}
      <section className="card mb-6">
        <Step n={2} title={`Scraped products (${rows.length})`} />

        {!rows.length && <Empty>Paste some product links above to begin.</Empty>}

        {rows.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-surface-2 text-left text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={rows.every((row) => row.selected)}
                      onChange={(e) => toggleAll(e.target.checked)}
                      aria-label="Select all"
                    />
                  </th>
                  <th className="px-3 py-2 font-semibold">Product</th>
                  <th className="px-3 py-2 font-semibold">Source</th>
                  <th className="px-3 py-2 font-semibold">Variants</th>
                  <th className="px-3 py-2 font-semibold">Price</th>
                  <th className="px-3 py-2 font-semibold">Cur.</th>
                  <th className="px-3 py-2 font-semibold">Compare at</th>
                  <th className="px-3 py-2 font-semibold">Images</th>
                  <th className="px-3 py-2 font-semibold">Meta desc</th>
                  <th className="px-3 py-2 font-semibold">Result</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const { product } = row;
                  const comparable = product.variants.filter((v) => v.compareAtPrice).length;
                  return (
                    <tr key={row.key} className={i % 2 ? "bg-surface-2" : ""}>
                      <td className="px-3 py-2 align-top">
                        <input
                          type="checkbox"
                          checked={row.selected}
                          onChange={(e) => toggle(row.key, e.target.checked)}
                          aria-label={`Select ${product.title}`}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <button
                          className="flex cursor-pointer items-center gap-2.5 text-left"
                          onClick={() => setPreview(product)}
                        >
                          {product.images[0] && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={proxied(product.images[0])}
                              alt=""
                              className="h-10 w-10 shrink-0 rounded object-cover"
                            />
                          )}
                          <span className="min-w-0">
                            <span className="block max-w-xs truncate font-medium underline decoration-dotted">
                              {product.title}
                            </span>
                            <span className="block max-w-xs truncate font-mono text-[11px] text-muted">
                              {product.handle}
                            </span>
                          </span>
                        </button>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <span className="chip">{product.platform}</span>
                      </td>
                      <td className="px-3 py-2 align-top">{product.variants.length}</td>
                      <td className="px-3 py-2 align-top font-semibold">{priceRange(product)}</td>
                      <td className="px-3 py-2 align-top text-xs text-muted">{product.currency || "?"}</td>
                      <td className="px-3 py-2 align-top text-muted">
                        {comparable ? `${comparable}/${product.variants.length}` : "—"}
                      </td>
                      <td className="px-3 py-2 align-top">{product.images.length}</td>
                      <td className="px-3 py-2 align-top">
                        {product.metaDescription ? (
                          <span title={product.metaDescription}>✓</span>
                        ) : (
                          <span className="text-muted" title="No SEO meta description on the source">
                            —
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 align-top">
                        {!row.push && <span className="text-muted">—</span>}
                        {row.push?.ok && (
                          <a
                            className="font-medium text-brand underline"
                            href={row.push.adminUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Created
                          </a>
                        )}
                        {row.push && !row.push.ok && (
                          <span style={{ color: "var(--danger)" }} title={row.push.error}>
                            Failed
                          </span>
                        )}
                        {row.push?.warnings?.length ? (
                          <span className="block text-[11px] text-muted" title={row.push.warnings.join("\n")}>
                            {row.push.warnings.length} warning(s)
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {rows.some((row) => row.push && !row.push.ok) && (
          <div className="note-danger mt-4 space-y-1 text-xs">
            {rows
              .filter((row) => row.push && !row.push.ok)
              .map((row) => (
                <p key={row.key}>
                  <span className="font-semibold">{row.product.title}</span> — {row.push?.error}
                </p>
              ))}
          </div>
        )}
      </section>

      {/* 3 — push */}
      <section className="card">
        <Step n={3} title="Push to Shopify" />

        {!pushable.length ? (
          <Note tone="warn">
            No store has Shopify Admin API credentials yet.{" "}
            <Link href="/settings?tab=stores" className="underline">
              Add one under Settings → Store API Keys
            </Link>
            . The token needs the <code>write_products</code> scope.
          </Note>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-56">
              <span className="label">Destination store</span>
              <select className="field" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
                <option value="">Choose a store…</option>
                {pushable.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name || store.shopify.storeDomain}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <span className="label">Create as</span>
              <select
                className="field"
                value={status}
                onChange={(e) => setStatus(e.target.value as PushStatus)}
              >
                <option value="DRAFT">Draft — review before publishing</option>
                <option value="ACTIVE">Active — live immediately</option>
              </select>
            </div>

            <button
              className="btn-primary"
              onClick={push}
              disabled={pushing || !selected.length || !storeId}
            >
              {pushing ? (
                <>
                  <Spinner /> Pushing {selected.length}…
                </>
              ) : (
                `Push ${selected.length} product${selected.length === 1 ? "" : "s"}`
              )}
            </button>
          </div>
        )}

        <p className="hint mt-3">
          Description HTML, meta title and description, options, per-variant price, compare-at price, SKU, barcode
          and variant images all transfer. Images are handed to Shopify as source URLs, so it downloads them
          directly.
        </p>
      </section>

      {preview && <ProductModal product={preview} onClose={() => setPreview(null)} />}
    </main>
  );
}
