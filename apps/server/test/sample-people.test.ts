// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SAMPLE PEOPLE.
 *
 * An app's sample data may bring its own people and teams
 * (`sampleData.people`, `.teams`): "Add sample data" makes each a staff
 * member who cannot sign in, with one of the app's roles; the sample's rows
 * name them by key (`{"@person": "dana"}`, also inside a json value); and
 * "Remove sample data" takes them away — but for one a row that stays still
 * names.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { rolesRepo, teamsRepo, usersRepo } from '@adminium/meta';

import { createAppStore } from '../src/apps/store.js';
import { createSampleDataService, findSampleApp } from '../src/apps/sample-data.js';
import type { FileStore } from '../src/files/store.js';
import { LEGS, installInvoicing, invoicingManifest, type InvoicingHarness } from './invoicing-install.helpers.js';

const memoryFiles = {
  write: async () => ({ storageKey: 'x', sizeBytes: 0, sha256: '', destinationId: null, storage: 'memory' }),
} as unknown as FileStore;

const id = { ref: 'id', type: 'int', role: 'pk' };
const TABLES = [
  {
    ref: 'deals',
    belongs: [{ column: 'owner_id', set: 'team' }],
    indexes: [['owner_id']],
    columns: [id, { ref: 'name', type: 'text', maxLength: 80 }, { ref: 'owner_id', type: 'text', maxLength: 36, nullable: true, rules: { staff: true } }, { ref: 'made_by', type: 'text', maxLength: 36, nullable: true }],
  },
  { ref: 'views', columns: [id, { ref: 'name', type: 'text', maxLength: 80 }, { ref: 'filters', type: 'json' }] },
];

const manifest = (): Record<string, unknown> => ({
  ...invoicingManifest(TABLES),
  compatibility: { minAdminiumVersion: '0.3.27' },
  pages: [{ ref: 'studio-deals', template: 'page-crud', title: { key: 't', fallback: 'Deals' }, nav: { group: 'library', icon: 'list', order: 1 }, bindings: { rows: 'deals' } }],
  roles: [
    { key: 'rep', name: 'Rep', permissions: ['table:@deals:read', 'page:@studio-deals:view'], limits: { deals: { rows: { read: { reach: 'own' } } } } },
    { key: 'manager', name: 'Manager', permissions: ['table:@deals:read', 'page:@studio-deals:view'], limits: { deals: { rows: { read: { reach: 'team' } } } } },
  ],
  sampleData: {
    file: 'seeds/studio.sample.json',
    people: [
      { key: 'dana', name: 'Dana Whitlock', email: 'dana@meridian.example', role: 'rep' },
      { key: 'sam', name: 'Sam Okonjo', email: 'sam@meridian.example', role: 'rep' },
      { key: 'ivy', name: 'Ivy Sandoval', role: 'manager' },
    ],
    teams: [{ name: 'Sales', lead: 'ivy', members: ['dana', 'sam'] }],
  },
});

