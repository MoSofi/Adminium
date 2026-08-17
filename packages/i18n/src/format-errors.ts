// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Bounded ring of ICU format failures (23-runtime-translations.md §4.5, T12).
 *
 * When a message throws at format time, `IcuFormat` returns the RAW string —
 * so the user sees `{count, plural, one {…}}` sitting in the UI — and logs one
 * `console.warn`. For compiled bundles that is acceptable: the parity gate
 * makes it nearly impossible, and a developer sees the console.
 *
 * For admin-authored overrides it is not. The person who caused the failure is
 * an admin in the Translations editor, not a developer with devtools open, and
 * the write validator cannot catch everything (it checks the message against
 * its source, but the ARGUMENTS a call site actually passes are not knowable
 * statically). So failures land here, and the editor can show them.
 *
 * Deliberately bounded and in-memory: this is a diagnostic aid, not an audit
 * trail. A runaway render loop over one bad message must not grow without
 * limit.
 */

export interface FormatFailure {
  /** `namespace:key` where resolvable, else the bare key i18next gave us. */
  key: string;
  /** Language the failure happened under. */
  lng: string;
  message: string;
  /** Epoch ms; the caller supplies it so this module stays clock-free. */
  at: number;
  /** How many times this exact (key, lng, message) has failed. */
  count: number;
}

const MAX_ENTRIES = 50;

/**
 * Keyed by `key\0lng\0message` so a repeat increments rather than evicts.
 *
 * Insertion order is maintained as RECENCY order (see the re-insert below), so
 * the first key is always the least recently seen — which is exactly what
 * eviction takes.
 */
const failures = new Map<string, FormatFailure>();

export function recordFormatFailure(input: Omit<FormatFailure, 'count'>): void {
  const id = `${input.key}\x00${input.lng}\x00${input.message}`;
  const existing = failures.get(id);
  if (existing !== undefined) {
    existing.count += 1;
    existing.at = input.at;
    // Re-insert to move this key to the end. Updating in place would leave it
    // wherever it first landed, and eviction below takes the FIRST key — so a
    // message that is still failing would be evicted by unrelated one-offs.
    // That runaway loop is the case this ring exists for; it must survive.
    failures.delete(id);
    failures.set(id, existing);
    return;
  }
  if (failures.size >= MAX_ENTRIES) {
    const oldest = failures.keys().next().value;
    if (oldest !== undefined) failures.delete(oldest);
  }
  failures.set(id, { ...input, count: 1 });
}

/**
 * Most recent first.
 *
 * Entries are COPIED: the records are mutated in place on every repeat, so
 * handing out live references would let a caller's snapshot change under it
 * (and let a caller write into the ring). `Readonly` states that guarantee;
 * the copy is what actually provides it.
 */
export function formatFailures(): readonly Readonly<FormatFailure>[] {
  return [...failures.values()].map((f) => ({ ...f })).sort((a, b) => b.at - a.at);
}

export function clearFormatFailures(): void {
  failures.clear();
}
