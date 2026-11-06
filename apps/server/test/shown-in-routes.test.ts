// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Shown in" through the routes, on every available engine:
 *  - set on email templates (a whole family: every language of a key), report
 *    layouts and invoice layouts by whoever may edit them, audited, and only
 *    with workspaces that exist;
 *  - `?workspaceId=` on each list keeps what is shown in all or chosen there:
 *    a subset of the list without it, its badges counted the same way, and an
 *    unseen workspace not found;
 *  - a send never asks: a template hidden in a workspace is still the one a
 *    rule's key resolves to;
 *  - deleting a workspace lists what it was the only "Shown in" of (a family
 *    once), which is then "chosen, none", never widened to all;
 *  - an item's link rows go with the item; a copy is listed where its source is.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditRepo, connectionsRepo, emailTemplatesRepo, pagesRepo, permissionsRepo, rolesRepo, usersRepo, workspacesRepo, type MetaDb, type User } from '@adminium/meta';

import { liveTemplateKeySet, resolveRuleTemplate } from '../src/automations/templates.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { matrixRowsFromGrants, PERMISSIONS } from '../src/rbac/permissions.js';
import { emailTemplatesRoutes } from '../src/routes/email-templates/index.js';
import { invoicesRoutes } from '../src/routes/invoices/index.js';
import { reportDocumentsRoutes } from '../src/routes/report-documents/index.js';
import { workspacesRoutes } from '../src/routes/workspaces/index.js';
import { buildBareApp, type BareApp } from './jobs-helpers.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

const PLAIN = { encrypt: (v: string) => v, decrypt: (v: string) => v };

interface Listed {
  items: { id: string; shownIn: { mode: string; workspaceIds: string[] } }[];
  counts: Record<string, number>;
}

