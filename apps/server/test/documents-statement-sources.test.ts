// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A statement is built from its SOURCE tables as much as from its row: a
 * client's statement lists that client's invoices and payments. So every
 * staff door that draws or shows one asks for read on those tables too — the
 * register (listed and opened redacted, its bytes refused), the generic
 * render, and an app's own screen — on every engine. A role that reads the
 * client row but not the payments gets no payments out of any of them.
 */
import { documentProfilesRepo, permissionsRepo, rolesRepo, usersRepo, type DocumentProfile } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadSnapshotView } from '../src/data-io/snapshot-view.js';
import { renderDocument } from '../src/documents/render.js';
import { documentRoutes } from '../src/routes/documents/index.js';
import { installStudio, type StudioHarness } from './app-documents.helpers.js';
import { LEGS } from './invoicing-install.helpers.js';

/** The staff routes, signed in as whoever `x-user` names, with no ambient admin. */
async function staffServer(h: StudioHarness) {
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
    documentRoutes({ meta: h.meta, storage: h.pipeline.storage, runtime: h.pipeline.runtime, enqueue: () => Promise.resolve({ id: 'job_1' }), pipeline: h.pipeline }),
    { prefix: '/api/v1' },
  );
  await app.ready();
  return app;
}

/** A person holding read on exactly these tables. */
async function reader(h: StudioHarness, name: string, tables: readonly string[]): Promise<string> {
  const user = await usersRepo(h.meta).create({ email: `${name}@test`, name });
  const role = await rolesRepo(h.meta).create({ slug: `${name}-role`, name });
  await rolesRepo(h.meta).assignToUser(user.id, role.id);
  for (const table of tables) {
    await permissionsRepo(h.meta).grant(role.id, 'table', `${h.connectionId}/${table}`, { read: true, create: false, update: false, delete: false, export: false, import: false, read_pii: false } as never);
  }
  return user.id;
}

