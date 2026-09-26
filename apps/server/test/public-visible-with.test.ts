// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A person's child rows are only as visible as their parent — over the wire,
 * through an app installed by the real installer, on every engine this run
 * can reach.
 *
 * The sweep: a draft's lines by id, an unshared deliverable's versions,
 * another client's notes, a clause of a terms version only a draft names —
 * each answers the one 404, the same as an id that does not exist. A child's
 * own copy of its client (`client_id`) is never read: a line carrying the
 * right client under a draft stays hidden, one carrying the wrong client
 * under a sent proposal shows. And a note is made only against rows the
 * person can see, with its version belonging to its deliverable.
 */
import { connectionTenantConfig, publicEndpointsRepo } from '@adminium/meta';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { createEndpointService } from '../src/public-api/endpoint-service.js';
import { generatePublishableKey, sealPublishableKey } from '../src/public-api/keys.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { compileScope, ScopeCompileError, type PublicScopeDocument } from '../src/public-api/scope.js';
import { readerFor } from '../src/public-api/visible-with.js';
import { installInvoicing, invoicingManifest, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';
import { TEST_SECRET } from './helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, nullable = false) => ({ ref, type: 'text', maxLength: 120, ...(nullable ? { nullable: true } : {}) });
const fk = (ref: string, references: string, nullable = false) => ({ ref, type: 'fk', references, ...(nullable ? { nullable: true } : {}) });

/** A studio's client side in miniature: proposals and their terms, deliverables and their notes. */
function portalTables(): Record<string, unknown>[] {
  return [
    { ref: 'clients', columns: [id, { ...text('email'), unique: true }, text('name')] },
    { ref: 'terms_versions', columns: [id, text('title')] },
    { ref: 'terms_clauses', columns: [id, fk('terms_version_id', 'terms_versions'), text('body')] },
    {
      ref: 'proposals',
      columns: [
        id,
        fk('client_id', 'clients'),
        { ref: 'status', type: 'enum', enum: ['draft', 'sent', 'accepted'], default: 'draft' },
        fk('terms_version_id', 'terms_versions', true),
        { ref: 'valid_until', type: 'date', nullable: true },
        text('signed_name', true),
      ],
    },
    { ref: 'proposal_lines', columns: [id, fk('proposal_id', 'proposals'), fk('client_id', 'clients', true), text('label')] },
    { ref: 'deliverables', columns: [id, fk('client_id', 'clients'), { ref: 'status', type: 'enum', enum: ['unshared', 'pending', 'approved'], default: 'unshared' }] },
    { ref: 'deliverable_versions', columns: [id, fk('deliverable_id', 'deliverables'), { ref: 'v', type: 'int', default: 1 }] },
    // `deliverable_id` may be empty, so only the create's own check keeps a note from being made with no parent.
    { ref: 'deliverable_notes', columns: [id, fk('deliverable_id', 'deliverables', true), fk('version_id', 'deliverable_versions', true), fk('client_id', 'clients', true), text('body')] },
  ];
}

function portalManifest(): Record<string, unknown> {
  return {
    ...invoicingManifest(portalTables()),
    publicAccess: [
      { table: 'clients', methods: ['GET'], select: ['name'], claim: { match: ['email', 'name'] } },
      {
        table: 'proposals',
        methods: ['GET', 'PATCH'],
        select: ['id', 'status', 'terms_version_id', 'signed_name'],
        claimedBy: { table: 'clients', column: 'client_id' },
        filters: [{ column: 'status', op: 'in', value: ['sent', 'accepted'] }],
        // Signed once, while it is sent and still in date — and never with no name.
        writable: ['signed_name'],
        writableWhen: { status: ['sent'], valid_until: 'from-today', signed_name: [null] },
        requires: ['signed_name'],
      },
      { table: 'proposal_lines', methods: ['GET'], select: ['id', 'proposal_id', 'label'], visibleWith: { table: 'proposals', via: 'proposal_id' } },
      // The proposal points at the version it was sent with: the parent points down.
      { table: 'terms_versions', methods: ['GET'], select: ['id', 'title'], visibleWith: { table: 'proposals', via: 'terms_version_id' } },
      // Two steps from the client: a clause of a version a visible proposal names.
      { table: 'terms_clauses', methods: ['GET'], select: ['id', 'terms_version_id', 'body'], visibleWith: { table: 'terms_versions', via: 'terms_version_id' } },
      { table: 'deliverables', methods: ['GET'], select: ['id', 'status'], claimedBy: { table: 'clients', column: 'client_id' }, filters: [{ column: 'status', op: 'neq', value: 'unshared' }] },
      { table: 'deliverable_versions', methods: ['GET'], select: ['id', 'deliverable_id', 'v'], visibleWith: { table: 'deliverables', via: 'deliverable_id' } },
      {
        table: 'deliverable_notes',
        methods: ['GET', 'POST', 'PATCH'],
        select: ['id', 'deliverable_id', 'version_id', 'body'],
        writable: ['deliverable_id', 'version_id', 'body'],
        requires: ['body'],
        visibleWith: { table: 'deliverables', via: 'deliverable_id' },
      },
      // A proposal gone out of date may be asked about again — and only one that has.
      {
        table: 'proposals',
        methods: ['PATCH'],
        select: ['id', 'signed_name'],
        claimedBy: { table: 'clients', column: 'client_id' },
        writable: ['signed_name'],
        writableWhen: { status: ['sent'], valid_until: 'before-today' },
      },
    ],
  };
}

/** Two clients, each with drafts and sent work, and children that say the wrong client. */
async function seed(h: InvoicingHarness): Promise<void> {
  const t = h.real;
  const run = (statement: string) => h.rows(statement);
  await run(`insert into ${t('clients')} (email, name) values ('ada@example.com', 'Ada')`);
  await run(`insert into ${t('clients')} (email, name) values ('ben@example.com', 'Ben')`);
  for (const title of ['T1 sent to Ada', 'T2 only in Ada draft', 'T3 sent to Ben']) await run(`insert into ${t('terms_versions')} (title) values ('${title}')`);
  for (const v of [1, 2, 3]) await run(`insert into ${t('terms_clauses')} (terms_version_id, body) values (${String(v)}, 'clause of ${String(v)}')`);
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  await run(`insert into ${t('proposals')} (client_id, status, terms_version_id, valid_until) values (1, 'sent', 1, '${day(3)}')`);
  await run(`insert into ${t('proposals')} (client_id, status, terms_version_id) values (1, 'draft', 2)`);
  await run(`insert into ${t('proposals')} (client_id, status, terms_version_id) values (2, 'sent', 3)`);
  // Ada's fourth: sent, and out of date since yesterday.
  await run(`insert into ${t('proposals')} (client_id, status, valid_until) values (1, 'sent', '${day(-1)}')`);
  // Line 1: Ada's sent proposal. Line 2: her draft, marked hers. Line 3: Ben's. Line 4: Ada's sent proposal, wrongly marked Ben's.
  await run(`insert into ${t('proposal_lines')} (proposal_id, client_id, label) values (1, 1, 'design')`);
  await run(`insert into ${t('proposal_lines')} (proposal_id, client_id, label) values (2, 1, 'draft line')`);
  await run(`insert into ${t('proposal_lines')} (proposal_id, client_id, label) values (3, 2, 'ben line')`);
  await run(`insert into ${t('proposal_lines')} (proposal_id, client_id, label) values (1, 2, 'mislabelled')`);
  await run(`insert into ${t('deliverables')} (client_id, status) values (1, 'pending')`);
  await run(`insert into ${t('deliverables')} (client_id, status) values (1, 'unshared')`);
  await run(`insert into ${t('deliverables')} (client_id, status) values (2, 'pending')`);
  await run(`insert into ${t('deliverables')} (client_id, status) values (1, 'approved')`);
  for (const d of [1, 2, 3, 4]) await run(`insert into ${t('deliverable_versions')} (deliverable_id, v) values (${String(d)}, 1)`);
  await run(`insert into ${t('deliverable_notes')} (deliverable_id, client_id, body) values (1, 1, 'ada note')`);
  await run(`insert into ${t('deliverable_notes')} (deliverable_id, client_id, body) values (3, 2, 'ben note')`);
  await run(`insert into ${t('deliverable_notes')} (deliverable_id, client_id, body) values (2, 1, 'note on unshared')`);
}

describe.each(LEGS)('rows visible with their parent — %s', (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let served: Served;
  let ada: string;
  let ben: string;
  const ref = (short: string, suffix = 'claimed') => `${h.real(short)}_${suffix}`;
  const ids = (res: { json: () => unknown }) =>
    (res.json() as { data: { id: unknown }[] }).data.map((row) => Number(row.id)).sort((a, b) => a - b);

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, portalManifest());
    const made = h.reply['publicAccess'] as { keyId: string; endpoints: string[] };
    expect(made.endpoints).toContain(ref('deliverable_notes'));
    await seed(h);
    served = await servePublic(h, made.keyId);
    const claim = async (email: string, name: string) => {
      const res = await served.post('/claim', { match: { email, name } });
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as { data: { session: string } }).data.session;
    };
    ada = await claim('ada@example.com', 'Ada');
    ben = await claim('ben@example.com', 'Ben');
  }, 120_000);

  afterAll(async () => {
    if (!available) return;
    await served.close();
    await h.close();
  });

  it.skipIf(!available)('stores the parent and the columns that link them, either way round', async () => {
    const definitions = await publicEndpointsRepo(h.meta).listByConnection(h.connectionId);
    const definitionOf = (r: string) => JSON.parse(definitions.find((e) => e.ref === r)!.definition) as Record<string, unknown>;
    expect(definitionOf(ref('proposal_lines'))).toMatchObject({
      auth: { role: 'authenticated' },
      writable: [],
      visible_with: { ref: ref('proposals'), localColumn: 'proposal_id', foreignColumn: 'id' },
    });
    expect(definitionOf(ref('terms_versions'))['visible_with']).toEqual({ ref: ref('proposals'), localColumn: 'id', foreignColumn: 'terms_version_id' });
    expect(definitionOf(ref('terms_clauses'))['visible_with']).toEqual({ ref: ref('terms_versions'), localColumn: 'terms_version_id', foreignColumn: 'id' });
  });

  it.skipIf(!available)('lists only the children of parents the person can see, whatever client a child says', async () => {
    // Line 2 is under a draft though marked Ada's; line 4 is under her sent proposal though marked Ben's.
    expect(ids(await served.get(`/records/${ref('proposal_lines')}`, ada))).toEqual([1, 4]);
    expect(ids(await served.get(`/records/${ref('proposal_lines')}`, ben))).toEqual([3]);
    expect(ids(await served.get(`/records/${ref('deliverable_versions')}`, ada))).toEqual([1, 4]);
    expect(ids(await served.get(`/records/${ref('deliverable_notes')}`, ada))).toEqual([1]);
    expect(ids(await served.get(`/records/${ref('deliverable_notes')}`, ben))).toEqual([2]);
    // Down one way, and two steps.
    expect(ids(await served.get(`/records/${ref('terms_versions')}`, ada))).toEqual([1]);
    expect(ids(await served.get(`/records/${ref('terms_clauses')}`, ada))).toEqual([1]);
    expect(ids(await served.get(`/records/${ref('terms_clauses')}`, ben))).toEqual([3]);
  });

  it.skipIf(!available)('answers one 404, the same as an unknown id, for every child the person cannot see', async () => {
    const unknown = await served.get(`/records/${ref('proposal_lines')}/999`, ada);
    expect(unknown.statusCode).toBe(404);
    const hidden: [string, number][] = [
      [ref('proposal_lines'), 2], // a draft's line, marked hers
      [ref('proposal_lines'), 3], // another client's
      [ref('deliverable_versions'), 2], // an unshared deliverable's
      [ref('deliverable_versions'), 3], // another client's
      [ref('deliverable_notes'), 2], // another client's note
      [ref('deliverable_notes'), 3], // her own note, on an unshared deliverable
      [ref('terms_versions'), 2], // a version only her draft names
      [ref('terms_clauses'), 2], // a clause of that version
      [ref('terms_clauses'), 3], // a clause of Ben's
    ];
    for (const [r, row] of hidden) {
      const res = await served.get(`/records/${r}/${String(row)}`, ada);
      expect(res.statusCode, `${r}/${String(row)}`).toBe(404);
      expect(res.body).toBe(unknown.body);
    }
    // Her own, by id.
    expect((await served.get(`/records/${ref('proposal_lines')}/4`, ada)).statusCode).toBe(200);
    expect((await served.get(`/records/${ref('terms_clauses')}/1`, ada)).statusCode).toBe(200);
  });

  it.skipIf(!available)('reaches nothing without a session, and never through the caller’s own filter', async () => {
    const none = await served.get(`/records/${ref('proposal_lines')}`);
    expect(none.statusCode).toBe(404);
    expect(served.codeOf(none)).toBe('PUBLIC_REF_NOT_FOUND');
    expect((await served.get(`/records/${ref('proposal_lines')}/1`)).statusCode).toBe(404);
  });

  it.skipIf(!available)('makes a note only on rows the person can see, its version under its own deliverable', async () => {
    const make = (values: Record<string, unknown>, session = ada) =>
      served.composed.app.inject({ method: 'POST', url: `/api/v1/public/records/${ref('deliverable_notes')}`, headers: served.headers(session), payload: { values } });
    const refused = async (values: Record<string, unknown>) => {
      const res = await make(values);
      expect(res.statusCode, JSON.stringify(values)).toBe(400);
      expect(served.codeOf(res)).toBe('PUBLIC_WRITE_REFUSED');
    };
    const before = (await h.rows(`select count(*) as n from ${h.real('deliverable_notes')}`))[0]!['n'];
    await refused({ deliverable_id: 3, body: 'on Ben’s' }); // another client's deliverable
    await refused({ deliverable_id: 2, body: 'on unshared' }); // her own, unshared
    await refused({ deliverable_id: 999, body: 'on nothing' }); // no such deliverable
    await refused({ body: 'on no deliverable' }); // no parent at all
    await refused({ deliverable_id: 1, version_id: 4, body: 'version of her other deliverable' }); // a cross-parent version
    await refused({ deliverable_id: 1, version_id: 3, body: 'version of Ben’s' });
    await refused({ deliverable_id: 1, client_id: 1, body: 'supplied client' }); // the desk's copy is never a browser's
    await refused({ deliverable_id: 1, client_id: 2, body: 'supplied other client' });
    // U+0000 is refused, named, before the parent is looked up with it (Postgres answered that lookup 500).
    for (const [column, values] of [
      ['deliverable_id', { deliverable_id: '1\u0000', body: 'x' }],
      ['body', { deliverable_id: 1, body: 'x\u0000' }],
    ] as const) {
      const res = await make(values);
      expect(res.statusCode, res.body).toBe(400);
      expect((res.json() as { error: { params?: unknown } }).error.params).toEqual({ column, reason: 'invalid-character' });
    }
    expect((await h.rows(`select count(*) as n from ${h.real('deliverable_notes')}`))[0]!['n']).toEqual(before);

    const made = await make({ deliverable_id: 1, version_id: 1, body: 'looks good' });
    expect(made.statusCode, made.body).toBe(201);
    const noteId = Number((made.json() as { data: { id: unknown } }).data.id);
    expect(ids(await served.get(`/records/${ref('deliverable_notes')}`, ada))).toContain(noteId);
    // …and Ben never sees it.
    expect((await served.get(`/records/${ref('deliverable_notes')}/${String(noteId)}`, ben)).statusCode).toBe(404);
    // Without a session, nothing is made.
    const anonymous = await served.composed.app.inject({ method: 'POST', url: `/api/v1/public/records/${ref('deliverable_notes')}`, headers: served.headers(), payload: { values: { deliverable_id: 1, body: 'x' } } });
    expect(anonymous.statusCode).toBe(404);
  });

  it.skipIf(!available || dialect === 'sqlite')('holds the parent while the note goes in: a deliverable withdrawn at that moment refuses it', async () => {
    const { db } = await h.manager.data(h.connectionId);
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked!: () => void;
    const holding = new Promise<void>((resolve) => {
      locked = resolve;
    });
    // Another connection withdraws deliverable 4 and has not committed yet.
    const desk = db.transaction().execute(async (trx) => {
      await sql`update ${sql.table(h.real('deliverables'))} set status = 'unshared' where id = 4`.execute(trx);
      locked();
      await released;
    });
    await holding;
    const racing = served.composed.app.inject({
      method: 'POST',
      url: `/api/v1/public/records/${ref('deliverable_notes')}`,
      headers: served.headers(ada),
      payload: { values: { deliverable_id: 4, body: 'at the same moment' } },
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    release();
    await desk;
    const res = await racing;
    expect(res.statusCode, res.body).toBe(400);
    expect(Number((await h.rows(`select count(*) as n from ${h.real('deliverable_notes')} where body = 'at the same moment'`))[0]!['n'])).toBe(0);
    await h.rows(`update ${h.real('deliverables')} set status = 'approved' where id = 4`);
  });

  it.skipIf(!available)('gives an anonymous call and another client’s session nothing, reading or writing', async () => {
    const call = (method: 'GET' | 'POST' | 'PATCH', url: string, session?: string, values?: Record<string, unknown>) =>
      served.composed.app.inject({ method, url: `/api/v1/public${url}`, headers: served.headers(session), ...(values === undefined ? {} : { payload: { values } }) });
    const notes = `/records/${ref('deliverable_notes')}`;
    for (const [method, url, values] of [
      ['GET', notes, undefined],
      ['GET', `${notes}/1`, undefined],
      ['POST', notes, { deliverable_id: 1, body: 'anonymous' }],
      ['PATCH', `${notes}/1`, { body: 'anonymous' }],
      ['GET', `/records/${ref('proposal_lines')}`, undefined],
      ['GET', `/records/${ref('terms_clauses')}/1`, undefined],
    ] as const) {
      expect((await call(method, url, undefined, values)).statusCode, `${method} ${url}`).toBe(404);
    }
    // Ben's session: none of Ada's children, by list, by id, or by a change.
    expect(ids(await call('GET', `/records/${ref('proposal_lines')}`, ben))).toEqual([3]);
    expect((await call('GET', `${notes}/1`, ben)).statusCode).toBe(404);
    expect((await call('PATCH', `${notes}/1`, ben, { body: 'Ben writes on Ada' })).statusCode).toBe(404);
    expect((await h.rows(`select body from ${h.real('deliverable_notes')} where id = 1`))[0]!['body']).toBe('ada note');
  });

  it.skipIf(!available)('changes a child only through its parent, never moving it, never emptying what it needs', async () => {
    const patch = (id: number, values: Record<string, unknown>, session = ada) =>
      served.composed.app.inject({ method: 'PATCH', url: `/api/v1/public/records/${ref('deliverable_notes')}/${String(id)}`, headers: served.headers(session), payload: { values } });
    expect((await patch(1, { body: 'edited' })).statusCode).toBe(200);
    // Her own note, on a deliverable that is not shared: as if it did not exist.
    expect((await patch(3, { body: 'edited' })).statusCode).toBe(404);
    // Moved under another deliverable, even her own: refused.
    expect((await patch(1, { deliverable_id: 4, body: 'moved' })).statusCode).toBe(400);
    // A body the note needs, emptied: refused.
    const emptied = await patch(1, { body: '  ' });
    expect(emptied.statusCode).toBe(400);
    expect((emptied.json() as { error: { params?: unknown } }).error.params).toEqual({ column: 'body' });
    expect((await h.rows(`select body from ${h.real('deliverable_notes')} where id = 1`))[0]!['body']).toBe('edited');
  });

  it.skipIf(!available)('signs a proposal once, while it is sent and in date, and only with a name', async () => {
    const sign = (id: number, values: Record<string, unknown>) =>
      served.composed.app.inject({ method: 'PATCH', url: `/api/v1/public/records/${ref('proposals')}/${String(id)}`, headers: served.headers(ada), payload: { values } });
    expect((await sign(1, {})).statusCode).toBe(400);
    expect((await sign(1, { signed_name: '' })).statusCode).toBe(400);
    // Out of date since yesterday: nothing to change.
    expect((await sign(4, { signed_name: 'Ada Lovelace' })).statusCode).toBe(404);
    expect((await sign(1, { signed_name: 'Ada Lovelace' })).statusCode).toBe(200);
    // Once: it is no longer empty.
    expect((await sign(1, { signed_name: 'Someone Else' })).statusCode).toBe(404);
    expect((await h.rows(`select signed_name from ${h.real('proposals')} where id = 1`))[0]!['signed_name']).toBe('Ada Lovelace');
  });

  it.skipIf(!available)('changes a proposal through a before-today door only once its date is past', async () => {
    const ask = (id: number) =>
      served.composed.app.inject({ method: 'PATCH', url: `/api/v1/public/records/${ref('proposals', 'claimed_2')}/${String(id)}`, headers: served.headers(ada), payload: { values: { signed_name: 'asked again' } } });
    // Sent with no date at all (id 5): neither in date nor out of it.
    await h.rows(`insert into ${h.real('proposals')} (client_id, status) values (1, 'sent')`);
    expect((await ask(1)).statusCode).toBe(404); // still in date
    expect((await ask(5)).statusCode).toBe(404); // no date
    expect((await ask(3)).statusCode).toBe(404); // Ben's, and none of hers
    expect((await ask(4)).statusCode).toBe(200); // out of date since yesterday
    if (dialect === 'sqlite') {
      // A day kept as a number (a tool that stores epochs) sorts below any text on SQLite: never "before today".
      await h.rows(`update ${h.real('proposals')} set valid_until = 4102444800000 where id = 5`);
      expect((await ask(5)).statusCode).toBe(404);
    }
  });

  it.skipIf(!available)('checks every row of a batch the same way, all or none', async () => {
    // An operator's own key over the same endpoints plus a batch door on notes.
    const views = createPublicViews(h.meta);
    const service = createEndpointService({ meta: h.meta, viewFor: views.viewFor, tenantConfigOf: async (cid) => (await connectionTenantConfig(h.meta, cid)) ?? undefined });
    const notesTable = (await views.viewFor(h.connectionId))!.table(h.real('deliverable_notes')).id;
    await service.saveEndpoint({
      connectionId: h.connectionId,
      ref: 'notes_batch',
      origin: 'custom',
      definition: {
        path: '/notes_batch',
        source: notesTable,
        methods: ['GET', 'POST', 'BATCH'],
        select: ['id', 'deliverable_id', 'version_id', 'body'],
        filters: [],
        pagination: { default_limit: 50, max_limit: 200, order: 'id.asc' },
        auth: { role: 'authenticated' },
        rate_limit: { requests: 60, window: '1m' },
        response: { shape: 'object', envelope: 'data' },
        // Hand-made, so nothing stopped the desk's copy of the client being listed.
        writable: ['deliverable_id', 'version_id', 'client_id', 'body'],
        visible_with: { ref: ref('deliverables'), localColumn: 'deliverable_id', foreignColumn: 'id' },
      },
    });
    const secret = generatePublishableKey('browser');
    const { key } = await service.createKey({
      connectionId: h.connectionId,
      name: 'operator batch',
      access: [
        { ref: ref('clients'), methods: ['GET'] },
        { ref: ref('deliverables'), methods: ['GET'] },
        { ref: 'notes_batch', methods: ['GET', 'POST', 'BATCH'] },
      ],
      secret: { prefix: secret.prefix, tokenHash: secret.tokenHash, tokenEncrypted: sealPublishableKey(dsnCryptoFromSecret(TEST_SECRET), secret.token) },
      origins: [],
      kind: 'browser',
    });
    const other = await servePublic(h, key.id);
    try {
      const claim = await other.post('/claim', { match: { email: 'ada@example.com', name: 'Ada' } });
      const session = (claim.json() as { data: { session: string } }).data.session;
      const batch = (rows: Record<string, unknown>[]) =>
        other.composed.app.inject({ method: 'POST', url: '/api/v1/public/records/notes_batch/batch', headers: other.headers(session), payload: { rows } });
      const count = async () => (await h.rows(`select count(*) as n from ${h.real('deliverable_notes')}`))[0]!['n'];
      const before = await count();
      const mixed = await batch([{ deliverable_id: 1, body: 'fine' }, { deliverable_id: 3, body: 'Ben’s' }]);
      expect(mixed.statusCode, mixed.body).toBe(400);
      // A version, on a key that reads no versions at all: nothing to prove it is hers.
      const unread = await batch([{ deliverable_id: 1, version_id: 1, body: 'version unread' }]);
      expect(unread.statusCode, unread.body).toBe(400);
      // Her own client id, sent by the browser: the desk's copy is never a browser's.
      const copied = await batch([{ deliverable_id: 1, client_id: 1, body: 'client sent' }]);
      expect(copied.statusCode, copied.body).toBe(400);
      expect(await count()).toEqual(before);
      const good = await batch([{ deliverable_id: 1, body: 'one' }, { deliverable_id: 4, body: 'two' }]);
      expect(good.statusCode, good.body).toBe(200);
      expect(Number(await count())).toBe(Number(before) + 2);
    } finally {
      await other.close();
    }
  });
});

