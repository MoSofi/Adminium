// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT A LEAD SOURCE ADD-ON'S PAGE IS TOLD OF THE COMPANIES TABLES.
 *
 * The kit's one read lists, for a lead source add-on, each table an app on
 * its database declares as companies (`via: 'companies'`): its label, the
 * columns a company's details go in (the `lead` word), and the generated
 * page of it the reader may open. Read only, nothing else. The owner's word
 * on the table changes the map; an add-on that speaks for no source is told
 * of no companies table.
 *
 * The app here declares no `lead` of its own: this server does not run that
 * word yet (an app using it is refused at install until it does), so the map
 * comes from the owner's word. The app's own word is read by the same
 * resolver (`people-declared-lead.test.ts`).
 *
 * On every engine this run can reach, through the real installer and the
 * whole server.
 */
import { overridesRepo, rolesRepo, snapshotsRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { leadFinder } from '../../../packages/manifest/test/lead-finder-fixture.js';
import { ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from './auth-helpers.js';
import { addOnHarness, addOnManifest, appManifest, type Harness } from './app-add-ons.helpers.js';
import { LEGS } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Host = { tableRef: string; id: string; label: string; via: string; lead?: Record<string, unknown>; page?: string };

const LEAD = { number: 'company_number', website: 'website', phone: 'phone', address: { lines: 'address_lines', town: 'town', country: 'country' }, activity: 'sector', about: 'about', owner: 'account_owner_id' };

/** A small app that keeps companies, with the three columns the lead word needs. */
const book = appManifest('book', {
  version: '0.2.0',
  compatibility: { minAdminiumVersion: '0.3.65', engines: ['postgres', 'mysql', 'sqlite'] },
  requiredSchema: {
    tables: [
      {
        ref: 'companies',
        keyField: 'name',
        columns: [
          { ref: 'id', type: 'int', role: 'pk' },
          { ref: 'name', type: 'text', maxLength: 160 },
          { ref: 'company_number', type: 'text', maxLength: 40, nullable: true },
          { ref: 'website', type: 'text', maxLength: 200, nullable: true },
          { ref: 'phone', type: 'text', maxLength: 40, nullable: true },
          { ref: 'address_lines', type: 'text', maxLength: 300, nullable: true },
          { ref: 'town', type: 'text', maxLength: 120, nullable: true },
          { ref: 'country', type: 'text', maxLength: 2, nullable: true },
          { ref: 'sector', type: 'text', maxLength: 80, nullable: true },
          { ref: 'about', type: 'text', maxLength: 1000, nullable: true },
          { ref: 'notes', type: 'text', maxLength: 1000, nullable: true },
          { ref: 'account_owner_id', type: 'text', maxLength: 64, nullable: true, rules: { staff: true } },
        ],
      },
    ],
  },
  people: [{ table: 'companies', kind: 'companies', name: 'name' }],
  pages: [{ ref: 'book-companies', template: 'page-crud', title: { key: 'mft.book.companies', fallback: 'Companies' }, nav: { group: 'manifest:sample', icon: 'building', order: 1 }, bindings: { main: 'companies' } }],
});

describe.each(LEGS)('the companies tables a lead source add-on is told of — %s', (dialect, available) => {
  let h: Harness;
  let served: Served;
  let cookie = '';
  let companies = '';

  const kit = async (key: string) => {
    const res = await served.composed.app.inject({ method: 'GET', url: `/api/v1/add-ons/${key}/kit`, headers: { cookie } });
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as { hosts: Host[] };
  };

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageApp(book);
    const installed = await h.install('book', '0.2.0');
    expect(installed.statusCode, installed.body).toBe(200);
    await h.stageAddOn(leadFinder(), { bundled: true, files: { 'dist/server.js': 'export function createLeadSource() { return { checkKey: async () => ({ ok: true }) }; }' } });
    const added = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'company-finder', version: '1.0.0', attachTo: [] } });
    expect(added.statusCode, added.body).toBe(200);
    // An add-on with tables of its own and no source: told of no companies table.
    await h.stageAddOn(addOnManifest('notebook', { compatibility: { minAdminiumVersion: '0.3.18', requires: [] }, requiredSchema: { prefixed: true, tables: [{ ref: 'notes', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'body', type: 'text', nullable: true }] }] } }));
    const plain = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'notebook', version: '1.0.0', attachTo: [] } });
    expect(plain.statusCode, plain.body).toBe(200);
    const model = (await snapshotsRepo(h.meta).latest(h.connectionId))!.schema as { tables: { id: string; name: string }[] };
    companies = model.tables.find((table) => table.name.endsWith('companies'))!.id;
    served = await servePublic(h as never, null, { ADMINIUM_DATA_DIR: h.dataDir });
    const user = await usersRepo(h.meta).create({ email: 'boss@book.example', name: 'boss', passwordHash: await adminPasswordHash() });
    await rolesRepo(h.meta).assignToUser(user.id, (await rolesRepo(h.meta).findBySlug('super-admin'))!.id);
    const login = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: '10.3.0.1', payload: { email: 'boss@book.example', password: ADMIN_PASSWORD } });
    cookie = sessionCookie(login.headers['set-cookie']);
  }, 240_000);
  afterAll(async () => {
    if (!available) return;
    await served?.close();
    await h?.close();
  });

  it.skipIf(!available)('lists a declared companies table with its label, its page and an empty map, and nothing else', async () => {
    const hosts = (await kit('company-finder')).hosts.filter((host) => host.via === 'companies');
    expect(hosts).toHaveLength(1);
    expect(hosts[0]).toEqual({ tableRef: expect.any(String), id: companies, label: expect.any(String), via: 'companies', lead: {}, page: 'book-companies' });
    expect((await kit('notebook')).hosts.filter((host) => host.via === 'companies')).toEqual([]);
  });

  it.skipIf(!available)("sets the map with the owner's word on the table, and changes it with a later word", async () => {
    await overridesRepo(h.meta).create({ connectionId: h.connectionId, op: 'table.people', tableName: companies, columnName: null, value: { lead: LEAD } });
    // The kit's read of the declarations is kept half a minute per snapshot: a new one, as an override makes in the server, reads it again.
    await h.introspect();
    expect((await kit('company-finder')).hosts.find((one) => one.via === 'companies')?.lead).toEqual(LEAD);
    await overridesRepo(h.meta).create({ connectionId: h.connectionId, op: 'table.people', tableName: companies, columnName: null, value: { lead: { about: 'notes', address: { country: 'notes' } } } });
    await h.introspect();
    // The about column moves; a country column that is not two wide is not taken.
    expect((await kit('company-finder')).hosts.find((one) => one.via === 'companies')?.lead).toEqual({ ...LEAD, about: 'notes' });
  });
});
