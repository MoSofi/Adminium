// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A folio drawn from a stay: one list read from several sources in order —
 * the stay's nights (worked out when drawn, never stored), its extras with
 * the names each lists one level below it, and its charges — reaching an
 * invoice add-on's `items` as plain rows. When the rates changed after the
 * stay was priced, the nights print as one line equal to the stored figure,
 * so a folio never disagrees with its total. The desk reads the same nights
 * through its own route. On every engine.
 */
import { documentProfilesRepo, manifestsRepo, type DocumentProfile } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AddOnRuntimeState } from '../src/add-ons/runtime.js';
import { installedShapes, makeAppProfiles } from '../src/documents/app-profiles.js';
import { createDocumentPipeline } from '../src/documents/compose.js';
import { renderDocument, type RenderDeps } from '../src/documents/render.js';
import { mappedTables } from '../src/documents/subject.js';
import { addOnManifest } from './app-add-ons.helpers.js';
import { realIdOf } from './app-documents.helpers.js';
import { installInvoicing, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';
import { memoryStorage } from './memory-storage.helpers.js';
import { seedWren, wrenManifest, wrenTables } from './wren-house-fixture.js';

const id = { ref: 'id', type: 'int', role: 'pk' };

/** The hotel with a folio over its stays, and a breakfast's choices one level below each extra. */
function folioManifest(): Record<string, unknown> {
  const tables = wrenTables();
  tables.push({
    ref: 'extra_choices',
    columns: [id, { ref: 'stay_extra_id', type: 'fk', references: 'stay_extras' }, { ref: 'name', type: 'text', maxLength: 40 }, { ref: 'position', type: 'int', default: 0 }],
  });
  return {
    ...wrenManifest(tables),
    addOns: { requires: [{ key: 'invoices', range: '>=1.0.0', reason: { 'en-US': 'Draws the folio.' } }] },
    documents: [
      {
        kind: 'invoice',
        addOn: 'invoices',
        table: 'stays',
        name: { 'en-US': 'Folio' },
        mapping: {
          customerName: { column: 'guest_name' },
          total: { column: 'total' },
          items: {
            collections: [
              { nightly: 'room_total', columns: { date: 'date', desc: 'room_type_id.name', qty: 'qty', rate: 'rate', amount: 'rate', options: 'tags' } },
              {
                table: 'stay_extras',
                via: 'stay_id',
                orderBy: 'id',
                unless: 'removed',
                columns: { desc: 'label', qty: 'nights', rate: 'each', amount: 'amount', options: { list: { table: 'extra_choices', via: 'stay_extra_id', column: 'name', orderBy: 'position' } } },
              },
              { table: 'charges', via: 'stay_id', orderBy: 'charged_on', unless: 'voided', columns: { date: 'charged_on', desc: 'label', amount: 'amount' } },
            ],
          },
        },
      },
    ],
  };
}

/** A stand-in invoice add-on that prints the subject it is given. */
function standIn() {
  const drawn: Record<string, unknown>[] = [];
  const slots = [
    { id: 'customerName', type: 'text', required: true },
    { id: 'total', type: 'money', required: false },
    {
      id: 'items',
      type: 'collection',
      required: false,
      columns: [
        { id: 'date', type: 'date' },
        { id: 'desc', type: 'text' },
        { id: 'qty', type: 'number' },
        { id: 'rate', type: 'money' },
        { id: 'amount', type: 'money' },
        { id: 'options', type: 'text' },
      ],
    },
  ];
  const module = {
    key: 'invoices',
    kinds: () => [{ id: 'invoice', formats: ['html'] as const, paper: ['a4'] }],
    describe: () => ({ slots }),
    render: (input: { subject: Record<string, unknown> }) => {
      drawn.push(input.subject);
      return Promise.resolve([{ format: 'html' as const, filename: 'folio.html', mediaType: 'text/html', bytes: new TextEncoder().encode('{}'), locale: 'en-US', warnings: [] }]);
    },
  };
  const runtime = {
    providers: new Map([['document-render@1', [{ addOnKey: 'invoices', contract: 'document-render', version: 1, module }]]]),
    slots: new Map(),
    conflicts: [],
    problems: [],
  } as unknown as AddOnRuntimeState;
  return { drawn, runtime };
}

describe.each(LEGS)('a folio listing nights, extras and charges — %s', (dialect, available) => {
  let h: InvoicingHarness | undefined;
  let w: Awaited<ReturnType<typeof writerFor>>;
  let seed: Awaited<ReturnType<typeof seedWren>>;
  let pipeline: RenderDeps;
  let folio: DocumentProfile;
  let drawn: Record<string, unknown>[];
  beforeAll(async () => {
    if (!available) return;
    const manifest = folioManifest();
    h = await installInvoicing(dialect, manifest, async (meta) => {
      await manifestsRepo(meta, { encrypt: (v) => v, decrypt: (v) => v }).install({
        manifestKey: 'invoices',
        version: '1.0.0',
        kind: 'add-on',
        source: 'file',
        document: addOnManifest('invoices', { addOn: { attaches: [{ app: 'wren' }], slots: [] } }),
      });
    });
    const made = await makeAppProfiles({ meta: h.meta, manifest: manifest as never, connectionId: h.connectionId, realId: await realIdOf(h.meta, h.connectionId, h.real), shapes: await installedShapes(h.meta) });
    expect(made.skipped).toEqual([]);
    folio = (await documentProfilesRepo(h.meta).listOwnedBy(h.connectionId, 'wren')).find((p) => p.kind === 'invoice')!;
    const standing = standIn();
    drawn = standing.drawn;
    pipeline = { ...createDocumentPipeline({ meta: h.meta, manager: h.manager, storage: memoryStorage(), runtime: () => standing.runtime }), now: () => Date.parse('2026-09-25T11:00:00Z') };
    w = await writerFor(h, 'Europe/London');
    seed = await seedWren((ref, values) => w.create(ref, values));
  }, 180_000);
  afterAll(async () => h?.close());

  const itemsOf = (subject: Record<string, unknown>) => (subject['collections'] as Record<string, Record<string, unknown>[]>)['items']!;

  /** WH-3283: Teodor Blank, the Loft, Thu 23 – Tue 28 July, three guests, breakfast and parking, one bar charge. */
  const teodor = async () => {
    const stay = await w.create('stays', { first_name: 'Teodor', last_name: 'Blank', guests: 3, room_type_id: seed.loft['id'], arrive: '2026-07-23', depart: '2026-07-28' });
    const breakfast = await w.create('stay_extras', { stay_id: stay['id'], extra_id: seed.breakfast['id'] });
    await w.create('extra_choices', { stay_extra_id: breakfast['id'], name: 'Toast', position: 2 });
    await w.create('extra_choices', { stay_extra_id: breakfast['id'], name: 'Eggs', position: 1 });
    await w.create('stay_extras', { stay_id: stay['id'], extra_id: seed.parking['id'] });
    return stay;
  };

  it.runIf(available)('adds WH-3283 up to $1,564.15, and to $1,599.03 with its $32 charge; a $500 payment leaves $1,099.03', async () => {
    const stay = await teodor();
    const figures = async () => (await h!.rows(`SELECT room_total, extras_total, subtotal, tax, total, balance FROM ${h!.real('stays')} WHERE id = ${String(stay['id'])}`))[0]!;
    expect(Object.values(await figures()).map((v) => Number(v).toFixed(2))).toEqual(['1125.00', '310.00', '1435.00', '129.15', '1564.15', '1564.15']);
    await w.create('charges', { stay_id: stay['id'], label: 'Bar', amount: '32.00', charged_on: '2026-07-25' });
    await w.create('payments', { stay_id: stay['id'], amount: '500.00' });
    expect(Object.values(await figures()).map((v) => Number(v).toFixed(2))).toEqual(['1125.00', '310.00', '1467.00', '132.03', '1599.03', '1099.03']);
  });

  it.runIf(available)("prints each night, then each extra with its choices, then each charge, in the add-on's own columns", async () => {
    const stay = await teodor();
    await w.create('charges', { stay_id: stay['id'], label: 'Bar', amount: '32.00', charged_on: '2026-07-25' });
    await w.create('charges', { stay_id: stay['id'], label: 'Void', amount: '9.00', charged_on: '2026-07-24', voided: true });
    const outcome = await renderDocument(pipeline, { profileId: folio.id, pk: { id: stay['id'] } });
    expect(outcome.status, JSON.stringify(outcome)).toBe('rendered');
    const subject = drawn.at(-1)!;
    expect((subject['fields'] as Record<string, unknown>)['customerName']).toBe('Teodor Blank');
    const items = itemsOf(subject);
    expect(items.map((line) => [line['date'] ?? null, line['desc'], line['qty'] ?? null, line['amount'], line['options'] ?? ''])).toEqual([
      ['2026-07-23', 'Loft', 1, 21500, ''],
      ['2026-07-24', 'Loft', 1, 24000, 'Weekend'],
      ['2026-07-25', 'Loft', 1, 24000, 'Weekend'],
      ['2026-07-26', 'Loft', 1, 21500, ''],
      ['2026-07-27', 'Loft', 1, 21500, ''],
      [null, 'Breakfast', 5, 24000, 'Eggs · Toast'],
      [null, 'Parking', 5, 7000, ''],
      ['2026-07-25', 'Bar', null, 3200, ''],
    ]);
  });

  it.runIf(available)('prints the nights as one line of the stored figure once the rates changed after booking', async () => {
    const stay = await teodor();
    await w.update('rate_rules', seed.weekend['id'], { amount: '30.00' });
    try {
      const outcome = await renderDocument(pipeline, { profileId: folio.id, pk: { id: stay['id'] } });
      expect(outcome.status).toBe('rendered');
      const items = itemsOf(drawn.at(-1)!);
      expect(items[0]).toMatchObject({ date: '2026-07-23', desc: 'Loft', qty: 5, amount: 112500 });
      expect(items[0]!['rate'] ?? null).toBeNull();
      expect(items.map((line) => line['desc'])).toEqual(['Loft', 'Breakfast', 'Parking']);
      // The desk's own route says the same.
      const nights = await h!.app.inject({ method: 'GET', url: `/data/${h!.connectionId}/${encodeURIComponent(w.targetOf('stays').table.id)}/${String(stay['id'])}/nightly` });
      void nights;
    } finally {
      await w.update('rate_rules', seed.weekend['id'], { amount: '25.00' });
    }
  });

  it.runIf(available)("needs no grant on the rate tables: a night's price is the stay's own", () => {
    const tables = mappedTables(folio.mapping as never, folio.table);
    expect(tables).toContain(w.targetOf('stays').table.id);
    expect(tables).toContain(w.targetOf('stay_extras').table.id);
    expect(tables).toContain(w.targetOf('extra_choices').table.id);
    expect(tables).not.toContain(w.targetOf('rate_rules').table.id);
    expect(tables).not.toContain(w.targetOf('room_types').table.id);
  });
});