describe('the scope compiler, for rows visible with a parent', () => {
  const columns = () => new Set(['id', 'client_id', 'proposal_id', 'status', 'label', 'version_id']);
  const base = (child: Record<string, unknown>, extra: Record<string, unknown>[] = []): PublicScopeDocument =>
    ({
      version: 1,
      side: 'customer',
      timezone: 'UTC',
      claim: { strategy: 'lookup', ref: 'clients', match: ['id'] },
      resources: [
        { ref: 'clients', table: 'public.clients', actions: ['read'], expose: ['id'], claim: { column: 'id' } },
        { ref: 'proposals', table: 'public.proposals', actions: ['read'], expose: ['id'], claim: { column: 'client_id', ref: 'clients' } },
        { ref: 'lines', table: 'public.lines', actions: ['read'], expose: ['id'], visibleWith: { ref: 'proposals', localColumn: 'proposal_id', foreignColumn: 'id' }, ...child },
        ...extra,
      ],
    }) as PublicScopeDocument;
  const codes = (document: PublicScopeDocument) => {
    try {
      compileScope(document, columns);
      return [];
    } catch (error) {
      if (!(error instanceof ScopeCompileError)) throw error;
      return error.issues.map((issue) => issue.code);
    }
  };

  it('compiles a child that reads, and one that creates through its link', () => {
    expect(codes(base({}))).toEqual([]);
    expect(codes(base({ actions: ['read', 'create'], writable: ['proposal_id', 'label'] }))).toEqual([]);
  });

  it('refuses a child that replaces or removes a row, counts a person’s rows, or cannot name its parent', () => {
    expect(codes(base({ actions: ['read', 'update'], writable: ['label'] }))).toEqual([]);
    expect(codes(base({ actions: ['read', 'replace'], writable: ['label'] }))).toContain('SCOPE_VISIBLE_WITH_CHANGES');
    expect(codes(base({ actions: ['read', 'delete'] }))).toContain('SCOPE_VISIBLE_WITH_CHANGES');
    // A change whose parent reads the same table: one statement cannot do it on MySQL.
    const selfParent = base({ table: 'public.proposals', actions: ['read', 'update'], writable: ['label'] });
    expect(codes(selfParent)).toContain('SCOPE_VISIBLE_WITH_SELF_CHANGE');
    expect(codes(base({ actions: ['read', 'create'], writable: ['proposal_id', 'label'], requires: ['status'] }))).toContain('SCOPE_REQUIRES_NOT_WRITABLE');
    expect(codes(base({ actions: ['read', 'create'], writable: ['label'], rank: { orderBy: 'id' } }))).toContain('SCOPE_VISIBLE_WITH_OPTION');
    expect(codes(base({ actions: ['read', 'create'], writable: ['label'] }))).toContain('SCOPE_VISIBLE_WITH_CREATE_UNLINKED');
    expect(codes(base({ claim: { column: 'client_id' } }))).toContain('SCOPE_VISIBLE_WITH_AND_CLAIM');
  });

  it('refuses a parent that is missing, unread, unclaimed, or too far from the person', () => {
    expect(codes(base({ visibleWith: { ref: 'nobody', localColumn: 'proposal_id', foreignColumn: 'id' } }))).toContain('SCOPE_VISIBLE_WITH_UNKNOWN_REF');
    expect(codes(base({ visibleWith: { ref: 'proposals', localColumn: 'nope', foreignColumn: 'id' } }))).toContain('SCOPE_VISIBLE_WITH_UNKNOWN_COLUMN');
    const open = base({ visibleWith: { ref: 'menu', localColumn: 'proposal_id', foreignColumn: 'id' } }, [{ ref: 'menu', table: 'public.menu', actions: ['read'], expose: ['id'] }]);
    expect(codes(open)).toContain('SCOPE_VISIBLE_WITH_UNCLAIMED');
    const writeOnly = base({ visibleWith: { ref: 'drop', localColumn: 'proposal_id', foreignColumn: 'id' } }, [
      { ref: 'drop', table: 'public.drop', actions: ['create'], expose: ['id'], writable: ['label'], claim: { column: 'client_id', ref: 'clients' } },
    ]);
    expect(codes(writeOnly)).toContain('SCOPE_VISIBLE_WITH_PARENT_UNREADABLE');
    const deep = base({}, [
      { ref: 'notes', table: 'public.notes', actions: ['read'], expose: ['id'], visibleWith: { ref: 'lines', localColumn: 'version_id', foreignColumn: 'id' } },
      { ref: 'marks', table: 'public.marks', actions: ['read'], expose: ['id'], visibleWith: { ref: 'notes', localColumn: 'version_id', foreignColumn: 'id' } },
    ]);
    expect(codes(deep)).toContain('SCOPE_VISIBLE_WITH_TOO_DEEP');
  });
});

