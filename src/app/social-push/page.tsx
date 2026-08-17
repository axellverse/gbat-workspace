"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FetchedProductModal from "@/components/FetchedProductModal";
import { Empty, Field, Note, PageHeader, Spinner, Step } from "@/components/ui";
import { getJson, postJson, useWorkspace } from "@/lib/client";
import { composeImage, PIN_SIZE, SOCIAL_SIZE } from "@/lib/compose";
import type { Channel, ChannelResult, Store } from "@/lib/secrets";
import { matchStore, storeLabel } from "@/lib/stores";
import { DEFAULT_STYLE_ID, getStyle, POST_STYLES, type PostStyleId } from "@/lib/styles";
import type { Board, PinContent, Product } from "@/lib/types";

type ImageMode = "product" | "compose" | "ai";
type CopyTab = Channel;

const EMPTY_CONTENT: PinContent = {
  title: "",
  description: "",
  altText: "",
  hashtags: [],
  imagePrompt: "",
  instagramCaption: "",
  facebookMessage: "",
};

const CHANNEL_LABEL: Record<Channel, string> = {
  pinterest: "Pinterest",
  instagram: "Instagram",
  facebook: "Facebook",
};

type PushState = { busy: boolean; result: ChannelResult | null };
const IDLE_PUSH: PushState = { busy: false, result: null };

