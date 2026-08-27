// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Per-table write capabilities on the page reply (30-record-pages.md D4
 * follow-up): GET /api/v1/pages/:pageId resolves canCreate/canUpdate/canDelete
 * from the caller's `table:<connectionId>:<table>:<action>` grants against the
 * envelope's `source` — the SAME permissions the data routes enforce — so the
 * dashboard renders only write affordances that will not 403.
 *
 * - a viewer with a read-only table grant gets all-false;
 * - grants resolve per ACTION (create/update true + delete false round-trips
 *   as exactly that, not a blanket copy of one check);
 * - super-admins bypass to all-true;
 * - a source-less envelope carries no capability fields at all — absent means
 *   "not computed", which the client treats as its permissive default.
 *
 * `canUnmask` rides the same block: the crud/mask.ts UNMASK_PERMISSION check
 * the data routes mask rows with (admins yes, editors/viewers no), so the grid
 * only renders the PII reveal affordance for callers whose reads actually
 * carry the values in clear.
 */
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createSqliteMetaDb,
  firstRun,
  pagesRepo,
  permissionsRepo,
  rolesRepo,
  usersRepo,
  type MetaDb,
  type Role,
  type User,
} from '@adminium/meta';

import { buildServer, type AdminiumServer } from '../src/app.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { pagesRoutes } from '../src/routes/pages/index.js';
import { makeEnv } from './helpers.js';

interface Harness {
  app: AdminiumServer;
  meta: MetaDb;
  /** page-crud bound to conn_1/public.invoices. */
  crudPageId: string;
  /** page-dashboard with no `source` block. */
  dashPageId: string;
  superAdmin: User;
  /** Holds `editor` — invoices grant: read/create/update TRUE, delete FALSE. */
  editor: User;
  /** Holds `viewer` — invoices grant: read TRUE, every write FALSE. */
  viewer: User;
}

function asUser(user: User): Record<string, string> {
  return { 'x-test-user-id': user.id };
}

/** The generated-crud shape the dashboard binds a CrudApi from (09 §2.3). */
const CRUD_ENVELOPE = {
  v: 1,
  kind: 'page',
  id: 'page_invoices',
  template: 'page-crud',
  title: { key: 'nav.invoices', fallback: 'Invoices' },
  source: { connectionId: 'conn_1', table: 'public.invoices' },
  nav: { group: 'library', icon: 'table', order: 10, slug: 'invoices' },
  access: { minRole: 'viewer', permissions: [] },
  config: { columns: [] },
};

const SOURCELESS_ENVELOPE = {
  v: 1,
  kind: 'dashboard',
  id: 'page_dash',
  template: 'page-dashboard',
  title: { key: 'nav.overview', fallback: 'Overview' },
  config: { layout: { version: 1, items: [] } },
};

