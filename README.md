# GBAT's Internal Workspace

Internal tooling for GBAT, by Axell Group Of Companies. One Next.js application, two tools, one
credential store.

| Route          | Tool          | What it does                                                                     |
| -------------- | ------------- | -------------------------------------------------------------------------------- |
| `/`            | Home          | Landing page with a card per tool                                                |
| `/social-push` | Social Push   | Shopify backend link → copy + image → Pinterest, Instagram and Facebook          |
| `/scraper`     | Scraping Tool | Shopify/Shopline live links → review → push products into your Shopify store     |
| `/settings`    | Settings      | AI keys, per-store social accounts and store credentials, written to `Secret.json` |

**Multi-store.** Every credential except the AI and Zyte keys belongs to a store. Pasting a backend
link identifies the store from its handle and selects that store's Pinterest board, Facebook Page
and Instagram account automatically — there is no account picker to get wrong.

Both tools are built from the same component classes in `src/app/globals.css`, so they look and
behave the same.

## Running it

```bash
npm install
npm run dev
```

Then open <http://localhost:3000> and fill in the keys under **Settings**.

No headless browser is needed — both tools read published JSON endpoints directly.

The whole workspace sits behind one shared password. The default is **`techkeo`** — change it under
**Settings → API Keys → Workspace password**, which also signs every other browser out.

The dev server binds to **127.0.0.1**. In production the container binds `0.0.0.0` on the port the
platform assigns — the password is the boundary there, so read "Before you expose it" below.

## Deploying it

Two ways, depending on whether the host gives you a writable disk. A `Dockerfile` is included and
`next.config.mjs` emits a standalone server.

### A — No persistent disk (`GBAT_SECRETS`)

Works anywhere, including hosts that cannot store a file at all. Set the workspace up locally where
the UI makes it easy, then move it in one variable:

1. Locally: add your keys, stores and accounts under **Settings**.
2. **Settings → API Keys → Export configuration → Generate**, then Copy.
3. On the host, set `GBAT_SECRETS` to that value and deploy.

Everything works — both tools, all keys, every store. The one trade is that **Settings is read-only**
there, because a process cannot rewrite its own environment: to change anything, edit the variable
and redeploy. Publish history and transfer counters do not accumulate either, for the same reason.

The value contains every API key and the workspace password. Treat it as a secret: paste it only
into the host's secret storage, never into git. Base64 is accepted too, if a panel mangles long
values.

### B — A persistent disk (`GBAT_DATA_DIR`)

On Railway, Render, Fly.io or a VPS, mount a volume and point `GBAT_DATA_DIR` at it. Settings stays
fully editable and history accumulates, exactly as it does locally.

If both are set, **the file wins** — `GBAT_SECRETS` is only the fallback.

| Setting | Value |
| --- | --- |
| Build | `npm run build` |
| Start | `node server.js` (or `npm start`) |
| Config | `GBAT_SECRETS` (option A) **or** a volume plus `GBAT_DATA_DIR` (option B) |
| `GBAT_PASSWORD` | the password for a fresh instance when neither of the above carries one |
| Port | supplied by the platform via `PORT`; the container binds `0.0.0.0` |

After the first deploy, open **`/api/health`**. It needs no sign-in and names the source in use:

```json
{ "ok": true, "configSource": "env",  "settingsEditable": false }   // option A
{ "ok": true, "configSource": "file", "settingsEditable": true  }   // option B
```

If `ok` is `false` the volume is not mounted, and **any key entered will be lost on the next restart**.
The app still boots in that state rather than returning a blank 500 — it signs in, shows a red banner
on the home page, and refuses saves with the reason — so the problem is always diagnosable.
The home page shows the same warning once you are signed in. The Docker `HEALTHCHECK` uses this
endpoint, so a misconfigured container never reports healthy.

### Vercel and Netlify

Their filesystems are read-only, so **option B cannot work** there — there is nowhere for
`Secret.json` to live. **Option A works fine**: with `GBAT_SECRETS` set there is nothing to write,
and `/api/health` reports `configSource: "env"` and a healthy 200.

### Before you expose it

- **Set `GBAT_PASSWORD`.** The default is in this repo.
- **Keep `Secret.json` out of git.** It already is; the `.dockerignore` also keeps it out of the image.
- One shared password is the whole access model. There are no accounts and no audit trail, so treat
  the URL as a secret and prefer a private network or an authenticating proxy for anything sensitive.

## Secret.json — the only data store

There is no database. `Secret.json` at the project root holds everything:

