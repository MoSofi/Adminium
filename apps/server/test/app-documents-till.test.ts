// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A till's documents through its staff screen, on SQLite, Postgres and MySQL.
 *
 * A receipt lists a ticket's lines, and a line the cashier voided is not on
 * it: the app's mapping leaves rows out of a child list by the child's own
 * columns. A shelf-label sheet prints as many labels as the screen asks for:
 * the screen sends values for the slots nothing maps, typed by the outline
 * like a profile's own typed values, and never over a mapped column.
 */
import type { AddOnRuntimeState } from '../src/add-ons/runtime.js';
import { afterEach, describe, expect, it } from 'vitest';

import { addOnHarness, addOnManifest, appManifest, ENGINES, type Harness } from './app-add-ons.helpers.js';

/** The kinds the stand-in add-on draws, as its outline describes them. */
const KINDS: Record<string, { id: string; type: string; required: boolean; default?: string; columns?: { id: string; type: string }[] }[]> = {
  receipt: [
    { id: 'number', type: 'text', required: false },
    { id: 'amount', type: 'money', required: true },
    { id: 'lines', type: 'collection', required: false, columns: [{ id: 'description', type: 'text' }, { id: 'amount', type: 'money' }] },
  ],
  // As Barcode Labels describes its sheet: `count` is the labels to print.
  'label-sheet': [
    { id: 'sku', type: 'text', required: true },
    { id: 'code', type: 'text', required: true },
    { id: 'reference', type: 'text', required: true },
    { id: 'count', type: 'number', required: false },
    { id: 'on', type: 'date', required: true, default: 'now' },
  ],
};

/** A provider that prints the subject it is given, and keeps what it drew. */
function provider() {
  const drawn: { kind: string; subject: { fields: Record<string, unknown>; collections: Record<string, Record<string, unknown>[]> } }[] = [];
  const module = {
    key: 'printing',
    kinds: () => Object.keys(KINDS).map((id) => ({ id, formats: ['html'] as const, paper: ['a4'] })),
    describe: (kind: string) => ({ slots: KINDS[kind] ?? [] }),
    render: (input: { kind: string; subject: (typeof drawn)[number]['subject'] }) => {
      drawn.push({ kind: input.kind, subject: input.subject });
      return Promise.resolve([
        { format: 'html' as const, filename: `${input.kind}.html`, mediaType: 'text/html; charset=utf-8', bytes: new TextEncoder().encode(JSON.stringify(input.subject)), locale: 'en-US', warnings: [] },
      ]);
    },
  };
  const runtime = {
    providers: new Map([['document-render@1', [{ addOnKey: 'printing', contract: 'document-render', version: 1, module }]]]),
    slots: new Map(),
    conflicts: [],
    problems: [],
  } as unknown as AddOnRuntimeState;
  return { drawn, runtime };
}

const id = { ref: 'id', type: 'int', role: 'pk' };

