// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A plain index on a link a limit counts by (`index: true`), on every
 * engine: a fresh install makes it (MySQL's foreign key makes one already);
 * an update gives an installed table the index where none leads with the
 * column, and offers nothing where one does.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { sha512Integrity } from '../src/add-ons/store.js';
import { packageTarball } from './app-bundle-helpers.js';
import { LEGS, installInvoicing, invoicingManifest, type InvoicingHarness } from './invoicing-install.helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };

function version(v: string, indexed: boolean): Record<string, unknown> {
  return {
    ...invoicingManifest([
      { ref: 'ticket_types', columns: [id, { ref: 'capacity', type: 'int', nullable: true }] },
      {
        ref: 'tickets',
        columns: [id, { ref: 'ticket_type_id', type: 'fk', references: 'ticket_types', ...(indexed ? { index: true } : {}) }],
        capacity: { kind: 'parent', via: 'ticket_type_id', size: { column: 'capacity' } },
      },
    ]),
    version: v,
    compatibility: { minAdminiumVersion: '0.3.0', updatesFrom: '>=0.2.0' },
  };
}

describe.each(LEGS)('plain indexes a limit counts by — %s', (dialect, available) => {
  let h: (InvoicingHarness & { reply: Record<string, unknown> }) | undefined;
  afterEach(async () => {
    await h?.close();
    h = undefined;
  });
  const indexesOn = async (ref: string) => {
    const adapter = await h!.manager.introspectAdapter(h!.connectionId);
    try {
      const model = await adapter.introspect({ tableFilter: (t) => t.name === h!.real(ref), collectRowEstimates: false, collectActivityStats: false });
      return model.tables.find((t) => t.name === h!.real(ref))!.indexes.filter((i) => !i.primary).map((i) => i.columns);
    } finally {
      await adapter.close();
    }
  };

  it.skipIf(!available)('makes the index on a fresh install', async () => {
    h = await installInvoicing(dialect, version('0.2.0', true));
    expect(await indexesOn('tickets')).toContainEqual(['ticket_type_id']);
  }, 120_000);

  it.skipIf(!available)('gives an installed table the index where none leads with the column', async () => {
    h = await installInvoicing(dialect, version('0.2.0', false));
    const tarball = packageTarball({ 'manifest.json': JSON.stringify(version('0.2.1', true)), 'staff/index.html': '<!doctype html><html></html>' });
    const staged = await h.app.inject({ method: 'POST', url: `/apps/upload?expectedSha512=${encodeURIComponent(sha512Integrity(tarball))}`, headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from(tarball) });
    expect(staged.statusCode, staged.body).toBe(200);
    const planned = (await h.app.inject({ method: 'POST', url: '/apps/plan', payload: { key: 'studio', version: '0.2.1', connectionId: h.connectionId } })).json() as {
      plan: { tables: { ref: string; edits: { kind: string }[] }[] };
    };
    const edits = planned.plan.tables.find((t) => t.ref === 'tickets')!.edits;
    // MySQL's foreign key leads an index with the column already: nothing to add there.
    expect(edits.map((e) => e.kind)).toEqual(dialect === 'mysql' ? [] : ['add-index']);
    const res = await h.app.inject({ method: 'POST', url: '/apps/studio/update' });
    expect(res.statusCode, res.body).toBe(200);
    expect(await indexesOn('tickets')).toContainEqual(['ticket_type_id']);
  }, 120_000);
});