```jsonc
{
  "organisation": { "name": "Axell Group Of Companies", "workspace": "GBAT's Internal Workspace" },

  // Global — Settings tab 1. Up to three keys each, tried in order.
  "apiKeys": {
    "yunwu":  { "credentials": [{ "id": "…", "label": "Primary", "apiKey": "", "baseUrl": "https://yunwu.ai/v1" }] },
    "openai": { "credentials": [] },   // tried after every Yunwu key
    "zyte":   { "credentials": [] },   // fallback fetch for blocked storefronts
    "ttapi":  { "credentials": [] }    // reserved
  },

  // One entry per store — Settings tabs 2 and 3
  "stores": [{
    "id": "st_gbat-store",            // minted from the name on first save, then stable
    "name": "GBAT Store",
    "backendRef": "gbat-store",       // the handle in admin.shopify.com/store/<handle>
    "domain": "gbatstore.com",        // the live domain behind every "Shop Now" link
    "shopify": { "storeDomain": "gbat-store.myshopify.com", "adminToken": "", "apiVersion": "2025-10" },
    "brand":   { "name": "GBAT", "accentColor": "#1d4ed8" },
    "social": {
      "pinterest": { "accessToken": "", "environment": "production", "defaultBoardId": "" },
      // pageId/pageAccessToken/igUserId are filled in by "Connect / refresh accounts"
      "meta": { "accessToken": "", "apiVersion": "v25.0", "pageId": "", "pageName": "",
                "pageAccessToken": "", "igUserId": "", "igUsername": "" }
    }
  }],

  "preferences": { /* text model, image model, copy tone */ },
  "history": {
    "publishes": [],   // one record per Social Push run, with per-channel results
    "transfers": {}    // Product Transfer counters only — never product data
  }
}
```

- The file is created from the defaults on first run, written **0600**, and is **git-ignored**.
  `Secret.example.json` is the copy that ships.
- Its location is `GBAT_DATA_DIR` when set, otherwise the project root — that env var is what points
  a deployed instance at a persistent volume.
- A file in the old single-store shape is migrated on first read: the top-level Shopify, Pinterest
  and Meta keys are folded into one store and written back, so nothing entered before is lost.
- The server reads it on every request and writes it atomically, so hand-editing the file while the
  app is running is safe.
- `history` is appended to by the tools themselves and drives the home page:
  `publishes` is the full Social Push log (store, channel, permalink), while `transfers` is nothing
  but counters — how many products were scraped and how many landed in each store. The Product
  Transfer tool still stores no catalogue data whatsoever.
- Keys never reach the browser bundle except on the Settings page, and they never leave this
  machine other than in calls to the APIs you configured.
- Anyone with access to this machine can read `Secret.json`. Keep the workspace on hardware you
  control.

`.env` still works as a fallback for headless use: `YUNWU_API_KEY`, `YUNWU_BASE_URL`,
and `ZYTE_API_KEY`. Per-store credentials live only in `Secret.json`. Anything set there wins.

## Social Push

**Step 1 — Backend product link.** Paste the Shopify admin URL. The store is recognised *while you
type*: a panel names it and lists the exact accounts the post will go to — the Pinterest board, the
Instagram handle, the Facebook Page — so there is never a doubt about where a push will land. Its
boards load in the background.

**Fetch details** opens a preview popup with everything that came back: gallery, price, live link,
description and SEO meta description, plus the store it matched and its push targets. Catching a
wrong product here costs nothing; catching it after three networks have been written costs a
generation.

The link is rewritten to the store's configured live domain, so "Shop Now" never points at a
`myshopify.com` address. Public `/products/<handle>` links work too, matched on the live domain.

**Step 2 — Choose a style, then generate.** The style is one choice that steers both halves of the
generation:

| Style | Angle |
| --- | --- |
| Promotional | Offer-led. Leads with the deal, `SALE` flag, price and CTA on the creative |
| Feature focused | Concrete features and the benefit each one buys |
| Casual post | Reads like a friend recommending it. Light scrim, no price |
| Lifestyle | Aspirational scene, sells the feeling over the spec |
| Problem → solution | Names the annoyance, then the fix |
| Social proof | Popularity-led — and says nothing about popularity if the data does not support it |
| Minimal | Product first, almost nothing on the image |
| New arrival | Announcement energy, `NEW IN` flag |

Each carries prompt guidance *and* an image treatment: scrim strength, whether price, CTA and brand
appear, a corner flag, headline case and scale, an accent rule. So a Casual post never comes back
with a hard-sell headline over a discount badge.

