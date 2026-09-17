// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The report-documents routes — driven through a bare Fastify app with the
 * real rbac plugin and an `x-test-user-id` header, the way
 * `invoices-routes.test.ts` mounts the invoice surface.
 *
 * The assertions that carry the wave: a document minted from a starter
 * carries a summary drawn from its own blocks; the tab badges never respond
 * to the kind filter; a save re-derives the summary from the on-screen body
 * and keeps the row's starter icon; a duplicate lands directly after its
 * source as a draft; a report built from a template remembers it and
 * survives its deletion; and every write is a `settings.manage` power while
 * every read is a session's.
 */
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteMetaDb, firstRun, rolesRepo, usersRepo, type MetaDb, type Role, type User } from '@adminium/meta';

import { IMAGE_DATA_URL_MAX } from '../src/report-documents/document.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { reportDocumentsRoutes } from '../src/routes/report-documents/index.js';
import type { ReportDetailView, ReportSummaryView } from '../src/routes/report-documents/schema.js';
import { buildBareApp, type BareApp } from './jobs-helpers.js';

type ListReply = { items: ReportSummaryView[]; counts: { template: number; report: number } };
type ErrorReply = { error: { code: string; details: Record<string, unknown> } };

describe('report document routes', () => {
  let meta: MetaDb;
  let app: BareApp;
  let manager: User;
  let viewer: User;

  async function role(slug: string): Promise<Role> {
    const found = await rolesRepo(meta).findBySlug(slug);
    if (found === null) throw new Error(`missing built-in role ${slug}`);
    return found;
  }

  beforeEach(async () => {
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    const users = usersRepo(meta);
    manager = await users.create({ email: 'ava@adminium.test', name: 'Ava', status: 'active' });
    viewer = await users.create({ email: 'liam@adminium.test', name: 'Liam', status: 'active' });
    await rolesRepo(meta).assignToUser(manager.id, (await role('super-admin')).id);
    await rolesRepo(meta).assignToUser(viewer.id, (await role('viewer')).id);

    app = buildBareApp();
    app.addHook('onRequest', async (request) => {
      const id = request.headers['x-test-user-id'];
      if (typeof id === 'string' && id.length > 0) {
        (request as unknown as { user: { id: string; name: string } }).user = { id, name: id };
      }
    });
    await app.register(rbacPlugin, { meta });
    await app.register(reportDocumentsRoutes({ meta }));
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await meta.db.destroy();
  });

  function as(user: User) {
    return { 'x-test-user-id': user.id };
  }

  async function create(body: Record<string, unknown>, user: User = manager): Promise<ReportDetailView> {
    const res = await app.inject({ method: 'POST', url: '/report-documents', headers: as(user), payload: body });
    expect(res.statusCode, res.body).toBe(201);
    return res.json() as ReportDetailView;
  }

  async function detail(id: string): Promise<ReportDetailView> {
    const res = await app.inject({ method: 'GET', url: `/report-documents/${id}`, headers: as(viewer) });
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as ReportDetailView;
  }

  async function list(kind?: 'template' | 'report'): Promise<ListReply> {
    const url = kind === undefined ? '/report-documents' : `/report-documents?kind=${kind}`;
    const res = await app.inject({ method: 'GET', url, headers: as(viewer) });
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as ListReply;
  }

  it('creates from a starter: the body is the comp’s, the summary is drawn from it', async () => {
    const doc = await create({ kind: 'template', starter: 'exec' });
    expect(doc).toMatchObject({ kind: 'template', name: 'Executive summary', status: 'draft', starter: 'exec', originId: null });
    expect(doc.summary).toEqual({
      reportTitle: 'Q3 2026 Executive Summary',
      kicker: 'Quarterly report',
      accent: '#4f46e5',
      blockCount: 4,
      kpiCount: 3,
      series: [52, 68, 60, 82, 74, 96],
      starterIcon: 'briefcase',
    });
    expect(doc.body.blocks.map((b) => b.kind)).toEqual(['text', 'kpi', 'bar', 'table']);

    const health = await create({ kind: 'report', starter: 'health', name: 'Account health — July' });
    expect(health).toMatchObject({ kind: 'report', name: 'Account health — July', status: 'draft' });
    expect(health.summary).toMatchObject({ accent: '#12805c', starterIcon: 'heart-pulse', blockCount: 2 });

    const blank = await create({ kind: 'template' });
    expect(blank).toMatchObject({ name: 'Untitled template', starter: null, status: 'draft' });
    expect(blank.body.reportTitle).toBe('Untitled report');
    expect(blank.summary).toMatchObject({ blockCount: 1, starterIcon: 'file-text', series: [40, 66, 52, 78, 60] });
    expect((await create({ kind: 'report' })).name).toBe('Untitled report');

    const bogus = await app.inject({
      method: 'POST',
      url: '/report-documents',
      headers: as(manager),
      payload: { kind: 'template', starter: 'quarterly' },
    });
    expect(bogus.statusCode).toBe(422);
    expect((bogus.json() as ErrorReply).error.details).toEqual({ starter: 'quarterly' });
  });

  it('lists each kind newest first with counts that ignore the filter, and serves the twelve starters', async () => {
    const t1 = await create({ kind: 'template', starter: 'exec' });
    const t2 = await create({ kind: 'template', starter: 'weekly' });
    const r1 = await create({ kind: 'report', starter: 'incident' });

    const templates = await list('template');
    expect(templates.items.map((i) => i.id)).toEqual([t2.id, t1.id]);
    expect(templates.counts).toEqual({ template: 2, report: 1 });
    const reports = await list('report');
    expect(reports.items.map((i) => i.id)).toEqual([r1.id]);
    expect(reports.counts).toEqual({ template: 2, report: 1 });
    expect((await list()).items).toHaveLength(3);
    // A summary row never carries the body.
    expect('body' in (templates.items[0] as object)).toBe(false);

    const starters = await app.inject({ method: 'GET', url: '/report-documents/starters', headers: as(viewer) });
    expect(starters.statusCode).toBe(200);
    const cards = (starters.json() as { starters: { key: string; category: string }[] }).starters;
    expect(cards).toHaveLength(12);
    expect(cards[0]).toEqual({
      key: 'exec',
      name: 'Executive summary',
      category: 'leadership',
      icon: 'briefcase',
      reportTitle: 'Q3 2026 Executive Summary',
      accent: '#4f46e5',
      blockCount: 4,
      series: [52, 68, 60, 82, 74, 96],
    });
  });

  it('PUT saves the on-screen document and re-derives the summary from it', async () => {
    const doc = await create({ kind: 'report', starter: 'exec' });
    const put = await app.inject({
      method: 'PUT',
      url: `/report-documents/${doc.id}`,
      headers: as(manager),
      payload: {
        name: 'Q3 — final',
        status: 'sent',
        body: {
          ...doc.body,
          accent: '#0d9488',
          kicker: 'Board pack',
          reportTitle: 'Q3 2026 — final',
          blocks: [
            { id: 'k1', kind: 'kpi', title: 'Headline', w: 'half', show: true, kpis: [{ label: 'ARR', value: '$5.8M', delta: '+14%' }] },
            { id: 'l1', kind: 'line', title: 'Traffic', w: 'half', show: false, series: [{ label: 'Wk1', value: 30 }, { label: 'Wk2', value: 48 }] },
          ],
        },
      },
    });
    expect(put.statusCode, put.body).toBe(200);
    const saved = put.json() as ReportDetailView;
    expect(saved).toMatchObject({ name: 'Q3 — final', status: 'sent' });
    expect(saved.summary).toEqual({
      reportTitle: 'Q3 2026 — final',
      kicker: 'Board pack',
      accent: '#0d9488',
      blockCount: 2,
      kpiCount: 1,
      // `show: false` DIMS a block; it is still the first chart (trap 2).
      series: [30, 48],
      // The row's starter is what the card's icon follows, not the title.
      starterIcon: 'briefcase',
    });
    expect(saved.body.blocks.map((b) => [b.id, b.w, b.show])).toEqual([
      ['k1', 'half', true],
      ['l1', 'half', false],
    ]);
    // A reload reproduces it.
    expect(await detail(doc.id)).toEqual(saved);
    expect(saved.updatedAt).toBeGreaterThanOrEqual(saved.createdAt);

    const gone = await app.inject({ method: 'PUT', url: '/report-documents/rpt_nope', headers: as(manager), payload: { name: 'x', status: 'draft', body: {} } });
    expect(gone.statusCode).toBe(404);
  });

  it('PUT refuses an image over the cap with a code that names the field', async () => {
    const doc = await create({ kind: 'report' });
    const big = `data:image/png;base64,${'A'.repeat(IMAGE_DATA_URL_MAX)}`;
    const res = await app.inject({
      method: 'PUT',
      url: `/report-documents/${doc.id}`,
      headers: as(manager),
      payload: { name: doc.name, status: 'draft', body: { ...doc.body, bgImage: big } },
    });
    expect(res.statusCode).toBe(422);
    expect((res.json() as ErrorReply).error.details).toMatchObject({ code: 'IMAGE_TOO_LARGE', field: 'bgImage' });
  });

  it('PATCH renames in place; an empty name is refused by the schema', async () => {
    const doc = await create({ kind: 'template', starter: 'exec' });
    const res = await app.inject({ method: 'PATCH', url: `/report-documents/${doc.id}`, headers: as(manager), payload: { name: 'Board layout' } });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as ReportSummaryView).name).toBe('Board layout');
    // Renaming never changes the icon (the comp's `starterIconFor` defect).
    expect((res.json() as ReportSummaryView).summary.starterIcon).toBe('briefcase');
    const empty = await app.inject({ method: 'PATCH', url: `/report-documents/${doc.id}`, headers: as(manager), payload: { name: '   ' } });
    expect(empty.statusCode).toBe(422);
  });

  it('a duplicate lands directly after its source as a draft, named "(copy)"', async () => {
    const a = await create({ kind: 'template', starter: 'exec' });
    const b = await create({ kind: 'template', starter: 'weekly' });
    await app.inject({ method: 'PUT', url: `/report-documents/${a.id}`, headers: as(manager), payload: { name: a.name, status: 'live', body: a.body } });
    const res = await app.inject({ method: 'POST', url: `/report-documents/${a.id}/duplicate`, headers: as(manager) });
    expect(res.statusCode, res.body).toBe(201);
    const copy = res.json() as ReportDetailView;
    expect(copy).toMatchObject({ name: 'Executive summary (copy)', status: 'draft', starter: 'exec', kind: 'template' });
    expect(copy.body).toEqual(a.body);
    expect((await list('template')).items.map((i) => i.id)).toEqual([b.id, a.id, copy.id]);
  });

  it('a report from a template copies the body, records the origin, and outlives it (D6)', async () => {
    const tpl = await create({ kind: 'template', starter: 'mbr' });
    const res = await app.inject({
      method: 'POST',
      url: `/report-documents/${tpl.id}/from-template`,
      headers: as(manager),
      payload: { name: 'July review' },
    });
    expect(res.statusCode, res.body).toBe(201);
    const report = res.json() as ReportDetailView;
    expect(report).toMatchObject({ kind: 'report', name: 'July review', status: 'draft', originId: tpl.id, starter: 'mbr' });
    expect(report.body).toEqual(tpl.body);
    expect(report.summary.starterIcon).toBe('presentation');

    // Without a name it takes the template's.
    const unnamed = await app.inject({ method: 'POST', url: `/report-documents/${tpl.id}/from-template`, headers: as(manager), payload: {} });
    expect((unnamed.json() as ReportDetailView).name).toBe('Monthly business review');

    // Only a template can start a report.
    const wrong = await app.inject({ method: 'POST', url: `/report-documents/${report.id}/from-template`, headers: as(manager), payload: {} });
    expect(wrong.statusCode).toBe(422);
    expect((wrong.json() as ErrorReply).error.details).toEqual({ kind: 'report' });

    // Deleting the template leaves the report untouched.
    expect((await app.inject({ method: 'DELETE', url: `/report-documents/${tpl.id}`, headers: as(manager) })).statusCode).toBe(204);
    expect((await detail(report.id)).originId).toBe(tpl.id);
  });

  it('DELETE is a hard delete and 404s the second time', async () => {
    const doc = await create({ kind: 'report', starter: 'board' });
    expect((await app.inject({ method: 'DELETE', url: `/report-documents/${doc.id}`, headers: as(manager) })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: `/report-documents/${doc.id}`, headers: as(manager) })).statusCode).toBe(404);
    expect((await list()).counts).toEqual({ template: 0, report: 0 });
  });

  it('reads need a session; every write is a settings.manage power that names the permission', async () => {
    const doc = await create({ kind: 'template', starter: 'exec' });
    expect((await app.inject({ method: 'GET', url: '/report-documents' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/report-documents/starters' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: `/report-documents/${doc.id}`, headers: as(viewer) })).statusCode).toBe(200);
    const body = { name: 'x', status: 'draft', body: {} };
    const writes = [
      app.inject({ method: 'POST', url: '/report-documents', headers: as(viewer), payload: { kind: 'template' } }),
      app.inject({ method: 'PUT', url: `/report-documents/${doc.id}`, headers: as(viewer), payload: body }),
      app.inject({ method: 'PATCH', url: `/report-documents/${doc.id}`, headers: as(viewer), payload: { name: 'x' } }),
      app.inject({ method: 'DELETE', url: `/report-documents/${doc.id}`, headers: as(viewer) }),
      app.inject({ method: 'POST', url: `/report-documents/${doc.id}/duplicate`, headers: as(viewer) }),
      app.inject({ method: 'POST', url: `/report-documents/${doc.id}/from-template`, headers: as(viewer), payload: {} }),
    ];
    for (const res of await Promise.all(writes)) {
      expect(res.statusCode, res.body).toBe(403);
      // NOT `system:reports:manage` — that key is Scheduled Reports'.
      expect((res.json() as ErrorReply).error.details['permission']).toBe('system:settings:manage');
    }
    expect((await list()).counts).toEqual({ template: 1, report: 0 });
  });
});
