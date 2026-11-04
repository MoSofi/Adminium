// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A FORMULA COLUMN WITH A `normalize` RULE KEEPS ITS WORKED-OUT VALUE THAT WAY.
 *
 * A sample pack goes once to an address: `address_key` joins the postcode and
 * the first line of the address and is kept as a code, under a unique key. The
 * key is kept as a typed code is (upper case, spaces and dashes left out), so
 * the same address typed in another case makes the same key and the second
 * pack is refused there. The same holds when an edit works the key out again,
 * when a total over child rows does (the settle), and for an `email` rule.
 *
 * On every engine this run reaches, through an app installed by the real
 * installer.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { isUniqueViolation } from '../src/crud/decided-columns.js';
import { installInvoicing, invoicingManifest, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };

function manifest(): Record<string, unknown> {
  const tables = [
    {
      ref: 'sample_requests',
      columns: [
        id,
        { ref: 'postcode', type: 'text', maxLength: 12 },
        { ref: 'address_line1', type: 'text', maxLength: 120 },
        { ref: 'mailbox', type: 'text', maxLength: 64, nullable: true },
        { ref: 'domain', type: 'text', maxLength: 120, nullable: true },
        { ref: 'address_key', type: 'text', maxLength: 160, nullable: true, unique: true, rules: { formula: { join: ['postcode', 'address_line1'] }, normalize: 'code' } },
        { ref: 'reply_to', type: 'text', maxLength: 190, nullable: true, rules: { formula: { join: ['mailbox', '@', 'domain'] }, normalize: 'email' } },
      ],
    },
    {
      // A key worked out from a total over child rows: the newest note's reference, kept as a code.
      ref: 'packs',
      columns: [
        id,
        { ref: 'last_ref', type: 'text', maxLength: 32, nullable: true, rules: { rollup: { from: 'pack_notes', via: 'pack_id', latest: { of: 'ref', by: 'position' } } } },
        { ref: 'last_code', type: 'text', maxLength: 32, nullable: true, rules: { formula: { join: ['last_ref', ' '] }, normalize: 'code' } },
      ],
    },
    {
      ref: 'pack_notes',
      columns: [id, { ref: 'pack_id', type: 'fk', references: 'packs' }, { ref: 'position', type: 'int', default: 0 }, { ref: 'ref', type: 'text', maxLength: 32 }],
    },
  ];
  // A total by the newest child row is read by 0.3.28 and later.
  return { ...invoicingManifest(tables), compatibility: { minAdminiumVersion: '0.3.28' } };
}

/** The write refused by the unique key itself, not by anything before it. */
async function refusedByUniqueKey(write: Promise<unknown>): Promise<void> {
  const error = await write.then(
    () => null,
    (e: unknown) => e,
  );
  expect(isUniqueViolation(error), String(error)).toBe(true);
}

let open: InvoicingHarness | null = null;
afterEach(async () => {
  await open?.close();
  open = null;
});

for (const [dialect, available] of LEGS) {
  describe.skipIf(!available)(`a formula column's normalize rule, on ${dialect}`, () => {
    it('keeps the worked-out key as a code, so the same address in another case is refused by the unique key', async () => {
      const h = await installInvoicing(dialect, manifest());
      open = h;
      const w = await writerFor(h);
      const stored = async (ref: string, key: unknown) => (await h.rows(`select * from ${h.real(ref)} where id = ${String(key)}`))[0]!;

      const first = await w.create('sample_requests', { postcode: 'SL7 1BT', address_line1: '12 Quay Street', mailbox: ' Orders', domain: 'HarbourBakery.example ' });
      expect(await stored('sample_requests', first['id'])).toMatchObject({ address_key: 'SL71BT12QUAYSTREET', reply_to: 'orders@harbourbakery.example' });

      // The same address typed another way: the same key, refused where the key is unique.
      await refusedByUniqueKey(w.create('sample_requests', { postcode: 'sl7 1bt', address_line1: '12 quay street' }));
      await refusedByUniqueKey(w.create('sample_requests', { postcode: 'SL7-1BT', address_line1: '12 Quay  Street' }));
      expect(await h.rows(`select id from ${h.real('sample_requests')}`)).toHaveLength(1);

      // Another address is another key.
      const second = await w.create('sample_requests', { postcode: 'sl7 1bt', address_line1: '14 quay street' });
      expect((await stored('sample_requests', second['id']))['address_key']).toBe('SL71BT14QUAYSTREET');

      // An edit works the key out again, kept the same way; moved onto the first row's address it is refused.
      await w.update('sample_requests', second['id'], { address_line1: '16 Quay street' });
      expect((await stored('sample_requests', second['id']))['address_key']).toBe('SL71BT16QUAYSTREET');
      await refusedByUniqueKey(w.update('sample_requests', second['id'], { address_line1: '12 QUAY street' }));
      expect((await stored('sample_requests', second['id']))['address_key']).toBe('SL71BT16QUAYSTREET');
    });

    it('keeps a key worked out again by a total over child rows the same way', async () => {
      const h = await installInvoicing(dialect, manifest());
      open = h;
      const w = await writerFor(h);
      const pack = await w.create('packs', {});
      await w.create('pack_notes', { pack_id: pack['id'], position: 1, ref: 'ab-12 x' });
      const [row] = await h.rows(`select last_ref, last_code from ${h.real('packs')} where id = ${String(pack['id'])}`);
      expect(row).toMatchObject({ last_ref: 'ab-12 x', last_code: 'AB12X' });
    });
  });
}
