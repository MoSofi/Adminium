import { getFormatters } from '@adminium/i18n';
import { CountBadge } from '@adminium/ui';
import { z } from 'zod';

import { mulberry32 } from './feed-lib.js';
import type { WidgetProps } from '../../registry/types.js';
import { widgetSharedConfigSchema } from '../../registry/shared-config.js';

/**
 * `unread-badge` (annex §4) — a count pill on nav items / tabs / page titles,
 * live-synced with feed state ("{n} new"). Binds to a single derived integer
 * (`single-metric`). Overflows to "{max}+"; optionally hides at zero.
 */

export const unreadBadgeConfigSchema = widgetSharedConfigSchema.extend({
  /** Overflow cap — counts above render as "{max}+". */
  max: z.number().int().min(1).max(9999).default(99),
  /** Hide the pill entirely when the count is zero (nav-item behavior). */
  hideZero: z.boolean().default(true),
  /** Solid accent treatment (unread) vs neutral surface pill. */
  active: z.boolean().default(true),
  /** Accessible label suffix, e.g. "unread". */
  unitLabel: z.string().optional(),
});
export type UnreadBadgeConfig = z.infer<typeof unreadBadgeConfigSchema>;

/** Format a count with locale digits + overflow cap. */
export function formatCount(value: number, max: number, locale?: string): string {
  const n = Math.max(0, Math.trunc(value));
  if (n > max) return `${getFormatters(locale ?? 'en-US').number(max)}+`;
  return getFormatters(locale ?? 'en-US').number(n);
}

export interface UnreadBadgeProps {
  count: number;
  max?: number | undefined;
  hideZero?: boolean | undefined;
  active?: boolean | undefined;
  unitLabel?: string | undefined;
  locale?: string | undefined;
  testId?: string | undefined;
}

export function UnreadBadge({
  count,
  max = 99,
  hideZero = true,
  active = true,
  unitLabel,
  locale,
  testId,
}: UnreadBadgeProps) {
  const n = Math.max(0, Math.trunc(count));
  if (hideZero && n === 0) return null;
  const text = formatCount(n, max, locale);
  return (
    <CountBadge
      active={active}
      data-widget="unread-badge"
      data-testid={testId}
      aria-label={unitLabel === undefined ? undefined : `${text} ${unitLabel}`}
    >
      {text}
    </CountBadge>
  );
}

function countOf(data: unknown): number {
  if (typeof data === 'number') return data;
  if (typeof data === 'object' && data !== null) {
    const value = (data as { value?: unknown }).value;
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  }
  return 0;
}

export function UnreadBadgeWidget({ config, data }: WidgetProps<UnreadBadgeConfig>) {
  return (
    <UnreadBadge
      count={countOf(data)}
      max={config.max}
      hideZero={config.hideZero}
      active={config.active}
      {...(config.unitLabel === undefined ? {} : { unitLabel: config.unitLabel })}
      {...(config.format?.locale === undefined ? {} : { locale: config.format.locale })}
    />
  );
}

/** Deterministic non-zero count (04 §7.7). */
export function unreadBadgeDemoData(seed: number): { value: number } {
  const random = mulberry32(seed || 1);
  return { value: Math.floor(random() * 40) + 1 };
}
