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
import type { Manifest } from '@adminium/manifest';

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

  it('writes nothing for an add-on manifest', async () => {
    const result = await materialiseManifestPages({
      meta,
      manifest: { kind: 'add-on', key: 'x', version: '1.0.0' } as unknown as Manifest,
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
});
