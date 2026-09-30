// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A credit's nights kept inside its stay, on every engine: the first night is
 * never before the arrival — and, for a guest who left early, never the
 * arrival itself (`strict` while `kind` is `left_early`) — and the last never
 * after the departure (`notAfter` through the stay). A credit with no kind
 * yet is held by neither `when`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { installInvoicing, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };

function house(): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'house',
    name: 'House',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    description: { key: 'd', fallback: 'A small hotel' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: '0.3.1' },
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'stays', columns: [id, { ref: 'arrive', type: 'date' }, { ref: 'depart', type: 'date' }] },
        {
          ref: 'stay_credits',
          columns: [
            id,
            { ref: 'stay_id', type: 'fk', references: 'stays' },
            { ref: 'kind', type: 'enum', enum: ['left_early', 'missed'], nullable: true },
            {
              ref: 'from_date',
              type: 'date',
              rules: {
                notBefore: { column: 'arrive', via: 'stay_id', strict: [{ column: 'kind', eq: 'left_early' }] },
                notAfter: { column: 'depart', via: 'stay_id', when: [{ column: 'kind', isNull: false }] },
              },
            },
          ],
        },
      ],
    },
    pages: [{ ref: 'overview', template: 'page-dashboard', title: { key: 't', fallback: 'Overview' }, nav: { group: 'house', icon: 'home', order: 1 } }],
    frontends: [{ side: 'staff', kind: 'spa' }],
  };
}

describe.each(LEGS)("a credit's nights inside its stay — %s", (dialect, available) => {
  let h: InvoicingHarness;
  let w: Awaited<ReturnType<typeof writerFor>>;
  let stay: Record<string, unknown>;
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, house());
    w = await writerFor(h, 'UTC');
    stay = await w.create('stays', { arrive: '2026-08-10', depart: '2026-08-14' });
  }, 180_000);
  afterAll(async () => {
    if (available) await h.close();
  });
  const refused = { details: { fields: { from_date: { code: 'out-of-range' } } } };

  it.runIf(available)('credits a guest who never came from the arrival, and one who left early from the day after', async () => {
    await expect(w.create('stay_credits', { stay_id: stay['id'], kind: 'missed', from_date: '2026-08-10' })).resolves.toBeDefined();
    await expect(w.create('stay_credits', { stay_id: stay['id'], kind: 'left_early', from_date: '2026-08-10' })).rejects.toMatchObject(refused);
    await expect(w.create('stay_credits', { stay_id: stay['id'], kind: 'left_early', from_date: '2026-08-11' })).resolves.toBeDefined();
    await expect(w.create('stay_credits', { stay_id: stay['id'], kind: 'missed', from_date: '2026-08-09' })).rejects.toMatchObject(refused);
  });

  it.runIf(available)('keeps a credit inside the departure once it has a kind, and judges it again when the kind is set', async () => {
    await expect(w.create('stay_credits', { stay_id: stay['id'], kind: 'missed', from_date: '2026-08-15' })).rejects.toMatchObject(refused);
    const draft = await w.create('stay_credits', { stay_id: stay['id'], from_date: '2026-08-15' });
    await expect(w.update('stay_credits', draft['id'], { kind: 'missed' })).rejects.toMatchObject(refused);
    await expect(w.update('stay_credits', draft['id'], { kind: 'missed', from_date: '2026-08-14' })).resolves.toMatchObject({ count: 1 });
  });
});
