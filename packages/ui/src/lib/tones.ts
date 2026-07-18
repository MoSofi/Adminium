/**
 * lib/tones.ts — the canonical home of the semantic tone vocabulary and the
 * status→tone registry (workplan/03-component-library.md §3.3, §7.6).
 *
 * The SINGLE source of truth: components/icon-tile, components/badge and
 * components/status-pill re-export from here (their wave-1 local copies are
 * gone), so there is exactly one `Tone` union, one class map per recipe, and
 * one status→tone registry instance. New code must import from this module.
 */

/** Semantic tone vocabulary shared across the library. */
export type Tone = 'neutral' | 'accent' | 'pos' | 'warn' | 'danger' | 'info';

/** Every tone, in canonical display order (stories, matrices). */
export const TONES: readonly Tone[] = ['neutral', 'accent', 'pos', 'warn', 'danger', 'info'];

/** Tone → soft background + strong tone foreground utility pairs. */
export const toneSoftClasses: Record<Tone, string> = {
  neutral: 'bg-surface-3 text-fg-muted',
  accent: 'bg-accent-soft text-accent',
  pos: 'bg-pos-soft text-pos',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
};

/** Tone → solid background + on-tone foreground utility pairs. */
export const toneSolidClasses: Record<Tone, string> = {
  neutral: 'bg-surface-3 text-fg',
  accent: 'bg-accent text-accent-fg',
  pos: 'bg-pos text-white',
  warn: 'bg-warn text-white',
  danger: 'bg-danger text-white',
  info: 'bg-info text-white',
};

/**
 * Tone → `color-mix` border utilities used by Alert/Banner callouts
 * (tone-soft bg + 30%-mixed tone border, research/design-system.md §3 Tier 3).
 */
export const toneMixBorderClasses: Record<Tone, string> = {
  neutral: 'border-border',
  accent: 'border-[color-mix(in_srgb,var(--accent)_30%,transparent)]',
  pos: 'border-[color-mix(in_srgb,var(--pos)_30%,transparent)]',
  warn: 'border-[color-mix(in_srgb,var(--warn)_30%,transparent)]',
  danger: 'border-[color-mix(in_srgb,var(--danger)_30%,transparent)]',
  info: 'border-[color-mix(in_srgb,var(--info)_30%,transparent)]',
};

/**
 * Sticky translucent bar recipe (workplan/03-component-library.md §7.5) —
 * used by `Topbar`, `WizardLayout` footer and sticky table headers. Exported
 * from here so the color-mix recipe lives in exactly one place.
 */
export const glassBar =
  'sticky top-0 z-40 border-b border-border bg-[color-mix(in_srgb,var(--surface)_82%,transparent)] backdrop-blur-[8px]';

/**
 * Default status→tone registry (workplan/03-component-library.md §7.6).
 * Extended at runtime via `registerStatusTones` (widgets/manifests register
 * domain statuses); tints always derive from the tone — never hardcoded per
 * feature (the "Ticket Queue hardcoded priority tint" defect fix).
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