Then **one button** does everything for every platform: all three copy registers — a search-led
Pinterest title and description, a hook-first Instagram caption, a conversational Facebook message —
plus hashtags and alt text, and both creatives rendered at once. When it finishes, the post is ready
to push. Relay providers that reject JSON-schema mode degrade to JSON mode and then to parsed free
text; a model that ignores the extra keys falls back to the description so no channel is left blank.

Two renders come out of one design, because the networks disagree about shape:
- **1000×1500 (2:3)** for Pinterest
- **1080×1350 (4:5)** for Instagram and Facebook — Instagram rejects anything taller

In *Branded* mode they carry the headline, price, brand eyebrow and CTA pill in the store's accent
colour; in *Product photo* and *AI image* mode they are clean crops. The 4:5 version renders in the
background so Push never waits for it.

**Step 3 — Push.** Three independent buttons, each with its own spinner and result, plus a *Push all
three*. A failure on one channel never blocks the others. Every caption ends with
`Shop Now: <live link>`, and every run is appended to `history.publishes` with the store, the
per-channel outcome and the permalinks.

### Scopes and accounts

| Service   | Needs |
| --------- | ----- |
| Pinterest | `boards:read`, `pins:write` |
| Shopify   | `read_products` — plus **`write_files`** if you publish composed or AI images to Instagram |
| Meta      | `instagram_basic`, `instagram_content_publish`, `pages_manage_posts`, `pages_read_engagement` |

Scopes are per store. Instagram must be a **Business or Creator** account linked to that store's
Facebook Page. Under **Settings → Social API Keys**, pick the store, paste its long-lived Meta user
token and hit **Connect / refresh accounts**: the workspace lists the Pages that token administers
with the Instagram account linked to each, and picking a Page stores its Page-scoped token — you
never paste raw IDs.

### The Instagram image constraint

Instagram will not accept an uploaded file — it downloads the image from a URL you give it. That
shapes the whole flow:

| Channel   | How the image gets there |
| --------- | ------------------------ |
| Pinterest | base64 in the request |
| Facebook  | raw bytes, multipart |
| Instagram | a public URL it fetches itself |

So a branded or AI image, which only exists in your browser, is uploaded to **that store's Shopify
Files** first and Instagram is handed the `cdn.shopify.com` URL. This is why `write_files` is
needed. An image that is *already* public — a product photo on the CDN — skips the upload entirely.
To host images elsewhere, `ensurePublicImageUrl` in `src/lib/publish.ts` is the single place to
change.

Instagram also caps at 100 API-published posts per rolling 24 hours, and accepts JPEG only — which
is what the canvas exports.

## Scraping Tool — store-to-store transfer

Copies products from a live **Shopify** or **Shopline** storefront into one of your Shopify stores.

1. **Paste links** — one product URL per line, up to 100 at a time. Both platforms publish the whole
   product as JSON, so nothing is guessed from HTML:
   - Shopify `GET /products/{handle}.js`
   - Shopline `GET /api/product/products.json?handle={handle}`
2. **Review** — a row per product with variant count, price range, currency, how many variants carry
   a compare-at price, image count and whether the source has an SEO meta description. Clicking a
   row opens the full preview: gallery, every variant with its price/compare-at/SKU/image, and the
   description rendered *and* as raw HTML.
3. **Select and push** — tick the products, choose the destination store and whether they arrive as
   **Draft** (default) or **Active**, and push. Each row reports its own result with a link into the
   Shopify admin.

### What transfers

| Field | Notes |
| --- | --- |
| Description | Raw HTML, verbatim — never flattened to text |
| SEO title and meta description | Read from the rendered page, written to Shopify's `seo` field |
| Options | Rebuilt from the variants so no value is ever missing |
| Variants | Price, compare-at price, SKU, barcode, option values |
| Images | Product gallery **and** per-variant images, de-duplicated |
| Vendor, type, tags, handle | Copied as-is |

Images are handed to Shopify as source URLs, so Shopify downloads them itself — nothing is
re-uploaded from this machine. A compare-at price that is not above the price is dropped, because
Shopify rejects it.

### Currency

Shopify serves prices for whatever market it thinks the caller is in — the same product can come
back as `26.95` or `2613.10`. Every request is therefore pinned to the source store's own base
currency (read from its `/meta.json`), and the currency is shown in the table. If it differs from
the destination store's currency the push still runs, and each result carries a warning saying the
numbers were transferred unchanged rather than converted.

