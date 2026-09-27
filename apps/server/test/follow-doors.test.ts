// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Rows that follow a changed row are brought into step through every door, on
 * every engine — on a table that keeps no totals of its own too: a public
 * batch (a group's seats when its size changes), an undo of a change, and an
 * import's update when the table has hooks. A public batch is a change like
 * any other beside that: an email that waits for a move is queued by the move
 * (a job made ready), and a row the batch may not write — a paid stay whose
 * balance would go below zero — is refused as any public write is, never
 * answered as a server that is down.
 */
import { Readable } from 'node:stream';

import { connectionTenantConfig, filesRepo, importsRepo, rolesRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createWriteService } from '../src/crud/write-service.js';
import { writeStores } from '../src/crud/write-stores.js';
import type { FileStore } from '../src/files/store.js';
import { registerImportRunHandler } from '../src/jobs/import-run.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';

import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { createEndpointService } from '../src/public-api/endpoint-service.js';
import { generatePublishableKey, sealPublishableKey } from '../src/public-api/keys.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { TEST_SECRET } from './helpers.js';
import { installInvoicing, invoicingManifest, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';
import { seedWren, wrenManifest } from './wren-house-fixture.js';

/** An operator's own door on one table: written in batches by anyone holding its key. */
async function door(h: InvoicingHarness, table: string, ref: string, writable: string[]): Promise<Served> {
  const views = createPublicViews(h.meta);
  const service = createEndpointService({ meta: h.meta, viewFor: views.viewFor, tenantConfigOf: async (cid) => (await connectionTenantConfig(h.meta, cid)) ?? undefined });
  const source = (await views.viewFor(h.connectionId))!.table(h.real(table)).id;
  await service.saveEndpoint({
    connectionId: h.connectionId,
    ref,
    origin: 'custom',
    definition: {
      path: `/${ref}`,
      source,
      methods: ['PATCH', 'BATCH'],
      select: ['id'],
      filters: [],
      pagination: { default_limit: 50, max_limit: 200, order: 'id.asc' },
      auth: { role: 'anon' },
      rate_limit: { requests: 60, window: '1m' },
      response: { shape: 'object', envelope: 'data' },
      writable,
    },
  });
  const secret = generatePublishableKey('browser');
  const { key } = await service.createKey({
    connectionId: h.connectionId,
    name: `${ref} key`,
    access: [{ ref, methods: ['PATCH', 'BATCH'] }],
    secret: { prefix: secret.prefix, tokenHash: secret.tokenHash, tokenEncrypted: sealPublishableKey(dsnCryptoFromSecret(TEST_SECRET), secret.token) },
    origins: [],
    kind: 'browser',
  });
  return servePublic(h, key.id);
}

describe.each(LEGS)('a public batch of stays — %s', (dialect, available) => {
  let h: InvoicingHarness | undefined;
  let w: Awaited<ReturnType<typeof writerFor>>;
  let seed: Awaited<ReturnType<typeof seedWren>>;
  let served: Served;
  const batch = (rows: Record<string, unknown>[]) =>
    served.composed.app.inject({ method: 'POST', url: '/api/v1/public/records/stays_door/batch', headers: served.headers(), payload: { rows } });

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, wrenManifest());
    w = await writerFor(h, 'Europe/London');
    seed = await seedWren((ref, values) => w.create(ref, values));
    served = await door(h, 'stays', 'stays_door', ['guests', 'depart']);
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await served.close();
    await h!.close();
  });

  const breakfastStay = async () => {
    const made = await w.create('stays', { first_name: 'Mia', last_name: 'Okada', guests: 2, room_type_id: seed.garden['id'], arrive: '2026-07-31', depart: '2026-08-03' });
    await w.create('stay_extras', { stay_id: made['id'], extra_id: seed.breakfast['id'] });
    return { stay: made };
  };
  const row = async (ref: string, id: unknown) => (await h!.rows(`SELECT * FROM ${h!.real(ref)} WHERE id = ${String(id)}`))[0]!;

  it.skipIf(!available)('refuses a paid stay a change could take below what was paid, as any public write is refused', async () => {
    const { stay } = await breakfastStay();
    await w.create('payments', { stay_id: stay['id'], amount: '693.24' });
    const res = await batch([{ id: stay['id'], depart: '2026-08-02' }]);
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json()).toEqual({ error: { code: 'PUBLIC_WRITE_REFUSED', message: 'That write was refused.' } });
    expect(String((await row('stays', stay['id']))['depart'])).toContain('2026-08-03');
  });
});

