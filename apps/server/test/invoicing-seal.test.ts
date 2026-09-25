// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The fingerprint an accepted proposal is sealed with, on every engine: the
 * SHA-256 of what it said — the signature, the dates, its lines, and its terms
 * with their clauses — in a canonical form a later check works out again.
 *
 * What each case holds:
 *  - accepting seals a fingerprint that the check gives back exactly;
 *  - any change to a hashed column, a line, the terms or a clause gives
 *    another fingerprint;
 *  - the same proposal gives the same fingerprint on SQLite, Postgres and
 *    MySQL, whatever each driver hands back for a decimal or a date;
 *  - a proposal signed after it was accepted is sealed when the name is
 *    first filled;
 *  - the dashboard's form accepting and changing lines in one save seals the
 *    lines as that save left them;
 *  - history (an import, sample data) is sealed by nobody.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { fingerprintOf } from '../src/crud/seal.js';
import type { HashOf } from '../src/connections/effective-schema.js';
import type { WriteContext } from '../src/crud/write-service.js';
import { LEGS, installInvoicing, type InvoicingHarness } from './invoicing-install.helpers.js';
import { dataRoutesOver, type DataRoutes } from './invoicing-routes.helpers.js';
import { seedSettings, setConnectionCurrency, settledWriter } from './invoicing-writes.helpers.js';
import { statesManifest } from './invoicing-states.helpers.js';

let open: InvoicingHarness | null = null;
let routes: DataRoutes | null = null;
afterEach(async () => {
  await routes?.close();
  routes = null;
  await open?.close();
  open = null;
});

/** The fingerprint of the same proposal, per engine: compared once every engine has run. */
const byEngine = new Map<string, string>();

const history: WriteContext = { origin: 'import', hops: 0, actor: { kind: 'user', id: 'usr_imp', label: 'Importer' }, request: null };

async function harness(dialect: (typeof LEGS)[number][0]) {
  const h = await installInvoicing(dialect, statesManifest());
  open = h;
  await seedSettings(h);
  await setConnectionCurrency(h, 'EUR');
  const w = await settledWriter(h);
  const client = await w.create('clients', { email: 'ann@example.test', name: 'Ann' });
  const terms = await w.create('terms', { version: 'v3' });
  await w.create('terms_clauses', { terms_id: terms['id'], position: 2, body: 'Payment within 14 days.' });
  await w.create('terms_clauses', { terms_id: terms['id'], position: 1, body: 'Files are kept for a year — café élan.' });
  /** A sent proposal with two lines, naming the terms. */
  const proposal = async () => {
    const made = await w.create('proposals', { client_id: client['id'], terms_id: terms['id'], valid_until: '2026-10-31' });
    await w.create('proposal_lines', { proposal_id: made['id'], position: 2, amount: '1200.5' });
    await w.create('proposal_lines', { proposal_id: made['id'], position: 1, amount: '80' });
    await w.update('proposals', made['id'], { status: 'sent' });
    return made;
  };
  const row = async (id: unknown) => (await h.rows(`select * from ${h.real('proposals')} where id = ${String(id)}`))[0]!;
  const target = w.targetOf('proposals');
  const hashOf = (target.table.table!.columns.find((c) => c.name === 'fingerprint')!.stamp!.set as { hashOf: HashOf }).hashOf;
  /** What a later check works out, from the rows as they are stored now. */
  const recompute = async (id: unknown) => fingerprintOf(w.db, target.view, target.table, await row(id), hashOf, 'EUR');
  return { h, w, client, terms, proposal, row, recompute };
}