describe.each(LEGS)('a statement shown or drawn through the staff doors, on %s', (dialect, reachable) => {
  let h: StudioHarness;
  let app: Awaited<ReturnType<typeof staffServer>>;
  let statement: DocumentProfile;
  let documentId: string;
  const users: Record<string, string> = {};

  beforeAll(async () => {
    if (!reachable) return;
    h = await installStudio(dialect);
    const t = (ref: string) => h.real(ref);
    const no = dialect === 'postgres' ? 'false' : '0';
    await h.sql(`insert into ${t('clients')} (id, email, name, company) values (3, 'cara@x.test', 'Cara', 'Cara Makes')`);
    await h.sql(`insert into ${t('invoices')} (id, client_id, number, status, issued_on, total, currency) values (201, 3, 'INV-3201', 'sent', '2026-03-10', '100', 'EUR')`);
    await h.sql(`insert into ${t('payments')} (id, invoice_id, client_id, amount, voided, paid_on) values (1, 201, 3, '60', ${no}, '2026-04-01')`);
    statement = (await documentProfilesRepo(h.meta).listOwnedBy(h.connectionId, 'studio')).find((p) => p.kind === 'statement')!;
    const drawn = await renderDocument(h.pipeline, { profileId: statement.id, pk: { id: 3 } });
    if (drawn.status !== 'rendered') throw new Error('the statement was not drawn');
    documentId = drawn.document.id;

    const view = await loadSnapshotView(h.meta, h.connectionId);
    const id = (ref: string) => view.model.tables.find((x) => x.name === h.real(ref))!.id;
    users['all'] = await reader(h, 'desk', [id('clients'), id('invoices'), id('payments')]);
    // The client row and its invoices, not its payments; and the other way round.
    users['noPayments'] = await reader(h, 'front', [id('clients'), id('invoices')]);
    users['noInvoices'] = await reader(h, 'till', [id('clients'), id('payments')]);
    app = await staffServer(h);
  }, 180_000);

  afterAll(async () => {
    if (!reachable) return;
    await app.close();
    await h.close();
  });

  const as = (user: string, method: 'GET' | 'POST', url: string, payload?: Record<string, unknown>) =>
    app.inject({ method, url: `/api/v1${url}`, headers: { 'x-user': users[user]! }, ...(payload === undefined ? {} : { payload }) });

  it.skipIf(!reachable)('shows and draws it for a role that reads every table it is built from', async () => {
    const listed = await as('all', 'GET', `/documents?profileId=${statement.id}`);
    expect((listed.json() as { documents: { id: string; redacted: boolean }[] }).documents.find((d) => d.id === documentId)?.redacted).toBe(false);
    expect((await as('all', 'GET', `/documents/${documentId}`)).json()).toMatchObject({ redacted: false });
    expect((await as('all', 'GET', `/documents/${documentId}/content`)).statusCode).toBe(200);
    expect((await as('all', 'GET', `/documents/${documentId}/print`)).statusCode).toBe(200);
    expect((await as('all', 'POST', '/documents/render', { profileId: statement.id, pk: { id: 3 } })).statusCode).toBe(200);
    expect([200, 201]).toContain((await as('all', 'POST', '/apps/studio/documents/render', { kind: 'statement', ref: 'clients', pk: { id: 3 } })).statusCode);
  });

  it.skipIf(!reachable)('asks read on a linked row’s table even where the mapping does not name it', async () => {
    // A receipt prints its invoice's number through the payment's foreign key. An older profile
    // names only the key, not the table: the table is still read, so still asked.
    const receipt = (await documentProfilesRepo(h.meta).listOwnedBy(h.connectionId, 'studio')).find((p) => p.kind === 'receipt')!;
    const unnamed = Object.fromEntries(
      Object.entries(receipt.mapping).map(([slot, mapped]) => {
        if (typeof mapped !== 'object' || mapped === null || !('ref' in mapped)) return [slot, mapped];
        const { table: _table, ...rest } = mapped as Record<string, unknown>;
        return [slot, rest];
      }),
    );
    expect(JSON.stringify(unnamed)).toContain('"ref"');
    await h.meta.db.updateTable('adminium_document_profiles').set({ mapping: JSON.stringify(unnamed) }).where('id', '=', receipt.id).execute();
    const drawn = await renderDocument(h.pipeline, { profileId: receipt.id, pk: { id: 1 } });
    if (drawn.status !== 'rendered') throw new Error('the receipt was not drawn');
    const view = await loadSnapshotView(h.meta, h.connectionId);
    const id = (ref: string) => view.model.tables.find((x) => x.name === h.real(ref))!.id;
    users['paymentsOnly'] = await reader(h, 'cashier', [id('payments')]);
    const content = await as('paymentsOnly', 'GET', `/documents/${drawn.document.id}/content`);
    expect(content.statusCode).toBe(403);
    expect((content.json() as { message: string }).message).toContain(h.real('invoices'));
    expect((await as('all', 'GET', `/documents/${drawn.document.id}/content`)).statusCode).toBe(200);
  });

  it.skipIf(!reachable)('refuses it on every door to a role that cannot read one of its source tables', async () => {
    // Soft: each door's answer is reported on its own.
    for (const who of ['noPayments', 'noInvoices']) {
      const listed = await as(who, 'GET', `/documents?profileId=${statement.id}`);
      expect.soft((listed.json() as { documents: { id: string; redacted: boolean }[] }).documents.find((d) => d.id === documentId)?.redacted, who).toBe(true);
      expect.soft((await as(who, 'GET', `/documents/${documentId}`)).json(), who).toMatchObject({ redacted: true });
      const content = await as(who, 'GET', `/documents/${documentId}/content`);
      expect.soft(content.statusCode, who).toBe(403);
      // The refusal names the table that is missing.
      const missing = h.real(who === 'noPayments' ? 'payments' : 'invoices');
      expect.soft((content.json() as { message: string }).message, who).toContain(missing);
      expect.soft((await as(who, 'GET', `/documents/${documentId}/print`)).statusCode, who).toBe(403);
      const render = await as(who, 'POST', '/documents/render', { profileId: statement.id, pk: { id: 3 } });
      expect.soft(render.statusCode, who).toBe(403);
      expect.soft((render.json() as { message: string }).message, who).toContain(missing);
      // An app's own screen answers as it always has: the one 404.
      expect.soft((await as(who, 'POST', '/apps/studio/documents/render', { kind: 'statement', ref: 'clients', pk: { id: 3 } })).statusCode, who).toBe(404);
    }
  });
});
