// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Documents an app ships for its own tables, and its staff screen asking for
 * one, on every engine.
 *
 * Two apps on one database, neither built on a shape: a till (`pos`, its
 * `sales` printed as an 80 mm receipt, filed under its "receipts" feature)
 * and a practice (`clinic`, a payment printed as a receipt for the insurer).
 * Both are installed through the real installer; their profiles are made the
 * way the install makes them (`installAppDocuments`), and the staff route is
 * the one the dashboard's record page shares its rule with: signed in, and
 * able to read every table the document reads.
 */
import {
  appTablesRepo,
  documentProfilesRepo,
  manifestsRepo,
  permissionsRepo,
  rolesRepo,
  usersRepo,
  type DocumentProfile,
} from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { installAppDocuments, uninstallAppDocuments } from '../src/documents/app-documents.js';
import { availabilityOf } from '../src/documents/app-profiles.js';
import { loadSnapshotView } from '../src/data-io/snapshot-view.js';
import { sha512Integrity } from '../src/add-ons/store.js';
import { documentRoutes } from '../src/routes/documents/index.js';
import { packageTarball } from './app-bundle-helpers.js';
import { installStudio, invoiceShape, memoryStorage, standInProvider, type StudioHarness } from './app-documents.helpers.js';
import { installInvoicing, invoicingManifest, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };
const reason = { 'en-US': 'Prints documents.' };

/** A till: sales and their lines, a receipt filed under its "receipts" feature. */
function posManifest(documents?: Record<string, unknown>[]): Record<string, unknown> {
  return {
    ...invoicingManifest([
      {
        ref: 'sales',
        columns: [
          id,
          { ref: 'number', type: 'text', maxLength: 24, nullable: true },
          { ref: 'total', type: 'decimal', scale: 2, nullable: true },
          { ref: 'currency', type: 'text', maxLength: 3, nullable: true },
        ],
      },
      {
        ref: 'sale_lines',
        columns: [
          id,
          { ref: 'sale_id', type: 'fk', references: 'sales' },
          { ref: 'position', type: 'int', default: 0 },
          { ref: 'name', type: 'text', maxLength: 120, nullable: true },
          { ref: 'amount', type: 'decimal', scale: 2, nullable: true },
        ],
      },
    ]),
    key: 'pos',
    name: 'Till',
    pages: [{ ref: 'pos-sales', template: 'page-crud', title: { key: 't', fallback: 'Sales' }, nav: { group: 'library', icon: 'list', order: 1 }, bindings: { rows: 'sales' } }],
    addOns: {
      suggests: [{ key: 'invoices', range: '>=1.0.0', reason }],
      features: [{ id: 'receipts', label: { 'en-US': 'Receipts' }, requires: ['invoices'] }],
    },
    documents: documents ?? [
      {
        kind: 'receipt',
        addOn: 'invoices',
        table: 'sales',
        name: 'Till receipt',
        feature: 'receipts',
        mapping: {
          number: { column: 'number' },
          amount: { column: 'total' },
          lines: { collection: { table: 'sale_lines', via: 'sale_id', orderBy: 'position', columns: { description: 'name', amount: 'amount' } } },
        },
      },
    ],
  };
}

/** A practice: payments, printed as a receipt for the insurer. */
function clinicManifest(): Record<string, unknown> {
  return {
    ...invoicingManifest([
      {
        ref: 'payments',
        columns: [
          id,
          { ref: 'patient', type: 'text', maxLength: 120, nullable: true },
          { ref: 'insurer', type: 'text', maxLength: 120, nullable: true },
          { ref: 'amount', type: 'decimal', scale: 2, nullable: true },
        ],
      },
    ]),
    key: 'clinic',
    name: 'Clinic',
    pages: [{ ref: 'clinic-payments', template: 'page-crud', title: { key: 't', fallback: 'Payments' }, nav: { group: 'library', icon: 'list', order: 1 }, bindings: { rows: 'payments' } }],
    addOns: { suggests: [{ key: 'invoices', range: '>=1.0.0', reason }] },
    documents: [
      {
        kind: 'insurer-receipt',
        addOn: 'invoices',
        table: 'payments',
        name: 'Receipt for the insurer',
        mapping: { insurer: { column: 'insurer' }, patient: { column: 'patient' }, amount: { column: 'amount' } },
      },
    ],
  };
}

