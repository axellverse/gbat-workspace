"use client";

import { useEffect, useState } from "react";

/**
 * Light / dark / follow-the-system, remembered in this browser.
 *
 * The choice is written to `data-theme` on <html>; globals.css defines the
 * palette for both the attribute and the OS preference. `applyTheme` below is
 * also inlined in the document head so the first paint is already correct.
 */

export type Theme = "light" | "dark" | "system";

export const THEME_KEY = "gbat.theme";

/** Runs both here and, stringified, in the pre-hydration script in layout.tsx. */
export const THEME_BOOTSTRAP = `(function(){try{
  var t = localStorage.getItem(${JSON.stringify(THEME_KEY)});
  if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
}catch(e){}})();`;

const ORDER: Theme[] = ["light", "dark", "system"];

const ICON: Record<Theme, string> = { light: "☀", dark: "☾", system: "◐" };
const LABEL: Record<Theme, string> = { light: "Light", dark: "Dark", system: "System" };

function apply(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = (localStorage.getItem(THEME_KEY) as Theme | null) ?? "system";
    setTheme(ORDER.includes(stored) ? stored : "system");
    setReady(true);
  }, []);

  const choose = (next: Theme) => {
    setTheme(next);
    apply(next);
    try {
      if (next === "system") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, next);
    } catch {
      /* private mode — the choice lasts for this tab only */
    }
  };

  // Render nothing until the stored value is known, or the button would flash
  // the wrong icon on first paint.
  if (!ready) return <span className="h-8 w-[5.5rem]" aria-hidden />;

  return (
    <div
      className="flex items-center gap-0.5 rounded-lg border border-line bg-surface-2 p-0.5"
      role="group"
      aria-label="Colour theme"
    >
      {ORDER.map((option) => (
        <button
          key={option}
          onClick={() => choose(option)}
          title={`${LABEL[option]} theme`}
          aria-pressed={theme === option}
          className={`h-7 w-7 cursor-pointer rounded-md text-sm transition ${
            theme === option ? "bg-brand text-brand-ink" : "text-muted hover:bg-surface hover:text-ink"
          }`}
        >
          <span aria-hidden>{ICON[option]}</span>
          <span className="sr-only">{LABEL[option]}</span>
        </button>
      ))}
    </div>
  );
}
