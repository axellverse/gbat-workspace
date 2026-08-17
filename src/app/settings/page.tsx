"use client";

import { useEffect, useState } from "react";
import { Empty, Field, Note, PageHeader, Spinner } from "@/components/ui";
import { getJson, useWorkspace } from "@/lib/client";
import type { MetaAccount } from "@/lib/meta";
import ProviderKeys, { type ProviderMeta } from "@/components/ProviderKeys";
import type { ApiKeys, Credential, Preferences, ProviderId, Store } from "@/lib/secrets";
import { storeLabel } from "@/lib/stores";

type TestState = { status: "idle" | "busy" | "ok" | "fail"; message: string };
const IDLE: TestState = { status: "idle", message: "" };

type TabId = "ai" | "social" | "stores";

const TABS: { id: TabId; label: string }[] = [
  { id: "ai", label: "AI & Zyte API Keys" },
  { id: "social", label: "Social API Keys" },
  { id: "stores", label: "Store API Keys" },
];

const PROVIDERS: ProviderMeta[] = [
  {
    id: "yunwu",
    name: "Yunwu AI",
    blurb:
      "OpenAI-compatible relay. Tried first for every copy and image generation; if a key is spent or down the " +
      "next one in this list is used automatically.",
    needsBaseUrl: true,
    placeholder: "sk-…",
    defaultBaseUrl: "https://yunwu.ai/v1",
  },
  {
    id: "openai",
    name: "OpenAI",
    blurb: "Used after every Yunwu key has been tried. Same models, same request shape.",
    needsBaseUrl: true,
    placeholder: "sk-…",
    defaultBaseUrl: "https://api.openai.com/v1",
  },
  {
    id: "zyte",
    name: "Zyte",
    blurb:
      "Fallback fetch for storefronts that refuse a plain request in the Product Transfer tool. Only reached " +
      "when a direct fetch is turned away, because it bills per call.",
    needsBaseUrl: false,
    placeholder: "Zyte API key",
    defaultBaseUrl: "",
  },
  {
    id: "ttapi",
    name: "TTAPI",
    blurb: "Stored for upcoming media work. Nothing calls it yet.",
    needsBaseUrl: true,
    placeholder: "TTAPI key",
    defaultBaseUrl: "https://api.ttapi.io",
  },
];

const BLANK_STORE: Omit<Store, "id"> = {
  name: "",
  backendRef: "",
  domain: "",
  shopify: { storeDomain: "", adminToken: "", apiVersion: "2025-10" },
  brand: { name: "", accentColor: "#1d4ed8" },
  social: {
    pinterest: { accessToken: "", environment: "production", defaultBoardId: "" },
    meta: {
      accessToken: "",
      apiVersion: "v25.0",
      pageId: "",
      pageName: "",
      pageAccessToken: "",
      igUserId: "",
      igUsername: "",
    },
  },
};