export default function SocialPushPage() {
  const { secrets, save, reload, loaded, error: settingsError } = useWorkspace();

  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [backendUrl, setBackendUrl] = useState("");
  const [product, setProduct] = useState<Product | null>(null);
  const [loadingProduct, setLoadingProduct] = useState(false);

  const [preview, setPreview] = useState<{ product: Product; via: string } | null>(null);
  const [styleId, setStyleId] = useState<PostStyleId>(DEFAULT_STYLE_ID);
  const [brief, setBrief] = useState("");
  const [content, setContent] = useState<PinContent>(EMPTY_CONTENT);
  const [generating, setGenerating] = useState(false);
  const [copyTab, setCopyTab] = useState<CopyTab>("pinterest");

  const [imageMode, setImageMode] = useState<ImageMode>("compose");
  const [sourceIndex, setSourceIndex] = useState(0);
  const [headline, setHeadline] = useState("");
  const [cta, setCta] = useState("Shop now");
  const [composed, setComposed] = useState("");
  const [socialImage, setSocialImage] = useState("");
  const [aiImage, setAiImage] = useState("");
  const [busyImage, setBusyImage] = useState(false);

  const [boards, setBoards] = useState<Board[]>([]);
  const [loadingBoards, setLoadingBoards] = useState(false);
  const [boardId, setBoardId] = useState("");
  const [boardsError, setBoardsError] = useState("");
  const [pushes, setPushes] = useState<Record<Channel, PushState>>({
    pinterest: IDLE_PUSH,
    instagram: IDLE_PUSH,
    facebook: IDLE_PUSH,
  });

  const stores = useMemo(() => secrets?.stores ?? [], [secrets]);
  const history = secrets?.history.publishes ?? [];

  /**
   * The backend link names its own store, so resolution happens while typing —
   * the target accounts are visible before anything is fetched.
   */
  const matchedStore: Store | null = useMemo(
    () => (backendUrl.trim() ? matchStore(stores, backendUrl) : null),
    [stores, backendUrl],
  );
  const unmatched = backendUrl.trim().length > 8 && !matchedStore;

  const productImage = product?.images[sourceIndex] || product?.images[0] || "";

  const pinImage = useMemo(() => {
    if (imageMode === "ai") return aiImage;
    if (imageMode === "compose") return composed;
    return productImage;
  }, [imageMode, aiImage, composed, productImage]);

  const brandLabel = matchedStore?.brand.name || product?.vendor || "";
  const accent = matchedStore?.brand.accentColor || "#1d4ed8";
  const style = getStyle(styleId);

  const fullDescription = useMemo(() => {
    const tags = content.hashtags.map((h) => `#${h}`).join(" ");
    return [content.description, tags].filter(Boolean).join("\n\n").slice(0, 800);
  }, [content.description, content.hashtags]);

  // Instagram wants the hashtags in the caption, not in a separate field.
  const fullInstagramCaption = useMemo(() => {
    const tags = content.hashtags.map((h) => `#${h}`).join(" ");
    return [content.instagramCaption, tags].filter(Boolean).join("\n\n").slice(0, 2000);
  }, [content.instagramCaption, content.hashtags]);

  const run = useCallback(async (fn: () => Promise<void>, setBusy: (v: boolean) => void) => {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  /* --------------------------------------------------------- step 1 */

  const fetchProduct = () =>
    run(async () => {
      const { product: p, via, store } = await postJson<{
        product: Product;
        via: string;
        store: { id: string; name: string } | null;
      }>("/api/shopify/product", { url: backendUrl, storeId: matchedStore?.id });

      setProduct(p);
      setSourceIndex(0);
      setContent(EMPTY_CONTENT);
      setComposed("");
      setSocialImage("");
      setAiImage("");
      setPushes({ pinterest: IDLE_PUSH, instagram: IDLE_PUSH, facebook: IDLE_PUSH });
      setHeadline(p.title);

      // Show what came back before anything is generated from it.
      setPreview({ product: p, via });

      const where = store ? ` · matched to ${store.name}` : "";
      setNotice(`Loaded “${p.title}”${where}.`);
    }, setLoadingProduct);

  // A recognised store loads its own boards straight away, so step 3 is ready.
  const loadedBoardsFor = useRef("");
  useEffect(() => {
    const storeId = matchedStore?.id;
    if (!storeId || loadedBoardsFor.current === storeId) return;
    if (!matchedStore.social.pinterest.accessToken) return;

    loadedBoardsFor.current = storeId;
    setLoadingBoards(true);
    setBoardsError("");
    getJson<{ boards: Board[] }>(`/api/pinterest/boards?storeId=${encodeURIComponent(storeId)}`)
      .then(({ boards: b }) => {
        setBoards(b);
        setBoardId(matchedStore.social.pinterest.defaultBoardId || b[0]?.id || "");
      })
      .catch((err: unknown) => {
        // Preloading is a convenience, so this must not blow up the page — but
        // a silent empty dropdown is worse than saying why it is empty.
        setBoards([]);
        setBoardsError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoadingBoards(false));
  }, [matchedStore]);

  const reloadBoards = () =>
    run(async () => {
      if (!matchedStore) throw new Error("Paste a backend link so the workspace knows which store to ask.");
      setBoardsError("");
      const { boards: b } = await getJson<{ boards: Board[] }>(
        `/api/pinterest/boards?storeId=${encodeURIComponent(matchedStore.id)}`,
      );
      setBoards(b);
      if (!b.length) setNotice("That account has no boards yet — create one on Pinterest first.");
    }, setLoadingBoards);

  /* --------------------------------------------------------- step 2 */

  const composeOptions = useMemo(
    () => ({
      imageUrl: imageMode === "ai" && aiImage ? aiImage : productImage,
      headline: headline || product?.title || "",
      brand: brandLabel,
      price: product?.price || "",
      cta,
      accent,
      overlay: true,
      treatment: style.image,
    }),
    [imageMode, aiImage, productImage, headline, product?.title, product?.price, brandLabel, cta, accent, style],
  );

  /**
   * One click covers every channel: the copy for all three networks in the
   * chosen style, then both creatives at the sizes those networks accept.
   */
  const generate = () =>
    run(async () => {
      if (!product) throw new Error("Fetch a product first.");

      const { content: c } = await postJson<{ content: PinContent }>("/api/generate/text", {
        product,
        brief,
        style: styleId,
      });
      setContent(c);
      setHeadline(c.title);

      const nextCta = style.defaultCta || cta;
      setCta(nextCta);

      if (composeOptions.imageUrl) {
        const base = { ...composeOptions, headline: c.title, cta: nextCta };
        // Render both now so Push is ready the moment this finishes.
        const [pin, social] = await Promise.all([
          composeImage(base, PIN_SIZE),
          composeImage(base, SOCIAL_SIZE),
        ]);
        setComposed(pin);
        setSocialImage(social);
        setImageMode("compose");
      }
      setNotice(`Generated ${style.label.toLowerCase()} content and creatives for all three platforms.`);
    }, setGenerating);

  const generateAiImage = () =>
    run(async () => {
      const prompt = content.imagePrompt || `A styled lifestyle scene featuring: ${product?.title || headline}`;
      const { dataUrl } = await postJson<{ dataUrl: string }>("/api/generate/image", { prompt });
      setAiImage(dataUrl);
      setImageMode("ai");
    }, setBusyImage);

  const recompose = () =>
    run(async () => {
      if (!composeOptions.imageUrl) throw new Error("There is no image to compose from yet.");
      setComposed(await composeImage(composeOptions, PIN_SIZE));
      setImageMode("compose");
    }, setBusyImage);

  // Keep the pin in sync with the headline/CTA fields once one exists.
  const hasComposed = Boolean(composed);
  useEffect(() => {
    if (!hasComposed || imageMode !== "compose" || !composeOptions.imageUrl) return;
    const timer = setTimeout(() => {
      composeImage(composeOptions, PIN_SIZE)
        .then(setComposed)
        .catch(() => undefined);
    }, 400);
    return () => clearTimeout(timer);
  }, [hasComposed, imageMode, composeOptions]);

  /**
   * Instagram rejects anything taller than 4:5, so the same design is exported
   * again at 1080x1350 in the background — Push never waits for it.
   */
  const socialSource = imageMode === "ai" ? aiImage : productImage;
  const socialOverlay = imageMode === "compose";
  useEffect(() => {
    if (!socialSource) {
      setSocialImage("");
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      composeImage({ ...composeOptions, imageUrl: socialSource, overlay: socialOverlay }, SOCIAL_SIZE)
        .then((image) => !cancelled && setSocialImage(image))
        .catch(() => undefined);
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [socialSource, socialOverlay, composeOptions]);

  /* --------------------------------------------------------- step 3 */

  const push = async (channels: Channel[]) => {
    if (!matchedStore) return setError("No store is selected — paste a backend link first.");
    if (!product) return setError("Fetch a product first.");

    setError("");
    setNotice("");
    setPushes((current) => {
      const next = { ...current };
      for (const channel of channels) next[channel] = { busy: true, result: null };
      return next;
    });

    try {
      const { results } = await postJson<{ results: ChannelResult[] }>("/api/publish", {
        storeId: matchedStore.id,
        channels,
        link: product.sourceUrl,
        pinImage,
        socialImage,
        title: content.title || product.title,
        thumbnail: productImage,
        pinterest: {
          boardId,
          title: content.title || product.title,
          description: fullDescription,
          altText: content.altText,
        },
        instagram: { caption: fullInstagramCaption },
        facebook: { message: content.facebookMessage || content.description },
      });

      setPushes((current) => {
        const next = { ...current };
        for (const result of results) next[result.channel] = { busy: false, result };
        return next;
      });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPushes((current) => {
        const next = { ...current };
        for (const channel of channels) next[channel] = IDLE_PUSH;
        return next;
      });
    }
  };

  const clearHistory = () =>
    run(async () => {
      await postJson("/api/settings/history", { kind: "publishes" });
      await reload();
    }, setLoadingProduct);

  /* ------------------------------------------------------------ render */

  if (!loaded) {
    return (
      <main className="mx-auto max-w-6xl px-5 py-10">
        {settingsError ? <Note tone="danger">{settingsError}</Note> : <Empty>Loading workspace…</Empty>}
      </main>
    );
  }

  const anyBusy = Object.values(pushes).some((p) => p.busy);
  const readyToPush = Boolean(product && matchedStore && (pinImage || socialImage));

  return (
    <main className="mx-auto max-w-6xl px-5 py-8">
      <PageHeader
        eyebrow="Social Push"
        title="One product, three networks"
        description="Paste a Shopify backend link. The store is recognised automatically and its own social accounts are used."
        actions={
          <Link href="/settings" className="btn-ghost">
            ⚙ Settings
            {!stores.length && <span className="tag ml-1">add a store</span>}
          </Link>
        }
      />

      {error && <Note tone="danger">{error}</Note>}
      {notice && <Note tone="ok">{notice}</Note>}

      <div className="grid gap-6 lg:grid-cols-[1fr_390px]">
        <div className="space-y-6">
          {/* 1 — backend URL */}
          <section className="card">
            <Step n={1} title="Backend product link" />
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                className="field"
                placeholder="https://admin.shopify.com/store/your-store/products/1234567890"
                value={backendUrl}
                onChange={(e) => setBackendUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && backendUrl && fetchProduct()}
              />
              <button
                className="btn-primary shrink-0"
                onClick={fetchProduct}
                disabled={loadingProduct || !backendUrl.trim()}
              >
                {loadingProduct ? (
                  <>
                    <Spinner /> Fetching…
                  </>
                ) : (
                  "Fetch details"
                )}
              </button>
            </div>

            {matchedStore && (
              <div className="mt-3 rounded-xl border border-brand bg-brand-soft/40 p-3">
                <p className="text-sm">
                  <span className="font-semibold">Store found:</span>{" "}
                  <span className="font-bold text-brand">{storeLabel(matchedStore)}</span>
                  {matchedStore.domain && <span className="ml-2 text-xs text-muted">{matchedStore.domain}</span>}
                </p>
                <p className="mt-1.5 text-xs text-muted">Will push to this store&apos;s own accounts:</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <span className="chip">
                    {matchedStore.social.pinterest.accessToken ? "✓ Pinterest" : "— Pinterest not connected"}
                  </span>
                  <span className="chip">
                    {matchedStore.social.meta.igUserId
                      ? `✓ Instagram @${matchedStore.social.meta.igUsername || matchedStore.social.meta.igUserId}`
                      : "— Instagram not connected"}
                  </span>
                  <span className="chip">
                    {matchedStore.social.meta.pageId
                      ? `✓ Facebook ${matchedStore.social.meta.pageName || matchedStore.social.meta.pageId}`
                      : "— Facebook not connected"}
                  </span>
                </div>
              </div>
            )}

            {unmatched && (
              <p className="note-warn mt-3 text-sm">
                No store matches this link.{" "}
                <Link href="/settings?tab=stores" className="underline">
                  Add it under Settings → Stores
                </Link>{" "}
                so its social accounts can be mapped.
              </p>
            )}

            {product && (
              <div className="mt-4 flex gap-4 rounded-xl bg-surface-2 p-3">
                {product.images[0] && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={product.images[0]} alt="" className="h-24 w-24 shrink-0 rounded-lg object-cover" />
                )}
                <div className="min-w-0">
                  <p className="truncate font-semibold">{product.title}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {product.price && <span className="chip">{product.price}</span>}
                    {product.vendor && <span className="chip">{product.vendor}</span>}
                    <span className="chip">{product.available ? "In stock" : "Sold out"}</span>
                  </div>
                  <p className="mt-2 line-clamp-2 text-xs text-muted">{product.description}</p>
                  {product.metaDescription && (
                    <p className="mt-1.5 line-clamp-2 text-xs text-muted">
                      <span className="font-semibold">Meta description:</span> {product.metaDescription}
                    </p>
                  )}
                  <p className="mt-1.5 truncate text-xs text-muted">
                    <span className="font-semibold">Live link:</span> {product.sourceUrl}
                  </p>
                </div>
              </div>
            )}
          </section>

          {/* 2 — generate */}
          <section className="card">
            <Step n={2} title="Choose a style, then generate" />

            <div className="mb-3 grid gap-3 sm:grid-cols-[minmax(0,240px)_1fr]">
              <Field label="Post style">
                <select
                  className="field"
                  value={styleId}
                  onChange={(e) => setStyleId(e.target.value as PostStyleId)}
                >
                  {POST_STYLES.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Optional brief">
                <input
                  className="field"
                  placeholder="Angle, audience, season, a keyword to hit…"
                  value={brief}
                  onChange={(e) => setBrief(e.target.value)}
                />
              </Field>
            </div>

            <p className="hint mb-4">{style.blurb}</p>

            <button
              className="btn-primary mb-5 w-full py-3"
              onClick={generate}
              disabled={generating || !product}
            >
              {generating ? (
                <>
                  <Spinner /> Generating for all platforms…
                </>
              ) : (
                "Generate copy + creative for all platforms"
              )}
            </button>

            <div className="mb-4 flex flex-wrap gap-2">
              {(Object.keys(CHANNEL_LABEL) as CopyTab[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setCopyTab(tab)}
                  className={copyTab === tab ? "btn bg-brand text-brand-ink" : "btn-ghost"}
                  aria-pressed={copyTab === tab}
                >
                  {CHANNEL_LABEL[tab]}
                </button>
              ))}
            </div>

            {copyTab === "pinterest" && (
              <div className="space-y-3">
                <Field label={`Pin title · ${content.title.length}/100`}>
                  <input
                    className="field"
                    maxLength={100}
                    value={content.title}
                    onChange={(e) => setContent({ ...content, title: e.target.value })}
                  />
                </Field>
                <Field label={`Pin description · ${content.description.length}`}>
                  <textarea
                    className="field min-h-28 resize-y"
                    value={content.description}
                    onChange={(e) => setContent({ ...content, description: e.target.value })}
                  />
                </Field>
                <Field label="Alt text">
                  <input
                    className="field"
                    maxLength={500}
                    value={content.altText}
                    onChange={(e) => setContent({ ...content, altText: e.target.value })}
                  />
                </Field>
              </div>
            )}

            {copyTab === "instagram" && (
              <Field
                label={`Caption · ${fullInstagramCaption.length}/2200`}
                hint="The first line is all anyone sees before “more”. Hashtags are appended automatically."
              >
                <textarea
                  className="field min-h-40 resize-y"
                  value={content.instagramCaption}
                  onChange={(e) => setContent({ ...content, instagramCaption: e.target.value })}
                />
              </Field>
            )}

            {copyTab === "facebook" && (
              <Field label={`Message · ${content.facebookMessage.length}`}>
                <textarea
                  className="field min-h-40 resize-y"
                  value={content.facebookMessage}
                  onChange={(e) => setContent({ ...content, facebookMessage: e.target.value })}
                />
              </Field>
            )}

            <div className="mt-3">
              <Field label="Hashtags (comma separated · Pinterest + Instagram)">
                <input
                  className="field"
                  value={content.hashtags.join(", ")}
                  onChange={(e) =>
                    setContent({
                      ...content,
                      hashtags: e.target.value
                        .split(",")
                        .map((t) => t.trim().replace(/^#/, ""))
                        .filter(Boolean),
                    })
                  }
                />
              </Field>
            </div>

            <div className="mt-5 border-t border-line pt-4">
              <div className="mb-3 flex flex-wrap gap-2">
                <ModeButton active={imageMode === "product"} onClick={() => setImageMode("product")} disabled={!product}>
                  Product photo
                </ModeButton>
                <ModeButton active={imageMode === "compose"} onClick={() => setImageMode("compose")} disabled={!product}>
                  Branded
                </ModeButton>
                <ModeButton active={imageMode === "ai"} onClick={() => setImageMode("ai")} disabled={!aiImage}>
                  AI image
                </ModeButton>
              </div>

              {product && product.images.length > 1 && (
                <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
                  {product.images.map((src, i) => (
                    <button
                      key={src}
                      onClick={() => setSourceIndex(i)}
                      className={`h-16 w-16 shrink-0 overflow-hidden rounded-lg border-2 ${
                        i === sourceIndex ? "border-brand" : "border-transparent opacity-60"
                      }`}
                      aria-label={`Use image ${i + 1}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src} alt="" className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Headline on image">
                  <input className="field" value={headline} onChange={(e) => setHeadline(e.target.value)} />
                </Field>
                <Field label="Call to action">
                  <input className="field" value={cta} onChange={(e) => setCta(e.target.value)} />
                </Field>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button className="btn-ghost" onClick={recompose} disabled={busyImage || !product}>
                  {busyImage ? (
                    <>
                      <Spinner /> Working…
                    </>
                  ) : (
                    "Redraw image"
                  )}
                </button>
                <button className="btn-ghost" onClick={generateAiImage} disabled={busyImage || !product}>
                  Generate with AI
                </button>
              </div>
            </div>
          </section>

          {/* 3 — push */}
          <section className="card">
            <Step n={3} title="Push to platforms" />

            <div className="space-y-3">
              <PushRow
                channel="pinterest"
                state={pushes.pinterest}
                disabled={!readyToPush || !boardId}
                onPush={() => push(["pinterest"])}
                status={
                  boardsError
                    ? boardsError
                    : matchedStore?.social.pinterest.accessToken
                      ? boards.length
                        ? `${boards.length} board${boards.length === 1 ? "" : "s"} available`
                        : "No boards loaded yet"
                      : "No Pinterest token for this store"
                }
              >
                <div className="flex flex-col gap-2 sm:flex-row">
                  <select className="field" value={boardId} onChange={(e) => setBoardId(e.target.value)}>
                    <option value="">{boards.length ? "Choose a board…" : "No boards loaded"}</option>
                    {boards.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                        {b.privacy && b.privacy !== "PUBLIC" ? ` (${b.privacy.toLowerCase()})` : ""}
                      </option>
                    ))}
                  </select>
                  <button className="btn-ghost shrink-0" onClick={reloadBoards} disabled={loadingBoards || !matchedStore}>
                    {loadingBoards ? (
                      <>
                        <Spinner /> Loading…
                      </>
                    ) : (
                      "Reload boards"
                    )}
                  </button>
                </div>
              </PushRow>

              <PushRow
                channel="facebook"
                state={pushes.facebook}
                disabled={!readyToPush}
                onPush={() => push(["facebook"])}
                status={
                  matchedStore?.social.meta.pageId
                    ? `Posting to ${matchedStore.social.meta.pageName || matchedStore.social.meta.pageId}`
                    : "No Facebook Page connected for this store"
                }
              />

              <PushRow
                channel="instagram"
                state={pushes.instagram}
                disabled={!readyToPush}
                onPush={() => push(["instagram"])}
                status={
                  matchedStore?.social.meta.igUserId
                    ? `Posting as @${matchedStore.social.meta.igUsername || matchedStore.social.meta.igUserId}`
                    : "No Instagram account connected for this store"
                }
              />
            </div>

            <p className="mt-4 text-xs text-muted">
              Every caption ends with <span className="font-semibold">Shop Now: {product?.sourceUrl || "—"}</span>
            </p>

            <button
              className="btn-ghost mt-3 w-full py-3"
              onClick={() => push(["pinterest", "facebook", "instagram"])}
              disabled={anyBusy || !readyToPush}
            >
              {anyBusy ? (
                <>
                  <Spinner /> Pushing…
                </>
              ) : (
                "Push all three"
              )}
            </button>
          </section>
        </div>

        {/* previews + history */}
        <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
          <section className="card">
            <h3 className="mb-3 text-sm font-bold">Pinterest · 2:3</h3>
            <div className="overflow-hidden rounded-xl bg-surface-2">
              {pinImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={pinImage} alt={content.altText} className="w-full" />
              ) : (
                <div className="flex aspect-2/3 items-center justify-center text-sm text-muted">No image yet</div>
              )}
            </div>

            <h3 className="mb-3 mt-5 text-sm font-bold">Instagram &amp; Facebook · 4:5</h3>
            <div className="overflow-hidden rounded-xl bg-surface-2">
              {socialImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={socialImage} alt={content.altText} className="w-full" />
              ) : (
                <div className="flex aspect-4/5 items-center justify-center text-sm text-muted">No image yet</div>
              )}
            </div>
          </section>

          {history.length > 0 && (
            <section className="card">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-bold">Pushed ({history.length})</h3>
                <button className="btn-quiet" onClick={clearHistory}>
                  Clear
                </button>
              </div>
              <ul className="space-y-3 text-sm">
                {history.slice(0, 15).map((entry) => (
                  <li key={`${entry.createdAt}-${entry.productUrl}`}>
                    <p className="truncate font-medium">{entry.title}</p>
                    <p className="text-xs text-muted">{entry.storeName}</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {entry.results.map((result) =>
                        result.ok && result.url ? (
                          <a
                            key={result.channel}
                            className="chip hover:border-brand"
                            href={result.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            ✓ {CHANNEL_LABEL[result.channel]}
                          </a>
                        ) : (
                          <span
                            key={result.channel}
                            className="chip"
                            style={result.ok ? undefined : { color: "var(--danger)" }}
                            title={result.error}
                          >
                            {result.ok ? "✓" : "✕"} {CHANNEL_LABEL[result.channel]}
                          </span>
                        ),
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted">{new Date(entry.createdAt).toLocaleString()}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>

      {preview && (
        <FetchedProductModal
          product={preview.product}
          store={matchedStore}
          via={preview.via}
          onClose={() => setPreview(null)}
        />
      )}
    </main>
  );
}

function PushRow({
  channel,
  state,
  status,
  disabled,
  onPush,
  children,
}: {
  channel: Channel;
  state: PushState;
  status: string;
  disabled: boolean;
  onPush: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-line p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{CHANNEL_LABEL[channel]}</p>
          <p className="text-xs text-muted">{status}</p>
        </div>
        <button className="btn-primary shrink-0" onClick={onPush} disabled={disabled || state.busy}>
          {state.busy ? (
            <>
              <Spinner /> Pushing…
            </>
          ) : (
            `Push to ${CHANNEL_LABEL[channel]}`
          )}
        </button>
      </div>

      {children && <div className="mt-3">{children}</div>}

      {state.result && (
        <p className={state.result.ok ? "note-ok mt-3 text-xs" : "note-danger mt-3 text-xs"}>
          {state.result.ok ? (
            state.result.url ? (
              <a className="underline" href={state.result.url} target="_blank" rel="noreferrer">
                {state.result.url}
              </a>
            ) : (
              `Published (${state.result.id})`
            )
          ) : (
            state.result.error
          )}
        </p>
      )}
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={active ? "btn bg-brand text-brand-ink" : "btn-ghost"}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}
