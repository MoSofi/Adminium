// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The register's public reads, on every available dialect: the documents of
 * exactly the rows a claim reaches — the latest one per row, newest first,
 * page by page — and the documents drawn from values for a claim, bounded to
 * one connection. Plus what a render writes back: the subject it printed,
 * the key its claim was made on, and a profile's line order.
 */
import { describe, expect, it } from 'vitest';

import { applyMigrations, connectionsRepo, documentProfilesRepo, documentsRepo, entityKeyOf, type DsnCrypto, type MetaDb } from '../src/index.js';
import { TEST_DIALECTS, useMetaDb } from './helpers/db.js';

const crypto: DsnCrypto = {
  encrypt: (plaintext) => `enc:test:${Buffer.from(plaintext, 'utf8').toString('base64')}`,
  decrypt: (token) => Buffer.from(token.slice('enc:test:'.length), 'base64').toString('utf8'),
};
const T0 = 1_750_000_000_000;
const TABLE = 'public.studio_invoices';

async function connection(meta: MetaDb, name: string): Promise<string> {
  return (await connectionsRepo(meta, crypto).create({ name, engine: 'postgres', introspectDsn: `postgres://ro:s@db/${name}` })).id;
}

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`the register's public reads [${dialect.name}]`, () => {
    const db = useMetaDb(dialect, (meta) => applyMigrations(meta.db, { dialect: meta.dialect }));

    async function world() {
      const meta = db();
      const a = await connection(meta, 'a');
      const b = await connection(meta, 'b');
      const profiles = documentProfilesRepo(meta);
      const invoice = await profiles.create({ addOnKey: 'invoices', kind: 'invoice', name: 'Invoice', connectionId: a, table: TABLE, mapping: {}, ownerApp: 'studio' }, T0);
      const receipt = await profiles.create({ addOnKey: 'invoices', kind: 'receipt', name: 'Receipt', connectionId: a, table: TABLE, mapping: {}, ownerApp: 'studio' }, T0);
      const register = documentsRepo(meta);
      const draw = async (profileId: string, kind: string, connectionId: string, id: number, at: number, rendered = true) => {
        const row = await register.create(
          { profileId, addOnKey: 'invoices', kind, connectionId, entity: { connectionId, table: TABLE, pk: { id }, label: String(id) }, subject: {}, locale: 'en-US', format: 'html' },
          at,
        );
        if (rendered) await register.markRendered(row.id, { number: `N-${String(id)}`, fileId: null, htmlFileId: null, format: 'html' }, at);
        return row.id;
      };
      return { meta, a, b, invoice, receipt, register, draw };
    }

    it('lists the latest document of each reached row, newest first, in keyset pages', async () => {
      const { a, invoice, register, draw } = await world();
      const ids: Record<number, string> = {};
      for (let id = 1; id <= 7; id += 1) ids[id] = await draw(invoice.id, 'invoice', a, id, T0 + id * 1000);
      // Row 2 drawn again later: only the later one is listed.
      const again = await draw(invoice.id, 'invoice', a, 2, T0 + 9000);
      // A failed draw of row 3, later still, is not listed and does not hide the rendered one.
      await draw(invoice.id, 'invoice', a, 3, T0 + 9500, false);

      const keys = [1, 2, 3, 4, 5, 6, 7].map((id) => entityKeyOf({ id }));
      const page = (after?: { createdAt: number; id: string }) =>
        register.listForRows({ connectionId: a, entityTable: TABLE, entityIds: keys, profileIds: [invoice.id], limit: 3, ...(after === undefined ? {} : { after }) });
      const one = await page();
      expect(one.map((d) => d.id)).toEqual([again, ids[7], ids[6]]);
      const two = await page({ createdAt: one[2]!.createdAt, id: one[2]!.id });
      expect(two.map((d) => d.id)).toEqual([ids[5], ids[4], ids[3]]);
      const three = await page({ createdAt: two[2]!.createdAt, id: two[2]!.id });
      expect(three.map((d) => d.id)).toEqual([ids[1]]);
    });

    it('reads only the rows, profiles, kinds and connection it is given', async () => {
      const { a, b, invoice, receipt, register, draw } = await world();
      const mine = await draw(invoice.id, 'invoice', a, 1, T0 + 1000);
      await draw(invoice.id, 'invoice', a, 2, T0 + 2000);
      const receiptOne = await draw(receipt.id, 'receipt', a, 1, T0 + 3000);
      await draw(invoice.id, 'invoice', b, 1, T0 + 4000);
      const read = (over: Partial<Parameters<typeof register.listForRows>[0]> = {}) =>
        register.listForRows({ connectionId: a, entityTable: TABLE, entityIds: [entityKeyOf({ id: 1 })], profileIds: [invoice.id, receipt.id], limit: 10, ...over });
      expect((await read()).map((d) => d.id)).toEqual([receiptOne, mine]);
      expect((await read({ kinds: ['invoice'] })).map((d) => d.id)).toEqual([mine]);
      expect(await read({ kinds: [] })).toEqual([]);
      expect((await read({ profileIds: [invoice.id] })).map((d) => d.id)).toEqual([mine]);
      expect(await read({ entityIds: [] })).toEqual([]);
      expect(await read({ connectionId: b, profileIds: [receipt.id] })).toEqual([]);
    });

    it('finds the documents drawn from values on one connection, with the key their claim was made on', async () => {
      const { a, b, register } = await world();
      const make = async (connectionId: string, at: number, claim: { column: string; value: string; keyId?: string } | null) => {
        const row = await register.create(
          { profileId: null, addOnKey: 'invoices', kind: 'invoice', connectionId, entity: null, subject: {}, locale: 'en-US', format: 'html', claim },
          at,
        );
        await register.markRendered(row.id, { number: '1', fileId: null, htmlFileId: null, format: 'html' }, at);
        return row.id;
      };
      const first = await make(a, T0 + 1000, { column: 'email', value: 'ann@x.test', keyId: 'pbk_1' });
      const second = await make(a, T0 + 2000, { column: 'email', value: 'ann@x.test' });
      await make(a, T0 + 3000, null);
      await make(b, T0 + 4000, { column: 'email', value: 'ann@x.test', keyId: 'pbk_1' });
      const found = await register.listClaimedIntents({ connectionId: a, limit: 10 });
      expect(found.map((d) => d.id)).toEqual([second, first]);
      expect(found[1]!.claim).toEqual({ column: 'email', value: 'ann@x.test', keyId: 'pbk_1' });
      expect((await register.listClaimedIntents({ connectionId: a, limit: 10, after: { createdAt: found[0]!.createdAt, id: found[0]!.id } })).map((d) => d.id)).toEqual([first]);
    });

    it('finds the number a profile already gave a row, never a voided one\'s', async () => {
      const { a, invoice, receipt, register, draw } = await world();
      const entity = { table: TABLE, pk: { id: 4 } };
      expect(await register.numberFor(invoice.id, entity)).toBeNull();
      const first = await draw(invoice.id, 'invoice', a, 4, T0 + 1000);
      expect(await register.numberFor(invoice.id, entity)).toBe('N-4');
      // Another profile's, or another row's, is not this one's.
      expect(await register.numberFor(receipt.id, entity)).toBeNull();
      expect(await register.numberFor(invoice.id, { table: TABLE, pk: { id: 5 } })).toBeNull();
      // A failed draw has no number; a voided one gives its number up.
      await draw(invoice.id, 'invoice', a, 4, T0 + 2000, false);
      expect(await register.numberFor(invoice.id, entity)).toBe('N-4');
      await register.markVoided(first, 'operator');
      expect(await register.numberFor(invoice.id, entity)).toBeNull();
    });

    it('keeps the subject a render printed, and a profile\'s line order across a patch', async () => {
      const { a, invoice, register, meta } = await world();
      const row = await register.create(
        { profileId: invoice.id, addOnKey: 'invoices', kind: 'invoice', connectionId: a, entity: null, subject: { number: null }, locale: 'en-US', format: 'html' },
        T0,
      );
      const done = await register.markRendered(row.id, { number: 'INV-1', fileId: null, htmlFileId: null, format: 'html', subject: { number: 'INV-1' } }, T0);
      expect(done!.subject).toEqual({ number: 'INV-1' });
      const patched = await documentProfilesRepo(meta).patch(invoice.id, { orderBy: 'position' }, T0);
      expect(patched!.orderBy).toBe('position');
      expect((await documentProfilesRepo(meta).patch(invoice.id, { name: 'Invoice (renamed)' }, T0))!.orderBy).toBe('position');
    });
  });
}