describe.each(META_ENGINES)('"Shown in" — $name', (engine) => {
  let handle: MetaHandle;
  let meta: MetaDb;
  let app: BareApp;
  let owner: User;
  let viewer: User;
  let coffee: string;
  let kiln: string;

  beforeAll(async () => {
    if (!engine.available) return;
    handle = await engine.make();
    meta = handle.meta;
    const users = usersRepo(meta);
    owner = await users.create({ email: 'owner@adminium.test', name: 'Owner', status: 'active' });
    viewer = await users.create({ email: 'viewer@adminium.test', name: 'Viewer', status: 'active' });
    await rolesRepo(meta).assignToUser(owner.id, (await rolesRepo(meta).findBySlug('super-admin'))!.id);
    await rolesRepo(meta).assignToUser(viewer.id, (await rolesRepo(meta).findBySlug('viewer'))!.id);
    app = buildBareApp();
    app.addHook('onRequest', async (request) => {
      const id = request.headers['x-test-user-id'];
      if (typeof id === 'string' && id.length > 0) (request as unknown as { user: { id: string; name: string } }).user = { id, name: id };
    });
    await app.register(rbacPlugin, { meta });
    await app.register(workspacesRoutes);
    await app.register(emailTemplatesRoutes({ meta }));
    await app.register(reportDocumentsRoutes({ meta }));
    await app.register(invoicesRoutes({ meta }));
    await app.ready();
  }, 120_000);
  afterAll(async () => {
    if (!engine.available) return;
    await app.close();
    await handle.destroy();
  });
  beforeEach(async () => {
    if (!engine.available) return;
    for (const table of ['adminium_item_workspaces', 'adminium_workspace_connections', 'adminium_workspaces', 'adminium_report_documents', 'adminium_invoice_documents', 'adminium_audit_log'] as const) {
      await meta.db.deleteFrom(table).execute();
    }
    await meta.db.deleteFrom('adminium_email_templates').where('key', 'like', 'shown-%').execute();
    await meta.db.deleteFrom('adminium_pages').execute();
    await meta.db.deleteFrom('adminium_connections').execute();
    const connections = connectionsRepo(meta, PLAIN);
    const make = async (name: string) => (await connections.create({ name, engine: 'postgres', introspectDsn: `postgres://ro@db.internal:5432/${name}` })).id;
    const fernhill = await make('fernhill');
    const kilnDb = await make('kiln');
    coffee = (await workspacesRepo(meta).create({ name: 'Fernhill Coffee', connectionIds: [fernhill] })).id;
    kiln = (await workspacesRepo(meta).create({ name: 'Kiln Street Pottery', connectionIds: [kilnDb] })).id;
  });

  const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, user: User = owner, payload?: unknown) =>
    app.inject({ method, url, headers: { 'x-test-user-id': user.id }, ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) });

  async function made(url: string, payload: Record<string, unknown>): Promise<string> {
    const res = await call('POST', url, owner, payload);
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { id: string }).id;
  }

  /** Two of each kind; the first of each shown in Kiln alone. An email family of two languages. */
  async function seed() {
    const emails = emailTemplatesRepo(meta);
    const firing = await emails.upsert('shown-firing', 'en_US', { name: 'Firing done', subject: 's', blocks: [], enabled: true });
    const firingDe = await emails.upsert('shown-firing', 'de_DE', { name: 'Brand fertig', subject: 's', blocks: [], enabled: true });
    const news = await emails.upsert('shown-news', 'en_US', { name: 'News', subject: 's', blocks: [], enabled: true });
    const reportA = await made('/report-documents', { kind: 'report', name: 'Kiln weekly' });
    const reportB = await made('/report-documents', { kind: 'template', name: 'Everyone' });
    const invoiceA = await made('/invoices', { kind: 'template', name: 'Kiln invoice' });
    const invoiceB = await made('/invoices', { kind: 'template', name: 'Plain invoice' });
    return { firing: firing.id, firingDe: firingDe.id, news: news.id, reportA, reportB, invoiceA, invoiceB };
  }

  it.skipIf(!engine.available)('is set by who edits the item, for a whole email family, with workspaces that exist, and audited', async () => {
    const s = await seed();
    const chosen = { shownIn: { mode: 'chosen', workspaceIds: [kiln, 'wsp_absent'] } };
    expect((await call('PATCH', `/report-documents/${s.reportA}`, viewer, chosen)).statusCode).toBe(403);

    const email = await call('PATCH', `/email-templates/${s.firing}`, owner, chosen);
    expect(email.statusCode, email.body).toBe(200);
    expect(email.json().shownIn).toEqual({ mode: 'chosen', workspaceIds: [kiln] });
    // The German row of the same key follows.
    expect(await workspacesRepo(meta).shownIn('email-template', s.firingDe)).toEqual({ mode: 'chosen', workspaceIds: [kiln] });
    const report = await call('PATCH', `/report-documents/${s.reportA}`, owner, chosen);
    expect(report.json()).toMatchObject({ name: 'Kiln weekly', shownIn: { mode: 'chosen', workspaceIds: [kiln] } });
    const invoice = await call('PATCH', `/invoices/${s.invoiceA}`, owner, chosen);
    expect(invoice.json()).toMatchObject({ name: 'Kiln invoice', shownIn: { mode: 'chosen', workspaceIds: [kiln] } });
    // Every reply declares it: the detail, and an untouched item's "all".
    expect((await call('GET', `/report-documents/${s.reportB}`)).json().shownIn).toEqual({ mode: 'all', workspaceIds: [] });
    expect((await call('GET', `/invoices/${s.invoiceA}`)).json().shownIn).toEqual({ mode: 'chosen', workspaceIds: [kiln] });
    expect((await call('GET', `/email-templates/${s.firingDe}`)).json().shownIn).toEqual({ mode: 'chosen', workspaceIds: [kiln] });

    // Back to all: the links go.
    const all = await call('PATCH', `/invoices/${s.invoiceA}`, owner, { shownIn: { mode: 'all', workspaceIds: [kiln] } });
    expect(all.json().shownIn).toEqual({ mode: 'all', workspaceIds: [] });
    expect((await workspacesRepo(meta).linksOfKind('invoice')).has(s.invoiceA)).toBe(false);

    const actions = (await auditRepo(meta).list({ category: 'settings', limit: 50 })).map((entry) => entry.action);
    for (const action of ['email-template.shown-in', 'report-document.shown-in', 'invoice-document.shown-in']) expect(actions).toContain(action);
    // A change of "Shown in" alone is not also written down as a rename.
    expect(actions).not.toContain('report-document.rename');
  });

  it.skipIf(!engine.available)('narrows each list to one workspace and never widens it; a send never asks', async () => {
    const s = await seed();
    for (const [url, id] of [[`/email-templates/${s.firing}`, s.firing], [`/report-documents/${s.reportA}`, s.reportA], [`/invoices/${s.invoiceA}`, s.invoiceA]] as const) {
      expect((await call('PATCH', url, owner, { shownIn: { mode: 'chosen', workspaceIds: [kiln] } })).statusCode, id).toBe(200);
    }
    const lists = [
      { url: '/email-templates', hidden: [s.firing, s.firingDe], kept: [s.news] },
      { url: '/report-documents', hidden: [s.reportA], kept: [s.reportB] },
      { url: '/invoices', hidden: [s.invoiceA], kept: [s.invoiceB] },
    ];
    for (const list of lists) {
      const whole = (await call('GET', list.url)).json() as Listed;
      const ids = new Set(whole.items.map((item) => item.id));
      for (const id of [...list.hidden, ...list.kept]) expect(ids.has(id), `${list.url} ${id}`).toBe(true);
      for (const workspace of [coffee, kiln]) {
        const res = await call('GET', `${list.url}?workspaceId=${workspace}`);
        expect(res.statusCode, res.body).toBe(200);
        const narrowed = res.json() as Listed;
        // ⊆: everything the narrowed list holds, the list without it holds too.
        for (const item of narrowed.items) expect(ids.has(item.id), `${list.url} ${item.id}`).toBe(true);
        const here = new Set(narrowed.items.map((item) => item.id));
        for (const id of list.kept) expect(here.has(id)).toBe(true);
        for (const id of list.hidden) expect(here.has(id)).toBe(workspace === kiln);
        // The badges count the same cut as the list.
        const total = Object.entries(narrowed.counts).filter(([kind]) => kind !== 'archived').reduce((sum, [, n]) => sum + n, 0);
        expect(total, list.url).toBe(narrowed.items.length);
      }
      expect((await call('GET', `${list.url}?workspaceId=wsp_absent`)).statusCode).toBe(404);
      // A workspace this person cannot see (the viewer reaches no page of Kiln) is not found either.
      expect((await call('GET', `${list.url}?workspaceId=${kiln}`, viewer)).statusCode).toBe(404);
    }

    // Hidden in Fernhill Coffee, and still the template the key sends.
    expect(await liveTemplateKeySet(meta)).toContain('shown-firing');
    expect((await resolveRuleTemplate(meta, 'shown-firing', 'en_US'))?.id).toBe(s.firing);
  });

  it.skipIf(!engine.available)('a workspace delete lists what it alone showed, once a family, and leaves it chosen, none', async () => {
    const s = await seed();
    const kilnOnly = { shownIn: { mode: 'chosen', workspaceIds: [kiln] } };
    const both = { shownIn: { mode: 'chosen', workspaceIds: [kiln, coffee] } };
    await call('PATCH', `/email-templates/${s.firing}`, owner, kilnOnly);
    await call('PATCH', `/report-documents/${s.reportA}`, owner, kilnOnly);
    await call('PATCH', `/invoices/${s.invoiceA}`, owner, kilnOnly);
    await call('PATCH', `/invoices/${s.invoiceB}`, owner, both);

    const plan = (await call('GET', `/workspaces/${kiln}/delete-plan`)).json() as { shownOnlyIn: { kind: string; itemId: string; name: string }[] };
    const listed = plan.shownOnlyIn.map((item) => `${item.kind}:${item.name}`).sort();
    expect(listed).toEqual(['email-template:' + (plan.shownOnlyIn.find((item) => item.kind === 'email-template')?.name ?? ''), 'invoice:Kiln invoice', 'report:Kiln weekly'].sort());
    expect(plan.shownOnlyIn.filter((item) => item.kind === 'email-template')).toHaveLength(1);

    const deleted = await call('DELETE', `/workspaces/${kiln}`);
    expect(deleted.statusCode, deleted.body).toBe(200);
    for (const [kind, id] of [['email-template', s.firing], ['email-template', s.firingDe], ['report', s.reportA], ['invoice', s.invoiceA]] as const) {
      expect(await workspacesRepo(meta).shownIn(kind, id)).toEqual({ mode: 'chosen', workspaceIds: [] });
    }
    // Shown in two: it keeps the other.
    expect(await workspacesRepo(meta).shownIn('invoice', s.invoiceB)).toEqual({ mode: 'chosen', workspaceIds: [coffee] });
    // Chosen, none: in no workspace's list, still in the list without one.
    const inCoffee = ((await call('GET', `/report-documents?workspaceId=${coffee}`)).json() as Listed).items.map((item) => item.id);
    expect(inCoffee).not.toContain(s.reportA);
    expect(((await call('GET', '/report-documents')).json() as Listed).items.map((item) => item.id)).toContain(s.reportA);
  });

  it.skipIf(!engine.available)('takes an item\'s links with it, and lists a copy where its source is', async () => {
    const s = await seed();
    const kilnOnly = { shownIn: { mode: 'chosen', workspaceIds: [kiln] } };
    await call('PATCH', `/email-templates/${s.news}`, owner, kilnOnly);
    await call('PATCH', `/report-documents/${s.reportA}`, owner, kilnOnly);
    await call('PATCH', `/invoices/${s.invoiceA}`, owner, kilnOnly);

    // A copy, and another language, are listed where their source is.
    const reportCopy = await call('POST', `/report-documents/${s.reportA}/duplicate`);
    expect(reportCopy.json().shownIn).toEqual({ mode: 'chosen', workspaceIds: [kiln] });
    const invoiceCopy = await call('POST', `/invoices/${s.invoiceA}/duplicate`);
    expect(invoiceCopy.json().shownIn).toEqual({ mode: 'chosen', workspaceIds: [kiln] });
    const invoiceLang = await call('POST', `/invoices/${s.invoiceA}/languages`, owner, { lang: 'de' });
    expect(invoiceLang.statusCode, invoiceLang.body).toBe(201);
    expect(invoiceLang.json().shownIn).toEqual({ mode: 'chosen', workspaceIds: [kiln] });
    const emailLang = await call('POST', `/email-templates/${s.news}/languages`, owner, { locale: 'fr_FR' });
    expect(emailLang.statusCode, emailLang.body).toBe(201);
    expect(emailLang.json().shownIn).toEqual({ mode: 'chosen', workspaceIds: [kiln] });
    const emailCopy = await call('POST', `/email-templates/${s.news}/duplicate`);
    expect(emailCopy.json().shownIn).toEqual({ mode: 'chosen', workspaceIds: [kiln] });

    for (const [url, kind, id] of [
      [`/email-templates/${s.news}`, 'email-template', s.news],
      [`/report-documents/${s.reportA}`, 'report', s.reportA],
      [`/invoices/${s.invoiceA}`, 'invoice', s.invoiceA],
    ] as const) {
      const res = await call('DELETE', url);
      expect(res.statusCode, res.body).toBe(204);
      expect((await workspacesRepo(meta).linksOfKind(kind)).has(id), url).toBe(false);
    }
    // Gone items leave nothing for a delete to list.
    const plan = (await call('GET', `/workspaces/${kiln}/delete-plan`)).json() as { shownOnlyIn: { itemId: string }[] };
    for (const id of [s.news, s.reportA, s.invoiceA]) expect(plan.shownOnlyIn.map((item) => item.itemId)).not.toContain(id);
  });

  it.skipIf(!engine.available)('names to an editor only the workspaces they see, and keeps the others when they save', async () => {
    const s = await seed();
    const both = { shownIn: { mode: 'chosen', workspaceIds: [coffee, kiln] } };
    for (const url of [`/email-templates/${s.firing}`, `/report-documents/${s.reportA}`, `/invoices/${s.invoiceA}`]) expect((await call('PATCH', url, owner, both)).statusCode, url).toBe(200);
    // Edits templates and layouts; reaches a page of Kiln's database alone, so sees Kiln's workspace alone.
    const editor = await usersRepo(meta).create({ email: `editor-${engine.name}@adminium.test`, name: 'Editor', status: 'active' });
    const role = await rolesRepo(meta).create({ slug: `kiln-editor-${Date.now()}`, name: 'Kiln editor' });
    await rolesRepo(meta).assignToUser(editor.id, role.id);
    for (const row of matrixRowsFromGrants([PERMISSIONS.settingsManage]).rows) await permissionsRepo(meta).grant(role.id, row.resourceKind, row.resourceRef, row.actions as never);
    const kilnDb = (await workspacesRepo(meta).findById(kiln))!.connectionIds[0]!;
    const page = await pagesRepo(meta).create({ connectionId: kilnDb, slug: 'kiln-firings', type: 'crud', title: 'Firings', navGroup: 'workspace', config: { v: 1, kind: 'crud', template: 'page-crud', config: {} }, createdBy: null });
    await permissionsRepo(meta).grant(role.id, 'page', page.id, { view: true, edit: false } as never);

    for (const url of [`/email-templates/${s.firing}`, `/report-documents/${s.reportA}`, `/invoices/${s.invoiceA}`]) {
      const read = await call('GET', url, editor);
      expect(read.statusCode, `${url} ${read.body}`).toBe(200);
      expect(read.json().shownIn, url).toEqual({ mode: 'chosen', workspaceIds: [kiln] });
      expect(read.body, url).not.toContain(coffee);
    }
    for (const url of ['/email-templates', '/report-documents', '/invoices']) {
      const list = await call('GET', url, editor);
      expect(list.statusCode, `${url} ${list.body}`).toBe(200);
      expect(list.body, url).not.toContain(coffee);
    }

    // Their save is over what they see: taking Kiln off leaves Fernhill's link as it was.
    const saved = await call('PATCH', `/invoices/${s.invoiceA}`, editor, { shownIn: { mode: 'chosen', workspaceIds: [] } });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json().shownIn).toEqual({ mode: 'chosen', workspaceIds: [] });
    expect(await workspacesRepo(meta).shownIn('invoice', s.invoiceA)).toEqual({ mode: 'chosen', workspaceIds: [coffee] });
    // Naming a workspace they do not see changes nothing of it.
    expect((await call('PATCH', `/report-documents/${s.reportA}`, editor, { shownIn: { mode: 'chosen', workspaceIds: [kiln] } })).statusCode).toBe(200);
    expect((await workspacesRepo(meta).shownIn('report', s.reportA))?.workspaceIds.sort()).toEqual([coffee, kiln].sort());
    expect((await call('PATCH', `/email-templates/${s.news}`, editor, { shownIn: { mode: 'chosen', workspaceIds: [coffee] } })).statusCode).toBe(200);
    expect(await workspacesRepo(meta).shownIn('email-template', s.news)).toEqual({ mode: 'chosen', workspaceIds: [] });
  });
});
