// SPDX-License-Identifier: AGPL-3.0-only
/**
 * LIVE COLUMN FACTS ON `GET /api/v1/pages/:pageId`.
 *
 * The stored `config.columns[]` is the table as it was the day the page was
 * generated, capped at eight, and regeneration will not touch a page anybody
 * has edited. So the create dialog reads these instead: every non-secret
 * column of the source table, in the table's own order, with who fills it in
 * and whether the dialog has to ask.
 *
 * The page here is deliberately generated with a SHORT column list and a
 * column that no longer matches the table — the block has to answer for the
 * database, not for the document.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { pagesRepo, permissionsRepo, rolesRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { pagesRoutes } from '../src/routes/pages/index.js';
import {
  asUser,
  buildDataTestApp,
  createConnectionViaApi,
  introspectViaApi,
  type DataTestContext,
} from './connections-helpers.js';

interface ColumnFact {
  spec: { name: string; logicalType: string; fk?: { table: string; display?: string } };
  ordinal: number;
  writable: boolean;
  filledBy: 'database' | 'adminium' | null;
  fill?: { kind: string; onUpdate?: boolean; implicit?: boolean };
  required: boolean;
}

interface PageReply {
  columnFacts?: { table: { labelSingular: string | null }; columns: ColumnFact[] };
}

describe('column facts on the page reply', () => {
  let dir: string;
  let t: DataTestContext;
  let pageId: string;
  let sourcelessPageId: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'adminium-facts-'));
    const file = join(dir, 'clinic.db');
    const db = new BetterSqlite3(file);
    db.exec(`CREATE TABLE clinics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name VARCHAR(60) NOT NULL
    )`);
    db.exec(`CREATE TABLE patients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name VARCHAR(80) NOT NULL,
      clinic_id INTEGER REFERENCES clinics(id),
      password_hash VARCHAR(120),
      notes TEXT,
      created_at TIMESTAMP NOT NULL,
      updated_at TIMESTAMP NOT NULL
    )`);
    db.close();

    t = await buildDataTestApp({
      extraRoutes: async (api, ctx) => {
        // `app.requireAuth` wants a session as well as a user, and the shared
        // harness's stub sets only the user (the data routes never ask). The
        // hook is scoped to this plugin, so no other suite sees it.
        api.addHook('onRequest', async (request) => {
          const user = (request as unknown as { user?: { id: string } }).user;
          if (user !== undefined) {
            (request as unknown as { session: unknown }).session = { id: 'test-session', userId: user.id };
          }
        });
        await api.register(pagesRoutes({ meta: ctx.meta }) as never);
      },
    });
    const connId = await createConnectionViaApi(t, `sqlite:${file}`, 'clinic', 'sqlite');
    await introspectViaApi(t, connId);
    await t.grantTable(t.roles.admin, connId, '*', { read: true, create: true, update: true });

    const pages = pagesRepo(t.meta);
    const page = await pages.create({
      connectionId: connId,
      slug: 'patients',
      type: 'page-crud',
      title: 'Patients',
      navGroup: 'library',
      // A DELIBERATELY STALE document: two columns, one of which is not even a
      // column of the table any more.
      config: {
        v: 1,
        kind: 'page',
        id: 'page_patients',
        template: 'page-crud',
        title: { key: 'nav.patients', fallback: 'Patients' },
        source: { connectionId: connId, table: 'patients' },
        nav: { group: 'library', icon: 'table', order: 10, slug: 'patients' },
        access: { minRole: 'viewer', permissions: [] },
        config: { columns: [{ name: 'full_name' }, { name: 'gone_last_year' }] },
      },
      origin: 'generated',
    });
    pageId = page.id;
    const sourceless = await pages.create({
      connectionId: null,
      slug: 'overview',
      type: 'page-dashboard',
      title: 'Overview',
      navGroup: 'workspace',
      config: {
        v: 1,
        kind: 'dashboard',
        id: 'page_overview',
        template: 'page-dashboard',
        title: { key: 'nav.overview', fallback: 'Overview' },
        config: { layout: { version: 1, items: [] } },
      },
    });
    sourcelessPageId = sourceless.id;

    const admin = await rolesRepo(t.meta).findBySlug('admin');
    if (admin === null) throw new Error('missing admin role');
    const permissions = permissionsRepo(t.meta);
    for (const id of [pageId, sourcelessPageId]) {
      await permissions.grant(admin.id, 'page', id, { view: true, edit: true });
    }
  });

  afterAll(async () => {
    await t.app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const read = async (id: string): Promise<PageReply> => {
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/v1/pages/${id}`,
      headers: asUser(t.users.admin),
    });
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as PageReply;
  };

  it('lists every writable column in the table’s own order, not the document’s', async () => {
    const facts = (await read(pageId)).columnFacts;
    expect(facts).toBeDefined();
    expect(facts?.columns.map((c) => c.spec.name)).toEqual([
      'id',
      'full_name',
      'clinic_id',
      'notes',
      'created_at',
      'updated_at',
    ]);
  });

  it('leaves out the secret column the write path would refuse anyway', async () => {
    const facts = (await read(pageId)).columnFacts;
    expect(facts?.columns.some((c) => c.spec.name === 'password_hash')).toBe(false);
  });

  it('says who fills each column in, and which one the dialog must ask for', async () => {
    const facts = (await read(pageId)).columnFacts;
    const byName = new Map(facts?.columns.map((c) => [c.spec.name, c]));
    // The key: the database has a default (autoincrement), so nobody asks.
    expect(byName.get('id')?.filledBy).toBe('database');
    expect(byName.get('id')?.required).toBe(false);
    // The owner's case: NOT NULL, no database default — Adminium fills it.
    expect(byName.get('created_at')?.filledBy).toBe('adminium');
    expect(byName.get('created_at')?.fill).toEqual({ kind: 'now', onUpdate: false, implicit: true });
    expect(byName.get('created_at')?.required).toBe(false);
    expect(byName.get('updated_at')?.fill?.onUpdate).toBe(true);
    // NOT NULL and nothing fills it: the one field that must be supplied.
    expect(byName.get('full_name')?.filledBy).toBeNull();
    expect(byName.get('full_name')?.required).toBe(true);
    // Optional, nothing fills it.
    expect(byName.get('notes')?.required).toBe(false);
  });

  it('carries the reference’s display column, so the picker stops guessing', async () => {
    const facts = (await read(pageId)).columnFacts;
    const fk = facts?.columns.find((c) => c.spec.name === 'clinic_id');
    expect(fk?.spec.fk?.table).toBe('main.clinics');
    expect(fk?.spec.fk?.display).toBe('name');
  });

  it('is absent for a page with no source table', async () => {
    expect((await read(sourcelessPageId)).columnFacts).toBeUndefined();
  });
});