### Nothing is stored

Scraped products live in the browser tab and nowhere else — not in `Secret.json`, not in
localStorage, not on disk. Closing the tab discards them. The server is a relay: it fetches from the
source, hands the data to your browser, and later takes it back to create the products.

The one exception is arithmetic: how many products were scraped, and how many were created in each
destination store. Those totals feed the home page and contain no titles, prices or images. Reset
them any time from the home page.

The destination store's Admin API token needs **`write_products`**. If a storefront refuses a plain
request and a Zyte key is configured, the fetch retries through Zyte automatically.

## API keys and fallback

Each provider holds up to **three** keys, ordered in Settings and tried top-down. A key that is
spent, rate-limited, rotated or whose provider is down falls through to the next; a genuinely bad
request does not retry, because it would fail identically on every key and cost three times as much.
The AI chain runs every Yunwu key first, then every OpenAI key — they speak the same API. When all
of them fail, the error names each key that was tried.

## Security notes

This is an unauthenticated internal app, so the boundaries that matter are the ones around
untrusted input:

- **Scraped descriptions render in a sandboxed iframe** (`sandbox=""`, no `allow-scripts`, no
  `allow-same-origin`). Product HTML comes from someone else's storefront; injecting it into our own
  DOM would let it read `/api/settings` and exfiltrate every key. The original HTML is still
  transferred to Shopify byte-for-byte.
- **SSRF**: user-supplied URLs are resolved before they are fetched, and refused if any answer lands
  in a loopback, private, link-local, CGNAT or multicast range — IPv6 included, since the URL parser
  rewrites `[::ffff:169.254.169.254]` into hex form that a string check misses.
- **The image proxy** caps responses at 20 MB and returns them `nosniff` under a locked-down CSP.
- **Prototype pollution**: `__proto__`, `constructor` and `prototype` are dropped when a settings
  patch is merged into `Secret.json`.
- **`Secret.json` is written 0600**, owner-only.
- **The server binds to 127.0.0.1** in both `dev` and `start`.

### The password gate

Middleware guards *everything* — pages and API routes alike — because `/api/settings` hands out
every key, so gating only the UI would protect nothing. Signed-out requests get a redirect to
`/login` (pages) or a `401` (API).

- The session is a **stateless signed cookie**: `<expiry>.<HMAC-SHA256>`, `HttpOnly`, `SameSite=lax`,
  7 days. Forging one needs the signing secret, which is 32 random bytes minted on first run and
  kept in `Secret.json`.
- The password is compared in **constant time** (both sides hashed first, so the buffers match).
- **Eight wrong attempts** locks sign-in for a minute.
- The password and signing secret are **stripped from `/api/settings`** — the browser never receives
  them.
- Changing the password **rotates the signing secret**, which invalidates every other session.

## Home page

A dashboard rather than a menu. Four tiles across the top (stores, stores ready to push, posts
published, products moved), then a card per tool, then per-tool activity:

- **Social Push** — a store × platform grid of posts published, with failures marked in red next to
  the count, plus a totals row. Rolled up from the publish log, so no extra bookkeeping.
- **Product Transfer** — scraped / pushed / failed figures, a breakdown of Shopify vs Shopline
  sources, and a per-destination-store table.

Both panels have their own Reset.

## Layout

```
src/
  app/
    page.tsx               home
    social-push/page.tsx   Social Push — the three-step multi-store publisher
    scraper/page.tsx       Scraping tool — store-to-store transfer
    settings/page.tsx      three tabs: AI & Zyte, Social API Keys, Store API Keys
    globals.css            the design system both tools use
    api/                   settings, publish, scrape, shopify, pinterest, meta, generate, ai,
                           proxy-image
  components/              SiteHeader, StorefrontPreview, shared UI primitives
  lib/
    secrets.ts             Secret.json read/write, migration, store-scoped credentials (server only)
    stores.ts              URL → store matching and live-link building (pure, runs in the browser)
    client.ts              the browser's view of Secret.json
    publish.ts             the fan-out: one post → three channels, isolated failures
    meta.ts                Facebook Pages + Instagram Business publishing
    shopify-admin.ts       shared Admin GraphQL transport + the SEO meta-description query
    migrate/               source reading (Shopify + Shopline), productSet push, Zyte fallback
    shopify-files.ts       staged upload → public CDN URL, so Instagram can fetch the image
    ai.ts pinterest.ts shopify.ts compose.ts
```
