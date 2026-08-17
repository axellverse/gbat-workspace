import type { ReactNode } from "react";

/** The shared building blocks. Both tools are assembled from these, so the
    two pages cannot drift apart visually. */

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <p className="mb-1 text-[11px] font-bold uppercase tracking-widest text-brand">{eyebrow}</p>}
        <h1 className="text-2xl font-black tracking-tight">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Step({ n, title, aside }: { n: number; title: string; aside?: ReactNode }) {
  return (
    <h2 className="section-title">
      <span className="step-badge">{n}</span>
      {title}
      {aside && <span className="ml-auto font-normal">{aside}</span>}
    </h2>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <span className="label">{label}</span>
      {children}
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

export function Note({ tone, children }: { tone: "ok" | "warn" | "danger"; children: ReactNode }) {
  const className = tone === "ok" ? "note-ok" : tone === "warn" ? "note-warn" : "note-danger";
  return (
    <div className={`${className} mb-5 break-words`} role={tone === "danger" ? "alert" : "status"}>
      {children}
    </div>
  );
}

export function Spinner() {
  return <span className="spinner" aria-hidden />;
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-24 items-center justify-center rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">
      {children}
    </div>
  );
}
