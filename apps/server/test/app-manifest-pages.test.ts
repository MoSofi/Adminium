// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app's declared pages, written on install and kept honest on update.
 *
 * What is on trial: a bound calendar is COMPOSED from the app's real table
 * (not stored empty), an unbound page is created empty and reported rather
 * than refusing the install, a slug someone else owns is never overwritten,
 * and an update rebuilds only the pages nobody edited.
 */
import BetterSqlite3 from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  connectionsRepo,
  createSqliteMetaDb,
  firstRun,
  pagesRepo,
  permissionsRepo,
  rolesRepo,
  snapshotsRepo,
  type MetaDb,
} from '@adminium/meta';
import { pageLayoutSchema } from '@adminium/engine/config';
import type { Manifest } from '@adminium/manifest';

import { layoutQueryProblems } from '../src/apps/manifest-page-config.js';
import { materialiseManifestPages } from '../src/apps/manifest-pages.js';
import { isUntouched } from '../src/pages/generated-stamp.js';
import { bcp47, pickLabel } from '../src/i18n/bcp47.js';
import { navTitleOf } from '../src/routes/bootstrap/handlers.js';

const CRYPTO = { encrypt: (v: string) => v, decrypt: (v: string) => v };

/** What the real schema target leaves behind after creating the app's tables. */
const SNAPSHOT = {
  dialect: 'sqlite',
  name: 'clinic',
  defaultSchema: 'main',
  schemas: ['main'],
  tables: [
    {
      schema: 'main',
      name: 'visits',
      columns: [
        { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
        { name: 'reason', logicalType: 'text' },
        { name: 'starts_at', logicalType: 'timestamp' },
      ],
      primaryKey: ['id'],
    },
    {
      schema: 'main',
      name: 'visit_notes',
      columns: [
        { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
        { name: 'visit_id', logicalType: 'integer', nullable: false },
        { name: 'body', logicalType: 'text' },
      ],
      primaryKey: ['id'],
    },
  ],
  relations: [
    {
      id: 'fk_visit_notes_visits',
      kind: 'declared-fk',
      cardinality: 'one-to-many',
      from: { tableId: 'main.visit_notes', columns: ['visit_id'] },
      to: { tableId: 'main.visits', columns: ['id'] },
    },
  ],
  enums: [],
};

function manifest(pages: Record<string, unknown>[]): Manifest {
  return {
    kind: 'app',
    key: 'clinic',
    version: '1.0.0',
    pages: pages.map((page) => ({
      title: { key: `mft.clinic.${String(page['ref'])}`, fallback: String(page['ref']) },
      nav: { group: 'manifest:clinic', icon: 'calendar', order: 1 },
      ...page,
    })),
  } as unknown as Manifest;
}

let meta: MetaDb;
let connectionId: string;

beforeEach(async () => {
  meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  connectionId = (
    await connectionsRepo(meta, CRYPTO).create({
      name: 'Clinic',
      engine: 'sqlite',
      introspectDsn: 'sqlite::memory:',
      dataDsn: 'sqlite::memory:',
    })
  ).id;
  await snapshotsRepo(meta).create({
    connectionId,
    source: 'introspection',
    schema: SNAPSHOT,
    checksum: 'sha-1',
  });
});

const write = (m: Manifest, manifestRowId = 'mfst_1') =>
  materialiseManifestPages({ meta, manifest: m, manifestRowId, connectionId, createdBy: null });

describe('materialiseManifestPages', () => {
  it('composes a bound calendar from the real table, and files it in the app’s own section', async () => {
    const result = await write(
      manifest([{ ref: 'clinic-day', template: 'page-calendar', bindings: { rows: 'visits' } }]),
    );
    expect(result.created).toEqual(['clinic-day']);
    expect(result.warnings).toEqual([]);

    const page = await pagesRepo(meta).findBySlug(connectionId, 'clinic-day');
    expect(page?.origin).toBe('manifest');
    expect(page?.manifestId).toBe('mfst_1');
    // The app's section; the group the manifest named, within it.
    expect(page?.navGroup).toBe('app');
    const config = page?.config as {
      source: { table: string };
      nav: { group: string };
      title: { fallback: string };
      config: { layout: { items: { widget: string }[] }; generatedHash: string };
    };
    expect(config.nav.group).toBe('manifest:clinic');
    expect(config.source.table).toBe('main.visits');
    expect(config.title.fallback).toBe('clinic-day');
    expect(config.config.layout.items.map((item) => item.widget)).toContain('calendar-month');
    expect(typeof config.config.generatedHash).toBe('string');
  });

  it('creates an unbound page empty and says so, rather than refusing', async () => {
    const result = await write(manifest([{ ref: 'clinic-list', template: 'page-crud' }]));
    expect(result.created).toEqual(['clinic-list']);
    expect(result.warnings.map((w) => w.reason)).toEqual(['PAGE_UNBOUND']);
  });

  it('reports a table that cannot back its template, and an unknown template', async () => {
    const result = await write(
      manifest([
        { ref: 'clinic-board', template: 'page-board', bindings: { rows: 'visits' } },
        { ref: 'clinic-legacy', template: 'table', bindings: { visits: 'visits' } },
      ]),
    );
    expect(result.warnings.map((w) => [w.page, w.reason])).toEqual([
      ['clinic-board', 'PAGE_UNFIT'],
      ['clinic-legacy', 'PAGE_TEMPLATE_UNKNOWN'],
    ]);
    // The unfit one still exists, empty; the unknown one is not built at all.
    expect(result.created).toEqual(['clinic-board']);
  });

  it('never overwrites a page somebody else owns at the same address', async () => {
    await pagesRepo(meta).create({
      connectionId,
      slug: 'clinic-day',
      type: 'page-crud',
      title: 'Mine',
      config: {},
      origin: 'user',
    });
    const result = await write(
      manifest([{ ref: 'clinic-day', template: 'page-calendar', bindings: { rows: 'visits' } }]),
    );
    expect(result.warnings.map((w) => w.reason)).toContain('PAGE_SLUG_TAKEN');
    expect((await pagesRepo(meta).findBySlug(connectionId, 'clinic-day'))?.title).toBe('Mine');
  });

  it('on update, rebuilds an untouched page and keeps an edited one', async () => {
    const pages = manifest([
      { ref: 'clinic-day', template: 'page-calendar', bindings: { rows: 'visits' } },
      { ref: 'clinic-list', template: 'page-crud', bindings: { rows: 'visits' } },
    ]);
    await write(pages);

    // An operator edits the list page.
    const list = await pagesRepo(meta).findBySlug(connectionId, 'clinic-list');
    const edited = structuredClone(list?.config) as { config: { columns: unknown[] } };
    edited.config.columns = edited.config.columns.slice(0, 1);
    await pagesRepo(meta).replaceConfig(list?.id as string, edited);

    // A re-install replaced the app's row: pages follow the new one.
    const again = await write(pages, 'mfst_2');
    expect(again.recomposed).toEqual(['clinic-day']);
    expect(again.kept).toEqual(['clinic-list']);
    expect(again.created).toEqual([]);
    expect((await pagesRepo(meta).findBySlug(connectionId, 'clinic-list'))?.manifestId).toBe('mfst_2');
    const kept = (await pagesRepo(meta).findBySlug(connectionId, 'clinic-list'))?.config as {
      config: { columns: unknown[] };
    };
    expect(kept.config.columns).toHaveLength(1);
  });

  it('writes nothing for an add-on that declares no pages, rules or tables of its own', async () => {
    const result = await materialiseManifestPages({
      meta,
      // As every add-on released before the install floor: a block of its own, and none of an app's.
      manifest: { kind: 'add-on', key: 'x', version: '1.0.0', addOn: { attaches: [{ app: '*' }], connect: { kind: 'none' } } } as unknown as Manifest,
      manifestRowId: 'mfst_1',
      connectionId,
      createdBy: null,
    });
    expect(result).toEqual({ created: [], recomposed: [], kept: [], warnings: [] });
  });
});

describe('manifest pages: grants, titles, no takeover', () => {
  it('gives a new app page the audience its sibling pages have', async () => {
    const pages = pagesRepo(meta);
    await pages.create({
      id: 'page_sibling',
      connectionId,
      slug: 'hand-made',
      type: 'page-crud',
      title: 'Hand made',
      navGroup: 'library',
      navOrder: 1,
      config: {},
      origin: 'user',
    } as never);
    const role = await rolesRepo(meta).create({ slug: 'front-desk', name: 'Front desk' });
    await permissionsRepo(meta).grant(role.id, 'page', 'page_sibling', { view: true, edit: false });

    await write(manifest([{ ref: 'clinic-list', template: 'page-crud' }]));
    const page = await pages.findBySlug(connectionId, 'clinic-list');
    const grants = await permissionsRepo(meta).listForResource('page', page!.id);
    expect(grants.map((g) => [g.roleId, g.actions])).toEqual([[role.id, { view: true, edit: false }]]);
  });

  it("keeps the manifest's title key, its translations and the app it belongs to", async () => {
    await write(manifest([{ ref: 'clinic-list', template: 'page-crud', titles: { 'de-DE': 'Besuche' } }]));
    const page = await pagesRepo(meta).findBySlug(connectionId, 'clinic-list');
    expect(page?.config).toMatchObject({
      app: 'clinic',
      title: { key: 'mft.clinic.clinic-list', fallback: 'clinic-list', from: 'clinic-list', titles: { 'de-DE': 'Besuche' } },
    });
    const [row] = (await pagesRepo(meta).navRows()).filter((r) => r.slug === 'clinic-list');
    expect(navTitleOf(row!, 'de_DE')).toBe('Besuche');
    expect(navTitleOf(row!, 'de-AT')).toBe('Besuche');
    expect(navTitleOf(row!, 'fr_FR')).toBe('clinic-list');
    // The operator renamed it: theirs wins in every language.
    expect(navTitleOf({ ...row!, title: 'Our visits' }, 'de_DE')).toBe('Our visits');
  });

  it("never takes over another app's page, and rebuilds its own after a reinstall", async () => {
    const pages = pagesRepo(meta);
    await write(manifest([{ ref: 'payments', template: 'page-crud' }]), 'mfst_clinic');
    const other = { ...manifest([{ ref: 'payments', template: 'page-crud' }]), key: 'hotel' } as Manifest;
    // The installing row exists; the first app's row is live in the meta store.
    await meta.db
      .insertInto('adminium_manifests')
      .values({
        id: 'mfst_clinic',
        manifestKey: 'clinic',
        version: '1.0.0',
        source: 'file',
        manifest: '{}',
        licenseKeyEncrypted: null,
        connectionId,
        status: 'installed',
        kind: 'app',
        packageIntegrity: null,
        packageFileId: null,
        installedBy: null,
        installedAt: 0,
        updatedAt: 0,
      } as never)
      .execute();

    const result = await write(other, 'mfst_hotel');
    expect(result.warnings.map((w) => w.reason)).toEqual(['PAGE_SLUG_TAKEN']);
    expect((await pages.findBySlug(connectionId, 'payments'))?.manifestId).toBe('mfst_clinic');

    // The clinic is uninstalled (its row goes) and installed again: its orphan
    // page is recognised by the app key it carries, and rebuilt.
    await meta.db.deleteFrom('adminium_manifests').where('id', '=', 'mfst_clinic').execute();
    const again = await write(manifest([{ ref: 'payments', template: 'page-crud' }]), 'mfst_clinic_2');
    expect(again.warnings.map((w) => w.reason)).not.toContain('PAGE_SLUG_TAKEN');
    expect(again.recomposed).toEqual(['payments']);
    expect((await pages.findBySlug(connectionId, 'payments'))?.manifestId).toBe('mfst_clinic_2');
  });
});

describe('bcp47 and pickLabel', () => {
  it('reads either spelling and falls back through the language to US English', () => {
    expect(bcp47('de_DE')).toBe('de-DE');
    expect(pickLabel({ 'en-US': 'Till', 'de-DE': 'Kasse' }, 'de_DE')).toBe('Kasse');
    expect(pickLabel({ 'en-US': 'Till', 'de-DE': 'Kasse' }, 'de_CH')).toBe('Kasse');
    expect(pickLabel({ 'en-US': 'Till', 'de-DE': 'Kasse' }, 'fr_FR')).toBe('Till');
  });
});

describe('a page’s own form and layout', () => {
  const form = (relation: string) => ({
    v: 2,
    sections: [
      {
        id: 'visit',
        fields: [{ column: 'reason', label: 'Why' }, { relation, control: 'child-rows', columns: [{ column: 'body' }] }],
      },
    ],
  });

  it('binds a form’s relation to the real one, under the stamp', async () => {
    const result = await write(
      manifest([{ ref: 'clinic-visits', template: 'page-crud', bindings: { rows: 'visits' }, config: { form: form('visit_notes') } }]),
    );
    expect(result.warnings).toEqual([]);
    const page = await pagesRepo(meta).findBySlug(connectionId, 'clinic-visits');
    const config = (page?.config as { config: { form: { sections: { fields: Record<string, unknown>[] }[] }; generatedHash: string } }).config;
    expect(config.form.sections[0]!.fields).toEqual([
      { column: 'reason', label: 'Why' },
      { relation: 'fk_visit_notes_visits', control: 'child-rows', columns: [{ column: 'body' }] },
    ]);
    // The form is the app's, so an untouched page can still be rebuilt.
    expect(isUntouched(page?.config)).toBe(true);
  });

  it('keeps the page, without the form, when a relation leads nowhere', async () => {
    const result = await write(
      manifest([{ ref: 'clinic-visits', template: 'page-crud', bindings: { rows: 'visits' }, config: { form: form('invoices') } }]),
    );
    expect(result.created).toEqual(['clinic-visits']);
    expect(result.warnings.map((w) => [w.reason, w.message])).toEqual([
      ['PAGE_FORM_INVALID', 'nothing links "visits" to "invoices", so it has the form Adminium makes'],
    ]);
    const page = await pagesRepo(meta).findBySlug(connectionId, 'clinic-visits');
    expect((page?.config as { config: { form?: unknown } }).config.form).toBeUndefined();
  });

  it('draws the Overview’s own layout, bound to the connection and the real table', async () => {
    const layout = {
      version: 1,
      items: [{ i: 'visits-today', widget: 'kpi-stat', x: 0, y: 0, w: 3, h: 2, config: { query: { source: { name: 'visits' }, shape: 'scalar' } } }],
    };
    const result = await write(manifest([{ ref: 'clinic-overview', template: 'page-dashboard', config: { layout } }]));
    expect(result.warnings).toEqual([]);
    const page = await pagesRepo(meta).findBySlug(connectionId, 'clinic-overview');
    const stored = (page?.config as { config: { layout: typeof layout } }).config.layout;
    expect(stored.items.map((item) => item.config.query)).toEqual([
      { connectionId, source: { name: 'visits' }, shape: 'scalar' },
    ]);
  });

  it('binds the limited table a list\'s counts name, as it binds the list\'s own', async () => {
    const layout = {
      version: 1,
      items: [
        {
          i: 'coming',
          widget: 'mini-table',
          x: 0,
          y: 0,
          w: 6,
          h: 4,
          config: { binding: { source: { name: 'visits' }, shape: 'record-list', select: ['id'], counts: { table: 'visit_notes', as: 'sold' } } },
        },
      ],
    };
    const result = await write(manifest([{ ref: 'clinic-overview', template: 'page-dashboard', config: { layout } }]));
    expect(result.warnings).toEqual([]);
    const page = await pagesRepo(meta).findBySlug(connectionId, 'clinic-overview');
    const stored = (page?.config as { config: { layout: { items: { config: { binding: Record<string, unknown> } }[] } } }).config.layout;
    expect(stored.items[0]!.config.binding['counts']).toEqual({ table: 'visit_notes', as: 'sold' });
    // A table the connection has not got: the layout is not drawn.
    const missing = structuredClone(layout);
    (missing.items[0]!.config.binding as { counts: { table: string } }).counts.table = 'tickets';
    const refused = await write(manifest([{ ref: 'clinic-overview-2', template: 'page-dashboard', config: { layout: missing } }]));
    expect(refused.warnings.map((w) => w.message).join(' ')).toContain('"tickets" is not a table of this connection');
  });
});

describe('what a layout\'s cards ask for, judged when the install is planned', () => {
  const card = (query: Record<string, unknown>) => ({ version: 1, items: [{ i: 'a', widget: 'mini-table', x: 0, y: 0, w: 3, h: 2, config: { binding: { source: { name: 'rooms' }, shape: 'record-list', ...query } } }] });
  // The app declares `rooms`: a date, a time and a text column.
  const app = {
    kind: 'app',
    requiredSchema: {
      tables: [
        {
          ref: 'rooms',
          columns: [
            { ref: 'id', type: 'int', role: 'pk' },
            { ref: 'to_date', type: 'date' },
            { ref: 'made_at', type: 'timestamptz' },
            { ref: 'reason', type: 'text' },
          ],
        },
      ],
    },
  } as unknown as Manifest;
  const problems = (query: Record<string, unknown>) => layoutQueryProblems(pageLayoutSchema.parse(card(query)), app);

  it('passes what a card can read, and every query it read before', () => {
    expect(problems({ filters: [{ column: 'active', op: 'eq', value: true }, { or: [{ column: 'to_date', op: 'gte', day: 'today' }, { column: 'to_date', op: 'is_null' }] }] })).toEqual([]);
    expect(problems({ counts: { table: 'stays' } })).toEqual([]);
    expect(problems({ filters: [{ column: 'active', op: 'eq', value: true, stray: 1 }], anything: 'else' })).toEqual([]);
    expect(problems({ shape: 'single-metric', kind: 'capacity-counts', capacity: { metric: 'occupancy' } })).toEqual([]);
  });

  it.each([
    ['seventeen conditions over groups', { filters: [{ or: Array.from({ length: 9 }, () => ({ column: 'reason', op: 'eq', value: 'x' })) }, { and: Array.from({ length: 8 }, () => ({ column: 'reason', op: 'eq', value: 'x' })) }] }, 'Filters are limited to 16 conditions'],
    ['a day ten thousand days on', { filters: [{ column: 'to_date', op: 'gte', day: 'today+9999' }] }, '"today+9999" is not a day'],
    ['a day that is not one', { filters: [{ column: 'to_date', op: 'eq', day: '2026-02-30' }] }, '"2026-02-30" is not a day'],
    ['a day and a value', { filters: [{ column: 'to_date', op: 'gte', day: 'today', value: '2026-01-01' }] }, 'not both'],
    ['a day with in', { filters: [{ column: 'to_date', op: 'in', day: 'today' }] }, 'not "in"'],
    ['a day on text', { filters: [{ column: 'reason', op: 'eq', day: 'today' }] }, 'keeps neither a date nor a time'],
    ['neq with a day on a time', { filters: [{ column: 'made_at', op: 'neq', day: 'today' }] }, '"neq" takes a date column only'],
  ])('refuses what every read refuses: %s', (_label, query, words) => {
    const found = problems(query);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain(words);
  });

  it('passes a day on the app\'s date and time columns, and neq on a date', () => {
    expect(problems({ filters: [{ column: 'made_at', op: 'eq', day: 'today-1' }, { column: 'to_date', op: 'neq', day: '2026-07-28' }] })).toEqual([]);
  });

  it('refuses a group, a day, counts or a figure no card can read', () => {
    const shapeless = ['the card over "rooms" has filters no card can read: they are not ones a card can read'];
    expect(problems({ filters: [{ or: [{ and: [{ or: [{ column: 'a', op: 'eq', value: 1 }] }] }] }] })).toEqual(shapeless);
    expect(problems({ filters: [{ column: 'to_date', op: 'gte', day: 'tomorrow' }] })).toEqual(shapeless);
    expect(problems({ counts: { table: 'stays', as: '1st' } })).toEqual(['the card over "rooms" asks for counts that are not ones a card can read']);
    expect(problems({ shape: 'categorical', counts: { table: 'stays' } })).toEqual(['the card over "rooms" asks for counts beside something other than a list']);
    expect(problems({ kind: 'capacity-counts', shape: 'single-metric', capacity: { metric: 'revenue' } })).toEqual(['the card over "rooms" asks for a figure that is not one']);
  });
});
