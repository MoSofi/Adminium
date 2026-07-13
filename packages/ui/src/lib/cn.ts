/**
 * `cn()` — the single class-composition utility for `@adminium/ui`
 * (workplan/03-component-library.md §2, §3.1).
 *
 * clsx handles conditional/array inputs; tailwind-merge resolves conflicting
 * Tailwind utilities so the consumer `className` (always passed last by
 * components) wins over CVA-produced classes.
 */
import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';
import type { CSSProperties } from 'react';

export type { ClassValue } from 'clsx';

/**
 * tailwind-merge must be taught the @adminium/tokens custom utilities, or it
 * mis-buckets them: without this, `text-micro` (type scale) and `text-fg-subtle`
 * (color) both land in the ambiguous `text-*` group and one silently wins.
 * Keep these lists in sync with packages/tokens/src/tailwind.css `@theme`.
 */
const TOKEN_FONT_SIZES = ['display', 'title', 'section', 'modal', 'body', 'body-sm', 'caption', 'micro'];
const TOKEN_COLORS = [
  'bg', 'surface', 'surface-2', 'surface-3', 'border', 'border-strong',
  'fg', 'fg-muted', 'fg-subtle',
  'accent', 'accent-fg', 'accent-soft', 'accent-hover', 'accent-border',
  'pos', 'pos-soft', 'warn', 'warn-soft', 'danger', 'danger-soft', 'info', 'info-soft',
  ...Array.from({ length: 8 }, (_, i) => `viz-${i + 1}`),
];

const twMerge = extendTailwindMerge({
  extend: {
    theme: { color: TOKEN_COLORS },
    classGroups: {
      'font-size': [{ text: TOKEN_FONT_SIZES }],
      shadow: [{ shadow: ['card', 'menu', 'modal', 'glow'] }],
    },
  },
});

/** Compose class names; later Tailwind utilities override earlier conflicts. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * A map of CSS custom properties (`--*` keys only) to their values.
 * `null`/`undefined` entries are dropped, numbers are stringified.
 */
export type CssVarMap = Record<`--${string}`, string | number | null | undefined>;

/**
 * `cssVars()` — typed builder for CSS-custom-property bags
 * (workplan/03-component-library.md §3.4).
 *
 * The JSX `style` prop is banned (`adminium/no-style-prop`); its single
 * sanctioned escape hatch is an INLINE object literal whose every key is a
 * string-literal custom property, e.g. `style={{ '--progress': pct }}` — the
 * lint rule cannot see inside a call expression, so `style={cssVars(...)}`
 * is still reported. Use this helper for the non-JSX surfaces of the same
 * mechanism: imperative writes (`Object.assign(el.style, cssVars({...}))`),
 * chart geometry passed to third-party APIs, and for typing the objects that
 * component props accept before they are inlined at the JSX call site.
 */
export function cssVars(vars: CssVarMap): CSSProperties {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(vars)) {
    if (value !== null && value !== undefined) out[key] = String(value);
  }
  return out as CSSProperties;
}
