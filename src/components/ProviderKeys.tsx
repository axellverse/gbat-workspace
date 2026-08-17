"use client";

import { Field } from "@/components/ui";
import type { Credential, ProviderId } from "@/lib/secrets";

/**
 * Up to three keys for one provider, tried top to bottom.
 *
 * Dropshipping keys die constantly — quota spent, card declined, key rotated.
 * Ordering them here means a dead first key costs a retry rather than a
 * blocked afternoon.
 */

export const MAX_KEYS = 3;

export type ProviderMeta = {
  id: ProviderId;
  name: string;
  blurb: string;
  needsBaseUrl: boolean;
  placeholder: string;
  defaultBaseUrl: string;
};

export default function ProviderKeys({
  meta,
  credentials,
  showKeys,
  onChange,
}: {
  meta: ProviderMeta;
  credentials: Credential[];
  showKeys: boolean;
  onChange: (next: Credential[]) => void;
}) {
  const edit = (index: number, patch: Partial<Credential>) =>
    onChange(credentials.map((credential, i) => (i === index ? { ...credential, ...patch } : credential)));

  const add = () =>
    onChange([
      ...credentials,
      {
        id: `cred_${Date.now().toString(36)}_${credentials.length}`,
        label: "",
        apiKey: "",
        baseUrl: meta.needsBaseUrl ? meta.defaultBaseUrl : "",
      },
    ]);

  const remove = (index: number) => onChange(credentials.filter((_, i) => i !== index));

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= credentials.length) return;
    const next = [...credentials];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold">{meta.name}</h2>
          <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted">{meta.blurb}</p>
        </div>
        <span className="chip shrink-0">
          {credentials.length}/{MAX_KEYS} keys
        </span>
      </div>

      {!credentials.length && (
        <p className="rounded-xl border border-dashed border-line px-4 py-5 text-center text-sm text-muted">
          No {meta.name} key yet.
        </p>
      )}

      {credentials.map((credential, index) => (
        <div key={credential.id} className="rounded-xl border border-line bg-surface-2 p-3">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="tag">{index === 0 ? "Primary" : `Fallback ${index}`}</span>
            <input
              className="field h-8 max-w-48 flex-1 py-1 text-xs"
              placeholder="Label (optional)"
              value={credential.label}
              onChange={(e) => edit(index, { label: e.target.value })}
              aria-label={`Label for ${meta.name} key ${index + 1}`}
            />
            <span className="ml-auto flex items-center gap-1">
              <button
                className="btn-quiet"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                aria-label="Move up"
                title="Try this key earlier"
              >
                ↑
              </button>
              <button
                className="btn-quiet"
                onClick={() => move(index, 1)}
                disabled={index === credentials.length - 1}
                aria-label="Move down"
                title="Try this key later"
              >
                ↓
              </button>
              <button className="btn-quiet" onClick={() => remove(index)} aria-label="Remove key">
                Remove
              </button>
            </span>
          </div>

          <div className={meta.needsBaseUrl ? "grid gap-3 sm:grid-cols-[1fr_1fr]" : ""}>
            <Field label="API key">
              <input
                className="field font-mono"
                type={showKeys ? "text" : "password"}
                autoComplete="off"
                spellCheck={false}
                placeholder={meta.placeholder}
                value={credential.apiKey}
                onChange={(e) => edit(index, { apiKey: e.target.value })}
              />
            </Field>

            {meta.needsBaseUrl && (
              <Field label="Base URL">
                <input
                  className="field font-mono text-xs"
                  spellCheck={false}
                  placeholder={meta.defaultBaseUrl}
                  value={credential.baseUrl}
                  onChange={(e) => edit(index, { baseUrl: e.target.value })}
                />
              </Field>
            )}
          </div>
        </div>
      ))}

      {credentials.length < MAX_KEYS && (
        <button className="btn-ghost" onClick={add}>
          + Add {credentials.length ? "fallback" : ""} key
        </button>
      )}
    </section>
  );
}