describe('an app’s child entry, planned', () => {
  it('may not let a browser write the desk’s copy of the signed-in person', async () => {
    const { planPublicEndpoints } = await import('../src/apps/manifest-public.js');
    const manifest = portalManifest() as { publicAccess: Record<string, unknown>[] };
    const notes = manifest.publicAccess.find((entry) => entry['table'] === 'deliverable_notes')!;
    notes['writable'] = ['deliverable_id', 'client_id', 'body'];
    const planned = planPublicEndpoints(manifest as never, {}, null).find((entry) => entry.table === 'deliverable_notes')!;
    expect(planned.issues).toEqual([
      '"deliverable_notes.client_id" points at the signed-in person\'s own table, so it is filled from the parent and never written publicly',
    ]);
    notes['writable'] = ['deliverable_id', 'body'];
    expect(planPublicEndpoints(manifest as never, {}, null).find((entry) => entry.table === 'deliverable_notes')!.issues).toEqual([]);
  });

  it('offers files only on a column shown, of rows a claim or a parent opens', () => {
    const doc = (resource: Record<string, unknown>) =>
      ({
        version: 1,
        side: 'customer',
        timezone: 'UTC',
        claim: { strategy: 'lookup', ref: 'clients', match: ['id'] },
        resources: [{ ref: 'clients', table: 'public.clients', actions: ['read'], expose: ['id'], claim: { column: 'id' } }, { ref: 'files', table: 'public.files', actions: ['read'], ...resource }],
      }) as PublicScopeDocument;
    const codes = (document: PublicScopeDocument) => {
      try {
        compileScope(document);
        return [];
      } catch (error) {
        if (!(error instanceof ScopeCompileError)) throw error;
        return error.issues.map((issue) => issue.code);
      }
    };
    expect(codes(doc({ expose: ['id', 'file'], files: ['file'], claim: { column: 'client_id', ref: 'clients' } }))).toEqual([]);
    expect(codes(doc({ expose: ['id'], files: ['file'], claim: { column: 'client_id', ref: 'clients' } }))).toContain('SCOPE_FILES_NOT_EXPOSED');
    expect(codes(doc({ expose: ['id', 'file'], files: ['file'] }))).toContain('SCOPE_FILES_UNCLAIMED');
  });
});

