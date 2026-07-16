import { MonoText } from '@adminium/ui';
import type { Tone } from '@adminium/ui';
import type { ReactNode } from 'react';

import { formatAbsoluteTime, formatRelativeTime } from '../tables/column-spec.js';

/**
 * Shared helpers for the `feeds` family (annex §4) — tone normalization, the
 * "actor action target" sentence renderer (bold actor/target, mono target ids),
 * and a relative-timestamp element. Kept framework-light: no i18n provider
 * dependency, so widgets stay pure and render in stories/tests without a
 * wrapper (the dashboard resolves labels through @adminium/i18n at the host
 * boundary, like the rest of the registry — 04 §2, 04-T06).
 *
 * The deterministic demo primitives live in the framework-free `feed-demo-lib`
 * leaf, because the pure `feeds-config` module needs them and must not reach
 * the JSX below (04 §2.3). They are re-exported here so this module stays the
 * one import point the family's components use.
 */
export { DEMO_EPOCH, MS_DAY, mulberry32, pickFrom } from './feed-demo-lib.js';

const KNOWN_TONES: ReadonlySet<string> = new Set([
  'neutral',
  'accent',
  'pos',
  'warn',
  'danger',
  'info',
]);

/** Coerce an untrusted tone string to a valid `Tone`, defaulting to neutral. */
export function toneOf(value: unknown, fallback: Tone = 'neutral'): Tone {
  return typeof value === 'string' && KNOWN_TONES.has(value) ? (value as Tone) : fallback;
}

/**
 * "actor action target" event sentence (annex §4): bold actor, muted verb,
 * bold + mono-ish target. Any part may be omitted. Targets that look like
 * identifiers (contain `#`, `/`, `_`, or `.`) render in JetBrains Mono.
 */
export function FeedSentence({
  actor,
  action,
  target,
}: {
  actor?: string | undefined;
  action?: string | undefined;
  target?: string | undefined;
}): ReactNode {
  const monoTarget =
    target !== undefined && /[#/_.]/.test(target) && !/\s/.test(target);
  return (
    <span className="text-body-sm text-fg-muted">
      {actor !== undefined && <span className="font-semibold text-fg">{actor}</span>}
      {action !== undefined && <span>{actor === undefined ? '' : ' '}{action}</span>}
      {target !== undefined &&
        (monoTarget ? (
          <>
            {' '}
            <MonoText className="font-semibold text-fg">{target}</MonoText>
          </>
        ) : (
          <span className="font-semibold text-fg"> {target}</span>
        ))}
    </span>
  );
}

/**
 * Relative timestamp (`3h ago`) with an absolute-time `title` tooltip. `now`
 * is injectable so tests are deterministic; production defaults to the wall
 * clock. Mono + `whitespace-nowrap` for the trailing metadata slot.
 */
export function RelativeTime({
  iso,
  now,
  locale,
  className,
}: {
  iso: string;
  now?: number | undefined;
  locale?: string | undefined;
  className?: string | undefined;
}): ReactNode {
  return (
    <time
      dateTime={iso}
      title={formatAbsoluteTime(iso, locale)}
      className={`whitespace-nowrap font-mono text-caption tabular-nums text-fg-subtle ${className ?? ''}`}
    >
      {formatRelativeTime(iso, { locale, ...(now === undefined ? {} : { now }) })}
    </time>
  );
}

/** A `record-list` envelope's rows — tolerant of the bare-array shorthand. */
export function feedRowsOf(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (typeof data === 'object' && data !== null) {
    const envelope = data as { data?: unknown; snapshot?: unknown };
    if (Array.isArray(envelope.data)) return envelope.data as Record<string, unknown>[];
    if (Array.isArray(envelope.snapshot)) return envelope.snapshot as Record<string, unknown>[];
  }
  return [];
}
