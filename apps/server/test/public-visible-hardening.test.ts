// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Rows visible with their parent, under the attacks a review found — on
 * every engine this run can reach where the engine matters.
 *
 * - A child the parent points AT is only as closed as the parent's column
 *   that points: a scope, an install or a manifest that lets anyone write that
 *   column is refused, since a person could re-point their own row at another
 *   person's child.
 * - A child's link to its parent is checked against the parent the child
 *   declares — never against any other reader of the parent's table — and
 *   whether or not the database knows the column as a foreign key; a change
 *   never moves it.
 * - A document's statement reads a child's rows only where their parents are
 *   the person's.
 * - A column offered for download is never one a caller writes.
 */
import { validateManifest } from '@adminium/manifest';
import { connectionTenantConfig, publicKeysRepo, type PublicKey } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { planPublicEndpoints } from '../src/apps/manifest-public.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { narrowingOf } from '../src/documents/compose.js';
import { createEndpointService, KeyCreateRefused } from '../src/public-api/endpoint-service.js';
import type { PublicEndpointDefinition } from '../src/public-api/endpoint.js';
import { generatePublishableKey, openPublishableKey, sealPublishableKey } from '../src/public-api/keys.js';
import { createPublicResolver, createPublicViews } from '../src/public-api/runtime.js';
import { compileScope, ScopeCompileError, type PublicScopeDocument } from '../src/public-api/scope.js';
import { createDocumentAccess } from '../src/routes/public/documents.js';
import { installInvoicing, invoicingManifest, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';
import { TEST_SECRET } from './helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, nullable = false) => ({ ref, type: 'text', maxLength: 120, ...(nullable ? { nullable: true } : {}) });
const fk = (ref: string, references: string, nullable = false) => ({ ref, type: 'fk', references, ...(nullable ? { nullable: true } : {}) });

/** A proposal that points at its terms, and a key that lets the client change where it points. */
function downLinkManifest(writableLink: boolean): Record<string, unknown> {
  return {
    ...invoicingManifest([
      { ref: 'clients', columns: [id, { ...text('email'), unique: true }, text('name')] },
      { ref: 'terms_versions', columns: [id, text('title')] },
      { ref: 'terms_clauses', columns: [id, fk('terms_version_id', 'terms_versions'), text('body')] },
      { ref: 'proposals', columns: [id, fk('client_id', 'clients'), fk('terms_version_id', 'terms_versions', true), text('signed_name', true)] },
    ]),
    publicAccess: [
      { table: 'clients', methods: ['GET'], select: ['name'], claim: { match: ['email', 'name'] } },
      {
        table: 'proposals',
        methods: ['GET', 'PATCH'],
        select: ['id', 'terms_version_id', 'signed_name'],
        claimedBy: { table: 'clients', column: 'client_id' },
        writable: writableLink ? ['signed_name', 'terms_version_id'] : ['signed_name'],
      },
      { table: 'terms_versions', methods: ['GET'], select: ['id', 'title'], visibleWith: { table: 'proposals', via: 'terms_version_id' } },
      { table: 'terms_clauses', methods: ['GET'], select: ['id', 'body'], visibleWith: { table: 'terms_versions', via: 'terms_version_id' } },
    ],
  };
}

const compiled = (document: PublicScopeDocument) => {
  try {
    compileScope(document);
    return [];
  } catch (error) {
    if (!(error instanceof ScopeCompileError)) throw error;
    return error.issues.map((issue) => issue.code);
  }
};

describe('a child its parent points at', () => {
  const doc = (proposal: Record<string, unknown>): PublicScopeDocument =>
    ({
      version: 1,
      side: 'customer',
      timezone: 'UTC',
      claim: { strategy: 'lookup', ref: 'clients', match: ['id'] },
      resources: [
        { ref: 'clients', table: 'public.clients', actions: ['read'], expose: ['id'], claim: { column: 'id' } },
        { ref: 'proposals', table: 'public.proposals', actions: ['read'], expose: ['id'], claim: { column: 'client_id', ref: 'clients' }, ...proposal },
        { ref: 'terms', table: 'public.terms', actions: ['read'], expose: ['id'], visibleWith: { ref: 'proposals', localColumn: 'id', foreignColumn: 'terms_version_id' } },
      ],
    }) as unknown as PublicScopeDocument;

  it('is refused by the scope compiler when anything on the key writes the pointing column', () => {
    expect(compiled(doc({}))).toEqual([]);
    expect(compiled(doc({ actions: ['read', 'update'], writable: ['terms_version_id'] }))).toContain('SCOPE_VISIBLE_WITH_PARENT_LINK_WRITABLE');
    expect(compiled(doc({ actions: ['read', 'update'], writable: ['terms_version_id'], writableValues: { terms_version_id: [2] } }))).toContain(
      'SCOPE_VISIBLE_WITH_PARENT_LINK_WRITABLE',
    );
    // A second door on the same table that creates proposals naming any terms.
    const second = doc({});
    second.resources.push({ ref: 'proposals_new', table: 'public.proposals', actions: ['create'], expose: ['id'], writable: ['terms_version_id'] } as never);
    expect(compiled(second)).toContain('SCOPE_VISIBLE_WITH_PARENT_LINK_WRITABLE');
    const defaulted = doc({});
    defaulted.resources.push({ ref: 'proposals_new', table: 'public.proposals', actions: ['create'], expose: ['id'], writable: ['signed_name'], defaults: { terms_version_id: 2 } } as never);
    expect(compiled(defaulted)).toContain('SCOPE_VISIBLE_WITH_PARENT_LINK_WRITABLE');
  });

  it('is refused by the manifest validator and by the install', () => {
    const open = validateManifest(downLinkManifest(true));
    expect(open.ok).toBe(false);
    expect(JSON.stringify(open)).toContain('is the link a child reads its rows by');
    expect(validateManifest(downLinkManifest(false)).ok).toBe(true);
    const planned = planPublicEndpoints(downLinkManifest(true) as never, {}, null).find((entry) => entry.table === 'terms_versions')!;
    expect(planned.issues.join(' ')).toContain('is the link a child reads its rows by');
  });
});

describe('a column offered for download', () => {
  it('is never one a caller writes', () => {
    const document = {
      version: 1,
      side: 'customer',
      timezone: 'UTC',
      claim: { strategy: 'lookup', ref: 'clients', match: ['id'] },
      resources: [
        { ref: 'clients', table: 'public.clients', actions: ['read'], expose: ['id'], claim: { column: 'id' } },
        { ref: 'files', table: 'public.files', actions: ['read', 'update'], expose: ['id', 'file'], files: ['file'], writable: ['file'], claim: { column: 'client_id', ref: 'clients' } },
      ],
    } as PublicScopeDocument;
    expect(compiled(document)).toContain('SCOPE_FILES_WRITABLE');
    const manifest = {
      ...invoicingManifest([
        { ref: 'clients', columns: [id, { ...text('email'), unique: true }, text('name')] },
        { ref: 'versions', columns: [id, fk('client_id', 'clients'), text('file', true)] },
      ]),
      publicAccess: [
        { table: 'clients', methods: ['GET'], select: ['name'], claim: { match: ['email', 'name'] } },
        { table: 'versions', methods: ['GET', 'PATCH'], select: ['id', 'file'], files: ['file'], writable: ['file'], claimedBy: { table: 'clients', column: 'client_id' } },
      ],
    };
    expect(JSON.stringify(validateManifest(manifest))).toContain('is offered for download, so a browser never writes it');
  });
});

function portalManifest(): Record<string, unknown> {
  return {
    ...invoicingManifest([
      { ref: 'clients', columns: [id, { ...text('email'), unique: true }, text('name')] },
      { ref: 'deliverables', columns: [id, fk('client_id', 'clients'), { ref: 'status', type: 'enum', enum: ['unshared', 'pending', 'approved'], default: 'unshared' }] },
      { ref: 'deliverable_notes', columns: [id, fk('deliverable_id', 'deliverables', true), text('body')] },
      // A column naming its deliverable that the database does not know as a foreign key.
      { ref: 'deliverable_marks', columns: [id, { ref: 'deliverable_ref', type: 'int', nullable: true }, text('body')] },
      { ref: 'invoices', columns: [id, fk('client_id', 'clients'), { ref: 'status', type: 'enum', enum: ['draft', 'sent'], default: 'draft' }] },
      { ref: 'payments', columns: [id, fk('invoice_id', 'invoices'), { ref: 'amount', type: 'int' }] },
    ]),
    publicAccess: [
      { table: 'clients', methods: ['GET'], select: ['name'], claim: { match: ['email', 'name'] } },
      { table: 'deliverables', methods: ['GET'], select: ['id', 'status'], claimedBy: { table: 'clients', column: 'client_id' }, filters: [{ column: 'status', op: 'neq', value: 'unshared' }] },
      { table: 'invoices', methods: ['GET'], select: ['id', 'status'], claimedBy: { table: 'clients', column: 'client_id' }, filters: [{ column: 'status', op: 'eq', value: 'sent' }] },
      { table: 'payments', methods: ['GET'], select: ['id', 'amount'], visibleWith: { table: 'invoices', via: 'invoice_id' } },
    ],
  };
}

describe.each(LEGS)('a child held to the parent it declares — %s', (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let served: Served;
  let key: PublicKey;
  let ada: string;
  let ben: string;
  const t = (short: string) => h.real(short);

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, portalManifest());
    await h.rows(`insert into ${t('clients')} (email, name) values ('ada@example.com', 'Ada')`);
    await h.rows(`insert into ${t('clients')} (email, name) values ('ben@example.com', 'Ben')`);
    await h.rows(`insert into ${t('deliverables')} (client_id, status) values (1, 'pending')`);
    await h.rows(`insert into ${t('deliverables')} (client_id, status) values (2, 'approved')`);
    await h.rows(`insert into ${t('invoices')} (client_id, status) values (1, 'sent')`);
    await h.rows(`insert into ${t('invoices')} (client_id, status) values (1, 'draft')`);
    await h.rows(`insert into ${t('invoices')} (client_id, status) values (2, 'sent')`);
    for (const [invoice, amount] of [[1, 10], [2, 20], [3, 30]]) await h.rows(`insert into ${t('payments')} (invoice_id, amount) values (${String(invoice)}, ${String(amount)})`);

    // An operator's own key: a public portfolio of approved work beside the client's own, and two doors for notes.
    const views = createPublicViews(h.meta);
    const view = (await views.viewFor(h.connectionId))!;
    const service = createEndpointService({ meta: h.meta, viewFor: views.viewFor, tenantConfigOf: async (cid) => (await connectionTenantConfig(h.meta, cid)) ?? undefined });
    const base = (ref: string, table: string, select: string[], more: Partial<PublicEndpointDefinition>): PublicEndpointDefinition =>
      ({
        path: `/${ref}`,
        source: view.table(t(table)).id,
        methods: ['GET'],
        select,
        filters: [],
        pagination: { default_limit: 50, max_limit: 200, order: 'id.asc' },
        auth: { role: 'authenticated' },
        rate_limit: { requests: 60, window: '1m' },
        response: { shape: 'object', envelope: 'data' },
        ...more,
      }) as PublicEndpointDefinition;
    const save = (ref: string, definition: PublicEndpointDefinition) => service.saveEndpoint({ connectionId: h.connectionId, ref, origin: 'custom', definition });
    await save('portfolio', base('portfolio', 'deliverables', ['id'], { auth: { role: 'anon' }, filters: [{ column: 'status', op: 'eq', value: 'approved' }] }));
    const parent = { ref: `${t('deliverables')}_claimed`, localColumn: 'deliverable_id', foreignColumn: 'id' };
    await save('notes', base('notes', 'deliverable_notes', ['id', 'deliverable_id', 'body'], { methods: ['GET', 'POST'], writable: ['deliverable_id', 'body'], visible_with: parent }));
    await save('marks', base('marks', 'deliverable_marks', ['id', 'deliverable_ref', 'body'], { methods: ['GET', 'POST', 'PATCH'], writable: ['deliverable_ref', 'body'], visible_with: { ...parent, localColumn: 'deliverable_ref' } }));
    const secret = generatePublishableKey('browser');
    ({ key } = await service.createKey({
      connectionId: h.connectionId,
      name: 'operator',
      access: [
        { ref: `${t('clients')}_claimed`, methods: ['GET'] },
        { ref: `${t('deliverables')}_claimed`, methods: ['GET'] },
        { ref: 'portfolio', methods: ['GET'] },
        { ref: 'notes', methods: ['GET', 'POST'] },
        { ref: 'marks', methods: ['GET', 'POST', 'PATCH'] },
      ],
      secret: { prefix: secret.prefix, tokenHash: secret.tokenHash, tokenEncrypted: sealPublishableKey(dsnCryptoFromSecret(TEST_SECRET), secret.token) },
      origins: [],
      kind: 'browser',
    }));
    served = await servePublic(h, key.id);
    const claim = async (email: string, name: string) => ((await served.post('/claim', { match: { email, name } })).json() as { data: { session: string } }).data.session;
    ada = await claim('ada@example.com', 'Ada');
    ben = await claim('ben@example.com', 'Ben');
  }, 120_000);

  afterAll(async () => {
    if (!available) return;
    await served.close();
    await h.close();
  });

  const write = (method: 'POST' | 'PATCH', url: string, session: string, values: Record<string, unknown>) =>
    served.composed.app.inject({ method, url: `/api/v1/public/records/${url}`, headers: served.headers(session), payload: { values } });

  it.skipIf(!available)('refuses a note under another person’s deliverable, however public it is', async () => {
    expect((await write('POST', 'notes', ada, { deliverable_id: 2, body: 'on Ben’s' })).statusCode).toBe(400);
    expect((await served.get('/records/notes', ben)).body).not.toContain('on Ben');
    expect((await write('POST', 'notes', ada, { deliverable_id: 1, body: 'mine' })).statusCode).toBe(201);
  });

  it.skipIf(!available)('checks a link the database does not know as one, on a create and on a change', async () => {
    expect((await write('POST', 'marks', ada, { deliverable_ref: 2, body: 'on Ben’s' })).statusCode).toBe(400);
    const mine = await write('POST', 'marks', ada, { deliverable_ref: 1, body: 'mine' });
    expect(mine.statusCode, mine.body).toBe(201);
    const markId = String((mine.json() as { data: { id: unknown } }).data.id);
    expect((await write('PATCH', `marks/${markId}`, ada, { deliverable_ref: 2 })).statusCode).toBe(400);
    expect((await write('PATCH', `marks/${markId}`, ada, { body: 'edited' })).statusCode).toBe(200);
    expect(Number((await h.rows(`select deliverable_ref from ${t('deliverable_marks')} where id = ${markId}`))[0]!['deliverable_ref'])).toBe(1);
  });

  it.skipIf(!available)('reads a statement’s payments only under the person’s own sent invoices', async () => {
    const token = openPublishableKey(dsnCryptoFromSecret(TEST_SECRET), (await publicKeysRepo(h.meta).findById((h.reply['publicAccess'] as { keyId: string }).keyId))!.tokenEncrypted!);
    const views = createPublicViews(h.meta);
    const resolved = (await createPublicResolver(h.meta, views).resolve(token))!;
    const view = (await views.viewFor(h.connectionId))!;
    const invoices = view.table(t('invoices')).id;
    const payments = view.table(t('payments')).id;
    const access = createDocumentAccess({ meta: h.meta, manager: h.manager, viewFor: views.viewFor });
    const session = { id: 'pss_x', keyId: resolved.keyId, grant: { ref: `${t('clients')}_claimed`, column: 'id', value: 1 }, level: 'lookup' as const };
    const profile = { table: invoices, mapping: {}, options: { statement: { documents: { table: invoices }, payments: { table: payments } } } };
    const got = await access.sourceAccess({ key: resolved, session }, profile as never);
    expect(got.state).toBe('ok');
    const { db, dialect: engine } = await h.manager.data(h.connectionId);
    const narrow = narrowingOf(db, view, engine, (got as unknown as { filters: Map<string, never> }).filters)(payments);
    let query = db.selectFrom(payments as never).select('amount' as never);
    if (narrow !== null) query = narrow(query) as typeof query;
    const amounts = ((await query.execute()) as { amount: unknown }[]).map((row) => Number(row.amount)).sort();
    // Her sent invoice's payment only: not her draft's, not Ben's.
    expect(amounts).toEqual([10]);
  });
});