const BUNDLE = {
  format: 'adminium.sample/1',
  app: 'studio',
  tables: [
    {
      ref: 'deals',
      rows: [
        { name: 'Desk rows', owner_id: { '@person': 'dana' }, made_by: { '@person': 'ivy' } },
        { name: 'Showroom refit', owner_id: { '@person': 'sam' } },
        { name: 'Nobody yet' },
      ],
    },
    { ref: 'views', rows: [{ name: "Sam's board", filters: { rep: { '@person': 'sam' }, any: [{ '@person': 'dana' }, 'open'], over: 20000 } }] },
  ],
};

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`sample people on ${dialect}`, () => {
    const harnesses: InvoicingHarness[] = [];
    const install = async (bundle: unknown = BUNDLE, before?: (h: InvoicingHarness) => Promise<void>) => {
      const h = await installInvoicing(dialect, manifest(), undefined, { 'seeds/studio.sample.json': JSON.stringify(bundle) });
      harnesses.push(h);
      await before?.(h);
      const service = createSampleDataService({ meta: h.meta, manager: h.manager, store: createAppStore({ dataDir: h.dataDir }), files: memoryFiles });
      const app = (await findSampleApp(h.meta, 'studio'))!;
      const add = () => service.add(app, { locale: 'en-US', userId: null, userLabel: 'test', now: Date.now() });
      const remove = () => service.remove(app, { keepChanged: true, userId: null, userLabel: 'test' });
      const sample = async () => (await usersRepo(h.meta).list({ status: 'sample', limit: 50 })).sort((a, b) => a.name.localeCompare(b.name));
      const byName = async (name: string) => (await sample()).find((user) => user.name === name);
      return { h, add, remove, sample, byName };
    };
    afterAll(async () => {
      for (const h of harnesses) await h.close();
    });

    describe('added', () => {
      let s: Awaited<ReturnType<typeof install>>;
      beforeAll(async () => {
        s = await install();
        await s.add();
      }, 240_000);

      it('makes each a staff member who cannot sign in, with the app\'s role', async () => {
        const people = await s.sample();
        expect(people.map((user) => [user.name, user.email, user.status, user.passwordHash])).toEqual([
          ['Dana Whitlock', 'dana@meridian.example', 'sample', null],
          ['Ivy Sandoval', 'ivy.studio@sample.invalid', 'sample', null],
          ['Sam Okonjo', 'sam@meridian.example', 'sample', null],
        ]);
        const roles = rolesRepo(s.h.meta);
        expect((await roles.rolesForUser(people[0]!.id)).map((role) => role.slug)).toEqual(['studio-rep']);
        expect((await roles.rolesForUser(people[1]!.id)).map((role) => role.slug)).toEqual(['studio-manager']);
        expect((await usersRepo(s.h.meta).countByStatus()).sample).toBe(3);
      });

      it('makes the team, with its lead', async () => {
        const teams = teamsRepo(s.h.meta);
        const team = (await teams.findByName('Sales'))!;
        const ivy = (await s.byName('Ivy Sandoval'))!;
        const members = await teams.members(team.id);
        expect(members.length).toBe(3);
        expect(members.filter((member) => member.lead).map((member) => member.userId)).toEqual([ivy.id]);
        // The lead reaches the two reps' rows: what "their team's rows" is read from.
        expect((await teams.leadReach(ivy.id)).ids.length).toBe(2);
      });

      it('fills the rows that name a person, in a column and inside a json value', async () => {
        const dana = (await s.byName('Dana Whitlock'))!.id;
        const sam = (await s.byName('Sam Okonjo'))!.id;
        const ivy = (await s.byName('Ivy Sandoval'))!.id;
        const deals = await s.h.rows(`SELECT name, owner_id, made_by FROM ${s.h.real('deals')} ORDER BY id`);
        expect(deals).toEqual([
          { name: 'Desk rows', owner_id: dana, made_by: ivy },
          { name: 'Showroom refit', owner_id: sam, made_by: null },
          { name: 'Nobody yet', owner_id: null, made_by: null },
        ]);
        const [view] = await s.h.rows(`SELECT filters FROM ${s.h.real('views')}`);
        const filters = typeof view!['filters'] === 'string' ? JSON.parse(view!['filters'] as string) : view!['filters'];
        expect(filters).toEqual({ rep: sam, any: [dana, 'open'], over: 20000 });
      });

      it('takes them all away with the sample', async () => {
        const done = await s.remove();
        expect(done.removed).toBe(4);
        expect(await s.sample()).toEqual([]);
        expect(await teamsRepo(s.h.meta).findByName('Sales')).toBeNull();
        expect(await s.h.rows(`SELECT COUNT(*) AS n FROM ${s.h.real('deals')}`)).toEqual([{ n: expect.anything() }]);
        // Added again: the same three, made anew.
        await s.add();
        expect((await s.sample()).length).toBe(3);
      });
    });

    it('leaves a real person\'s address and a real team\'s name alone', async () => {
      const s = await install(BUNDLE, async (h) => {
        await usersRepo(h.meta).create({ email: 'dana@meridian.example', name: 'The real Dana', passwordHash: 'x', status: 'active' });
        await teamsRepo(h.meta).create('Sales');
      });
      await s.add();
      expect((await s.byName('Dana Whitlock'))!.email).toBe('dana.studio@sample.invalid');
      expect((await usersRepo(s.h.meta).findByEmail('dana@meridian.example'))!.status).toBe('active');
      const teams = teamsRepo(s.h.meta);
      expect(await teams.members((await teams.findByName('Sales'))!.id)).toEqual([]);
      expect((await teams.members((await teams.findByName('Sales (sample)'))!.id)).length).toBe(3);
      await s.remove();
      // The operator's own team and person are still there; the sample's are not.
      expect(await teams.findByName('Sales (sample)')).toBeNull();
      expect(await teams.findByName('Sales')).not.toBeNull();
      expect((await usersRepo(s.h.meta).findByEmail('dana@meridian.example'))!.name).toBe('The real Dana');
    }, 240_000);

    it('keeps a person a row of the operator\'s own still names, and takes them back on the next add', async () => {
      const s = await install();
      await s.add();
      const dana = (await s.byName('Dana Whitlock'))!.id;
      // The operator made a deal of their own and gave it to the sample rep.
      await s.h.rows(`INSERT INTO ${s.h.real('deals')} (name, owner_id) VALUES ('Our own deal', '${dana}')`);
      await s.remove();
      expect((await s.sample()).map((user) => user.name)).toEqual(['Dana Whitlock']);
      // Her team stays while she is in it.
      const teams = teamsRepo(s.h.meta);
      expect((await teams.members((await teams.findByName('Sales'))!.id)).map((member) => member.userId)).toEqual([dana]);
      await s.add();
      const again = await s.sample();
      expect(again.length).toBe(3);
      expect(again.find((user) => user.name === 'Dana Whitlock')!.id).toBe(dana);
      expect((await teams.members((await teams.findByName('Sales'))!.id)).length).toBe(3);
      expect(await teams.findByName('Sales (sample)')).toBeNull();
    }, 240_000);

    it('makes nobody when the rows cannot go in', async () => {
      // A row with no name: refused by the table, and the whole add with it.
      const s = await install({ ...BUNDLE, tables: [{ ref: 'deals', rows: [{ owner_id: { '@person': 'dana' } }] }] });
      await expect(s.add()).rejects.toThrow();
      expect(await s.sample()).toEqual([]);
      expect(await teamsRepo(s.h.meta).findByName('Sales')).toBeNull();
    }, 240_000);
  });
}
