"use client";

import { useEffect, useState } from "react";
import type { Store } from "@/lib/secrets";
import { storeLabel } from "@/lib/stores";
import type { Product } from "@/lib/types";

/**
 * What came back from the backend link, shown before anything is generated.
 *
 * The point is to catch a wrong product or a thin description now, rather than
 * after three networks have been written and an image rendered.
 */

function proxied(src: string) {
  return src.startsWith("data:") ? src : `/api/proxy-image?url=${encodeURIComponent(src)}`;
}

export default function FetchedProductModal({
  product,
  store,
  via,
  onClose,
}: {
  product: Product;
  store: Store | null;
  via: string;
  onClose: () => void;
}) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const hero = product.images[active] || product.images[0];

  const targets = [
    store?.social.pinterest.accessToken ? "Pinterest" : null,
    store?.social.meta.igUserId ? `Instagram @${store.social.meta.igUsername || store.social.meta.igUserId}` : null,
    store?.social.meta.pageId ? `Facebook ${store.social.meta.pageName || store.social.meta.pageId}` : null,
  ].filter(Boolean) as string[];

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-8"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Fetched: ${product.title}`}
    >
      <div
        className="w-full max-w-3xl rounded-2xl border border-line bg-surface p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-widest text-brand">
              Fetched from {via === "admin" ? "the Shopify backend" : "the public storefront"}
            </p>
            <h2 className="text-lg font-bold leading-snug">{product.title}</h2>
          </div>
          <button className="btn-ghost shrink-0" onClick={onClose}>
            Close
          </button>
        </div>

        {/* which store, and where it will go */}
        <div className={`mb-5 rounded-xl border p-3 ${store ? "border-brand bg-brand-soft/40" : "border-line"}`}>
          {store ? (
            <>
              <p className="text-sm font-semibold">
                Store identified: <span className="text-brand">{storeLabel(store)}</span>
              </p>
              <p className="mt-1 text-xs text-muted">
                {targets.length
                  ? `Will push to ${targets.join(" · ")}`
                  : "No social accounts connected for this store yet — connect them in Settings."}
              </p>
            </>
          ) : (
            <p className="text-sm">
              No store matched this link, so no social accounts could be selected.
            </p>
          )}
        </div>

        <div className="grid gap-6 sm:grid-cols-[minmax(0,260px)_1fr]">
          <div>
            <div className="overflow-hidden rounded-xl border border-line bg-surface-2">
              {hero ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={proxied(hero)} alt={product.title} className="mx-auto max-h-64 w-full object-contain" />
              ) : (
                <div className="flex h-48 items-center justify-center text-sm text-muted">No images</div>
              )}
            </div>
            {product.images.length > 1 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {product.images.map((src, i) => (
                  <button
                    key={src}
                    onClick={() => setActive(i)}
                    className={`h-12 w-12 overflow-hidden rounded-lg border-2 ${
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
            <p className="hint">{product.images.length} image(s) available</p>
          </div>

          <div className="min-w-0 space-y-4">
            <div className="flex flex-wrap gap-1.5">
              {product.price && <span className="chip">{product.price}</span>}
              {product.vendor && <span className="chip">{product.vendor}</span>}
              {product.productType && <span className="chip">{product.productType}</span>}
              <span className="chip">{product.available ? "In stock" : "Sold out"}</span>
            </div>

            <div>
              <span className="label">Live link (the Shop Now target)</span>
              <p className="break-all font-mono text-xs text-muted">{product.sourceUrl}</p>
            </div>

            <div>
              <span className="label">Meta description</span>
              <p className="text-sm leading-relaxed text-muted">
                {product.metaDescription || "— none set on this product —"}
              </p>
            </div>

            <div>
              <span className="label">Description</span>
              <p className="max-h-40 overflow-auto whitespace-pre-wrap text-sm leading-relaxed text-muted">
                {product.description || "— none —"}
              </p>
            </div>

            {product.tags.length > 0 && (
              <div>
                <span className="label">Tags</span>
                <p className="text-xs text-muted">{product.tags.slice(0, 20).join(", ")}</p>
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button className="btn-primary" onClick={onClose}>
            Looks right — continue
          </button>
        </div>
      </div>
    </div>
  );
}