const till = () =>
  appManifest('till', {
    name: 'Till',
    requiredSchema: {
      tables: [
        { ref: 'menu_items', columns: [id, { ref: 'name', type: 'text', maxLength: 80 }, { ref: 'barcode', type: 'text', maxLength: 20, nullable: true }] },
        { ref: 'tickets', columns: [id, { ref: 'number', type: 'text', maxLength: 24, nullable: true }, { ref: 'total', type: 'decimal', scale: 2, nullable: true }] },
        {
          ref: 'ticket_lines',
          columns: [
            id,
            { ref: 'ticket_id', type: 'fk', references: 'tickets' },
            { ref: 'position', type: 'int', default: 0 },
            { ref: 'kind', type: 'text', maxLength: 16, default: 'item' },
            { ref: 'name', type: 'text', maxLength: 120, nullable: true },
            { ref: 'amount', type: 'decimal', scale: 2, nullable: true },
            { ref: 'voided', type: 'bool', default: false },
          ],
        },
      ],
    },
    addOns: { suggests: [{ key: 'printing', range: '>=1.0.0', reason: { 'en-US': 'Prints receipts and labels.' } }] },
    documents: [
      {
        kind: 'receipt',
        addOn: 'printing',
        table: 'tickets',
        name: 'Till receipt',
        mapping: {
          number: { column: 'number' },
          amount: { column: 'total' },
          lines: {
            collection: {
              table: 'ticket_lines',
              via: 'ticket_id',
              orderBy: 'position',
              columns: { description: 'name', amount: 'amount' },
              where: { column: 'kind', in: ['item'] },
              unless: 'voided',
            },
          },
        },
      },
      {
        kind: 'label-sheet',
        addOn: 'printing',
        table: 'menu_items',
        name: 'Shelf labels',
        mapping: { sku: { column: 'id' }, code: { column: 'barcode' }, reference: { column: 'name' } },
      },
    ],
  });

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`a till's documents on ${dialect}`, () => {
    const bool = (value: boolean) => (dialect === 'postgres' ? String(value) : value ? '1' : '0');
    const setUp = async () => {
      const { drawn, runtime } = provider();
      h = await addOnHarness(dialect, { documents: { runtime: () => runtime } });
      await h.stageAddOn(addOnManifest('printing', { name: 'Printing' }));
      await h.stageApp(till());
      const installed = await h.install('till', '0.2.0');
      expect(installed.statusCode, installed.body).toBe(200);
      const printing = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'printing', version: '1.0.0', attachTo: ['till'] } });
      expect(printing.statusCode, printing.body).toBe(200);
      return { harness: h, drawn };
    };
    const draw = (harness: Harness, payload: Record<string, unknown>) =>
      harness.inject({ method: 'POST', url: '/apps/till/documents/render', payload });

    it('leaves a voided line, and a line that is not an item, off the receipt', async () => {
      const { harness, drawn } = await setUp();
      await harness.rows(`insert into tickets (id, number, total) values (1, 'T-1', '5.50')`);
      await harness.rows(
        'insert into ticket_lines (id, ticket_id, position, kind, name, amount, voided) values ' +
          `(1, 1, 1, 'item', 'Latte', '3.50', ${bool(false)}), ` +
          `(2, 1, 2, 'item', 'Scone', '2.50', ${bool(true)}), ` +
          `(3, 1, 3, 'note', 'No sugar', null, ${bool(false)}), ` +
          `(4, 1, 4, 'item', 'Tea', '2.00', ${bool(false)})`,
      );
      const res = await draw(harness, { kind: 'receipt', ref: 'tickets', pk: { id: 1 } });
      expect(res.statusCode, res.body).toBe(201);
      expect(drawn.at(-1)!.subject.collections['lines']!.map((line) => [line['description'], line['amount']])).toEqual([
        ['Latte', 350],
        ['Tea', 200],
      ]);
    }, 90_000);

    it('prints as many labels as the screen asks for, and never over a mapped column', async () => {
      const { harness, drawn } = await setUp();
      await harness.rows(`insert into menu_items (id, name, barcode) values (7, 'Oat milk', '5012345678900')`);
      const labels = (values?: Record<string, unknown>) => draw(harness, { kind: 'label-sheet', ref: 'menu_items', pk: { id: 7 }, ...(values === undefined ? {} : { values }) });

      const one = await labels();
      expect(one.statusCode, one.body).toBe(201);
      expect(drawn.at(-1)!.subject.fields).toMatchObject({ sku: '7', code: '5012345678900', reference: 'Oat milk' });
      expect(drawn.at(-1)!.subject.fields['count']).toBeUndefined();
      // Unchanged and asked the same way: the same sheet.
      expect((await labels()).statusCode).toBe(200);

      const twelve = await labels({ count: 12 });
      expect(twelve.statusCode, twelve.body).toBe(201);
      expect(drawn.at(-1)!.subject.fields).toMatchObject({ count: 12, reference: 'Oat milk' });
      // Typed by the outline, as a profile's own typed value is.
      expect((await labels({ count: '12' })).statusCode).toBe(200);
      expect((await labels({ count: 24 })).statusCode).toBe(201);
      expect(drawn.at(-1)!.subject.fields['count']).toBe(24);
      // No values is the sheet it was before any were sent.
      expect((await labels()).json().id).toBe(one.json().id);

      // Refused, naming the slot: a mapped column, a slot the outline does not have, a value its type cannot hold.
      for (const [values, slot] of [
        [{ reference: 'Soya milk' }, 'reference'],
        [{ copies: 3 }, 'copies'],
        [{ count: 'lots' }, 'count'],
        [{ on: 'tomorrow' }, 'on'],
      ] as const) {
        const refused = await labels(values);
        expect(refused.statusCode, JSON.stringify(values)).toBe(400);
        expect(refused.body).toContain(`"${slot}"`);
      }
      // Bounded by the route's schema: a long text and too many values never reach a render.
      const before = drawn.length;
      expect((await labels({ count: 'x'.repeat(2_001) })).statusCode).toBeGreaterThanOrEqual(400);
      expect((await labels(Object.fromEntries(Array.from({ length: 33 }, (_, n) => [`s${String(n)}`, 1])))).statusCode).toBeGreaterThanOrEqual(400);
      expect(drawn.length).toBe(before);
    }, 90_000);
  });
}
