// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the engine keeps about each source of one install, without ever
 * holding a key: one document per install (`add-on-sources:<installId>`), in
 * the same documents store payments keep their setup in.
 *
 * Per source: the last four characters of the saved key and when it was
 * saved, the last Check and what it found (accepted, refused, could not
 * reach), the switch, the daily cap and the share of it one person may
 * spend. The switch and the caps live here and not in the add-on's settings
 * table: the engine reads them before every call, and the add-on's own code
 * can never write them.
 *
 * A source the document does not name yet reads with its defaults: off until
 * a key is saved (on at once for a source that needs none), a daily cap of
 * 100 calls for a paid source (none for a free one), and half of the day's
 * cap for any one person.
 *
 * Every change goes through `mutateSourcesState`: one writer per install at
 * a time, always over the latest document, so a slow Check never writes back
 * a switch somebody turned off meanwhile.
 */
import { paymentSettingsRepo, type MetaDb } from '@adminium/meta';
import { z } from 'zod';

import { withServiceLock } from '../payments/services.js';
import { SOURCE_ID_RE } from './keys.js';
import type { LeadSourceEntry } from './pending-types.js';

/** The document's name for one install. */
export function sourcesDocName(installId: string): string {
  return `add-on-sources:${installId}`;
}

/** A paid source's daily cap before the owner sets one. */
export const DEFAULT_DAILY_CAP = 100;
/** The share of a day's cap one person may spend, in per cent, before the owner sets one. */
export const DEFAULT_PERSON_SHARE = 50;
/** The highest daily cap an owner may set. */
export const MAX_DAILY_CAP = 100_000;

export const SOURCE_VERDICTS = ['accepted', 'refused', 'unreachable'] as const;
export type SourceVerdict = (typeof SOURCE_VERDICTS)[number];

export const sourceStateSchema = z
  .object({
    /** The last four characters of the saved key ('' for a key too short to show any); null when none is saved. */
    lastFour: z.string().max(4).nullable(),
    savedAt: z.number().int().nonnegative().nullable(),
    checkedAt: z.number().int().nonnegative().nullable(),
    verdict: z.enum(SOURCE_VERDICTS).nullable(),
    on: z.boolean(),
    /** Calls a day across everybody; null: no cap (a free source the owner left uncapped). */
    dailyCap: z.number().int().min(1).max(MAX_DAILY_CAP).nullable(),
    /** The per cent of the daily cap one person may spend; null: no share. */
    personShare: z.number().int().min(1).max(100).nullable(),
  })
  .strict();
export type SourceState = z.infer<typeof sourceStateSchema>;

export const sourcesStateSchema = z
  .object({
    v: z.literal(1),
    sources: z.record(z.string().regex(SOURCE_ID_RE), sourceStateSchema),
  })
  .strict();
export type SourcesState = z.infer<typeof sourcesStateSchema>;

export function emptySourcesState(): SourcesState {
  return { v: 1, sources: {} };
}

/** Whether a source is called with a key of the owner's. The website reader and the open registers are not. */
export function needsKey(entry: LeadSourceEntry): boolean {
  return entry.reads !== 'website' && entry.key !== undefined;
}

/** A source's state before anything was saved for it. */
export function defaultSourceState(entry: LeadSourceEntry): SourceState {
  return {
    lastFour: null,
    savedAt: null,
    checkedAt: null,
    verdict: null,
    on: !needsKey(entry),
    dailyCap: entry.paid === true ? DEFAULT_DAILY_CAP : null,
    personShare: DEFAULT_PERSON_SHARE,
  };
}

/** One source's state, its defaults filled in where the document says nothing of it. */
export function sourceStateOf(document: SourcesState, entry: LeadSourceEntry): SourceState {
  return document.sources[entry.id] ?? defaultSourceState(entry);
}

/** The install's document as stored, or an empty one. */
export async function readSourcesState(meta: MetaDb, installId: string): Promise<SourcesState> {
  return (await paymentSettingsRepo(meta).get(sourcesDocName(installId), sourcesStateSchema)) ?? emptySourcesState();
}

/** The lock every writer of one install's sources holds: its keys and its document change together. */
export function withSourcesLock<T>(installId: string, run: () => Promise<T>): Promise<T> {
  return withServiceLock(`add-on-sources:${installId}`, run);
}

/**
 * Reads the latest document, changes one source, writes it back, under the
 * install's lock. `change` is handed the source's state with its defaults
 * filled in.
 */
export async function mutateSourceState(
  meta: MetaDb,
  installId: string,
  entry: LeadSourceEntry,
  change: (state: SourceState) => SourceState,
  at: number = Date.now(),
): Promise<SourceState> {
  return withSourcesLock(installId, () => writeSourceState(meta, installId, entry, change, at));
}

/** As `mutateSourceState`, for a caller that already holds the install's lock. */
export async function writeSourceState(
  meta: MetaDb,
  installId: string,
  entry: LeadSourceEntry,
  change: (state: SourceState) => SourceState,
  at: number = Date.now(),
): Promise<SourceState> {
  const docs = paymentSettingsRepo(meta);
  const current = await readSourcesState(meta, installId);
  const next = sourceStateSchema.parse(change(sourceStateOf(current, entry)));
  await docs.set(sourcesDocName(installId), sourcesStateSchema, { ...current, sources: { ...current.sources, [entry.id]: next } }, at);
  return next;
}

/** An install is gone: its document goes with it. */
export async function forgetSourcesState(meta: MetaDb, installId: string): Promise<void> {
  await withSourcesLock(installId, () => paymentSettingsRepo(meta).remove(sourcesDocName(installId)));
}
