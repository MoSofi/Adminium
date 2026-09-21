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
  snapshotsRepo,
  type MetaDb,
} from '@adminium/meta';
import type { Manifest } from '@adminium/manifest';

import { materialiseManifestPages } from '../src/apps/manifest-pages.js';

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
  ],
  relations: [],
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
  it('composes a bound calendar from the real table, and files it where the sidebar shows it', async () => {
    const result = await write(
      manifest([{ ref: 'clinic-day', template: 'page-calendar', bindings: { rows: 'visits' } }]),
    );
    expect(result.created).toEqual(['clinic-day']);
    expect(result.warnings).toEqual([]);

    const page = await pagesRepo(meta).findBySlug(connectionId, 'clinic-day');
    expect(page?.origin).toBe('manifest');
    expect(page?.manifestId).toBe('mfst_1');
    // `manifest:clinic` is not a sidebar group; a calendar goes to Planning.
    expect(page?.navGroup).toBe('planning');
    const config = page?.config as {
      source: { table: string };
      title: { fallback: string };
      config: { layout: { items: { widget: string }[] }; generatedHash: string };
    };
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
    expect(result.warnings.map((w) => w.reason)).toEqual(['PAGE_SLUG_TAKEN']);
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
