// SPDX-License-Identifier: AGPL-3.0-only
/**
 * EMAILS OF A CHANGE, on every engine, through an app installed by the real
 * installer and the server's own producers and sender:
 *
 *  - "these columns changed" (`onChange {columns, changed: true}`): a stay's
 *    dates moved, whatever they became, compared with the row as stored — a
 *    change to the same dates, or of another column, sends nothing;
 *  - one message per change (`repeat`): dates moved twice, "Resend" twice,
 *    are two messages each;
 *  - the row as it was (`was`): the old dates and total, kept on the message
 *    and printed by its template in their forms;
 *  - every door: the desk's change, a bulk change, a guest's change, a rule's
 *    change and an undo (the dates put back are a change too) queue one; an
 *    import is history and queues none; an undo never sets off an email of a
 *    value reached ("changed to");
 *  - a Reply-To from the app's settings on every message, none when the
 *    settings hold no address;
 *  - a document the template may go without (`attach.optional`): sent
 *    without it and without its marked paragraph when no add-on draws it;
 *    without `optional`, the message fails as before;
 *  - a code in groups of four (`{{stay.code.grouped}}`).
 */
import { Readable } from 'node:stream';

import { connectionTenantConfig, filesRepo, importsRepo, overridesRepo, rolesRepo, settingsRepo, usersRepo, type MetaDb } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { decryptSecret } from '../src/config/secrets.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { runUpdateAction } from '../src/automations/actions/record-write.js';
import { EMAIL_SEND_PAYLOAD_VERSION_PLAIN, emailEnvelopeKey } from '../src/email/send.js';
import type { FileStore } from '../src/files/store.js';
import { registerImportRunHandler } from '../src/jobs/import-run.js';
import { createEndpointService } from '../src/public-api/endpoint-service.js';
import { generatePublishableKey, sealPublishableKey } from '../src/public-api/keys.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { adminPasswordHash, ADMIN_PASSWORD, login } from './auth-helpers.js';
import { TEST_SECRET } from './helpers.js';
import { installInvoicing, invoicingManifest, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';
import { SMTP } from './outbox-rows-fixture.js';
import { servePublic, type Served } from './public-lane.helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength = 120, more: Record<string, unknown> = {}) => ({ ref, type: 'text', maxLength, nullable: true, ...more });
const KINDS = ['dates', 'resend', 'cancelled', 'receipt', 'strict', 'moved'] as const;

function inn(): Record<string, unknown> {
  const manifest = invoicingManifest([
    { ref: 'settings', columns: [id, text('name', 80), text('house_email', 254)] },
    { ref: 'guests', columns: [id, { ref: 'email', type: 'text', maxLength: 254, unique: true }, text('name', 80)] },
    {
      ref: 'stays',
      columns: [
        id,
        { ref: 'guest_id', type: 'fk', references: 'guests', nullable: true },
        { ref: 'arrive', type: 'date' },
        { ref: 'depart', type: 'date' },
        { ref: 'total', type: 'decimal', scale: 2, nullable: true, semantic: 'money' },
        text('code', 16, { rules: { code: { length: 8, prefix: 'BK-' } } }),
        text('note', 200),
        { ref: 'status', type: 'enum', enum: ['booked', 'cancelled'], default: 'booked' },
        { ref: 'resend_at', type: 'timestamptz', nullable: true },
        { ref: 'paid', type: 'bool', default: false },
      ],
    },
    {
      ref: 'messages',
      columns: [
        id,
        { ref: 'kind', type: 'enum', enum: [...KINDS] },
        { ref: 'status', type: 'enum', enum: ['queued', 'sent', 'failed', 'skipped'], default: 'queued' },
        text('to_address', 254),
        { ref: 'guest_id', type: 'fk', references: 'guests', nullable: true },
        { ref: 'stay_id', type: 'fk', references: 'stays', nullable: true },
        text('error', 200),
        { ref: 'sent_at', type: 'timestamptz', nullable: true },
        { ref: 'was', type: 'text', nullable: true },
      ],
    },
  ]);
  (manifest['pages'] as { bindings: Record<string, string> }[])[0]!.bindings = { rows: 'stays' };
  const template = (kind: string, subject: string, blocks: Record<string, unknown>[], attach?: Record<string, unknown>) => ({
    key: `studio-${kind}`,
    name: kind,
    ...(attach === undefined ? {} : { attach }),
    locales: { 'en-US': { subject, blocks } },
  });
  return {
    ...manifest,
    outbox: {
      table: 'messages',
      columns: { kind: 'kind', status: 'status', to: 'to_address', error: 'error', sentAt: 'sent_at', was: 'was' },
      links: { stay: 'stay_id' },
      recipient: { via: 'guest_id', table: 'guests', email: 'email', name: 'name' },
      settings: { table: 'settings', name: 'name', replyTo: 'house_email' },
      kinds: Object.fromEntries(KINDS.map((kind) => [kind, `studio-${kind}`])),
      producers: [
        { kind: 'dates', link: 'stay_id', onChange: { table: 'stays', columns: ['arrive', 'depart'], changed: true }, repeat: true, was: ['arrive', 'depart', 'total'] },
        { kind: 'resend', link: 'stay_id', onChange: { table: 'stays', columns: ['resend_at'], changed: true }, repeat: true },
        { kind: 'cancelled', link: 'stay_id', onChange: { table: 'stays', column: 'status', to: 'cancelled' } },
        { kind: 'receipt', link: 'stay_id', onChange: { table: 'stays', column: 'paid', to: true } },
        { kind: 'strict', link: 'stay_id', onChange: { table: 'stays', column: 'paid', to: true } },
        { kind: 'moved', link: 'stay_id', onChange: { table: 'stays', columns: ['arrive'], changed: true }, repeat: true, was: ['total', 'arrive'] },
      ],
    },
    emailTemplates: [
      template('dates', 'Your dates have changed — {{stay.code.grouped}}', [
        { block: 'email.text', data: { text: 'Before {{was.arrive.day_month}} to {{was.depart.day_month}} ({{was.total}}); now {{stay.arrive.day_month}} to {{stay.depart.day_month}} ({{stay.total}}).' } },
      ]),
      template('resend', 'Your booking {{stay.code.grouped}}', [{ block: 'email.text', data: { text: 'Booking {{stay.code}}.' } }]),
      template('cancelled', 'Cancelled', [{ block: 'email.text', data: { text: 'Cancelled.' } }]),
      template(
        'receipt',
        'Paid',
        [
          { block: 'email.text', data: { text: 'Thank you for paying.' } },
          { block: 'email.text', data: { text: 'Your receipt is attached.', withAttachment: true } },
        ],
        { kind: 'receipt', link: 'stay', optional: true },
      ),
      template('strict', 'Paid (receipt)', [{ block: 'email.text', data: { text: 'Receipt attached.' } }], { kind: 'receipt', link: 'stay' }),
      template('moved', 'Moved', [{ block: 'email.text', data: { text: 'It was [{{was.total}}] from {{was.arrive.day_month}}.' } }]),
    ],
  };
}

interface Sent {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
}

describe.each(LEGS)('emails of a change — %s', (dialect, available) => {
  let h: InvoicingHarness | undefined;
  let meta: MetaDb;
  let served: Served;
  let w: Awaited<ReturnType<typeof writerFor>>;
  let cookie = '';
  const now = Date.parse('2026-10-20T12:00:00Z');

  beforeAll(async () => {
    if (!available) return;
    // A database not named `adminium_…`: a rule writes to no table whose id says so.
    h = await installInvoicing(dialect, inn(), undefined, {}, { database: 'inn' });
    meta = h.meta;
    await settingsRepo(meta).set('email.smtp', SMTP as never);
    await meta.db.updateTable('adminium_connections').set({ timezone: 'Europe/London', currency: 'USD' }).where('id', '=', h.connectionId).execute();
    w = await writerFor(h, 'Europe/London');
    await h.rows(`INSERT INTO ${h.real('settings')} (name, house_email) VALUES ('The Inn', 'desk@theinn.dev')`);
    await h.rows(`INSERT INTO ${h.real('guests')} (email, name) VALUES ('mia@waveform.dev', 'Mia Okada')`);
    // A guest's own change of dates.
    const views = createPublicViews(meta);
    const service = createEndpointService({ meta, viewFor: views.viewFor, tenantConfigOf: async (cid) => (await connectionTenantConfig(meta, cid)) ?? undefined });
    await service.saveEndpoint({
      connectionId: h.connectionId,
      ref: 'stay_dates',
      origin: 'custom',
      definition: {
        path: '/stay_dates',
        source: w.targetOf('stays').table.id,
        methods: ['PATCH'],
        select: ['id'],
        filters: [],
        pagination: { default_limit: 50, max_limit: 200, order: 'id.asc' },
        auth: { role: 'anon' },
        rate_limit: { requests: 600, window: '1m' },
        response: { shape: 'object', envelope: 'data' },
        writable: ['arrive', 'depart'],
      } as never,
    });
    const secret = generatePublishableKey('browser');
    const { key } = await service.createKey({
      connectionId: h.connectionId,
      name: 'guests',
      access: [{ ref: 'stay_dates', methods: ['PATCH'] as never }],
      secret: { prefix: secret.prefix, tokenHash: secret.tokenHash, tokenEncrypted: sealPublishableKey(dsnCryptoFromSecret(TEST_SECRET), secret.token) },
      origins: [],
      kind: 'browser',
    });
    served = await servePublic(h, key.id);
    const user = await usersRepo(meta).create({ email: 'desk@waveform.dev', name: 'Desk', passwordHash: await adminPasswordHash(), status: 'active' });
    await rolesRepo(meta).assignToUser(user.id, (await rolesRepo(meta).findBySlug('super-admin'))!.id);
    cookie = (await login(served.composed.app as never, 'desk@waveform.dev', ADMIN_PASSWORD)).cookie ?? '';
  }, 180_000);
  afterAll(async () => {
    await served?.close();
    await h?.close();
  });

  const staff = (method: 'PATCH' | 'POST', rest: string, payload: unknown) =>
    served.composed.app.inject({ method, url: `/api/v1/data/${h!.connectionId}/${encodeURIComponent(w.targetOf('stays').table.id)}${rest}`, headers: { cookie }, payload: payload as never });
  const stay = async (values: Record<string, unknown> = {}) =>
    (await w.create('stays', { guest_id: 1, arrive: '2026-11-05', depart: '2026-11-08', total: '480.00', ...values }))['id'] as number;
  const messages = async (stayId: number, kind?: string) =>
    (await h!.rows(`SELECT id, kind, status, was, error FROM ${h!.real('messages')} WHERE stay_id = ${String(stayId)}${kind === undefined ? '' : ` AND kind = '${kind}'`} ORDER BY id`)) as Record<string, unknown>[];
  const jobs = async () =>
    (await meta.db.selectFrom('adminium_jobs').selectAll().where('kind', '=', 'email.send').orderBy('createdAt').orderBy('id').execute()).map(
      (job) => (typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload) as { v: number; envelope: string },
    );
  const mail = async (): Promise<Sent[]> => (await jobs()).map((payload) => JSON.parse(decryptSecret(payload.envelope, emailEnvelopeKey(TEST_SECRET))) as Sent);
  /** Send what is queued now, and hand back what went. */
  const sendAll = async (): Promise<Sent[]> => {
    const before = (await mail()).length;
    await served.composed.app.outboxSender.sendApp('studio', now);
    return (await mail()).slice(before);
  };
  const was = (row: Record<string, unknown>) => JSON.parse(String(row['was'])) as Record<string, unknown>;

  it.runIf(available)("queues one message per change of a stay's dates at the desk, keeping the dates and total it had", async () => {
    const id = await stay();
    const moved = await staff('PATCH', `/${String(id)}`, { values: { depart: '2026-11-09' } });
    expect(moved.statusCode, moved.body).toBe(200);
    // The same dates sent again, and another column changed: no change of dates.
    expect((await staff('PATCH', `/${String(id)}`, { values: { arrive: '2026-11-05', depart: '2026-11-09' } })).statusCode).toBe(200);
    expect((await staff('PATCH', `/${String(id)}`, { values: { note: 'late check-in' } })).statusCode).toBe(200);
    expect((await staff('PATCH', `/${String(id)}`, { values: { arrive: '2026-11-04', total: '640.00' } })).statusCode).toBe(200);
    const kept = await messages(id, 'dates');
    expect(kept.map((row) => was(row))).toEqual([
      { arrive: '2026-11-05', depart: '2026-11-08', total: dialect === 'sqlite' ? 480 : '480.00' },
      { arrive: '2026-11-05', depart: '2026-11-09', total: dialect === 'sqlite' ? 480 : '480.00' },
    ]);
    const sent = (await sendAll()).filter((one) => one.subject.startsWith('Your dates'));
    expect(sent).toHaveLength(2);
    expect(sent[0]!.text).toContain('Before November 5 to November 8 ($480.00); now November 4 to November 9 ($640.00).');
    expect(sent[1]!.text).toContain('Before November 5 to November 9 ($480.00); now November 4 to November 9 ($640.00).');
    // The stay's code, in groups of four; a Reply-To to the house.
    const code = String((await h!.rows(`SELECT code FROM ${h!.real('stays')} WHERE id = ${String(id)}`))[0]!['code']);
    // The house keeps its codes with `BK-`: the prefix is printed whole, the eight after it in two groups.
    expect(code).toMatch(/^BK-[A-Z0-9]{8}$/);
    expect(sent[0]!.subject).toBe(`Your dates have changed — BK-${code.slice(3, 7)}-${code.slice(7)}`);
    expect(sent[0]!.replyTo).toBe('desk@theinn.dev');
    // Neither a Reply-To nor a message's old values changes the payload a server of the release before reads.
    expect((await jobs()).every((payload) => payload.v === EMAIL_SEND_PAYLOAD_VERSION_PLAIN)).toBe(true);
  });

  it.runIf(available)('sends "Resend" twice as two messages', async () => {
    const id = await stay();
    expect((await staff('PATCH', `/${String(id)}`, { values: { resend_at: '2026-10-20T10:00:00Z' } })).statusCode).toBe(200);
    expect((await staff('PATCH', `/${String(id)}`, { values: { resend_at: '2026-10-20T10:05:00Z' } })).statusCode).toBe(200);
    expect(await messages(id, 'resend')).toHaveLength(2);
    const sent = (await sendAll()).filter((one) => one.subject.startsWith('Your booking'));
    expect(sent).toHaveLength(2);
    expect(sent[0]!.subject).toMatch(/^Your booking BK-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  it.runIf(available)('queues one for each stay of a bulk change, and one for a guest\'s own change', async () => {
    const a = await stay();
    const b = await stay();
    const bulk = await staff('POST', '/bulk', { action: 'update', ids: [String(a), String(b)], values: { depart: '2026-11-10' } });
    expect(bulk.statusCode, bulk.body).toBe(200);
    expect(await messages(a, 'dates')).toHaveLength(1);
    expect(await messages(b, 'dates')).toHaveLength(1);
    const guest = await served.composed.app.inject({ method: 'PATCH', url: `/api/v1/public/records/stay_dates/${String(a)}`, headers: served.headers(), payload: { values: { arrive: '2026-11-06' } } });
    expect(guest.statusCode, guest.body).toBe(200);
    const kept = await messages(a, 'dates');
    expect(kept).toHaveLength(2);
    expect(was(kept[1]!)).toMatchObject({ arrive: '2026-11-05', depart: '2026-11-10' });
  });

  it.runIf(available)("queues one for a rule's change of the dates", async () => {
    const id = await stay();
    const target = w.targetOf('stays');
    const row = (await h!.rows(`SELECT * FROM ${h!.real('stays')} WHERE id = ${String(id)}`))[0]!;
    await runUpdateAction(
      { type: 'record.update', values: { depart: '2026-11-12' } } as never,
      {
        meta,
        manager: h!.manager,
        app: served.composed.app,
        writes: w.writes,
        rule: { id: 'rule_dates', name: 'Longer stays' } as never,
        runId: 'run_1',
        hops: 0,
        now,
        source: { connectionId: h!.connectionId, view: target.view, db: target.db, dialect: target.dialect, table: target.table, record: { connectionId: h!.connectionId, table: target.table.id, pk: { id }, label: String(id) }, row },
        tokens: {} as never,
        text: { updateOk: () => '', writeWould: () => '' } as never,
        secret: TEST_SECRET,
      } as never,
    );
    expect(await messages(id, 'dates')).toHaveLength(1);
  });

  it.runIf(available)('queues one when the change of dates is undone, and none for an undo that reaches a value', async () => {
    const id = await stay();
    const moved = await staff('PATCH', `/${String(id)}`, { values: { depart: '2026-11-11' } });
    const token = (moved.json() as { undoToken: string }).undoToken;
    const undone = await served.composed.app.inject({ method: 'POST', url: `/api/v1/data/undo/${token}`, headers: { cookie } });
    expect(undone.statusCode, undone.body).toBe(200);
    const kept = await messages(id, 'dates');
    expect(kept).toHaveLength(2);
    // The second tells of the dates put back: it keeps the ones the undone change had set.
    expect(was(kept[1]!)).toMatchObject({ depart: '2026-11-11' });

    // A cancelled stay taken back to booked, then that undone: the stay is cancelled again, and no cancellation email goes.
    const other = await stay({ status: 'cancelled' });
    const back = await staff('PATCH', `/${String(other)}`, { values: { status: 'booked' } });
    const again = await served.composed.app.inject({ method: 'POST', url: `/api/v1/data/undo/${(back.json() as { undoToken: string }).undoToken}`, headers: { cookie } });
    expect(again.statusCode, again.body).toBe(200);
    expect((await h!.rows(`SELECT status FROM ${h!.real('stays')} WHERE id = ${String(other)}`))[0]!['status']).toBe('cancelled');
    expect(await messages(other, 'cancelled')).toHaveLength(0);
  });

  it.runIf(available)('queues none for an import: it brings history', async () => {
    const id = await stay();
    const csv = `id,depart\n${String(id)},2026-11-15\n`;
    const storage = {
      read: async () => Promise.resolve(Readable.from([csv])),
      write: async () => Promise.resolve({ storageKey: 'report', sizeBytes: 0, sha256: '', destinationId: null, storage: 'memory' }),
    } as unknown as FileStore;
    const file = await filesRepo(meta).create({ filename: 'stays.csv', mime: 'text/csv', sizeBytes: csv.length, sha256: 'x', kind: 'upload' });
    const imports = importsRepo(meta);
    const user = await usersRepo(meta).create({ email: 'importer@waveform.dev', name: 'Importer', passwordHash: 'x' });
    const job = await imports.create({
      connectionId: h!.connectionId,
      tableName: w.targetOf('stays').table.id,
      requestedBy: user.id,
      fileId: file.id,
      mapping: { columns: [{ from: 'id', to: 'id' }, { from: 'depart', to: 'depart' }] } as never,
      options: { mode: 'upsert', matchColumn: 'id', skipInvalid: false } as never,
    });
    await imports.markReady(job.id, { total: 1 });
    let handler: ((payload: unknown, ctx: unknown) => Promise<unknown>) | null = null;
    registerImportRunHandler({ registerJobHandler: (_kind: string, _schema: unknown, run: typeof handler) => (handler = run) } as never, { meta, manager: h!.manager, storage });
    await handler!({ importId: job.id }, { jobId: 'job_import', signal: new AbortController().signal, progress: () => {}, log: () => {} });
    expect((await imports.findById(job.id))?.status).toBe('succeeded');
    expect(String((await h!.rows(`SELECT depart FROM ${h!.real('stays')} WHERE id = ${String(id)}`))[0]!['depart'])).toContain('15');
    expect(await messages(id)).toHaveLength(0);
  });

  it.runIf(available)('sends a receipt without the document no add-on draws, and without its marked paragraph; fails one that must carry it', async () => {
    const id = await stay();
    expect((await staff('PATCH', `/${String(id)}`, { values: { paid: true } })).statusCode).toBe(200);
    const sent = await sendAll();
    const receipt = sent.find((one) => one.subject === 'Paid');
    expect(receipt).toBeDefined();
    expect(receipt!.text).toContain('Thank you for paying.');
    expect(receipt!.text).not.toContain('Your receipt is attached.');
    const strict = await messages(id, 'strict');
    expect(strict[0]).toMatchObject({ status: 'failed' });
    expect(String(strict[0]!['error'])).toContain('receipt');
    expect(sent.find((one) => one.subject === 'Paid (receipt)')).toBeUndefined();
  });

  it.runIf(available)('keeps nothing of a column marked personal since, and prints what was kept of it empty', async () => {
    const id = await stay();
    const pii = await overridesRepo(meta).create({ connectionId: h!.connectionId, op: 'column.pii', tableName: w.targetOf('stays').table.id, columnName: 'total', value: { masked: true } as never });
    try {
      expect((await staff('PATCH', `/${String(id)}`, { values: { arrive: '2026-11-04' } })).statusCode).toBe(200);
      const kept = await messages(id, 'moved');
      expect(kept).toHaveLength(1);
      expect(was(kept[0]!)).toEqual({ total: null, arrive: '2026-11-05' });
      // One kept before the mark: what it kept is not printed.
      await h!.rows(`UPDATE ${h!.real('messages')} SET was = '{"total":480,"arrive":"2026-11-05"}' WHERE id = ${String(kept[0]!['id'])}`);
      const sent = (await sendAll()).filter((one) => one.subject === 'Moved');
      expect(sent).toHaveLength(1);
      expect(sent[0]!.text).toContain('It was [] from November 5.');
      expect(sent[0]!.text).not.toContain('480');
    } finally {
      await overridesRepo(meta).delete(pii.id);
    }
  });

  it.runIf(available)('adds no Reply-To when the house keeps no address, or one that is not an address', async () => {
    for (const value of [null, 'not an address', 'a@b.dev, c@d.dev']) {
      await h!.rows(`UPDATE ${h!.real('settings')} SET house_email = ${value === null ? 'NULL' : `'${value}'`}`);
      const id = await stay();
      await staff('PATCH', `/${String(id)}`, { values: { resend_at: '2026-10-21T09:00:00Z' } });
      const sent = (await sendAll()).filter((one) => one.subject.startsWith('Your booking'));
      expect(sent).toHaveLength(1);
      expect(sent[0]!.replyTo).toBeUndefined();
    }
    await h!.rows(`UPDATE ${h!.real('settings')} SET house_email = 'desk@theinn.dev'`);
  });
});