/** A second app on the harness's database, through the same installer. */
async function installAlso(h: InvoicingHarness, manifest: Record<string, unknown>): Promise<void> {
  const tarball = packageTarball({ 'manifest.json': JSON.stringify(manifest), 'staff/index.html': '<!doctype html><html><body></body></html>' });
  const staged = await h.app.inject({
    method: 'POST',
    url: `/apps/upload?expectedSha512=${encodeURIComponent(sha512Integrity(tarball))}`,
    headers: { 'content-type': 'application/octet-stream' },
    payload: Buffer.from(tarball),
  });
  expect(staged.statusCode, staged.body).toBe(200);
  const body = { key: manifest['key'], version: manifest['version'], connectionId: h.connectionId };
  expect((await h.app.inject({ method: 'POST', url: '/apps/plan', payload: body })).statusCode).toBe(200);
  const installed = await h.app.inject({ method: 'POST', url: '/apps/install', payload: body });
  expect(installed.statusCode, installed.body).toBe(200);
}

/** The route as the composition root registers it, signed in as whoever `x-user` names. */
async function staffServer(meta: InvoicingHarness['meta'], pipeline: NonNullable<Parameters<typeof documentRoutes>[0]['pipeline']>) {
  const Fastify = (await import('fastify')).default;
  const zod = await import('fastify-type-provider-zod');
  const app = Fastify();
  app.setValidatorCompiler(zod.validatorCompiler);
  app.setSerializerCompiler(zod.serializerCompiler);
  app.decorate('rbac', { require: () => async () => {} } as never);
  app.decorate('requireAuth', async () => {});
  app.addHook('onRequest', async (request) => {
    const user = request.headers['x-user'];
    (request as { user?: unknown }).user = typeof user === 'string' ? { id: user } : null;
    (request as { can?: unknown }).can = () => Promise.resolve(false);
  });
  await app.register(
    documentRoutes({ meta, storage: pipeline.storage, runtime: pipeline.runtime, enqueue: () => Promise.resolve({ id: 'job_1' }), pipeline }),
    { prefix: '/api/v1' },
  );
  await app.ready();
  return app;
}

/** A person holding read on exactly these tables. */
async function reader(meta: InvoicingHarness['meta'], name: string, connectionId: string, tables: readonly string[]): Promise<string> {
  const user = await usersRepo(meta).create({ email: `${name}@test`, name });
  const role = await rolesRepo(meta).create({ slug: `${name}-role`, name });
  await rolesRepo(meta).assignToUser(user.id, role.id);
  for (const table of tables) await permissionsRepo(meta).grant(role.id, 'table', `${connectionId}/${table}`, { read: true, create: false, update: false, delete: false, export: false, import: false, read_pii: false } as never);
  return user.id;
}