describe('the read handle of a child', () => {
  it('runs only one SELECT on the child’s own table, and refuses anything else', async () => {
    const BetterSqlite3 = (await import('better-sqlite3')).default;
    const { Kysely, SqliteDialect } = await import('kysely');
    const db = new Kysely<never>({ dialect: new SqliteDialect({ database: new BetterSqlite3(':memory:') }) });
    const parentTable = { id: 'main.parents', name: 'parents' } as never;
    const reader = readerFor(
      { db: db as never, dialect: 'sqlite', view: {} as never },
      { id: 'main.children', name: 'children' } as never,
      { reachable: true, steps: [{ link: { ref: 'parents', localColumn: 'parent_id', foreignColumn: 'id' }, parent: {} as never, table: parentTable, predicate: null }] },
    );
    const compiled = reader.selectFrom('main.children' as never).selectAll().compile();
    expect(compiled.sql).toBe('select * from "main"."children" where exists (select 1 as "one" from "main"."parents" as "adm_vw0" where "adm_vw0"."id" = "children"."parent_id")');
    expect(() => reader.selectFrom('main.parents' as never).selectAll().compile()).toThrow(/one SELECT on its own table/);
    expect(() => reader.deleteFrom('main.children' as never).compile()).toThrow(/one SELECT on its own table/);
    await db.destroy();
  });
});