export default function SettingsPage() {
  const { secrets, save, loaded, error: loadError } = useWorkspace();

  const [tab, setTab] = useState<TabId>("ai");
  const [keys, setKeys] = useState<ApiKeys | null>(null);
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [stores, setStores] = useState<Store[] | null>(null);
  const [activeStoreId, setActiveStoreId] = useState("");

  const [showKeys, setShowKeys] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");

  const [aiTest, setAiTest] = useState<TestState>(IDLE);
  const [shopTest, setShopTest] = useState<TestState>(IDLE);
  const [pinTest, setPinTest] = useState<TestState>(IDLE);
  const [metaTest, setMetaTest] = useState<TestState>(IDLE);
  const [accounts, setAccounts] = useState<MetaAccount[]>([]);

  // Adopt the file once, then edit a local draft so typing never hits the disk.
  useEffect(() => {
    if (!secrets || keys) return;
    setKeys(structuredClone(secrets.apiKeys));
    setPrefs(structuredClone(secrets.preferences));
    setStores(structuredClone(secrets.stores));
    setActiveStoreId(secrets.stores[0]?.id || "");
  }, [secrets, keys]);

  // Deep links from the Social Push page land on the right tab.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("tab");
    if (wanted && TABS.some((t) => t.id === wanted)) setTab(wanted as TabId);
  }, []);

  if (!loaded || !keys || !prefs || !stores) {
    return (
      <main className="mx-auto max-w-3xl px-5 py-10">
        {loadError ? <Note tone="danger">{loadError}</Note> : <Empty>Loading Secret.json…</Empty>}
      </main>
    );
  }

  const touch = () => {
    setDirty(true);
    setSaved("");
  };

  const setCredentials = (provider: ProviderId, credentials: Credential[]) => {
    setKeys({ ...keys, [provider]: { credentials } });
    touch();
  };

  const editPref = (patch: Partial<Preferences>) => {
    setPrefs({ ...prefs, ...patch });
    touch();
  };

  /** Applies a deep patch to one store without disturbing the others. */
  const editStore = (id: string, patch: (store: Store) => Store) => {
    setStores(stores.map((store) => (store.id === id ? patch(store) : store)));
    touch();
  };

  const addStore = () => {
    // A blank id tells the server to mint one from the name on save.
    const draft: Store = { ...structuredClone(BLANK_STORE), id: `new-${Date.now()}` };
    setStores([...stores, draft]);
    setActiveStoreId(draft.id);
    setTab("stores");
    touch();
  };

  const removeStore = (id: string) => {
    const next = stores.filter((store) => store.id !== id);
    setStores(next);
    if (activeStoreId === id) setActiveStoreId(next[0]?.id || "");
    touch();
  };

  const persist = async () => {
    setSaving(true);
    setError("");
    try {
      const written = await save({ apiKeys: keys, preferences: prefs, stores });
      // The server may have minted ids for new stores; adopt what it wrote.
      setStores(structuredClone(written.stores));
      if (!written.stores.some((s) => s.id === activeStoreId)) {
        setActiveStoreId(written.stores[0]?.id || "");
      }
      setDirty(false);
      setSaved("Saved to Secret.json.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  /** The Test buttons hit the server, which reads the saved file — so save first. */
  const runTest = async (set: (s: TestState) => void, fn: () => Promise<string>) => {
    set({ status: "busy", message: "" });
    try {
      if (dirty) await persist();
      set({ status: "ok", message: await fn() });
    } catch (err) {
      set({ status: "fail", message: err instanceof Error ? err.message : String(err) });
    }
  };

  const testAi = () =>
    runTest(setAiTest, async () => {
      const query = `?textModel=${encodeURIComponent(prefs.textModel)}&imageModel=${encodeURIComponent(prefs.imageModel)}`;
      const r = await getJson<{
        provider: string;
        label: string;
        attempts: number;
        baseUrl: string;
        modelCount: number;
        textModelFound: boolean | null;
        imageModelFound: boolean | null;
      }>(`/api/ai/test${query}`);

      const warnings = [
        r.textModelFound === false && `“${prefs.textModel}” is not in this provider's model list`,
        r.imageModelFound === false && `“${prefs.imageModel}” is not in this provider's model list`,
      ].filter(Boolean);

      const fellBack = r.attempts > 1 ? ` after ${r.attempts - 1} key(s) failed` : "";
      return (
        `${r.provider} · ${r.label}${fellBack} — ${new URL(r.baseUrl).host}, ${r.modelCount} models` +
        (warnings.length ? ` — heads up: ${warnings.join("; ")}.` : "")
      );
    });

  const testShopify = (storeId: string) =>
    runTest(setShopTest, async () => {
      const r = await getJson<{ shop: string; storefront: string; currency: string; apiVersion: string }>(
        `/api/shopify/test?storeId=${encodeURIComponent(storeId)}`,
      );
      return `Connected to ${r.shop} (${r.storefront}) · ${r.currency} · API ${r.apiVersion}`;
    });

  const testPinterest = (storeId: string) =>
    runTest(setPinTest, async () => {
      const r = await getJson<{ boards: { id: string }[] }>(
        `/api/pinterest/boards?storeId=${encodeURIComponent(storeId)}`,
      );
      return `Token works · ${r.boards.length} board${r.boards.length === 1 ? "" : "s"} visible`;
    });

  const loadMetaAccounts = (storeId: string) =>
    runTest(setMetaTest, async () => {
      const r = await getJson<{ accounts: MetaAccount[] }>(
        `/api/meta/accounts?storeId=${encodeURIComponent(storeId)}`,
      );
      setAccounts(r.accounts);
      const withIg = r.accounts.filter((a) => a.igUserId).length;
      return `${r.accounts.length} Page${r.accounts.length === 1 ? "" : "s"} · ${withIg} with Instagram linked`;
    });

  const secretType = showKeys ? "text" : "password";
  const activeStore = stores.find((store) => store.id === activeStoreId) || null;

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <PageHeader
        eyebrow="Workspace"
        title="Settings"
        description="Everything the workspace knows, stored in Secret.json at the project root. No database."
        actions={
          <>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-muted">
              <input type="checkbox" checked={showKeys} onChange={(e) => setShowKeys(e.target.checked)} />
              Show keys
            </label>
            <button className="btn-primary" onClick={persist} disabled={saving || !dirty}>
              {saving ? (
                <>
                  <Spinner /> Saving…
                </>
              ) : dirty ? (
                "Save changes"
              ) : (
                "Saved"
              )}
            </button>
          </>
        }
      />

      <nav className="mb-6 flex flex-wrap gap-2">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            onClick={() => setTab(entry.id)}
            className={tab === entry.id ? "btn bg-brand text-brand-ink" : "btn-ghost"}
            aria-current={tab === entry.id ? "page" : undefined}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      {error && <Note tone="danger">{error}</Note>}
      {saved && <Note tone="ok">{saved}</Note>}
      {dirty && <Note tone="warn">Unsaved changes — nothing is written to Secret.json until you save.</Note>}

      {/* ---------------------------------------------- tab 1: API keys */}
      {tab === "ai" && (
        <div className="space-y-5">
          <Note tone="ok">
            Each provider takes up to three keys. They are tried from the top down, so a spent quota or a rotated
            key falls through to the next one instead of failing the job. Drag order with the arrows.
          </Note>

          {PROVIDERS.map((provider) => (
            <ProviderKeys
              key={provider.id}
              meta={provider}
              credentials={keys[provider.id].credentials}
              showKeys={showKeys}
              onChange={(next) => setCredentials(provider.id, next)}
            />
          ))}

          <section className="card space-y-4">
            <SectionHead
              title="Generation defaults"
              subtitle="Which models the Social Push copywriter and image generator ask for."
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Text model">
                <input
                  className="field"
                  value={prefs.textModel}
                  onChange={(e) => editPref({ textModel: e.target.value })}
                />
              </Field>
              <Field label="Image model">
                <input
                  className="field"
                  value={prefs.imageModel}
                  onChange={(e) => editPref({ imageModel: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Copy tone">
              <input className="field" value={prefs.tone} onChange={(e) => editPref({ tone: e.target.value })} />
            </Field>

            <TestRow label="Test AI keys" state={aiTest} onTest={testAi} />
          </section>

          <PasswordCard />
        </div>
      )}

      {/* -------------------------------------------- tab 2: social by store */}
      {tab === "social" && (
        <div className="space-y-5">
          <StoreChooser
            stores={stores}
            activeId={activeStoreId}
            onPick={(id) => {
              setActiveStoreId(id);
              setAccounts([]);
              setPinTest(IDLE);
              setMetaTest(IDLE);
            }}
            onAdd={addStore}
          />

          {!activeStore && <Empty>Add a store first — social accounts belong to a store.</Empty>}

          {activeStore && (
            <>
              <section className="card space-y-4">
                <SectionHead
                  title={`Pinterest — ${storeLabel(activeStore)}`}
                  subtitle="Needs the boards:read and pins:write scopes."
                />
                <Field label="Access token">
                  <input
                    className="field font-mono"
                    type={secretType}
                    autoComplete="off"
                    placeholder="pina_…"
                    value={activeStore.social.pinterest.accessToken}
                    onChange={(e) => {
                      const value = e.target.value;
                      editStore(activeStore.id, (s) => ({
                        ...s,
                        social: { ...s.social, pinterest: { ...s.social.pinterest, accessToken: value } },
                      }));
                      setPinTest(IDLE);
                    }}
                  />
                </Field>
                <Field label="Environment">
                  <select
                    className="field"
                    value={activeStore.social.pinterest.environment}
                    onChange={(e) => {
                      const value = e.target.value as "production" | "sandbox";
                      editStore(activeStore.id, (s) => ({
                        ...s,
                        social: { ...s.social, pinterest: { ...s.social.pinterest, environment: value } },
                      }));
                    }}
                  >
                    <option value="production">Production</option>
                    <option value="sandbox">Sandbox</option>
                  </select>
                </Field>
                <TestRow label="Test connection" state={pinTest} onTest={() => testPinterest(activeStore.id)} />
              </section>

              <section className="card space-y-4">
                <SectionHead
                  title={`Meta — ${storeLabel(activeStore)}`}
                  subtitle="Instagram must be a Business or Creator account linked to this store's Facebook Page."
                />

                <Field
                  label="Long-lived user access token"
                  hint="Needs instagram_basic, instagram_content_publish, pages_manage_posts and pages_read_engagement."
                >
                  <input
                    className="field font-mono"
                    type={secretType}
                    autoComplete="off"
                    value={activeStore.social.meta.accessToken}
                    onChange={(e) => {
                      const value = e.target.value;
                      editStore(activeStore.id, (s) => ({
                        ...s,
                        social: { ...s.social, meta: { ...s.social.meta, accessToken: value } },
                      }));
                      setMetaTest(IDLE);
                      setAccounts([]);
                    }}
                  />
                </Field>

                <Field label="Graph API version">
                  <input
                    className="field font-mono text-xs"
                    value={activeStore.social.meta.apiVersion}
                    onChange={(e) => {
                      const value = e.target.value;
                      editStore(activeStore.id, (s) => ({
                        ...s,
                        social: { ...s.social, meta: { ...s.social.meta, apiVersion: value } },
                      }));
                    }}
                  />
                </Field>

                <TestRow
                  label="Connect / refresh accounts"
                  state={metaTest}
                  onTest={() => loadMetaAccounts(activeStore.id)}
                />

                {accounts.length > 0 && (
                  <Field label="Publish to" hint="Picking a Page also selects the Instagram account linked to it.">
                    <select
                      className="field"
                      value={activeStore.social.meta.pageId}
                      onChange={(e) => {
                        const account = accounts.find((a) => a.pageId === e.target.value);
                        if (!account) return;
                        editStore(activeStore.id, (s) => ({
                          ...s,
                          social: {
                            ...s.social,
                            meta: {
                              ...s.social.meta,
                              pageId: account.pageId,
                              pageName: account.pageName,
                              pageAccessToken: account.pageAccessToken,
                              igUserId: account.igUserId,
                              igUsername: account.igUsername,
                            },
                          },
                        }));
                      }}
                    >
                      <option value="">Select a Page…</option>
                      {accounts.map((account) => (
                        <option key={account.pageId} value={account.pageId}>
                          {account.pageName}
                          {account.igUserId ? ` · @${account.igUsername || account.igUserId}` : " · no Instagram linked"}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}

                {activeStore.social.meta.pageId && (
                  <div className="flex flex-wrap gap-1.5">
                    <span className="chip">Page: {activeStore.social.meta.pageName || activeStore.social.meta.pageId}</span>
                    <span className="chip" style={activeStore.social.meta.igUserId ? undefined : { color: "var(--warn)" }}>
                      {activeStore.social.meta.igUserId
                        ? `Instagram: @${activeStore.social.meta.igUsername || activeStore.social.meta.igUserId}`
                        : "No Instagram linked to this Page"}
                    </span>
                  </div>
                )}

                <p className="hint">
                  Instagram downloads the image from a URL rather than accepting an upload, so branded images are
                  pushed to this store&apos;s Shopify Files first — which needs <code>write_files</code> on its
                  Admin API token.
                </p>
              </section>
            </>
          )}
        </div>
      )}

      {/* ---------------------------------------------------- tab 3: stores */}
      {tab === "stores" && (
        <div className="space-y-5">
          <section className="card flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold">Stores ({stores.length})</h2>
              <p className="mt-1 text-xs text-muted">
                The backend reference is how a pasted admin link finds this store. The domain builds the Shop Now
                link customers click.
              </p>
            </div>
            <button className="btn-primary" onClick={addStore}>
              Add store
            </button>
          </section>

          {!stores.length && <Empty>No stores yet. Add one to start pushing.</Empty>}

          {stores.map((store) => (
            <section key={store.id} className="card space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold">{store.name || "Untitled store"}</h3>
                  <p className="mt-1 font-mono text-xs text-muted">{store.id}</p>
                </div>
                <button className="btn-quiet" onClick={() => removeStore(store.id)}>
                  Remove
                </button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Store name">
                  <input
                    className="field"
                    placeholder="GBAT Store"
                    value={store.name}
                    onChange={(e) => {
                      const value = e.target.value;
                      editStore(store.id, (s) => ({ ...s, name: value }));
                    }}
                  />
                </Field>
                <Field label="Backend link reference" hint="The handle in admin.shopify.com/store/<handle>">
                  <input
                    className="field font-mono text-xs"
                    placeholder="gbat-store"
                    value={store.backendRef}
                    onChange={(e) => {
                      const value = e.target.value;
                      editStore(store.id, (s) => ({ ...s, backendRef: value }));
                    }}
                  />
                </Field>
              </div>

              <Field label="Live domain" hint="Used for the Shop Now link — the domain customers actually visit.">
                <input
                  className="field font-mono text-xs"
                  placeholder="gbatstore.com"
                  value={store.domain}
                  onChange={(e) => {
                    const value = e.target.value;
                    editStore(store.id, (s) => ({ ...s, domain: value }));
                  }}
                />
              </Field>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Shopify domain">
                  <input
                    className="field font-mono text-xs"
                    placeholder="gbat-store.myshopify.com"
                    value={store.shopify.storeDomain}
                    onChange={(e) => {
                      const value = e.target.value;
                      editStore(store.id, (s) => ({ ...s, shopify: { ...s.shopify, storeDomain: value } }));
                      setShopTest(IDLE);
                    }}
                  />
                </Field>
                <Field label="Admin API version">
                  <input
                    className="field font-mono text-xs"
                    value={store.shopify.apiVersion}
                    onChange={(e) => {
                      const value = e.target.value;
                      editStore(store.id, (s) => ({ ...s, shopify: { ...s.shopify, apiVersion: value } }));
                    }}
                  />
                </Field>
              </div>

              <Field
                label="Admin API access token"
                hint="Needs read_products, plus write_files to push branded images to Instagram."
              >
                <input
                  className="field font-mono"
                  type={secretType}
                  autoComplete="off"
                  placeholder="shpat_…"
                  value={store.shopify.adminToken}
                  onChange={(e) => {
                    const value = e.target.value;
                    editStore(store.id, (s) => ({ ...s, shopify: { ...s.shopify, adminToken: value } }));
                    setShopTest(IDLE);
                  }}
                />
              </Field>

              <div className="grid grid-cols-[auto_1fr] items-end gap-3">
                <Field label="Accent">
                  <input
                    className="h-10 w-16 cursor-pointer rounded-lg border border-line bg-surface p-1"
                    type="color"
                    value={store.brand.accentColor}
                    onChange={(e) => {
                      const value = e.target.value;
                      editStore(store.id, (s) => ({ ...s, brand: { ...s.brand, accentColor: value } }));
                    }}
                  />
                </Field>
                <Field label="Brand name on images" hint="Leave blank to use the Shopify vendor.">
                  <input
                    className="field"
                    value={store.brand.name}
                    onChange={(e) => {
                      const value = e.target.value;
                      editStore(store.id, (s) => ({ ...s, brand: { ...s.brand, name: value } }));
                    }}
                  />
                </Field>
              </div>

              <TestRow label="Test Shopify connection" state={shopTest} onTest={() => testShopify(store.id)} />
            </section>
          ))}
        </div>
      )}

      <p className="py-6 text-xs leading-relaxed text-muted">
        Secret.json sits at the project root and is git-ignored. Anyone with access to this machine can read it —
        keep the workspace on hardware you control.
      </p>
    </main>
  );
}

function StoreChooser({
  stores,
  activeId,
  onPick,
  onAdd,
}: {
  stores: Store[];
  activeId: string;
  onPick: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <section className="card flex flex-wrap items-center gap-3">
      <span className="label mb-0">Store</span>
      <select className="field max-w-xs" value={activeId} onChange={(e) => onPick(e.target.value)}>
        {!stores.length && <option value="">No stores yet</option>}
        {stores.map((store) => (
          <option key={store.id} value={store.id}>
            {storeLabel(store)}
          </option>
        ))}
      </select>
      <button className="btn-ghost ml-auto" onClick={onAdd}>
        Add store
      </button>
    </section>
  );
}

/**
 * The one shared password for the workspace. Changing it signs every other
 * browser out, which is usually the point of changing it.
 */
function PasswordCard() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [state, setState] = useState<TestState>(IDLE);

  const submit = async () => {
    if (next !== confirm) {
      setState({ status: "fail", message: "The two new passwords do not match." });
      return;
    }
    setState({ status: "busy", message: "" });
    try {
      const res = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ current, next }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error || "Could not change the password.");

      setCurrent("");
      setNext("");
      setConfirm("");
      setState({ status: "ok", message: "Password changed. Everyone else has been signed out." });
    } catch (err) {
      setState({ status: "fail", message: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <section className="card space-y-4">
      <SectionHead
        title="Workspace password"
        subtitle="One shared password guards the whole app, including the API that hands out these keys. Changing it signs every other browser out."
      />

      <Field label="Current password">
        <input
          className="field"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="New password" hint="At least 6 characters.">
          <input
            className="field"
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </Field>
        <Field label="Confirm new password">
          <input
            className="field"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </Field>
      </div>

      <div>
        <button
          className="btn-ghost"
          onClick={submit}
          disabled={state.status === "busy" || !current || !next || !confirm}
        >
          {state.status === "busy" ? (
            <>
              <Spinner /> Changing…
            </>
          ) : (
            "Change password"
          )}
        </button>
        {state.status === "ok" && <p className="note-ok mt-2 text-xs">✓ {state.message}</p>}
        {state.status === "fail" && <p className="note-danger mt-2 text-xs">✕ {state.message}</p>}
      </div>
    </section>
  );
}

function SectionHead({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h2 className="text-sm font-bold">{title}</h2>
      <p className="mt-1 text-xs leading-relaxed text-muted">{subtitle}</p>
    </div>
  );
}

function TestRow({ label, state, onTest }: { label: string; state: TestState; onTest: () => void }) {
  return (
    <div>
      <button className="btn-ghost" onClick={onTest} disabled={state.status === "busy"}>
        {state.status === "busy" ? (
          <>
            <Spinner /> Testing…
          </>
        ) : (
          label
        )}
      </button>
      {state.status === "ok" && <p className="note-ok mt-2 text-xs">✓ {state.message}</p>}
      {state.status === "fail" && <p className="note-danger mt-2 text-xs">✕ {state.message}</p>}
    </div>
  );
}