describe.each(LEGS)('a key that lets a person re-point their own row — %s', (dialect, available) => {
  it.skipIf(!available)('cannot be made', async () => {
    const h = await installInvoicing(dialect, downLinkManifest(false));
    try {
      const views = createPublicViews(h.meta);
      const view = (await views.viewFor(h.connectionId))!;
      const service = createEndpointService({ meta: h.meta, viewFor: views.viewFor, tenantConfigOf: async (cid) => (await connectionTenantConfig(h.meta, cid)) ?? undefined });
      await service.saveEndpoint({
        connectionId: h.connectionId,
        ref: 'repoint',
        origin: 'custom',
        definition: {
          path: '/repoint',
          source: view.table(h.real('proposals')).id,
          methods: ['GET', 'PATCH'],
          select: ['id', 'terms_version_id'],
          filters: [],
          pagination: { default_limit: 50, max_limit: 200, order: 'id.asc' },
          auth: { role: 'authenticated' },
          rate_limit: { requests: 60, window: '1m' },
          response: { shape: 'object', envelope: 'data' },
          writable: ['terms_version_id'],
          claim: { column: 'client_id', ref: `${h.real('clients')}_claimed` },
        },
      });
      const secret = generatePublishableKey('browser');
      await expect(
        service.createKey({
          connectionId: h.connectionId,
          name: 'repointing',
          access: [
            { ref: `${h.real('clients')}_claimed`, methods: ['GET'] },
            { ref: `${h.real('proposals')}_claimed`, methods: ['GET'] },
            { ref: 'repoint', methods: ['GET', 'PATCH'] },
            { ref: `${h.real('terms_versions')}_claimed`, methods: ['GET'] },
          ],
          secret: { prefix: secret.prefix, tokenHash: secret.tokenHash, tokenEncrypted: sealPublishableKey(dsnCryptoFromSecret(TEST_SECRET), secret.token) },
          origins: [],
          kind: 'browser',
        }),
      ).rejects.toBeInstanceOf(KeyCreateRefused);
    } finally {
      await h.close();
    }
  }, 120_000);
});

