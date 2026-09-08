// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The eight style axes as canvas classes (the comp's `wrapOf`, 1407-1419;
 * 39-email-templates-and-campaigns.md Appendix A §E2). The mail body is
 * ALWAYS LIGHT, so the greys are the comp's literals; the accent rides the
 * `--adm-email-accent` custom property the shell sets (D15).
 *
 * `full` bleeds the block to the paper's edges: the body has 28 px side
 * padding, so the wrapper pulls out by that much and pads back in.
 */
import type { EmailBlockStyle } from '../../api.js';

const PAD: Record<NonNullable<EmailBlockStyle['pad']>, string> = {
  none: 'p-0',
  s: 'px-3 py-2.5',
  m: 'px-[18px] py-4',
  l: 'px-[26px] py-6',
};
const BG: Record<NonNullable<EmailBlockStyle['bg']>, string> = {
  none: 'bg-transparent',
  soft: 'bg-[#fafafa]',
  tint: 'bg-[color-mix(in_srgb,var(--adm-email-accent)_12%,transparent)]',
  accent: 'bg-[var(--adm-email-accent)]',
  dark: 'bg-[#17171c]',
};
const FG: Record<NonNullable<EmailBlockStyle['fg']>, string> = {
  auto: 'text-[#55555f]',
  strong: 'text-[#17171c]',
  muted: 'text-[#6b6b76]',
  accent: 'text-[var(--adm-email-accent)]',
  white: 'text-white',
};
const SIZE: Record<NonNullable<EmailBlockStyle['size']>, string> = {
  s: 'text-[12px]',
  m: 'text-[13.5px]',
  l: 'text-[15.5px]',
};
const ALIGN: Record<NonNullable<EmailBlockStyle['align']>, string> = {
  start: 'text-start',
  center: 'text-center',
  end: 'text-end',
};
const BORDER: Record<NonNullable<EmailBlockStyle['border']>, string> = {
  none: 'border-0',
  thin: 'border border-[#ececef]',
  dashed: 'border-[1.5px] border-dashed border-[#e2e2e8]',
};
const RADIUS: Record<NonNullable<EmailBlockStyle['radius']>, string> = {
  none: 'rounded-none',
  md: 'rounded-[10px]',
  lg: 'rounded-2xl',
};

/** The wrapper's classes for one block; `first` drops the 30 px gap above. */
export function blockWrapperClasses(style: EmailBlockStyle, first: boolean): string {
  const full = style.full === true;
  return [
    first ? 'mt-0' : 'mt-[30px]',
    'leading-[1.6]',
    PAD[style.pad ?? 'none'],
    BG[style.bg ?? 'none'],
    FG[style.fg ?? 'auto'],
    SIZE[style.size ?? 'm'],
    ALIGN[style.align ?? 'start'],
    BORDER[style.border ?? 'none'],
    full ? 'rounded-none -mx-7 px-7' : RADIUS[style.radius ?? 'md'],
  ].join(' ');
}

/** `1,234.56` — the comp's `money` (1421), a fixed two-decimal `en-US` figure. */
export function money(value: unknown): string {
  const n = Number(value);
  return (Number.isFinite(n) ? n : 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function str(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
}

export function num(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function rows<T extends Record<string, unknown>>(value: unknown): T[] {
  return Array.isArray(value) ? value.filter((row): row is T => typeof row === 'object' && row !== null) : [];
}

export function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => str(item)) : [];
}

/**
 * The comp's kicker (10.5 px, uppercase, muted); `mb-2` only when there is one.
 * MUTED IS `#6b6b76`, NOT THE COMP'S `#9a9aa5`: on white the comp's grey is
 * 2.78:1 and fails WCAG AA (axe blocks on it); `#6b6b76` is 5.3:1 and the
 * design system's light `--fg-muted` — the comp's own fallback value. Applies
 * to every muted text on the canvas; the mail renderer is a separate concern
 * (§6.1).
 */
export const KICKER = 'text-[10.5px] font-bold uppercase tracking-[.05em] text-[#6b6b76]';
