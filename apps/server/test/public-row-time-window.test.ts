// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A guest's change open only until a time of day kept on their own row (a
 * stay's arrival time, `time: {column}`), on every engine, the clock fixed:
 *
 *  - the app's public entry installs with it, and the endpoint store keeps it
 *    as the manifest said;
 *  - a guest may cancel until two hours before the time they gave, and not
 *    after; a guest may not move that time — the column that opens their own
 *    window is never theirs to write (refused by the manifest check, by the
 *    endpoint store and by the scope, as a writable date is), so no later
 *    arrival typed in the same change reopens a window that has closed.
 */
import { connectionTenantConfig, publicEndpointsRepo } from '@adminium/meta';
import { validateManifest } from '@adminium/manifest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { createEndpointService } from '../src/public-api/endpoint-service.js';
import { parseDefinition, type PublicMethod } from '../src/public-api/endpoint.js';
import { generatePublishableKey, sealPublishableKey } from '../src/public-api/keys.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { compileScope, ScopeCompileError } from '../src/public-api/scope.js';
import { houseManifest, houseTables, type Doc } from './house-moves.fixture.js';
import { installInvoicing, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';
import { TEST_SECRET } from './helpers.js';

const window = { arrive: { before: { time: { column: 'arrival_time' }, minus: { hours: 2 } } } };

/** The guest house with a guest's own stay entry, cancelled until two hours before the time they gave. */
function guestHouse(writableTime: boolean): Doc {
  const tables = houseTables();
  const stays = tables.find((t) => t['ref'] === 'stays')!;
  (stays['columns'] as Doc[]).push({ ref: 'email', type: 'text', maxLength: 200, nullable: true });
  const m = houseManifest(tables);
  m['frontends'] = [{ side: 'staff', kind: 'spa' }, { side: 'customer', kind: 'spa' }];
  m['publicAccess'] = [
    {
      table: 'stays',
      methods: ['GET', 'PATCH'],
      select: ['status', 'arrive', 'arrival_time'],
      claim: { verify: 'email-link', email: 'email' },
      humanCheck: true,
      writable: writableTime ? ['status', 'arrival_time'] : ['status'],
      writableValues: { status: ['cancelled'] },
      writableWhen: window,
    },
  ];
  return m;
}

describe('a public window timed by a column of the row, as the manifest and the scope see it', () => {
  it('validates when the guest may not write the time, and is refused when they may', () => {
    expect(validateManifest(guestHouse(false)).ok).toBe(true);
    const refused = validateManifest(guestHouse(true));
    expect(refused.ok).toBe(false);
    expect(JSON.stringify(refused)).toContain('arrival_time\\" decides when this row may change');
  });

  it('is refused by the scope as a writable date is: the end\'s own time, and a fallback\'s', () => {
    const columnsOf = (t: string): Set<string> | null => (t === 'public.stays' ? new Set(['id', 'status', 'arrive', 'arrival_time']) : null);
    const issuesOf = (writableWhen: Record<string, unknown>, writable: string[]): string[] => {
      try {
        compileScope(
          { version: 1, side: 'customer', timezone: 'Europe/London', resources: [{ ref: 'stays', table: 'public.stays', actions: ['read', 'update'], expose: ['id', 'status'], writable, writableWhen }] },
          columnsOf,
        );
        return [];
      } catch (error) {
        if (error instanceof ScopeCompileError) return error.issues.map((issue) => issue.code);
        throw error;
      }
    };
    expect(issuesOf(window, ['status'])).toEqual([]);
    expect(issuesOf(window, ['status', 'arrival_time'])).toContain('SCOPE_WRITABLE_WHEN_COLUMN_WRITABLE');
    expect(issuesOf({ arrive: { before: { time: '15:00', or: [{ column: 'arrive', time: { column: 'arrival_time' } }] } } }, ['status', 'arrival_time'])).toContain(
      'SCOPE_WRITABLE_WHEN_COLUMN_WRITABLE',
    );
  });
});

describe.each(LEGS)('a public window timed by a column of the row — %s', (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let served: Served;
  let w: Awaited<ReturnType<typeof writerFor>>;
  let service: ReturnType<typeof createEndpointService>;
  let idOf: (ref: string) => string;
  const definition = (writable: string[]) => ({
    methods: ['GET', 'PATCH'],
    pagination: { default_limit: 50, max_limit: 200, order: 'id.asc' },
    auth: { role: 'anon' },
    rate_limit: { requests: 600, window: '1m' },
    response: { shape: 'object', envelope: 'data' },
    path: '/stay_cancel',
    source: idOf('stays'),
    select: ['id', 'status', 'arrive', 'arrival_time'],
    filters: [],
    writable,
    writable_values: { status: ['cancelled'] },
    writable_when: { status: ['booked'], ...window },
  });

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, guestHouse(false));
    await h.meta.db.updateTable('adminium_connections').set({ timezone: 'Europe/London' }).where('id', '=', h.connectionId).execute();
    w = await writerFor(h, 'Europe/London');
    await w.create('settings', {});
    const views = createPublicViews(h.meta);
    service = createEndpointService({ meta: h.meta, viewFor: views.viewFor, tenantConfigOf: async (cid) => (await connectionTenantConfig(h.meta, cid)) ?? undefined });
    const view = (await views.viewFor(h.connectionId))!;
    idOf = (ref: string) => view.table(h.real(ref)).id;
    await service.saveEndpoint({ connectionId: h.connectionId, ref: 'stay_cancel', origin: 'custom', definition: definition(['status']) as never });
    const secret = generatePublishableKey('browser');
    const { key } = await service.createKey({
      connectionId: h.connectionId,
      name: 'house guests',
      access: [{ ref: 'stay_cancel', methods: ['GET', 'PATCH'] as PublicMethod[] }],
      secret: { prefix: secret.prefix, tokenHash: secret.tokenHash, tokenEncrypted: sealPublishableKey(dsnCryptoFromSecret(TEST_SECRET), secret.token) },
      origins: [],
      kind: 'browser',
    });
    served = await servePublic(h, key.id);
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await served.close();
    await h.close();
  });
  afterEach(() => vi.useRealTimers());
  const clock = (when: string) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(when));
  };
  const patch = (id: unknown, values: Record<string, unknown>) =>
    served.composed.app.inject({ method: 'PATCH', url: `/api/v1/public/records/stay_cancel/${String(id)}`, headers: served.headers(), payload: { values } });

  it.runIf(available)("installs the app's entry with the window as the manifest wrote it", async () => {
    const endpoints = await publicEndpointsRepo(h.meta).listByConnection(h.connectionId);
    const installed = endpoints.find((e) => e.ref.startsWith(h.real('stays')));
    expect(installed).toBeDefined();
    const parsed = parseDefinition(installed!.definition);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    expect(parsed.definition.writable_when).toEqual(window);
  });

  it.runIf(available)('lets a guest cancel until two hours before the time they gave, and not after', async () => {
    const type = await w.create('room_types', { name: 'Double' });
    await w.create('rooms', { number: '1', room_type_id: type['id'] });
    await w.create('rooms', { number: '2', room_type_id: type['id'] });
    const stay = (time: string) => w.create('stays', { guest: 'Kai', room_type_id: type['id'], arrive: '2026-11-02', depart: '2026-11-03', arrival_time: time });
    const early = await stay('18:30');
    const late = await stay('18:30');
    clock('2026-11-02T16:29:00Z');
    expect((await patch(early['id'], { status: 'cancelled' })).statusCode).toBe(200);
    clock('2026-11-02T16:30:00Z');
    const refused = await patch(late['id'], { status: 'cancelled' });
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json()).toMatchObject({ error: { code: 'PUBLIC_TOO_LATE' } });
    // A later arrival typed in the same change reopens nothing: the time is not theirs to write.
    const reopened = await patch(late['id'], { status: 'cancelled', arrival_time: '23:00' });
    expect(reopened.statusCode, reopened.body).toBe(400);
    const [row] = await h.rows(`select status, arrival_time from ${h.real('stays')} where id = ${String(late['id'])}`);
    expect([row!['status'], row!['arrival_time']]).toEqual(['booked', '18:30']);
  });

  it.runIf(available)('refuses an endpoint that lets the guest write the time their window reads', async () => {
    const saved = service.saveEndpoint({ connectionId: h.connectionId, ref: 'stay_cancel_open', origin: 'custom', definition: { ...definition(['status', 'arrival_time']), path: '/stay_cancel_open' } as never });
    await expect(saved).rejects.toMatchObject({ message: expect.stringContaining('SCOPE_WRITABLE_WHEN_COLUMN_WRITABLE') });
  });
});