describe.each(LEGS)('an app\'s own documents on %s', (dialect, reachable) => {
  let h: InvoicingHarness;
  let app: Awaited<ReturnType<typeof staffServer>>;
  let drawn: ReturnType<typeof standInProvider>['drawn'];
  let runtime: ReturnType<typeof standInProvider>['runtime'];
  let pos: DocumentProfile[];
  let clinic: DocumentProfile[];
  const users: Record<string, string> = {};
  const realId = async (appKey: string, ref: string) => {
    const names = await appTablesRepo(h.meta).realNames(h.connectionId, appKey);
    return (await loadSnapshotView(h.meta, h.connectionId)).model.tables.find((t) => t.name === names[ref])!.id;
  };
  const make = async (manifest: Record<string, unknown>) =>
    await installAppDocuments({
      meta: h.meta,
      manifest: manifest as never,
      connectionId: h.connectionId,
      view: await loadSnapshotView(h.meta, h.connectionId),
      names: await appTablesRepo(h.meta).realNames(h.connectionId, String(manifest['key'])),
      runtime: () => runtime,
    });
  const ask = (appKey: string, body: Record<string, unknown>, user = users['cashier']) =>
    app.inject({ method: 'POST', url: `/api/v1/apps/${appKey}/documents/render`, headers: user === undefined ? {} : { 'x-user': user }, payload: body });
  const attachment = async (host: string, enabled: boolean) => {
    const addOn = (await manifestsRepo(h.meta, { encrypt: (v) => v, decrypt: (v) => v }).findByKey('invoices'))!;
    await manifestsRepo(h.meta, { encrypt: (v) => v, decrypt: (v) => v }).setAttachmentEnabled(addOn.row.id, host, enabled);
  };

  beforeAll(async () => {
    if (!reachable) return;
    h = await installInvoicing(dialect, posManifest());
    await installAlso(h, clinicManifest());
    await manifestsRepo(h.meta, { encrypt: (v) => v, decrypt: (v) => v }).install({
      manifestKey: 'invoices',
      version: '1.0.0',
      kind: 'add-on',
      source: 'file',
      document: { kind: 'add-on', key: 'invoices', version: '1.0.0', addOn: { shapes: [invoiceShape()] } },
      attachTo: ['pos', 'clinic'],
    });
    ({ drawn, runtime } = standInProvider());
    const storage = memoryStorage();
    const { createDocumentPipeline } = await import('../src/documents/compose.js');
    const pipeline = createDocumentPipeline({ meta: h.meta, manager: h.manager, storage, runtime: () => runtime });
    app = await staffServer(h.meta, pipeline);

    await h.rows(`insert into ${h.real('sales')} (id, number, total, currency) values (1, 'S-0001', '12.50', 'EUR'), (2, 'S-0002', '3.00', 'EUR')`);
    await h.rows(
      `insert into pos_sale_lines (id, sale_id, position, name, amount) values (1, 1, 2, 'Scone', '2.50'), (2, 1, 1, 'Flat white', '10.00')`,
    );
    await h.rows(`insert into clinic_payments (id, patient, insurer, amount) values (1, 'Cormac', 'Laya', '60.00')`);

    pos = (await make(posManifest())).made.length === 1 ? await documentProfilesRepo(h.meta).listOwnedBy(h.connectionId, 'pos') : [];
    clinic = (await make(clinicManifest())).made.length === 1 ? await documentProfilesRepo(h.meta).listOwnedBy(h.connectionId, 'clinic') : [];
    users['cashier'] = await reader(h.meta, 'cashier', h.connectionId, [await realId('pos', 'sales'), await realId('pos', 'sale_lines')]);
    users['nurse'] = await reader(h.meta, 'nurse', h.connectionId, [await realId('clinic', 'payments')]);
    users['nobody'] = await reader(h.meta, 'nobody', h.connectionId, []);
  }, 180_000);

  afterAll(async () => {
    if (!reachable) return;
    await app.close();
    await h.close();
  });

  it.skipIf(!reachable)('makes each app\'s profile at install with its real tables, owned by the app', async () => {
    expect(pos.map((p) => [p.kind, p.table, p.ownerApp, p.name])).toEqual([['receipt', await realId('pos', 'sales'), 'pos', 'Till receipt']]);
    expect(pos[0]!.mapping).toMatchObject({ lines: { collection: { table: await realId('pos', 'sale_lines'), fkColumn: 'sale_id', orderBy: 'position' } } });
    expect(clinic.map((p) => [p.kind, p.table, p.ownerApp])).toEqual([['insurer-receipt', await realId('clinic', 'payments'), 'clinic']]);
  });

  it.skipIf(!reachable)('draws a till receipt for the staff screen, on the 80 mm roll, and hands back where it is', async () => {
    const first = await ask('pos', { kind: 'receipt', ref: 'sales', pk: { id: 1 } });
    expect(first.statusCode, first.body).toBe(201);
    const body = first.json() as { id: string; contentUrl: string; printUrl: string; reused: boolean; document: { number: string; kind: string } };
    expect(body.contentUrl).toBe(`/api/v1/documents/${body.id}/content`);
    expect(body.reused).toBe(false);
    // Not built on a shape and numbered by nothing of its own: the register numbers it.
    expect(body.document).toMatchObject({ kind: 'receipt', number: '1' });
    const subject = drawn.at(-1)!.subject as { number: string; fields: { number: string }; collections: { lines: { description: string }[] } };
    expect([subject.number, subject.fields.number]).toEqual(['1', 'S-0001']);
    expect(subject.collections.lines.map((l) => l.description)).toEqual(['Flat white', 'Scone']);

    // The bytes, for the same person, through the register's own door.
    const content = await app.inject({ method: 'GET', url: body.contentUrl, headers: { 'x-user': users['cashier']! } });
    expect(content.statusCode).toBe(200);

    // Unchanged: the same document back.
    const again = await ask('pos', { kind: 'receipt', ref: 'sales', pk: { id: 1 } });
    expect(again.statusCode).toBe(200);
    expect((again.json() as { id: string; reused: boolean })).toMatchObject({ id: body.id, reused: true });
  });

  it.skipIf(!reachable)('opens an HTML-only receipt in the tab to print, sandboxed, and still downloads it from the content route', async () => {
    const drawn = await ask('pos', { kind: 'receipt', ref: 'sales', pk: { id: 1 } });
    const { printUrl, contentUrl } = drawn.json() as { printUrl: string; contentUrl: string };
    const headers = { 'x-user': users['cashier']! };

    const printed = await app.inject({ method: 'GET', url: printUrl, headers });
    expect(printed.statusCode).toBe(200);
    expect(printed.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(printed.headers['content-disposition']).toBe("inline; filename=\"receipt.html\"; filename*=UTF-8''receipt.html");
    expect(printed.headers['x-content-type-options']).toBe('nosniff');
    // Drawn with its own styles and inline images; no script, no fetch, no form, no origin of ours.
    const policy = String(printed.headers['content-security-policy']).split(';').map((d) => d.trim());
    expect(policy).toEqual(expect.arrayContaining(['sandbox', "default-src 'none'", "style-src 'unsafe-inline'", 'img-src data:', 'font-src data:']));
    expect(policy.find((d) => d.startsWith('sandbox'))).toBe('sandbox');
    expect(policy.join(';')).not.toMatch(/script-src|connect-src|allow-/);
    expect(printed.body).toContain('S-0001');

    // The content route is the download it always was.
    const content = await app.inject({ method: 'GET', url: contentUrl, headers });
    expect(content.statusCode).toBe(200);
    expect(content.headers['content-disposition']).toBe("attachment; filename=\"receipt.html\"; filename*=UTF-8''receipt.html");
    expect(content.headers['x-content-type-options']).toBe('nosniff');
    expect(content.headers['content-security-policy']).toBeUndefined();
  });

  it.skipIf(!reachable)('draws the practice\'s insurer receipt for its own staff', async () => {
    const res = await ask('clinic', { kind: 'insurer-receipt', ref: 'payments', pk: { id: 1 } }, users['nurse']);
    expect(res.statusCode, res.body).toBe(201);
    expect(drawn.at(-1)!.subject).toMatchObject({ fields: { insurer: 'Laya', patient: 'Cormac', amount: 6000 } });
  });

  it.skipIf(!reachable)('answers the one 404 for another app\'s row, an undeclared kind, a missing row and a table the person cannot read', async () => {
    const cases: [string, Record<string, unknown>, string | undefined][] = [
      ['pos', { kind: 'insurer-receipt', ref: 'payments', pk: { id: 1 } }, users['cashier']],
      ['clinic', { kind: 'receipt', ref: 'sales', pk: { id: 1 } }, users['nurse']],
      ['clinic', { kind: 'insurer-receipt', ref: 'payments', pk: { id: 1 } }, users['cashier']],
      ['pos', { kind: 'invoice', ref: 'sales', pk: { id: 1 } }, users['cashier']],
      ['pos', { kind: 'receipt', ref: 'sale_lines', pk: { id: 1 } }, users['cashier']],
      ['pos', { kind: 'receipt', ref: 'sales', pk: { id: 999 } }, users['cashier']],
      ['pos', { kind: 'receipt', ref: 'sales', pk: { id: 'abc' } }, users['cashier']],
      ['pos', { kind: 'receipt', ref: 'sales', pk: { id: '99999999999999999999' } }, users['cashier']],
      ['pos', { kind: 'receipt', ref: 'sales', pk: { id: 1 } }, users['nobody']],
      ['nowhere', { kind: 'receipt', ref: 'sales', pk: { id: 1 } }, users['cashier']],
    ];
    const bodies = new Set<string>();
    for (const [appKey, body, user] of cases) {
      const res = await ask(appKey, body, user);
      expect(res.statusCode, `${appKey} ${JSON.stringify(body)}`).toBe(404);
      bodies.add((res.json() as { code?: string; error?: { code?: string } }).error?.code ?? res.body);
    }
    expect(bodies.size).toBe(1);
  });

  it.skipIf(!reachable)('refuses as the feature being off while the add-on is detached from the app', async () => {
    await attachment('pos', false);
    try {
      const res = await ask('pos', { kind: 'receipt', ref: 'sales', pk: { id: 2 } });
      expect(res.statusCode).toBe(409);
      expect(res.body).toContain('FEATURE_OFF');
      // The other app, still attached, draws as before.
      expect((await ask('clinic', { kind: 'insurer-receipt', ref: 'payments', pk: { id: 1 } }, users['nurse'])).statusCode).toBe(200);
    } finally {
      await attachment('pos', true);
    }
    expect((await ask('pos', { kind: 'receipt', ref: 'sales', pk: { id: 2 } })).statusCode).toBe(201);
  });

  it.skipIf(!reachable)('checks at install that the attached add-on draws each kind, and skips what is off', async () => {
    const before = await documentProfilesRepo(h.meta).list({ connectionId: h.connectionId });
    // A kind the add-on does not draw: refused, and nothing written.
    const unknown = posManifest([{ kind: 'gift-card', addOn: 'invoices', table: 'sales', name: 'Gift card', mapping: { amount: { column: 'total' } } }]);
    await expect(make(unknown)).rejects.toMatchObject({ statusCode: 422, code: 'DOCUMENT_KIND_UNKNOWN' });
    expect(await documentProfilesRepo(h.meta).list({ connectionId: h.connectionId })).toEqual(before);

    // Detached: nothing made, nothing refused, the install goes on — and the profile already made is kept.
    await attachment('clinic', false);
    try {
      const off = await make(clinicManifest());
      expect(off.made).toEqual([]);
      expect(off.removed).toEqual([]);
      expect(off.skipped.map((s) => s.reason)).toEqual(['the "invoices" add-on is not attached to the app, so this document is off']);
      await uninstallAppDocuments(h.meta, h.connectionId, 'clinic');
      expect((await make(clinicManifest())).made).toEqual([]);
    } finally {
      await attachment('clinic', true);
    }
    expect((await make(clinicManifest())).made.map((m) => m.kind)).toEqual(['insurer-receipt']);
  });

  it.skipIf(!reachable)('removes an app\'s profiles at uninstall, and only its own', async () => {
    const removed = await uninstallAppDocuments(h.meta, h.connectionId, 'pos');
    expect(removed).toBe(1);
    const left = await documentProfilesRepo(h.meta).list({ connectionId: h.connectionId });
    expect(left.map((p) => p.ownerApp)).toEqual(['clinic']);
    expect((await ask('pos', { kind: 'receipt', ref: 'sales', pk: { id: 1 } })).statusCode).toBe(409);
  });
});

describe.each(LEGS)('a statement asked for by the staff screen, on %s', (dialect, reachable) => {
  let h: StudioHarness;
  let app: Awaited<ReturnType<typeof staffServer>>;
  let owner: string;

  beforeAll(async () => {
    if (!reachable) return;
    h = await installStudio(dialect);
    const t = (ref: string) => h.real(ref);
    const no = dialect === 'postgres' ? 'false' : '0';
    await h.sql(`insert into ${t('clients')} (id, email, name, company) values (3, 'cara@x.test', 'Cara', 'Cara Makes')`);
    await h.sql(
      `insert into ${t('invoices')} (id, client_id, number, status, issued_on, total, currency) values ` +
        "(201, 3, 'INV-3201', 'sent', '2025-03-10', '100', 'EUR'), (203, 3, 'INV-3203', 'sent', '2026-02-01', '200', 'EUR')",
    );
    await h.sql(`insert into ${t('payments')} (id, invoice_id, client_id, amount, voided, paid_on) values (1, 201, 3, '60', ${no}, '2025-04-01')`);
    app = await staffServer(h.meta, h.pipeline);
    const view = await loadSnapshotView(h.meta, h.connectionId);
    const ids = ['clients', 'invoices', 'payments'].map((ref) => view.model.tables.find((x) => x.name === h.real(ref))!.id);
    owner = await reader(h.meta, 'desk', h.connectionId, ids);
  }, 180_000);

  afterAll(async () => {
    if (!reachable) return;
    await app.close();
    await h.close();
  });

  it.skipIf(!reachable)('reads the period it is asked for, and refuses one that is not a period', async () => {
    const statement = async (period?: string) => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/apps/studio/documents/render',
        headers: { 'x-user': owner },
        payload: { kind: 'statement', ref: 'clients', pk: { id: 3 }, ...(period === undefined ? {} : { period }) },
      });
      expect([200, 201], res.body).toContain(res.statusCode);
      return (res.json() as { document: { subject: { fields: Record<string, unknown> } } }).document.subject;
    };
    expect((await statement('year')).fields).toMatchObject({ periodFrom: '2026-01-01', openingBalance: 4000, closingBalance: 24000 });
    expect((await statement('all')).fields).toMatchObject({ openingBalance: 0, closingBalance: 24000 });
    expect((await statement()).fields['period']).toBe('all');
    const free = await app.inject({ method: 'POST', url: '/api/v1/apps/studio/documents/render', headers: { 'x-user': owner }, payload: { kind: 'statement', ref: 'clients', pk: { id: 3 }, period: '2020-01-01' } });
    expect(free.statusCode).toBe(400);
    // A statement reads the invoices and payments too: a person who may read only the client row gets the 404.
    const view = await loadSnapshotView(h.meta, h.connectionId);
    const clientsOnly = await reader(h.meta, 'front', h.connectionId, [view.model.tables.find((x) => x.name === h.real('clients'))!.id]);
    const refused = await app.inject({ method: 'POST', url: '/api/v1/apps/studio/documents/render', headers: { 'x-user': clientsOnly }, payload: { kind: 'statement', ref: 'clients', pk: { id: 3 }, period: 'year' } });
    expect(refused.statusCode).toBe(404);
  });
});

