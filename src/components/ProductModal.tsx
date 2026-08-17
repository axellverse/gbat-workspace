"use client";

import { useEffect, useState } from "react";
import type { SourceProduct } from "@/lib/migrate/types";

/** Full preview of one scraped product, exactly as it will be transferred. */

function proxied(src: string) {
  return src.startsWith("data:") ? src : `/api/proxy-image?url=${encodeURIComponent(src)}`;
}

export default function ProductModal({
  product,
  onClose,
}: {
  product: SourceProduct;
  onClose: () => void;
}) {
  const [active, setActive] = useState(0);
  const [showRawHtml, setShowRawHtml] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const hero = product.images[active] || product.images[0];

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-8"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={product.title}
    >
      <div
        className="w-full max-w-4xl rounded-2xl border border-line bg-surface p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-widest text-brand">{product.platform}</p>
            <h2 className="text-lg font-bold leading-snug">{product.title}</h2>
            <a
              className="mt-1 block truncate text-xs text-muted underline"
              href={product.sourceUrl}
              target="_blank"
              rel="noreferrer"
            >
              {product.sourceUrl}
            </a>
          </div>
          <button className="btn-ghost shrink-0" onClick={onClose}>
            Close
          </button>
        </div>

        {product.notes.length > 0 && (
          <div className="note-warn mb-5 text-sm">
            {product.notes.map((note) => (
              <p key={note}>{note}</p>
            ))}
          </div>
        )}

        <div className="grid gap-6 md:grid-cols-[minmax(0,340px)_1fr]">
          <div>
            <div className="overflow-hidden rounded-xl border border-line bg-surface-2">
              {hero ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={proxied(hero)} alt={product.title} className="mx-auto max-h-80 w-full object-contain" />
              ) : (
                <div className="flex h-56 items-center justify-center text-sm text-muted">No images</div>
              )}
            </div>
            {product.images.length > 1 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {product.images.map((src, i) => (
                  <button
                    key={src}
                    onClick={() => setActive(i)}
                    className={`h-14 w-14 overflow-hidden rounded-lg border-2 ${
                      i === active ? "border-brand" : "border-line opacity-70 hover:opacity-100"
                    }`}
                    aria-label={`Image ${i + 1}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={proxied(src)} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
            <p className="hint">{product.images.length} image(s) will transfer.</p>
          </div>

          <div className="min-w-0 space-y-4">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
              <Row label="Handle" value={product.handle} mono />
              <Row label="Currency" value={product.currency || "unknown"} />
              <Row label="Vendor" value={product.vendor || "—"} />
              <Row label="Type" value={product.productType || "—"} />
              <Row label="Tags" value={product.tags.length ? product.tags.join(", ") : "—"} />
              <Row label="Meta title" value={product.metaTitle || "—"} />
              <Row label="Meta description" value={product.metaDescription || "— none on the source —"} />
            </dl>

            {product.options.length > 0 && (
              <div>
                <span className="label">Options</span>
                <div className="space-y-1.5">
                  {product.options.map((option) => (
                    <p key={option.name} className="text-sm">
                      <span className="font-semibold">{option.name}:</span>{" "}
                      <span className="text-muted">{option.values.join(", ")}</span>
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* variants */}
        <section className="mt-6">
          <h3 className="mb-2 text-sm font-bold">Variants ({product.variants.length})</h3>
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-surface-2 text-left text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-3 py-2 font-semibold">Image</th>
                  <th className="px-3 py-2 font-semibold">Variant</th>
                  <th className="px-3 py-2 font-semibold">SKU</th>
                  <th className="px-3 py-2 font-semibold">Price</th>
                  <th className="px-3 py-2 font-semibold">Compare at</th>
                  <th className="px-3 py-2 font-semibold">Stock</th>
                </tr>
              </thead>
              <tbody>
                {product.variants.map((variant, i) => (
                  <tr key={`${variant.sku}-${i}`} className={i % 2 ? "bg-surface-2" : ""}>
                    <td className="px-3 py-2">
                      {variant.imageSrc ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={proxied(variant.imageSrc)}
                          alt=""
                          className="h-10 w-10 rounded object-cover"
                          title="This variant carries its own image"
                        />
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">{variant.optionValues.join(" / ") || variant.title || "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs text-muted">{variant.sku || "—"}</td>
                    <td className="px-3 py-2 font-semibold">{variant.price || "—"}</td>
                    <td className="px-3 py-2 text-muted">
                      {variant.compareAtPrice ? <s>{variant.compareAtPrice}</s> : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs">{variant.available ? "In stock" : "Sold out"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* description */}
        <section className="mt-6">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-bold">Description (HTML)</h3>
            <button className="btn-quiet" onClick={() => setShowRawHtml((v) => !v)}>
              {showRawHtml ? "Show rendered" : "Show raw HTML"}
            </button>
          </div>
          {product.descriptionHtml ? (
            showRawHtml ? (
              <pre className="max-h-72 overflow-auto rounded-xl bg-surface-2 p-4 text-xs leading-relaxed">
                {product.descriptionHtml}
              </pre>
            ) : (
              <DescriptionFrame html={product.descriptionHtml} />
            )
          ) : (
            <p className="text-sm text-muted">The source product has no description.</p>
          )}
        </section>
      </div>
    </div>
  );
}

/**
 * Renders a scraped description inside a fully sandboxed iframe.
 *
 * This HTML comes from someone else's storefront. Injecting it into our own
 * DOM would let a hostile product description run script on this origin and
 * read every API key out of /api/settings. A `sandbox` iframe with neither
 * `allow-scripts` nor `allow-same-origin` cannot execute anything or reach
 * back into the app, so the markup can be shown safely and still transferred
 * to Shopify byte-for-byte.
 */
function DescriptionFrame({ html }: { html: string }) {
  const document = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src * data:; style-src 'unsafe-inline'">
<base target="_blank">
<style>
  body { margin:0; padding:12px; font:14px/1.6 system-ui,-apple-system,'Segoe UI',sans-serif; color:#0b1220; background:#fff; }
  img, video, table { max-width:100%; height:auto; }
  a { color:#1d4ed8; }
</style></head><body>${html}</body></html>`;

  return (
    <iframe
      title="Product description"
      sandbox=""
      srcDoc={document}
      className="h-72 w-full rounded-xl border border-line bg-white"
    />
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <dt className="whitespace-nowrap font-semibold text-muted">{label}</dt>
      <dd className={`min-w-0 break-words ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
    </>
  );
}