async function buildHarness(): Promise<Harness> {
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);

  const roles = rolesRepo(meta);
  const users = usersRepo(meta);
  async function makeUser(name: string, roleSlug: string): Promise<User> {
    const role: Role | null = await roles.findBySlug(roleSlug);
    if (role === null) throw new Error(`missing built-in role ${roleSlug}`);
    const user = await users.create({ email: `${name}@adminium.test`, name, passwordHash: 'h', status: 'active' });
    await roles.assignToUser(user.id, role.id);
    return user;
  }
  const superAdmin = await makeUser('ava', 'super-admin');
  const editor = await makeUser('noah', 'editor');
  const viewer = await makeUser('liam', 'viewer');

  const pages = pagesRepo(meta);
  // connectionId null on the ROW: adminium_connections has an FK and this
  // suite runs on a bare meta db. The capability check reads the ENVELOPE's
  // `source` — the same binding the client's CrudApi calls with — so the row
  // column is irrelevant to what is under test.
  const crudPage = await pages.create({
    connectionId: null,
    slug: 'invoices',
    type: 'page-crud',
    title: 'Invoices',
    navGroup: 'library',
    config: CRUD_ENVELOPE,
    origin: 'generated',
  });
  const dashPage = await pages.create({
    connectionId: null,
    slug: 'overview',
    type: 'page-dashboard',
    title: 'Overview',
    navGroup: 'workspace',
    config: SOURCELESS_ENVELOPE,
  });

  // Page-view for both non-super roles (the GET's view gate, 09 §2.1), then
  // the table matrix rows under test: `resource_ref` is
  // `<connectionId>/<schema.table>` (07 §3.9). The editor's DELETE stays
  // false on purpose — the reply must resolve per action.
  const permissions = permissionsRepo(meta);
  for (const slug of ['editor', 'viewer'] as const) {
    const role = await roles.findBySlug(slug);
    if (role === null) throw new Error(`missing built-in role ${slug}`);
    for (const pageId of [crudPage.id, dashPage.id]) {
      await permissions.grant(role.id, 'page', pageId, { view: true, edit: false });
    }
    await permissions.grant(role.id, 'table', 'conn_1/public.invoices', {
      read: true,
      create: slug === 'editor',
      update: slug === 'editor',
      delete: false,
      export: false,
      import: false,
    });
  }

  const app = await buildServer({ env: makeEnv(), logger: false, metaDb: meta });
  // Stub session auth: x-test-user-id → request.user + a live session so
  // `app.requireAuth` (which checks both) passes.
  app.addHook('onRequest', async (request) => {
    const id = request.headers['x-test-user-id'];
    if (typeof id === 'string') {
      const user = await users.findById(id);
      if (user !== null) {
        const req = request as unknown as { user: unknown; session: unknown };
        req.user = user;
        req.session = { id: 'test-session', userId: user.id };
      }
    }
  });
  await app.register(rbacPlugin, { meta });
  await app.register(
    async (api) => {
      await api.register(pagesRoutes({ meta }));
    },
    { prefix: '/api/v1' },
  );
  await app.ready();

  return { app, meta, crudPageId: crudPage.id, dashPageId: dashPage.id, superAdmin, editor, viewer };
}

describe('per-table write capabilities on GET /api/v1/pages/:pageId', () => {
  let t: Harness;
  beforeEach(async () => {
    t = await buildHarness();
  });
  afterEach(async () => {
    await t.app.close();
    await t.meta.db.destroy();
  });

  const get = (user: User, pageId: string) =>
    t.app.inject({ method: 'GET', url: `/api/v1/pages/${pageId}`, headers: asUser(user) });

  const capabilitiesOf = (body: Record<string, unknown>) => ({
    canCreate: body['canCreate'],
    canUpdate: body['canUpdate'],
    canDelete: body['canDelete'],
    canUnmask: body['canUnmask'],
  });

  it('a read-only table grant resolves to all-false — no affordance to 403 on', async () => {
    const res = await get(t.viewer, t.crudPageId);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(capabilitiesOf(body)).toEqual({
      canCreate: false,
      canUpdate: false,
      canDelete: false,
      canUnmask: false,
    });
    // The read surface itself is untouched: envelope + layout capability.
    expect(body.data).toEqual(CRUD_ENVELOPE);
    expect(body.canEditLayout).toBe(false);
  });

  it('grants resolve per action: create/update true, delete false', async () => {
    const body = (await get(t.editor, t.crudPageId)).json();
    // Editors write rows but do not hold the unmask permission — their reads
    // arrive masked, so the reply must not offer the reveal affordance.
    expect(capabilitiesOf(body)).toEqual({
      canCreate: true,
      canUpdate: true,
      canDelete: false,
      canUnmask: false,
    });
  });

  it('super-admins bypass to all-true', async () => {
    const body = (await get(t.superAdmin, t.crudPageId)).json();
    expect(capabilitiesOf(body)).toEqual({
      canCreate: true,
      canUpdate: true,
      canDelete: true,
      canUnmask: true,
    });
  });

  it('a source-less envelope carries no capability fields at all', async () => {
    for (const user of [t.viewer, t.superAdmin]) {
      const res = await get(user, t.dashPageId);
      expect(res.statusCode).toBe(200);
      expect(capabilitiesOf(res.json())).toEqual({
        canCreate: undefined,
        canUpdate: undefined,
        canDelete: undefined,
        canUnmask: undefined,
      });
    }
  });
});
