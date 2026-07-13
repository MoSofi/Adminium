import type * as React from 'react';

import { Badge } from '../badge/Badge.js';
import type { BadgeProps, Tone } from '../badge/Badge.js';

/**
 * Default status→tone registry (workplan/03-component-library.md §7.6).
 * Extended at runtime via `registerStatusTones` (widgets/manifests register
 * domain statuses); tints always derive from the tone — never hardcoded.
 */
export const DEFAULT_STATUS_TONES: Readonly<Record<string, Tone>> = Object.freeze({
  paid: 'pos',
  active: 'pos',
  connected: 'pos',
  completed: 'pos',
  published: 'pos',
  healthy: 'pos',
  pending: 'warn',
  trialing: 'warn',
  queued: 'warn',
  degraded: 'warn',
  past_due: 'warn',
  failed: 'danger',
  error: 'danger',
  suspended: 'danger',
  overdue: 'danger',
  canceled: 'danger',
  refunded: 'info',
  running: 'info',
  syncing: 'info',
  scheduled: 'info',
  draft: 'neutral',
  archived: 'neutral',
  inactive: 'neutral',
  disabled: 'neutral',
});

const registry = new Map<string, Tone>(Object.entries(DEFAULT_STATUS_TONES));

/** Idempotent merge of domain statuses into the status→tone registry. */
export function registerStatusTones(map: Record<string, Tone>): void {
  for (const [status, tone] of Object.entries(map)) {
    registry.set(status.toLowerCase(), tone);
  }
}

/** Resolve the semantic tone for a status key (case-insensitive). */
export function statusTone(status: string, fallback: Tone = 'neutral'): Tone {
  return registry.get(status.toLowerCase()) ?? fallback;
}

export interface StatusPillProps extends Omit<BadgeProps, 'tone' | 'dot' | 'asChild'> {
  /** Status key resolved through the status→tone registry (`statusTone`). */
  status: string;
  /** Explicit tone override — skips the registry lookup. */
  tone?: Tone;
  /** Tone used when the status is not in the registry. Default `neutral`. */
  fallbackTone?: Tone;
  /** Localized label. Defaults to the raw status key (developer fallback). */
  children?: React.ReactNode;
}

/**
 * Badge preset with a status dot; tone driven by the semantic status→tone
 * registry (research/design-system.md §3 Tier 1).
 */
export function StatusPill({ status, tone, fallbackTone = 'neutral', children, ...props }: StatusPillProps) {
  return (
    <Badge tone={tone ?? statusTone(status, fallbackTone)} dot data-status={status} {...props}>
      {children ?? status}
    </Badge>
  );
}
