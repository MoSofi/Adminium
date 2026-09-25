// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The record page's "make a document" carries a statement's period to the
 * job that draws it — one of three words, never a date — so a statement drawn
 * from the dashboard covers the period asked for, not always everything.
 */
import BetterSqlite3 from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import {
  applyMigrations,
  connectionsRepo,
  createSqliteMetaDb,
  documentProfilesRepo,
  initMetaDb,
  permissionsRepo,
  rolesRepo,
  usersRepo,
} from '@adminium/meta';

import { documentRenderPayloadSchema } from '../src/jobs/document-render.js';
import { documentRoutes } from '../src/routes/documents/index.js';

describe('a statement\'s period from the record page', () => {
  it('reaches the queued job, and a date is refused', async () => {
    const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await initMetaDb(meta);
    await applyMigrations(meta.db, { dialect: meta.dialect });
    const connectionId = (await connectionsRepo(meta, { encrypt: (v) => v, decrypt: (v) => v }).create({ name: 'c', engine: 'postgres', introspectDsn: 'postgres://ro@db/c' })).id;
    const profile = await documentProfilesRepo(meta).create({ addOnKey: 'invoices', kind: 'statement', name: 'Statement', connectionId, table: 'public.clients', mapping: {} });
    const user = await usersRepo(meta).create({ email: 'desk@test', name: 'Desk' });
    const role = await rolesRepo(meta).create({ slug: 'desk', name: 'Desk' });
    await rolesRepo(meta).assignToUser(user.id, role.id);
    await permissionsRepo(meta).grant(role.id, 'table', `${connectionId}/public.clients`, { read: true, create: false, update: false, delete: false, export: false, import: false, read_pii: false } as never);

    const queued: Record<string, unknown>[] = [];
    const Fastify = (await import('fastify')).default;
    const zod = await import('fastify-type-provider-zod');
    const app = Fastify();
    app.setValidatorCompiler(zod.validatorCompiler);
    app.setSerializerCompiler(zod.serializerCompiler);
    app.decorate('rbac', { require: () => async () => {} } as never);
    app.decorate('requireAuth', async () => {});
    app.addHook('onRequest', async (request) => {
      (request as { user?: unknown }).user = { id: user.id };
    });
    await app.register(
      documentRoutes({ meta, storage: {} as never, runtime: () => null, enqueue: (input) => { queued.push(input.payload); return Promise.resolve({ id: 'job_1' }); } }),
      { prefix: '/api/v1' },
    );
    await app.ready();

    const res = await app.inject({ method: 'POST', url: '/api/v1/documents/render', payload: { profileId: profile.id, pk: { id: 3 }, period: 'year' } });
    expect(res.statusCode, res.body).toBe(200);
    expect(queued[0]).toMatchObject({ profileId: profile.id, period: 'year' });
    expect(documentRenderPayloadSchema.parse(queued[0]).period).toBe('year');
    const dated = await app.inject({ method: 'POST', url: '/api/v1/documents/render', payload: { profileId: profile.id, pk: { id: 3 }, period: '2020-01-01' } });
    expect(dated.statusCode).toBe(400);
    await app.close();
  });
});