describe('whether a document of an app is on', () => {
  const manifest = {
    key: 'pos',
    addOns: { features: [{ id: 'receipts', label: { 'en-US': 'Receipts' }, requires: ['invoices', 'printers'] }] },
  } as never;
  const kinds = () => new Set(['receipt']);

  it('needs its own add-on and every add-on of its feature attached, and a kind the add-on draws', () => {
    const plan = { addOn: 'invoices', kind: 'receipt', feature: 'receipts' };
    expect(availabilityOf(plan, manifest, { attached: new Set(['invoices', 'printers']), kindsOf: kinds })).toEqual({ state: 'on' });
    expect(availabilityOf(plan, manifest, { attached: new Set(['invoices']), kindsOf: kinds })).toEqual({
      state: 'off',
      reason: 'the "printers" add-on is not attached to the app, so its feature "receipts" is off',
    });
    expect(availabilityOf({ ...plan, feature: undefined }, manifest, { attached: new Set(['invoices']), kindsOf: kinds }).state).toBe('on');
    expect(availabilityOf({ ...plan, kind: 'gift-card' }, manifest, { attached: new Set(['invoices', 'printers']), kindsOf: kinds }).state).toBe('unknown');
    expect(availabilityOf(plan, manifest, { attached: new Set(['invoices', 'printers']), kindsOf: () => null }).state).toBe('off');
  });
});
