// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The consent routes and the column door, over an app installed for real on
 * every engine: a contacts table with an address, a "may be e-mailed" column
 * and its two strict stamps (who ticked it, and when), as the CRM declares
 * them.
 *
 * As the roles: the owner (Super Admin) does everything; a marketer holding
 * the e-mail screens' grant sees and adds to the do-not-email list but may not
 * take anyone off it; a clerk who may change contacts records consent and
 * "Replied"; a reader sees the panel and may change nothing; a stranger is
 * refused every route.
 *
 * The column door writes the column and its stamps from a log event: the
 * staff member as "who" for a staff event, nobody for a system one (an
 * unsubscribe), and the event's own time.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { auditRepo, permissionsRepo, rolesRepo, usersRepo, type User } from '@adminium/meta';

import { consentTableSource, createConsentService, type ConsentService } from '../src/consent/index.js';
import { errorEnvelope } from '../src/errors.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { consentRoutes } from '../src/routes/consent/index.js';
import { installInvoicing, invoicingManifest, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';

const SECRET = 'a-consent-routes-test-secret-value';

function contactsManifest(): Record<string, unknown> {
  const manifest = invoicingManifest([
    {
      ref: 'contacts',
      columns: [
        { ref: 'id', type: 'int', role: 'pk' },
        { ref: 'name', type: 'text', maxLength: 80 },
        { ref: 'email', type: 'text', maxLength: 254, nullable: true },
        { ref: 'may_email', type: 'bool', default: false },
        { ref: 'may_email_by_id', type: 'text', maxLength: 36, nullable: true, rules: { staff: true, stamp: { set: 'user-id', on: { columns: ['may_email'] }, strict: true } } },
        { ref: 'may_email_at', type: 'timestamptz', nullable: true, rules: { stamp: { set: 'now', on: { columns: ['may_email'] }, strict: true } } },
      ],
    },
  ]);
  // The strict stamps are read from 0.3.35 on.
  return { ...manifest, compatibility: { minAdminiumVersion: '0.3.35' }, pages: [{ ref: 'studio-contacts', template: 'page-crud', title: { key: 't', fallback: 'Contacts' }, nav: { group: 'library', icon: 'list', order: 1 }, bindings: { rows: 'contacts' } }] };
}

const yes = (value: unknown) => value === true || value === 1 || value === '1';

describe.each(LEGS)('consent routes and the column door — %s', (dialect, available) => {
  let h: InvoicingHarness;
  let app: FastifyInstance;
  let service: ConsentService;
  let contactsId: string;
  let owner: User;
  let marketer: User;
  let clerk: User;
  let reader: User;
  let stranger: User;
  let marta: Record<string, unknown>;
  let ben: Record<string, unknown>;

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, contactsManifest());
    const w = await writerFor(h);
    marta = await w.create('contacts', { name: 'Marta Kovac', email: 'Marta.Kovac@cobaltlegal.example' });
    ben = await w.create('contacts', { name: 'Ben Okafor', email: 'ben@okafor.example' });
    contactsId = w.targetOf('contacts').table.id;

    const users = usersRepo(h.meta);
    const roles = rolesRepo(h.meta);
    owner = await users.create({ email: `owner-${dialect}@adminium.test`, name: 'Mara Lind', status: 'active' });
    await roles.assignToUser(owner.id, (await roles.findBySlug('super-admin'))!.id);
    const person = async (slug: string, name: string, grants: { table?: { read: boolean; update: boolean }; settings?: boolean }): Promise<User> => {
      const role = await roles.create({ slug: `${slug}-${dialect}`, name: slug });
      if (grants.table !== undefined) {
        await permissionsRepo(h.meta).grant(role.id, 'table', `${h.connectionId}/${contactsId}`, { read: grants.table.read, create: false, update: grants.table.update, delete: false, export: false, import: false } as never);
      }
      if (grants.settings === true) await permissionsRepo(h.meta).grant(role.id, 'system', 'settings.manage', { allowed: true });
      const user = await users.create({ email: `${slug}-${dialect}@adminium.test`, name, status: 'active' });
      await roles.assignToUser(user.id, role.id);
      return user;
    };
    marketer = await person('marketer', 'Mo Marketer', { settings: true, table: { read: true, update: false } });
    clerk = await person('clerk', 'Tom Becker', { table: { read: true, update: true } });
    reader = await person('reader', 'Ida Reader', { table: { read: true, update: false } });
    stranger = await person('stranger', 'Sam Stranger', {});

    const tables = consentTableSource({ meta: h.meta, manager: h.manager });
    service = createConsentService({ meta: h.meta, secret: SECRET, tables });
    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.setErrorHandler((error: { statusCode?: number; code?: string; message: string; details?: unknown }, request, reply) => {
      void reply.status(error.statusCode ?? 500).send(errorEnvelope(error.code ?? 'INTERNAL', error.message, request.id, error.details));
    });
    app.addHook('onRequest', async (request) => {
      const id = request.headers['x-test-user-id'];
      if (typeof id !== 'string') return;
      const user = await users.findById(id);
      if (user !== null) (request as unknown as { user: object }).user = { id: user.id, name: user.name, email: user.email };
    });
    await app.register(rbacPlugin, { meta: h.meta });
    await app.register(async (api) => api.register(consentRoutes({ meta: h.meta, manager: h.manager, service, tables })), { prefix: '/api/v1' });
    await app.ready();
  }, 180_000);

  afterAll(async () => {
    if (!available) return;
    await app.close();
    await h.close();
  });

  const as = (user: User) => ({ 'x-test-user-id': user.id });
  const row = (record: Record<string, unknown>) => ({ connectionId: h.connectionId, table: contactsId, recordId: String(record['id']) });
  const call = (user: User, method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown) => app.inject({ method, url: `/api/v1${url}`, headers: as(user), ...(payload === undefined ? {} : { payload: payload as object }) });
  const contact = async (record: Record<string, unknown>) => (await h.rows(`select * from ${h.real('contacts')} where id = ${String(record['id'])}`))[0]!;

  it.runIf(available)('refuses every route to a role without the grant', async () => {
    const { entry } = await service.stop.add({ address: 'held@shop.example', reason: 'hand' });
    const answers = [
      await call(stranger, 'GET', '/consent/stop-list'),
      await call(stranger, 'POST', '/consent/stop-list', { addresses: ['x@shop.example'] }),
      await call(stranger, 'DELETE', `/consent/stop-list/${entry.id}`),
      await call(stranger, 'POST', '/consent/panel', row(marta)),
      await call(stranger, 'POST', '/consent/record-consent', { ...row(marta), purpose: 'newsletter', how: 'phone', note: null }),
      await call(stranger, 'POST', '/consent/replied', row(marta)),
      await call(stranger, 'POST', '/consent/said-no', row(marta)),
      // The record's readers and changers hold no list grant; the list's holder may not take anyone off it.
      await call(clerk, 'GET', '/consent/stop-list'),
      await call(clerk, 'POST', '/consent/stop-list', { addresses: ['x@shop.example'] }),
      await call(marketer, 'DELETE', `/consent/stop-list/${entry.id}`),
      await call(reader, 'POST', '/consent/record-consent', { ...row(marta), purpose: 'newsletter', how: 'phone', note: null }),
      await call(reader, 'POST', '/consent/replied', row(marta)),
      await call(reader, 'POST', '/consent/said-no', row(marta)),
    ];
    expect(answers.map((answer) => answer.statusCode)).toEqual(Array(answers.length).fill(403));
    expect(await service.stop.has('x@shop.example')).toBe(false);
    expect(await service.stop.has('marta.kovac@cobaltlegal.example')).toBe(false);
    expect(await service.stop.has('held@shop.example')).toBe(true);
    expect((await service.history({ person: { connectionId: h.connectionId, table: contactsId, key: String(marta['id']) } })).length).toBe(0);
  });

  it.runIf(available)('lets the list\'s holder see and add to the do-not-email list, and only a Super Admin take one off', async () => {
    const added = await call(marketer, 'POST', '/consent/stop-list', { addresses: [' Paste@Shop.example', 'paste@shop.example', '', 'nope', 'second@shop.example'] });
    expect(added.statusCode, added.body).toBe(200);
    expect(added.json()).toEqual({ data: { added: 2, already: 0, invalid: ['nope'] } });
    const again = await call(marketer, 'POST', '/consent/stop-list', { addresses: ['PASTE@shop.example'] });
    expect(again.json()).toEqual({ data: { added: 0, already: 1, invalid: [] } });

    const listed = await call(marketer, 'GET', '/consent/stop-list?q=paste');
    expect(listed.statusCode, listed.body).toBe(200);
    const [entry] = (listed.json() as { data: { entries: { id: string; address: string; reason: string; addedBy: { label: string }; mayRemove: boolean }[] } }).data.entries;
    expect(entry).toMatchObject({ address: 'paste@shop.example', reason: 'hand', addedBy: { label: 'Mo Marketer' }, mayRemove: false });
    const ownerView = (await call(owner, 'GET', '/consent/stop-list?q=paste')).json() as { data: { entries: { mayRemove: boolean }[]; total: number } };
    expect(ownerView.data.entries[0]?.mayRemove).toBe(true);

    expect((await call(marketer, 'DELETE', `/consent/stop-list/${entry!.id}`)).statusCode).toBe(403);
    const removed = await call(owner, 'DELETE', `/consent/stop-list/${entry!.id}`);
    expect(removed.statusCode, removed.body).toBe(200);
    expect(await service.stop.has('paste@shop.example')).toBe(false);
    expect((await call(owner, 'DELETE', `/consent/stop-list/${entry!.id}`)).statusCode).toBe(404);

    // An erased person's entry stays.
    await service.stop.add({ address: 'erased@shop.example', reason: 'link' });
    await service.eraseDisplay('erased@shop.example');
    const erased = (await service.stop.list({ limit: 50 })).entries.find((one) => one.address === null)!;
    expect((await call(owner, 'DELETE', `/consent/stop-list/${erased.id}`)).statusCode).toBe(422);
    expect(await service.stop.has('erased@shop.example')).toBe(true);

    // Audited without the addresses.
    const entries = await auditRepo(h.meta).list({ limit: 50 });
    const actions = entries.filter((one) => one.action.startsWith('consent.stop-list')).map((one) => one.action);
    expect(actions).toEqual(expect.arrayContaining(['consent.stop-list.add', 'consent.stop-list.remove']));
    expect(JSON.stringify(entries.filter((one) => one.action.startsWith('consent.')))).not.toContain('shop.example');
  });

  it.runIf(available)('records consent and "Replied" as the clerk, and shows the panel to a reader', async () => {
    const recorded = await call(clerk, 'POST', '/consent/record-consent', { ...row(ben), purpose: 'newsletter', how: 'in-person', note: 'At the showroom' });
    expect(recorded.statusCode, recorded.body).toBe(200);
    expect(recorded.json()).toMatchObject({ data: { event: { purpose: 'newsletter', state: 'yes', source: 'staff', how: 'in-person', note: 'At the showroom', staff: { id: clerk.id, label: 'Tom Becker' } } } });
    // An unsubscribe that knew only Ben's address is his too.
    await service.withdraw({ address: 'BEN@okafor.example', purpose: 'surveys', source: 'unsubscribe', detail: 'link', ip: '81.2.69.160' });
    await service.stop.add({ address: 'ben@okafor.example', reason: 'link', origin: 'Spring newsletter' });
    const replied = await call(clerk, 'POST', '/consent/replied', row(ben));
    expect(replied.statusCode, replied.body).toBe(200);

    const panel = await call(reader, 'POST', '/consent/panel', row(ben));
    expect(panel.statusCode, panel.body).toBe(200);
    const data = (panel.json() as { data: Record<string, unknown> }).data;
    expect(data).toMatchObject({
      addressKnown: true,
      purposes: [
        { purpose: 'newsletter', state: 'yes', event: { source: 'staff', how: 'in-person' } },
        { purpose: 'surveys', state: 'no', event: { source: 'unsubscribe', ip: null } },
      ],
      stopped: { reason: 'link', origin: 'Spring newsletter' },
      mayChange: false,
    });
    expect(data['lastReplied']).toEqual(expect.any(Number));
    expect((data['history'] as { state: string }[]).map((event) => event.state)).toEqual(['replied', 'no', 'yes']);
    // The address is never sent back; a sign-up's network address only to one who reads personal columns.
    expect(JSON.stringify(data)).not.toContain('okafor.example');
    const ownerPanel = (await call(owner, 'POST', '/consent/panel', row(ben))).json() as { data: { purposes: { event: { ip: string | null } | null }[]; mayChange: boolean } };
    expect(ownerPanel.data.purposes[1]?.event?.ip).toBe('81.2.69.160');
    expect(ownerPanel.data.mayChange).toBe(true);

    expect((await call(reader, 'POST', '/consent/panel', { ...row(ben), recordId: '999999' })).statusCode).toBe(404);
    const audit = (await auditRepo(h.meta).list({ limit: 50 })).filter((one) => one.action === 'consent.record' || one.action === 'consent.replied');
    expect(audit.map((one) => one.actorId)).toEqual([clerk.id, clerk.id]);
  });

  it.runIf(available)('lets whoever may change the record put its address on the list, but not see or empty the list', async () => {
    const said = await call(clerk, 'POST', '/consent/said-no', row(marta));
    expect(said.statusCode, said.body).toBe(200);
    expect(said.json()).toMatchObject({ data: { added: true, stopped: { reason: 'hand', origin: null } } });
    expect(await service.stop.entryFor('MARTA.KOVAC@cobaltlegal.example')).toMatchObject({ reason: 'hand', addedBy: { id: clerk.id, label: 'Tom Becker' } });
    expect((await call(clerk, 'POST', '/consent/said-no', row(marta))).json()).toMatchObject({ data: { added: false } });
    expect(JSON.stringify(said.json())).not.toContain('cobaltlegal');
    // The clerk's panel shows it, and says they may change the record; the reader's says they may not.
    expect(((await call(clerk, 'POST', '/consent/panel', row(marta))).json() as { data: { stopped: unknown; mayChange: boolean } }).data).toMatchObject({ stopped: { reason: 'hand' }, mayChange: true });
    expect(((await call(reader, 'POST', '/consent/panel', row(marta))).json() as { data: { mayChange: boolean } }).data.mayChange).toBe(false);
    // The install-wide list and taking an address off it stay the e-mail screens' and the Super Admin's.
    const entry = (await service.stop.entryFor('marta.kovac@cobaltlegal.example'))!;
    expect((await call(clerk, 'GET', '/consent/stop-list')).statusCode).toBe(403);
    expect((await call(clerk, 'DELETE', `/consent/stop-list/${entry.id}`)).statusCode).toBe(403);
    expect(await service.stop.has('marta.kovac@cobaltlegal.example')).toBe(true);
    expect((await call(owner, 'DELETE', `/consent/stop-list/${entry.id}`)).statusCode).toBe(200);
  });

  it.runIf(available)('writes the column and its stamps from a staff event, and leaves "who" empty for a system one', async () => {
    const person = { connectionId: h.connectionId, table: contactsId, key: String(marta['id']) };
    const target = { ...person, column: 'may_email' };
    const at = Date.UTC(2026, 9, 20, 9, 30, 0);
    const staffYes = await service.record({ person, address: 'marta.kovac@cobaltlegal.example', purpose: 'newsletter', state: 'yes', source: 'staff', how: 'phone', staff: { id: clerk.id, label: 'Tom Becker' }, at });
    expect(await service.applyToColumn(target, staffYes)).toBe('written');
    let stored = await contact(marta);
    expect(yes(stored['may_email'])).toBe(true);
    expect(stored['may_email_by_id']).toBe(clerk.id);
    expect(new Date(stored['may_email_at'] as string).getTime()).toBe(at);
    // Already so: nothing written, the stamps untouched.
    expect(await service.applyToColumn(target, { ...staffYes, staffId: 'usr_other' })).toBe('unchanged');
    expect((await contact(marta))['may_email_by_id']).toBe(clerk.id);

    // An unsubscribe by the e-mail link: no, by nobody, at its own time.
    const later = at + 86_400_000;
    const unsubscribed = await service.withdraw({ person, address: 'marta.kovac@cobaltlegal.example', purpose: 'newsletter', source: 'unsubscribe', detail: 'link', at: later });
    expect(await service.applyToColumn(target, unsubscribed)).toBe('written');
    stored = await contact(marta);
    expect(yes(stored['may_email'])).toBe(false);
    expect(stored['may_email_by_id']).toBeNull();
    expect(new Date(stored['may_email_at'] as string).getTime()).toBe(later);

    // A review "confirm" names its staff member, as a staff event does.
    const reviewed = await service.record({ person, purpose: 'newsletter', state: 'yes', source: 'review', detail: 'before-records', staff: { id: owner.id, label: 'Mara Lind' }, at: later + 1_000 });
    expect(await service.applyToColumn(target, reviewed)).toBe('written');
    expect((await contact(marta))['may_email_by_id']).toBe(owner.id);

    // Audited as the staff member or the system, with the log's source.
    const audit = (await auditRepo(h.meta).list({ limit: 50 })).filter((one) => one.action === 'record.update' && String(one.entity?.pk['id']) === String(marta['id']));
    expect(audit.map((one) => [one.actorKind, (one.changes?.['after'] as Record<string, unknown>)['consentSource']])).toEqual([
      ['user', 'review'],
      ['system', 'unsubscribe'],
      ['user', 'staff'],
    ]);

    expect(await service.applyToColumn({ ...target, key: '999999' }, reviewed)).toBe('missing');
    await expect(service.applyToColumn({ ...target, column: 'name' }, reviewed)).rejects.toThrow(/not a yes\/no column/);
    await expect(service.applyToColumn({ ...target, column: 'nope' }, reviewed)).rejects.toThrow(/no column/);
    const replied = await service.markReplied({ person, staff: { id: clerk.id, label: 'Tom Becker' } });
    await expect(service.applyToColumn(target, replied)).rejects.toThrow(/replied/);
  });
});