/** A tour's groups, and the seats that follow their group's size. */
function groupSeats(): Record<string, unknown> {
  return invoicingManifest([
    { ref: 'groups', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'size', type: 'int', default: 1 }] },
    {
      ref: 'seats',
      columns: [
        { ref: 'id', type: 'int', role: 'pk' },
        { ref: 'group_id', type: 'fk', references: 'groups' },
        { ref: 'size', type: 'int', nullable: true, rules: { copy: { via: 'group_id', from: 'size', mode: 'always', follow: true } } },
      ],
    },
  ]);
}

describe.each(LEGS)('rows others follow, through every door — %s', (dialect, available) => {
  let h: InvoicingHarness | undefined;
  let w: Awaited<ReturnType<typeof writerFor>>;
  let served: Served;

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, groupSeats());
    w = await writerFor(h);
    served = await door(h, 'groups', 'groups_door', ['size']);
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await served.close();
    await h!.close();
  });

  const size = async (id: unknown) => Number((await h!.rows(`select size from ${h!.real('seats')} where id = ${String(id)}`))[0]!['size']);

  it.skipIf(!available)('brings the followers of each changed row into step', async () => {
    const one = await w.create('groups', { size: 2 });
    const two = await w.create('groups', { size: 4 });
    const seat = await w.create('seats', { group_id: one['id'] });
    const other = await w.create('seats', { group_id: two['id'] });
    const res = await served.composed.app.inject({
      method: 'POST',
      url: '/api/v1/public/records/groups_door/batch',
      headers: served.headers(),
      payload: { rows: [{ id: one['id'], size: 5 }, { id: two['id'], size: 6 }] },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect([await size(seat['id']), await size(other['id'])]).toEqual([5, 6]);
  });

  it.skipIf(!available)('brings them back into step with an undo of the change', async () => {
    const desk = await usersRepo(h!.meta).create({ email: 'desk@tours.dev', name: 'Desk', passwordHash: await adminPasswordHash() });
    await rolesRepo(h!.meta).assignToUser(desk.id, (await rolesRepo(h!.meta).findBySlug('super-admin'))!.id);
    const login = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'desk@tours.dev', password: ADMIN_PASSWORD } });
    const cookie = sessionCookie(login.headers['set-cookie']);
    const group = await w.create('groups', { size: 2 });
    const seat = await w.create('seats', { group_id: group['id'] });
    const url = `/api/v1/data/${h!.connectionId}/${encodeURIComponent(w.targetOf('groups').table.id)}/${String(group['id'])}`;
    const changed = await served.composed.app.inject({ method: 'PATCH', url, headers: { cookie }, payload: { values: { size: 7 } } });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(await size(seat['id'])).toBe(7);
    const token = (changed.json() as { undoToken: string | null }).undoToken;
    expect(token).not.toBeNull();
    const undone = await served.composed.app.inject({ method: 'POST', url: `/api/v1/data/undo/${token!}`, headers: { cookie } });
    expect(undone.statusCode, undone.body).toBe(200);
    expect(await size(seat['id'])).toBe(2);
  });

  it.skipIf(!available)('writes a new follower with its parent as it is when the row goes in, not as it was prepared', async () => {
    const group = await w.create('groups', { size: 2 });
    // A tree whose root follows a group: the group changes after the root was prepared, before it goes in.
    const root = { name: 'seats', target: w.targetOf('seats'), values: { group_id: group['id'] }, at: [], children: [] };
    const outcome = await w.writes.createTree({
      root,
      context: w.desk,
      mode: 'save',
      checks: async (db, node) => {
        if (node.at.length === 0) await db.updateTable(w.targetOf('groups').table.id as never).set({ size: 8 } as never).where('id' as never, '=', group['id'] as never).execute();
      },
      announce: async () => {},
      mapError: (error) => {
        throw error;
      },
    });
    expect(await size(outcome.root['id'])).toBe(8);
    // An import's rows likewise: the group changes after the rows were checked, before they go in.
    const other = await w.create('groups', { size: 3 });
    const csv = `group_id\n${String(other['id'])}\n`;
    const base = createWriteService(writeStores(h!.meta));
    const writes = {
      ...base,
      check: async (...args: Parameters<typeof base.check>) => {
        const out = await base.check(...args);
        await h!.rows(`update ${h!.real('groups')} set size = 5 where id = ${String(other['id'])}`);
        return out;
      },
    };
    const job = await importOf('seats', csv, { columns: [{ from: 'group_id', to: 'group_id' }] }, { mode: 'insert', skipInvalid: false }, writes as never);
    expect(job).toBe('succeeded');
    expect(Number((await h!.rows(`select size from ${h!.real('seats')} where group_id = ${String(other['id'])}`))[0]!['size'])).toBe(5);
  });

  /** An import of one table, run by the job's own handler with this write service. */
  const importOf = async (ref: string, csv: string, mapping: unknown, options: unknown, writes?: ReturnType<typeof createWriteService>): Promise<string | undefined> => {
    const storage = {
      read: async () => Promise.resolve(Readable.from([csv])),
      write: async () => Promise.resolve({ storageKey: 'report', sizeBytes: 0, sha256: '', destinationId: null, storage: 'memory' }),
    } as unknown as FileStore;
    const file = await filesRepo(h!.meta).create({ filename: `${ref}.csv`, mime: 'text/csv', sizeBytes: csv.length, sha256: 'x', kind: 'upload' });
    const imports = importsRepo(h!.meta);
    const user = await usersRepo(h!.meta).create({ email: `importer-${String(Math.random()).slice(2)}@tours.dev`, name: 'Importer', passwordHash: 'x' });
    const job = await imports.create({ connectionId: h!.connectionId, tableName: w.targetOf(ref).table.id, requestedBy: user.id, fileId: file.id, mapping: mapping as never, options: options as never });
    await imports.markReady(job.id, { total: csv.trim().split('\n').length - 1 });
    let handler: ((payload: unknown, ctx: unknown) => Promise<unknown>) | null = null;
    registerImportRunHandler({ registerJobHandler: (_kind: string, _schema: unknown, run: typeof handler) => (handler = run) } as never, { meta: h!.meta, manager: h!.manager, storage, ...(writes === undefined ? {} : { writes }) });
    await handler!({ importId: job.id }, { jobId: `job_${job.id}`, signal: new AbortController().signal, progress: () => {}, log: () => {} });
    return (await imports.findById(job.id))?.status;
  };

  it.skipIf(!available)("brings them into step with an import's update, on a table with hooks", async () => {
    const group = await w.create('groups', { size: 3 });
    const seat = await w.create('seats', { group_id: group['id'] });
    const csv = `id,size\n${String(group['id'])},9\n`;
    const storage = {
      read: async () => Promise.resolve(Readable.from([csv])),
      write: async () => Promise.resolve({ storageKey: 'report', sizeBytes: 0, sha256: '', destinationId: null, storage: 'memory' }),
    } as unknown as FileStore;
    const file = await filesRepo(h!.meta).create({ filename: 'groups.csv', mime: 'text/csv', sizeBytes: csv.length, sha256: 'x', kind: 'upload' });
    const imports = importsRepo(h!.meta);
    const user = await usersRepo(h!.meta).create({ email: 'importer@tours.dev', name: 'Importer', passwordHash: 'x' });
    const job = await imports.create({
      connectionId: h!.connectionId,
      tableName: w.targetOf('groups').table.id,
      requestedBy: user.id,
      fileId: file.id,
      mapping: { columns: [{ from: 'id', to: 'id' }, { from: 'size', to: 'size' }] },
      options: { mode: 'upsert', matchColumn: 'id', skipInvalid: false },
    });
    await imports.markReady(job.id, { total: 1 });
    // A project hook judges the table's changes first: the import writes them one at a time.
    const writes = createWriteService({ ...writeStores(h!.meta), hooks: () => ({ wants: async (timing, action) => timing === 'before' && action === 'update', before: async () => {}, after: async () => {} }) });
    let handler: ((payload: unknown, ctx: unknown) => Promise<unknown>) | null = null;
    registerImportRunHandler({ registerJobHandler: (_kind: string, _schema: unknown, run: typeof handler) => (handler = run) } as never, { meta: h!.meta, manager: h!.manager, storage, writes });
    await handler!({ importId: job.id }, { jobId: 'job_follow', signal: new AbortController().signal, progress: () => {}, log: () => {} });
    expect((await imports.findById(job.id))?.status).toBe('succeeded');
    expect(Number((await h!.rows(`select size from ${h!.real('groups')} where id = ${String(group['id'])}`))[0]!['size'])).toBe(9);
    expect(await size(seat['id'])).toBe(9);
  });
});

