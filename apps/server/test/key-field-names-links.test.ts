// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A LINK TO A ROW IS NAMED BY THE KEY FIELD ITS TABLE DECLARES.
 *
 * A shop's orders are named by their number (`keyField: "number"`) and also
 * keep the customer's `name`. A proof links to its order: its form's picker,
 * and every chip of the link, name the order "BR-2276", not "Iris P." (the
 * column a guess picks first, and the same for four orders of one customer).
 * A table that declares no key field keeps the guess.
 *
 * On every engine this run can reach.
 */
import { parseDatabaseModel } from '@adminium/engine';
import { snapshotsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { columnFactsFor } from '../src/routes/pages/column-facts.js';
import { addOnHarness, appManifest, type Harness } from './app-add-ons.helpers.js';
import { LEGS } from './invoicing-install.helpers.js';

const pk = { ref: 'id', type: 'int', role: 'pk' } as const;

function shop(): Record<string, unknown> {
  return appManifest('shop', {
    version: '1.0.0',
    compatibility: { minAdminiumVersion: '0.3.44', engines: ['postgres', 'mysql', 'sqlite'] },
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'orders', keyField: 'number', columns: [pk, { ref: 'number', type: 'text', maxLength: 16, nullable: true, unique: true }, { ref: 'name', type: 'text', maxLength: 80, nullable: true }] },
        { ref: 'makers', columns: [pk, { ref: 'name', type: 'text', maxLength: 80, nullable: true }, { ref: 'code', type: 'text', maxLength: 16, nullable: true, unique: true }] },
        {
          ref: 'proofs',
          columns: [pk, { ref: 'order_id', type: 'fk', references: 'orders', nullable: true }, { ref: 'maker_id', type: 'fk', references: 'makers', nullable: true }, { ref: 'note', type: 'text', maxLength: 80, nullable: true }],
        },
      ],
    },
  });
}

describe.each(LEGS)('a link named by its table\'s key field — %s', (dialect, available) => {
  let h: Harness;
  let proofs: string;

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect);
    await h.stageApp(shop());
    const installed = await h.install('shop', '1.0.0');
    expect(installed.statusCode, installed.body).toBe(200);
    const model = parseDatabaseModel((await snapshotsRepo(h.meta).latest(h.connectionId))!.schema);
    proofs = model.tables.find((table) => table.name === 'shop_proofs')!.id;
  }, 240_000);
  afterAll(async () => {
    if (!available) return;
    await h?.close();
  });

  it.skipIf(!available)('names an order by its number, and a maker (no key field) by the guess', async () => {
    const facts = await columnFactsFor(h.meta, h.connectionId, proofs);
    const fk = (name: string) => facts!.columns.find((column) => column.spec['name'] === name)!.spec['fk'] as { display?: string };
    expect(fk('order_id').display).toBe('number');
    expect(fk('maker_id').display).toBe('name');
  });
});
