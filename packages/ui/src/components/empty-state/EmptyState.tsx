import { CalendarX2, CheckCircle2, Inbox, SearchX } from 'lucide-react';
import type { ComponentPropsWithRef, ReactNode } from 'react';

import { cn } from '../../lib/cn.js';
import type { Tone } from '../../lib/tones.js';
import { IconTile } from '../icon-tile/IconTile.js';

export type EmptyStatePreset = 'no-data' | 'all-caught-up' | 'no-matches' | 'nothing-scheduled';

/**
 * Preset → default icon + tile tone (designs/Empty States anatomy). Text is
 * always supplied via props — presets carry icons + spacing only.
 */
const presetDefaults: Record<EmptyStatePreset, { icon: ReactNode; tone: Tone }> = {
  'no-data': { icon: <Inbox />, tone: 'accent' },
  'all-caught-up': { icon: <CheckCircle2 />, tone: 'pos' },
  'no-matches': { icon: <SearchX />, tone: 'neutral' },
  'nothing-scheduled': { icon: <CalendarX2 />, tone: 'neutral' },
};

export interface EmptyStateProps extends Omit<ComponentPropsWithRef<'div'>, 'title'> {
  /** Layout preset supplying the default icon + tone (text via props). */
  preset?: EmptyStatePreset | undefined;
  /** Override the tile icon. */
  icon?: ReactNode;
  /** Override the tile tone. */
  tone?: Tone | undefined;
  /** Headline ("No invoices yet"). */
  title: ReactNode;
  /** Guidance copy ("Create your first invoice to get started."). */
  body?: ReactNode;
  /** CTA row (Buttons). */
  actions?: ReactNode;
  /** Compact paddings for embedded contexts (table bodies, cards). */
  compact?: boolean | undefined;
}

/**
 * EmptyState — 56px icon tile + headline + guidance + action row with layout
 * presets `no-data / all-caught-up / no-matches / nothing-scheduled`
 * (research/design-system.md §3 Tier 3).
 */
export function EmptyState({
  preset = 'no-data',
  icon,
  tone,
  title,
  body,
  actions,
  compact = false,
  className,
  children,
  ...props
}: EmptyStateProps) {
  const defaults = presetDefaults[preset];
  return (
    <div
      data-preset={preset}
      className={cn(
        'flex flex-col items-center text-center',
        compact ? 'px-4 py-8' : 'px-6 py-14',
        className,
      )}
      {...props}
    >
      <IconTile size="xl" tone={tone ?? defaults.tone} icon={icon ?? defaults.icon} />
      <h3 className="mt-4 text-section text-fg">{title}</h3>
      {body === undefined || body === null ? null : (
        <p className="mt-1 max-w-[380px] text-body-sm text-fg-muted">{body}</p>
      )}
      {children}
      {actions === undefined || actions === null ? null : (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{actions}</div>
      )}
    </div>
  );
}
