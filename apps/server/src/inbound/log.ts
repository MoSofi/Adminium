// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Keeping the door's token out of the request log.
 *
 * The path token is part of what lets a call in, and the request log prints
 * paths. `log-scrub.ts` calls this at merge, beside its other doors. Segments
 * are compared decoded, because the router also accepts `/api/v1/%69nbound/…`.
 */

/** The censor `log-scrub.ts` writes. Not imported from it, because that file calls this one. */
const REDACTED = '[REDACTED]';

const PREFIX = ['', 'api', 'v1', 'inbound'] as const;

function segmentName(raw: string): string {
  let name = raw;
  try {
    name = decodeURIComponent(raw);
  } catch {
    // Compared as sent.
  }
  return (name.split(';', 1)[0] ?? '').toLowerCase();
}

/**
 * The path with its token replaced, or null when it is not this door's. A
 * channel and source stay readable only when they are known ones. Anything
 * else may be a token pasted a segment early, so everything from it on goes.
 */
export function scrubInboundPath(segments: readonly string[], known: Readonly<Record<string, readonly string[]>>): string | null {
  if (segments.length <= PREFIX.length) return null;
  if (!PREFIX.every((name, index) => segmentName(segments[index] ?? '') === name)) return null;
  const channel = segmentName(segments[PREFIX.length] ?? '');
  const sources = Object.hasOwn(known, channel) ? known[channel] : undefined;
  if (sources === undefined) return `${segments.slice(0, PREFIX.length).join('/')}/${REDACTED}`;
  if (segments.length === PREFIX.length + 1) return null;
  const source = segmentName(segments[PREFIX.length + 1] ?? '');
  const keep = PREFIX.length + (sources.includes(source) ? 2 : 1);
  if (segments.length === keep) return null;
  return `${segments.slice(0, keep).join('/')}/${REDACTED}`;
}
