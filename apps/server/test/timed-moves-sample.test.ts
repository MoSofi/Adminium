// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A sample row the clock moves stays the app's own: a held sample order that
 * expires by its timed move is recorded again as the sample now holds it, so
 * "Remove sample data" takes it with the rest, not kept as a change of the
 * operator's — on every engine.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAppStore } from '../src/apps/store.js';
import { createSampleDataService, findSampleApp } from '../src/apps/sample-data.js';
import type { FileStore } from '../src/files/store.js';
import { runTimedMoves } from '../src/states/timed-moves.js';
import { installInvoicing, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { venueManifest } from './venue-moves.fixture.js';

const memoryFiles = {
  write: async () => ({ storageKey: 'x', sizeBytes: 0, sha256: '', destinationId: null, storage: 'memory' }),
} as unknown as FileStore;

const BUNDLE = {
  format: 'adminium.sample/1',
  app: 'venue',
  tables: [
    { ref: 'settings', rows: [{ hold_minutes: 10 }] },
    { ref: 'events', rows: [{ '@label': 'show', name: 'Sample show', starts_at: '2026-01-20T19:00:00Z', doors_at: '2026-01-20T18:30:00Z' }] },
    { ref: 'orders', rows: [{ event_id: { '@ref': 'show' }, email: 'sample@sample.example', status: 'held', held_until: '2026-01-01T09:00:00Z' }] },
  ],
};

describe.each(LEGS)('a sample row the clock moves — %s', (dialect, available) => {
  let h: InvoicingHarness | undefined;
  afterEach(async () => {
    vi.useRealTimers();
    await h?.close();
    h = undefined;
  });

  it.runIf(available)('is taken away with the rest of the sample data', async () => {
    const manifest = { ...venueManifest(), sampleData: { file: 'seeds/venue.sample.json' } };
    h = await installInvoicing(dialect, manifest, undefined, { 'seeds/venue.sample.json': JSON.stringify(BUNDLE) });
    const service = createSampleDataService({ meta: h.meta, manager: h.manager, store: createAppStore({ dataDir: h.dataDir }), files: memoryFiles });
    const app = async () => (await findSampleApp(h!.meta, 'venue'))!;
    await service.add(await app(), { locale: 'en-US', userId: null, userLabel: 'test', now: Date.now() });
    const [order] = await h.rows(`select id, status from ${h.real('orders')}`);
    expect(order!['status']).toBe('held');

    // Two days on, whatever the sample's hold said: long past its end.
    const later = new Date(Date.now() + 2 * 86_400_000);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(later);
    const tick = await runTimedMoves({ meta: h.meta, manager: h.manager }, h.connectionId, {}, later);
    vi.useRealTimers();
    expect(tick.moved).toBe(1);
    expect((await h.rows(`select status from ${h.real('orders')}`))[0]!['status']).toBe('expired');

    expect((await service.removePreview(await app())).changed).toEqual([]);
    const removed = await service.remove(await app(), { keepChanged: true, userId: null, userLabel: 'test' });
    expect(removed).toMatchObject({ kept: 0 });
    expect(await h.rows(`select id from ${h.real('orders')}`)).toEqual([]);
  }, 120_000);
});