describe.each(LEGS)('a public write in a session, stamped from the signed-in person — %s', (dialect, available) => {
  it.skipIf(!available)('writes the name the person is on file with, never one the browser sends', async () => {
    const h = await installInvoicing(dialect, {
      ...invoicingManifest([
        { ref: 'clients', columns: [id, { ...text('email'), unique: true }, text('name')] },
        { ref: 'notes', columns: [id, fk('client_id', 'clients'), text('body'), { ...text('author', true), rules: { stamp: { set: { claim: 'name' }, on: 'create' } } }] },
      ]),
      publicAccess: [
        { table: 'clients', methods: ['GET'], select: ['name'], claim: { match: ['email', 'name'] } },
        { table: 'notes', methods: ['POST'], select: ['id', 'body', 'author'], writable: ['body'], claimedBy: { table: 'clients', column: 'client_id' } },
      ],
    });
    const served = await servePublic(h, (h.reply['publicAccess'] as { keyId: string }).keyId);
    try {
      await h.rows(`insert into ${h.real('clients')} (email, name) values ('ada@example.com', 'Ada Lovelace')`);
      const session = ((await served.post('/claim', { match: { email: 'ada@example.com', name: 'Ada Lovelace' } })).json() as { data: { session: string } }).data.session;
      const made = await served.composed.app.inject({ method: 'POST', url: `/api/v1/public/records/${h.real('notes')}_claimed`, headers: served.headers(session), payload: { values: { body: 'hello' } } });
      expect(made.statusCode, made.body).toBe(201);
      expect((made.json() as { data: { author: unknown } }).data.author).toBe('Ada Lovelace');
    } finally {
      await served.close();
      await h.close();
    }
  }, 120_000);
});
