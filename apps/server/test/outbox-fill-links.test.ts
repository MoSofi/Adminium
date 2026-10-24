// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE LINKS OF A MESSAGE, FILLED FROM THE ROW IT IS ABOUT.
 *
 * A column of the same name fills a link only when both point at the same
 * table: a sign-off's `visit_id` names a job's visit, and a message whose
 * `visit_id` names a site visit is not linked to whichever site visit shares
 * that number (or refused, where none does, and the mail never queued).
 */
import { describe, expect, it } from 'vitest';

import { fillLinks } from '../src/outbox/producers.js';

const table = (id: string, columns: string[]) => ({ id, name: id, primaryKey: ['id'], columns: new Map(columns.map((name) => [name, { name }])) });
const relation = (from: string, column: string, to: string) => ({ through: null, from: { tableId: from, columns: [column] }, to: { tableId: to, columns: ['id'] } });

const OUTBOX = table('outbox', ['id', 'visit_id', 'job_id', 'contact_id']);
const SIGN_OFFS = table('sign_offs', ['id', 'visit_id', 'job_id', 'contact_id']);
const VIEW = {
  model: {
    relations: [
      relation('outbox', 'visit_id', 'site_visits'),
      relation('outbox', 'job_id', 'jobs'),
      relation('outbox', 'contact_id', 'contacts'),
      relation('sign_offs', 'visit_id', 'job_visits'),
      relation('sign_offs', 'job_id', 'jobs'),
      relation('sign_offs', 'contact_id', 'contacts'),
    ],
  },
  table: (id: string) => table(id, ['id']),
};
const DEFINITION = { recipient: { via: 'contact_id' }, links: { visit: 'visit_id', job: 'job_id' } };
/** A link still empty is looked for on the rows the filled links name: here, none of them names a site visit. */
const chain: Record<string, unknown> = {};
for (const step of ['selectFrom', 'selectAll', 'where']) chain[step] = () => chain;
chain['executeTakeFirst'] = async () => undefined;
const DB = chain;

describe('a message\'s links, from the row it is about', () => {
  it('copies a column of the same name only when it points at the same table', async () => {
    const values: Record<string, unknown> = {};
    await fillLinks(DB as never, VIEW as never, DEFINITION as never, OUTBOX as never, { table: SIGN_OFFS as never, row: { id: 7, visit_id: 3, job_id: 12, contact_id: 40 } }, values, 'id');
    // The job and the person are the same tables' rows; the sign-off's visit is a job's visit, not a site visit.
    expect(values).toEqual({ job_id: 12, contact_id: 40 });
  });

  it('still copies a same-named column the model links to nothing, as before', async () => {
    const values: Record<string, unknown> = {};
    const plain = { ...VIEW, model: { relations: VIEW.model.relations.filter((one) => !(one.from.tableId === 'sign_offs' && one.from.columns[0] === 'visit_id')) } };
    await fillLinks(DB as never, plain as never, DEFINITION as never, OUTBOX as never, { table: SIGN_OFFS as never, row: { id: 7, visit_id: 3, job_id: 12, contact_id: 40 } }, values, 'id');
    expect(values).toEqual({ visit_id: 3, job_id: 12, contact_id: 40 });
  });
});
