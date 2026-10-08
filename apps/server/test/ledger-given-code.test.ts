// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A ROW A LEDGER'S ANSWER ADDS, UNDER ITS OWN CODE AND WHERE IT ALREADY STANDS.
 *
 * Two things a plan may do for a row it adds and nobody may do through a
 * door: bring the code the row has always had, where the column's rule says a
 * ledger may (kept as given, after a code's own checks), and start the row at
 * a state only the ledger moves a row to — while that move asks nothing
 * first. The test add-on's `adopt` makes a thing of a host's row; its planner
 * hands over the code and the state the row names.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ledgerKitCodedManifest } from './fixtures/ledger-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';
import { DESK, ledgerWorld, refusal, type LedgerWorld } from './ledger.helpers.js';

const ADOPT = { id: 'adopt', into: { addOn: 'ledger-kit', ledger: 'units', action: 'adopt' }, map: { what: { row: true }, name: 'name', code: 'code', start: 'start' }, post: { on: { create: true } } };

describe.each(LEGS)('a thing a plan adds — %s', (dialect, available) => {
  let w: LedgerWorld;
  const things = () => w.h.rows('SELECT name, code, status FROM ledger_kit_things ORDER BY id');
  const thing = async (name: string) => (await w.h.rows(`SELECT name, code, status FROM ledger_kit_things WHERE name = '${name}'`))[0];

  beforeAll(async () => {
    if (!available) return;
    w = await ledgerWorld(dialect, { finds: { columns: 'name VARCHAR(80) NULL, code VARCHAR(20) NULL, start VARCHAR(20) NULL', postings: [ADOPT] } }, ledgerKitCodedManifest());
  }, 180_000);
  afterAll(async () => {
    if (available) await w.close();
  });

  it.skipIf(!available)('with no code given, Adminium makes one as ever, and the thing starts at the beginning', async () => {
    await w.create('finds', { name: 'plain' }, DESK);
    const made = await thing('plain');
    expect(String(made!['code'])).toMatch(/^TK-[0-9A-Z]{8}$/);
    expect(made!['status']).toBe('new');
  });

  it.skipIf(!available)('a code the row brings is kept as it was given', async () => {
    await w.create('finds', { name: 'old', code: 'TK-48219930' }, DESK);
    expect(await thing('old')).toMatchObject({ code: 'TK-48219930', status: 'new' });
  });

  it.skipIf(!available)('a code that is no code of this column stops the save, and nothing is written', async () => {
    const before = (await things()).length;
    // No prefix (it could be another table's word), too short, wider than the column.
    for (const code of ['48219930', 'TK-12', 'TK-1234567890']) {
      const said = await refusal(w.create('finds', { name: `bad ${code}`, code }, DESK));
      expect(said.details, code).toMatchObject({ reason: 'planner-failed' });
    }
    expect((await things()).length).toBe(before);
    expect(await w.h.rows("SELECT id FROM finds WHERE name LIKE 'bad %'")).toEqual([]);
  });

  it.skipIf(!available)('two rows cannot bring one code', async () => {
    await w.create('finds', { name: 'first', code: 'TK-77770001' }, DESK);
    await expect(w.create('finds', { name: 'second', code: 'TK-77770001' }, DESK)).rejects.toBeDefined();
    expect(await thing('second')).toBeUndefined();
  });

  it.skipIf(!available)('a thing may start where only the ledger moves one, when that move asks nothing', async () => {
    await w.create('finds', { name: 'running', code: 'TK-55550001', start: 'live' }, DESK);
    expect(await thing('running')).toMatchObject({ code: 'TK-55550001', status: 'live' });
  });

  it.skipIf(!available)('and not where the move asks something first, nor at a state no move reaches', async () => {
    for (const start of ['kept', 'gone']) {
      await expect(w.create('finds', { name: `to ${start}`, start }, DESK), start).rejects.toBeDefined();
      expect(await thing(`to ${start}`), start).toBeUndefined();
    }
  });
});
