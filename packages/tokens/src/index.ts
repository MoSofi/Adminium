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

/**
 * Accent axis: the 8 switchable palettes (`data-accent`), name → LIGHT-theme hex
 * (`--accent-light` in accents.css).
 *
 * This is ONE HALF of the accent. Each palette also has an `--accent-dark` hex that the dark
 * theme selects into `--accent`, and it is a different colour, drastically so for `black`
 * (#111111 light, #c9c9d4 dark). Anything that PAINTS an accent must therefore either read the
 * CSS variable — which already resolves per theme — or pick from {@link ACCENTS_DARK} when the
 * resolved theme is dark. Rendering `ACCENTS[a]` unconditionally shows the wrong colour on dark;
 * that is what the accent-picker swatch used to do.
 */
export const ACCENTS = {
  indigo: "#4f46e5",
  blue: "#1c59e0",
  teal: "#007167",
  violet: "#7936e9",
  rose: "#c40039",
  red: "#c0202f",
  orange: "#b03e00",
  black: "#111111",
} as const;

/**
 * The dark half (`--accent-dark`). Derived from the light ramp by recipe — see the header of
 * accents.css, which owns the values; these mirror them for JS that cannot read CSS (chart
 * canvases, the desktop shell, docs tables).
 */
export const ACCENTS_DARK = {
  indigo: "#99a5ff",
  blue: "#7fabff",
  teal: "#49bbae",
  violet: "#b39dff",
  rose: "#ff848c",
  red: "#ff8582",
  orange: "#ff885b",
  black: "#c9c9d4",
} as const;

/** `indigo` is the default. */
export type Accent = keyof typeof ACCENTS;

/** The accent hex actually painted for a resolved theme. */
export function accentHex(accent: Accent, theme: ResolvedTheme): string {
  return theme === "dark" ? ACCENTS_DARK[accent] : ACCENTS[accent];
}

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
