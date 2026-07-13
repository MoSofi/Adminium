/**
 * @adminium/tokens — JS-side constants for the four theming axes plus the pre-hydration
 * script. CSS custom properties live in the sibling .css files; these exports exist so
 * ThemeProvider, Storybook toolbars, charts and the desktop shell never hard-code axis
 * values. See workplan/02-design-system.md §2.5.
 */

/** Theme axis. `system` resolves via `matchMedia("(prefers-color-scheme: dark)")`. */
export const THEMES = ["light", "dark", "system"] as const;
export type ThemePref = (typeof THEMES)[number];
/** A resolved theme as stamped on `<html data-theme>`. */
export type ResolvedTheme = Exclude<ThemePref, "system">;

/** Accent axis: the 8 switchable palettes (`data-accent`), name → hex. */
export const ACCENTS = {
  indigo: "#4f46e5",
  blue: "#2563eb",
  teal: "#0d9488",
  violet: "#7c3aed",
  rose: "#e11d48",
  red: "#e5484d",
  orange: "#ea580c",
  black: "#111111",
} as const;
/** `indigo` is the default. */
export type Accent = keyof typeof ACCENTS;

/** Density axis (`data-density`). */
export const DENSITIES = ["comfortable", "compact"] as const;
export type Density = (typeof DENSITIES)[number];

/** Text direction axis (`dir` on `<html>`). `rtl` iff locale is `ar_EG`. */
export const DIRS = ["ltr", "rtl"] as const;
export type Dir = (typeof DIRS)[number];

/** Fixed 8-color categorical viz palette; series `i` gets `VIZ_PALETTE[i % 8]`. */
export const VIZ_PALETTE = [
  "#4f46e5",
  "#0ea5e9",
  "#14b8a6",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#22c55e",
] as const;

/** Sequential accent-ramp alphas → `--viz-ramp-1` … `--viz-ramp-6`. */
export const VIZ_RAMP_ALPHAS = [0.12, 0.28, 0.45, 0.65, 0.85, 1] as const;

/**
 * DOM attributes stamped on `document.documentElement` — by the pre-hydration script
 * before first paint and by ThemeProvider afterwards. The only place theming
 * attributes are ever set.
 */
export const THEME_ATTRIBUTES = {
  theme: "data-theme",
  accent: "data-accent",
  density: "data-density",
  dir: "dir",
  lang: "lang",
} as const;

/**
 * localStorage keys — a pre-paint cache of the last *resolved* values, never a
 * preference source. `adminium-theme`/`adminium-dir` match the comps' own persistence.
 */
export const STORAGE_KEYS = {
  theme: "adminium-theme",
  accent: "adminium-accent",
  density: "adminium-density",
  locale: "adminium-locale",
  dir: "adminium-dir",
} as const;

/** Baseline of the preference resolution order (BRIEF §7). */
export const DEFAULT_PREFS = {
  theme: "system",
  accent: "indigo",
  density: "comfortable",
  locale: "en_US",
} as const;

export { preHydrationScript } from "./pre-hydration.js";