for (const [dialect, available] of LEGS) {
  describe.skipIf(!available)(`fingerprints on ${dialect}`, () => {
    it('seal what was accepted, and give another fingerprint for any change to it', async () => {
      const { h, w, terms, proposal, row, recompute } = await harness(dialect);
      const made = await proposal();
      await w.update('proposals', made['id'], { status: 'accepted', signed_name: 'Ann Lee' });
      const sealed = String((await row(made['id']))['fingerprint']);
      expect(sealed).toMatch(/^[0-9a-f]{64}$/);
      expect(await recompute(made['id'])).toBe(sealed);
      byEngine.set(dialect, sealed);

      // Each change below is undone before the next, so each is measured alone.
      const changes: [string, string][] = [
        [`update ${h.real('proposals')} set signed_name = 'Ann B. Lee' where id = ${String(made['id'])}`, `update ${h.real('proposals')} set signed_name = 'Ann Lee' where id = ${String(made['id'])}`],
        [`update ${h.real('proposals')} set valid_until = '2026-11-30' where id = ${String(made['id'])}`, `update ${h.real('proposals')} set valid_until = '2026-10-31' where id = ${String(made['id'])}`],
        [`update ${h.real('proposal_lines')} set amount = 1200.51 where position = 2`, `update ${h.real('proposal_lines')} set amount = 1200.5 where position = 2`],
        [`update ${h.real('proposal_lines')} set position = 3 where position = 1`, `update ${h.real('proposal_lines')} set position = 1 where position = 3`],
        [`update ${h.real('terms')} set version = 'v4' where id = ${String(terms['id'])}`, `update ${h.real('terms')} set version = 'v3' where id = ${String(terms['id'])}`],
        [`update ${h.real('terms_clauses')} set body = 'Payment within 30 days.' where position = 2`, `update ${h.real('terms_clauses')} set body = 'Payment within 14 days.' where position = 2`],
      ];
      for (const [change, back] of changes) {
        await h.rows(change);
        expect(await recompute(made['id']), change).not.toBe(sealed);
        await h.rows(back);
        expect(await recompute(made['id']), back).toBe(sealed);
      }
      // A line added later is another document, too.
      await w.create('proposal_lines', { proposal_id: made['id'], position: 9, amount: '1' });
      expect(await recompute(made['id'])).not.toBe(sealed);
    });

    it('seal a proposal signed after it was accepted, when the name is first filled', async () => {
      const { w, proposal, row, recompute } = await harness(dialect);
      const made = await proposal();
      await w.update('proposals', made['id'], { status: 'accepted' });
      const first = (await row(made['id']))['fingerprint'];
      await w.update('proposals', made['id'], { signed_name: 'Ann Lee' });
      const signed = String((await row(made['id']))['fingerprint']);
      expect(signed).not.toBe(first);
      expect(await recompute(made['id'])).toBe(signed);
    });

    it("seal the lines as the dashboard's form left them when it accepts and edits them in one save", async () => {
      const { h, proposal, row, recompute } = await harness(dialect);
      const made = await proposal();
      routes = await dataRoutesOver(h, dialect);
      const r = routes;
      const lines = await h.rows(`select id, position from ${h.real('proposal_lines')} where proposal_id = ${String(made['id'])} order by position`);
      const reply = await r.patch('proposals', made['id'], {
        values: { status: 'accepted', signed_name: 'Ann Lee' },
        children: {
          [r.relation('proposal_lines')]: [
            { key: { id: lines[0]!['id'] }, values: { position: 1, amount: '99' } },
            { key: { id: lines[1]!['id'] }, values: { position: 2, amount: '1200.5' } },
          ],
        },
      });
      expect(reply.statusCode, reply.body).toBe(200);
      expect(await recompute(made['id'])).toBe(String((await row(made['id']))['fingerprint']));
    });

    it('seal no history', async () => {
      const { w, client, row } = await harness(dialect);
      const past = await w.create('proposals', { client_id: client['id'], status: 'accepted', signed_name: 'Ann Lee' }, history);
      expect((await row(past['id']))['fingerprint']).toBeNull();
    });
  });
}

describe('fingerprints across engines', () => {
  afterAll(() => byEngine.clear());
  it('are the same for the same proposal on every engine that ran', () => {
    const values = [...byEngine.values()];
    expect(values.length).toBeGreaterThan(0);
    expect(new Set(values).size).toBe(1);
  });
});