/** A studio's jobs, and the email a job made ready queues for its client. */
function readyJobs(): Record<string, unknown> {
  return {
    ...invoicingManifest([
      { ref: 'clients', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'email', type: 'text', maxLength: 254, nullable: true }] },
      {
        ref: 'jobs',
        columns: [
          { ref: 'id', type: 'int', role: 'pk' },
          { ref: 'client_id', type: 'fk', references: 'clients', nullable: true },
          { ref: 'status', type: 'enum', enum: ['open', 'ready'], default: 'open' },
        ],
      },
      {
        ref: 'messages',
        columns: [
          { ref: 'id', type: 'int', role: 'pk' },
          { ref: 'kind', type: 'enum', enum: ['ready'] },
          { ref: 'status', type: 'enum', enum: ['queued', 'sent', 'failed', 'skipped'], default: 'queued' },
          { ref: 'to_address', type: 'text', maxLength: 254, nullable: true },
          { ref: 'client_id', type: 'fk', references: 'clients', nullable: true },
          { ref: 'job_id', type: 'fk', references: 'jobs', nullable: true },
        ],
      },
    ]),
    outbox: {
      table: 'messages',
      columns: { kind: 'kind', status: 'status', to: 'to_address' },
      links: { job: 'job_id' },
      recipient: { via: 'client_id', table: 'clients', email: 'email' },
      kinds: { ready: 'studio-ready' },
      producers: [{ kind: 'ready', link: 'job_id', onChange: { table: 'jobs', column: 'status', to: 'ready' } }],
    },
    emailTemplates: [{ key: 'studio-ready', name: 'Ready', locales: { 'en-US': { subject: 'Ready', blocks: [{ block: 'email.text', data: { text: 'Your job is ready.' } }] } } }],
  };
}

describe.each(LEGS)('a public batch that moves a row an email waits for — %s', (dialect, available) => {
  let h: InvoicingHarness | undefined;
  let served: Served;

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, readyJobs());
    await h.rows(`insert into ${h.real('clients')} (id, email) values (1, 'ana@studio.org')`);
    await h.rows(`insert into ${h.real('jobs')} (id, client_id, status) values (1, 1, 'open'), (2, 1, 'open')`);
    served = await door(h, 'jobs', 'jobs_door', ['status']);
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await served.close();
    await h!.close();
  });

  it.skipIf(!available)('queues the email each move makes', async () => {
    const res = await served.composed.app.inject({
      method: 'POST',
      url: '/api/v1/public/records/jobs_door/batch',
      headers: served.headers(),
      payload: { rows: [{ id: 1, status: 'ready' }, { id: 2, status: 'ready' }] },
    });
    expect(res.statusCode, res.body).toBe(200);
    const queued = await h!.rows(`select kind, job_id from ${h!.real('messages')} order by job_id`);
    expect(queued.map((m) => [m['kind'], Number(m['job_id'])])).toEqual([
      ['ready', 1],
      ['ready', 2],
    ]);
  });
});
