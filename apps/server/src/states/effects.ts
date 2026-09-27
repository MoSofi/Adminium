// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE ROWS A MOVE MOVED TOO, ANNOUNCED.
 *
 * A move may move the row one of its links points at in the same write
 * (`states.effects`: a guest checked out turns the room to cleaning). That row
 * changed as surely as the first: its change is audited as the same writer's,
 * its screens refresh, and what watches its table (an app's emails, the
 * rules) hears of it — once the write has committed, after the first row's
 * own announcement.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { afterRecordWrite, type AfterRecordWriteInput } from '../crud/after-record-write.js';
import type { SnapshotView } from '../crud/identifiers.js';
import { pkLabel } from '../crud/records.js';
import type { Row } from '../crud/mask.js';
import { guardOf, type EffectWritten } from '../crud/states.js';

export interface EffectsAnnouncement {
  connectionId: string;
  view: SnapshotView;
  effects: readonly EffectWritten[] | undefined;
  origin: AfterRecordWriteInput['origin'];
  /** The request behind the write; absent, `actor` names who made it (a timed move, a rule). */
  request?: FastifyRequest | null | undefined;
  actor?: AfterRecordWriteInput['actor'];
  /** The rule whose write set them off, and how many hops deep it is: a rule never runs again on its own writes. */
  ruleId?: string | null | undefined;
  hops?: number | undefined;
  /** Where the audit row goes (`automation` for a rule's writes); `data` by default. */
  auditCategory?: AfterRecordWriteInput['auditCategory'];
  /** The store the audit row goes to when there is no request. */
  meta?: AfterRecordWriteInput['meta'];
}

/** Announce each row a write's moves moved too, as a change of its own table. */
export async function announceEffects(app: FastifyInstance, input: EffectsAnnouncement): Promise<void> {
  for (const effect of input.effects ?? []) {
    const table = input.view.table(effect.table);
    await afterRecordWrite(app, {
      request: input.request ?? null,
      ...(input.actor === undefined ? {} : { actor: input.actor }),
      connectionId: input.connectionId,
      table,
      action: 'update',
      entity: { connectionId: input.connectionId, table: table.id, pk: effect.pk, label: pkLabel(table, effect.pk) },
      before: effect.before,
      after: effect.after,
      origin: input.origin,
      ...(input.ruleId === undefined ? {} : { ruleId: input.ruleId }),
      ...(input.hops === undefined ? {} : { hops: input.hops }),
      ...(input.auditCategory === undefined ? {} : { auditCategory: input.auditCategory }),
      ...(input.meta === undefined ? {} : { meta: input.meta }),
    });
  }
}

/** The rows a prepared row's moves moved too, once its statement has run (a batch's, a parent form's). */
export function effectsOf(values: Row): EffectWritten[] {
  return guardOf(values)?.effected ?? [];
}
