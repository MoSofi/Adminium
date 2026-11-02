// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ONE ROW MADE BY A STRANGER: the create both the public API and the forms
 * door make, so the two can never hold a stranger's row to different rules.
 *
 * In order:
 *  1. a column the entry holds to plain text (a name, a note) is refused
 *     when it holds a web or e-mail address, before anything is counted;
 *  2. the entry's limits on a create nobody signed in for are charged
 *     (`anonymous-caps.ts`): so many a day per value, an hour per key, an
 *     hour per visitor. Over any of them, nothing is written;
 *  3. text no engine keeps alike is refused, then the row is written through the write service, with the entry's own
 *     refusal mapping (a constraint is never named to a stranger);
 *  4. once it is written: the caller's own record of it (the public API's
 *     audit row), the dashboard's widgets told to read again, the realtime
 *     frame for staff, the record event with `origin: 'public'` (so a "when a
 *     record is created" rule sees it), and what it handed to a ledger;
 *  5. a refused write gives back what the caps counted for it (all of it, or
 *     all but the visitor's own hour, as the caller's refusal says).
 *  6. What the row moved (a parent `moveOnCreate` changed) is told once it
 *     has committed.
 *
 * A child row checked against its parent is the public API's alone: it hands
 * its own `run`, given the plain create and the announcement to use.
 */
import type { RecordRef } from '@adminium/meta';
import type { FastifyInstance } from 'fastify';

import { emitRecordEvent, invalidateWidgetData } from '../crud/after-record-write.js';
import type { PostedOutcome } from '../crud/ledger-write.js';
import type { Row } from '../crud/mask.js';
import { unstorableText } from '../crud/column-rules.js';
import { pkLabel } from '../crud/records.js';
import type { EffectWritten } from '../crud/states.js';
import type { RecordWriteService, WriteContext, WriteTarget } from '../crud/write-service.js';
import { ValidationFailedError } from '../errors.js';
import { tellPostings } from '../ledgers/announce.js';
import { announceEffects, effectsOf } from '../states/effects.js';
import { chargeAnonymous, notPlain, type AnonymousCaps } from './anonymous-caps.js';
import { publishPublicWrite } from './publish.js';
import type { PublicChallengesRepo } from '@adminium/meta';

/** Who made the row, as the ledger's announcements name a stranger. */
const PUBLIC_ACTOR = { id: null, label: 'Public', kind: 'system' } as const;

/** The plain create, for a caller's own `run`: `told` hears of the row once it is written. */
export type CreateOne = (on: WriteTarget, told: (row: Row) => Promise<void>, recheck?: (values: Row) => Promise<void>) => Promise<Row>;

export interface PublicRowInput {
  app: FastifyInstance;
  writes: RecordWriteService;
  /** Where the caps' markers are kept, and the key they are hashed under. */
  challenges: Pick<PublicChallengesRepo, 'mark' | 'sentSince' | 'unmark'>;
  capKey: Buffer;
  target: WriteTarget;
  values: Row;
  context: WriteContext;
  /** The entry's limits on a create nobody signed in for; null when it has none. */
  caps: AnonymousCaps | null;
  /** Charge the caps: who is counted (the key, the entry, the visitor); null when they are not charged (a signed-in person's own row). */
  charge: { keyId: string; ref: string; ip: string } | null;
  /** The entry's refusal of a write: throws what the caller answers. */
  mapError: (error?: unknown) => never;
  /** The caller's own record of the row (the public API's audit row), before anything else is told. */
  recorded?: (row: Row, ref: RecordRef) => Promise<void>;
  /** The write itself when it is more than the plain create; the plain one when absent. */
  run?: (helpers: { create: CreateOne; announce: (row: Row) => Promise<void>; moved: EffectWritten[] }) => Promise<Row>;
  /** Whether a refused write keeps the visitor's own hour counted (a full slot): every marker goes back otherwise. */
  keepsVisitor?: (error: unknown) => boolean;
  /** Tried before a refusal is thrown on: a code typed that missed is a guess spent. */
  refused?: (error: unknown) => void;
  now?: number;
}

export type PublicRowOutcome =
  | { ok: true; row: Row }
  /** A plain-text column that holds more than plain text: nothing was counted or written. */
  | { ok: false; why: 'plain-text'; column: string }
  /** One of the caps is full: nothing was written. */
  | { ok: false; why: 'limit' };

/** Makes one row as a stranger makes it (see the header). A refused write throws, its caps given back. */
export async function createPublicRow(input: PublicRowInput): Promise<PublicRowOutcome> {
  const { app, target, values } = input;
  const caps = input.caps;
  // A name that is only a name, signed in or not.
  const unplain = caps === null ? null : notPlain(caps, values);
  if (unplain !== null) return { ok: false, why: 'plain-text', column: unplain };

  let release: (() => Promise<void>) | null = null;
  let releaseAllButVisitor: (() => Promise<void>) | null = null;
  if (caps !== null && input.charge !== null) {
    const charged = await chargeAnonymous(input.challenges, {
      caps,
      key: input.capKey,
      keyId: input.charge.keyId,
      connectionId: target.connectionId,
      table: target.table.id,
      ref: input.charge.ref,
      values,
      now: input.now ?? Date.now(),
      ip: input.charge.ip,
    });
    if (!charged.ok) return { ok: false, why: 'limit' };
    release = charged.release;
    releaseAllButVisitor = charged.releaseAllButVisitor ?? charged.release;
  }

  const announce = async (row: Row): Promise<void> => {
    const pk = Object.fromEntries(target.table.primaryKey.map((c) => [c, row[c]]));
    const ref: RecordRef = { connectionId: target.connectionId, table: target.table.id, pk, label: pkLabel(target.table, pk) };
    await input.recorded?.(row, ref);
    /*
     * The UNPROJECTED row, deliberately. What comes back to the anonymous
     * caller is narrowed by the caller, because a create must not return
     * more than a read of the same row would — but the stream's subscribers
     * are signed-in staff holding a table-read grant. The publisher masks it
     * for PII and secrets on the way out, which is the check that applies.
     */
    invalidateWidgetData(app, target.connectionId, target.table.id);
    publishPublicWrite(app.hasDecorator('realtime') ? app.realtime : null, { connectionId: target.connectionId, table: target.table, action: 'create', pk, row });
    /*
     * The sign-ups a rule most needs to see. A public create never reaches
     * `routes/data`, so without this a "when a record is created" rule would
     * be blind to exactly the rows strangers make. No undo window: nobody can
     * take a stranger's write back.
     */
    await emitRecordEvent(app, { connectionId: target.connectionId, table: target.table, action: 'create', entity: ref, before: null, after: row, origin: 'public' });
  };

  /** The parent the new row moved (`moveOnCreate`), heard of once the write has committed. */
  const moved: EffectWritten[] = [];
  const create: CreateOne = (on, told, recheck) => {
    // The row's own announcement, then what it handed to a ledger.
    const announceWritten = async (row: Row, written: Row, posted?: readonly PostedOutcome[]): Promise<void> => {
      moved.push(...effectsOf(written));
      await told(row);
      await tellPostings(app, { connectionId: target.connectionId, view: target.view, postings: posted, origin: 'public', actor: PUBLIC_ACTOR });
    };
    return input.writes.create({
      target: on,
      values,
      context: input.context,
      ...(recheck === undefined ? {} : { recheck }),
      /*
       * A constraint violation is not spelled out: the detail that names it
       * tells an anonymous caller which values already exist. A value refused
       * for itself, in a column the entry writes, is named by `mapError`.
       */
      mapError: input.mapError,
      announce: announceWritten,
    });
  };

  let row: Row;
  try {
    /*
     * Text no engine keeps alike is refused before a child's references are
     * looked up with it: the write service refuses it too, but only once a
     * lookup has sent it to the database.
     */
    const unstorable = unstorableText(values, target.table.columns);
    if (unstorable !== null) input.mapError(new ValidationFailedError('Some values were refused.', { fields: unstorable }));
    row = input.run === undefined ? await create(target, announce) : await input.run({ create, announce, moved });
  } catch (error) {
    input.refused?.(error);
    // Nothing was made: what the caps counted for it goes back (but the visitor's own hour, when the caller says the write reached a limit).
    if (input.keepsVisitor?.(error) === true) await releaseAllButVisitor?.();
    else await release?.();
    throw error;
  }
  await announceEffects(app, { connectionId: target.connectionId, view: target.view, effects: moved, origin: 'public', actor: PUBLIC_ACTOR });
  return { ok: true, row };
}
