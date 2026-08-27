// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Page lifecycle routes (08-server-api.md §2.6) — the Studio page manager's
 * server surface:
 *
 * - the gate is the workspace-scoped `system:pages:manage`, NOT the per-page
 *   `page:<id>:edit` the layout PATCH uses;
 * - create validates slug uniqueness and composes a valid §6.1 envelope;
 * - a metadata edit writes the row AND the envelope, so regeneration cannot
 *   silently revert it;
 * - delete cleans the `page:` grants no foreign key can reach;
 * - reorder renumbers each nav group densely;
 * - `If-Match` (expectedRevision) is enforced as a 409.
 */
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  auditRepo,
  connectionsRepo,
  createSqliteMetaDb,
  firstRun,
  pagesRepo,
  permissionsRepo,
  rolesRepo,
  usersRepo,
  type DsnCrypto,
  type MetaDb,
  type Role,
  type User,
} from '@adminium/meta';

/** `adminium_connections` rows are FK targets here; the DSN is never read. */
const TEST_CRYPTO: DsnCrypto = {
  encrypt: (plaintext) => `enc:${plaintext}`,
  decrypt: (token) => token.slice('enc:'.length),
};
import { NAV_GROUP_KEYS } from '../src/routes/bootstrap/schema.js';
import { pageNavGroup } from '../src/routes/pages/schema.js';

import { buildServer, type AdminiumServer } from '../src/app.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { pagesRoutes } from '../src/routes/pages/index.js';
import { makeEnv } from './helpers.js';

interface Harness {
  app: AdminiumServer;
  meta: MetaDb;
  superAdmin: User;
  /** Built-in `admin`: reaches Studio in the UI, holds NO pages.manage grant. */
  plainAdmin: User;
  manager: User;
  managerRole: Role;
}

function asUser(user: User): Record<string, string> {
  return { 'x-test-user-id': user.id };
}

async function buildHarness(): Promise<Harness> {
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);

  const roles = rolesRepo(meta);
  const users = usersRepo(meta);
  async function makeUser(name: string, roleSlug: string): Promise<User> {
    const role: Role | null = await roles.findBySlug(roleSlug);
    if (role === null) throw new Error(`missing built-in role ${roleSlug}`);
    const user = await users.create({
      email: `${name}@adminium.test`,
      name,
      passwordHash: 'h',
      status: 'active',
    });
    await roles.assignToUser(user.id, role.id);
    return user;
  }
  const superAdmin = await makeUser('ava', 'super-admin');
  const plainAdmin = await makeUser('zoe', 'admin');

  // A role holding exactly the new system key — proves the gate is the key
  // itself, not a role slug and not the super-admin bypass.
  const managerRole = await roles.create({ slug: 'page-manager', name: 'Page manager' });
  await permissionsRepo(meta).grant(managerRole.id, 'system', 'pages.manage', { allowed: true });
  const manager = await users.create({
    email: 'mgr@adminium.test',
    name: 'mgr',
    passwordHash: 'h',
    status: 'active',
  });
  await roles.assignToUser(manager.id, managerRole.id);

  const app = await buildServer({ env: makeEnv(), logger: false, metaDb: meta });
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

  return { app, meta, superAdmin, plainAdmin, manager, managerRole };
}

describe('page lifecycle routes', () => {
  let t: Harness;
  beforeEach(async () => {
    t = await buildHarness();
  });
  afterEach(async () => {
    await t.app.close();
    await t.meta.db.destroy();
  });

  const create = (user: User, body: unknown) =>
    t.app.inject({ method: 'POST', url: '/api/v1/pages', headers: asUser(user), payload: body });

  const NEW_PAGE = {
    slug: 'ops-overview',
    title: 'Ops overview',
    template: 'page-dashboard',
    navGroup: 'workspace',
  };

  describe('the gate is system:pages:manage', () => {
    it('denies the built-in admin, who holds no pages.manage grant', async () => {
      // The `admin` role reaches /studio in the UI (StudioGuard tests role
      // slugs) but that is discovery only — the server is the boundary.
      const res = await create(t.plainAdmin, NEW_PAGE);
      expect(res.statusCode).toBe(403);
      expect(await t.app.inject({ method: 'GET', url: '/api/v1/pages', headers: asUser(t.plainAdmin) })).toMatchObject(
        { statusCode: 403 },
      );
    });

    it('allows a non-super-admin role that holds exactly that key', async () => {
      const res = await create(t.manager, NEW_PAGE);
      expect(res.statusCode).toBe(200);
    });

    it('allows super-admins via the bypass', async () => {
      expect((await create(t.superAdmin, NEW_PAGE)).statusCode).toBe(200);
    });
  });

  describe('create', () => {
    it('composes a valid envelope and lists the page', async () => {
      const res = await create(t.superAdmin, NEW_PAGE);
      const created = res.json().data as { id: string; slug: string; origin: string };
      expect(created).toMatchObject({ slug: 'ops-overview', origin: 'user', isEnabled: true });

      const stored = await pagesRepo(t.meta).findById(created.id);
      const envelope = stored?.config as Record<string, unknown>;
      expect(envelope).toMatchObject({
        v: 1,
        // page-dashboard is the one template family that is `kind: 'dashboard'`,
        // which is what makes the envelope schema enforce `config.layout`.
        kind: 'dashboard',
        id: created.id,
        template: 'page-dashboard',
        title: { key: 'nav.ops-overview', fallback: 'Ops overview' },
        nav: { group: 'workspace', slug: 'ops-overview' },
      });
      // No generatedHash: the generator owns that marker, and a fake one would
      // make a later origin change silently destructive.
      expect((envelope['config'] as Record<string, unknown>)['generatedHash']).toBeUndefined();

      const list = await t.app.inject({
        method: 'GET',
        url: '/api/v1/pages',
        headers: asUser(t.superAdmin),
      });
      expect((list.json().data as unknown[]).length).toBe(1);
    });

    it('rejects a duplicate slug with 409 rather than a driver 500', async () => {
      await create(t.superAdmin, NEW_PAGE);
      const clash = await create(t.superAdmin, { ...NEW_PAGE, title: 'Another' });
      expect(clash.statusCode).toBe(409);
      expect(clash.json().error.code).toBe('UNIQUE_VIOLATION');
    });

    it('rejects a slug held by a page of a DIFFERENT connection', async () => {
      // The DB index is per-connection, but routing is not: `/p/$slug` is
      // resolved by `findNavItemBySlug`, a first-match-wins scan over the whole
      // flattened nav tree. Allowing the pair would not corrupt storage — it
      // would make one of the two pages permanently unreachable, silently.
      const other = await connectionsRepo(t.meta, TEST_CRYPTO).create({
        name: 'other',
        engine: 'sqlite',
        introspectDsn: 'file:other.db',
      });
      await pagesRepo(t.meta).create({
        connectionId: other.id,
        slug: 'ops-overview',
        type: 'page-crud',
        title: 'Generated Ops',
        navGroup: 'library',
        config: { v: 1 },
        origin: 'generated',
      });
      const res = await create(t.superAdmin, NEW_PAGE);
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('UNIQUE_VIOLATION');
    });

    it('lets a page keep its own slug on an unrelated patch', async () => {
      // The `exceptPageId` escape hatch: without it every PATCH that touched
      // any field would 409 against the row it is editing.
      const id = (await create(t.superAdmin, NEW_PAGE)).json().data.id as string;
      const res = await t.app.inject({
        method: 'PATCH',
        url: `/api/v1/pages/${id}`,
        headers: asUser(t.superAdmin),
        payload: { slug: 'ops-overview', title: 'Renamed' },
      });
      expect(res.statusCode).toBe(200);
    });

    it('rejects a template the app cannot render, and a non-kebab slug', async () => {
      // 422 VALIDATION_FAILED is this API's mapping for a schema-rejected body.
      expect((await create(t.superAdmin, { ...NEW_PAGE, template: 'page-marketing' })).statusCode).toBe(422);
      expect((await create(t.superAdmin, { ...NEW_PAGE, slug: 'Ops Overview' })).statusCode).toBe(422);
      // A group outside the five fixed buckets would render but never appear
      // in the sidebar — buildNavTree drops it silently.
      expect((await create(t.superAdmin, { ...NEW_PAGE, navGroup: 'custom' })).statusCode).toBe(422);
    });

    it('appends after the highest order in the target group', async () => {
      await pagesRepo(t.meta).create({
        connectionId: null,
        slug: 'existing',
        type: 'page-crud',
        title: 'Existing',
        navGroup: 'workspace',
        navOrder: 40,
        config: { v: 1 },
      });
      const res = await create(t.superAdmin, NEW_PAGE);
      expect((res.json().data as { navOrder: number }).navOrder).toBe(41);
    });

    it('inherits the view audience of its siblings in the same connection', async () => {
      const roles = rolesRepo(t.meta);
      const viewerRole = await roles.findBySlug('viewer');
      if (viewerRole === null) throw new Error('missing viewer role');
      const sibling = await pagesRepo(t.meta).create({
        connectionId: null,
        slug: 'sibling',
        type: 'page-crud',
        title: 'Sibling',
        navGroup: 'library',
        config: { v: 1 },
      });
      await permissionsRepo(t.meta).grant(viewerRole.id, 'page', sibling.id, {
        view: true,
        edit: true,
      });

      const created = (await create(t.superAdmin, NEW_PAGE)).json().data as { id: string };
      const grants = await permissionsRepo(t.meta).listForResource('page', created.id);
      expect(grants).toHaveLength(1);
      // View is inherited; edit is not — that stays a deliberate admin act.
      expect(grants[0]).toMatchObject({ roleId: viewerRole.id, actions: { view: true, edit: false } });
    });
  });

  describe('update', () => {
    async function seed(): Promise<string> {
      const res = await create(t.superAdmin, NEW_PAGE);
      return (res.json().data as { id: string }).id;
    }

    it('writes the row AND mirrors the envelope', async () => {
      const id = await seed();
      const res = await t.app.inject({
        method: 'PATCH',
        url: `/api/v1/pages/${id}`,
        headers: asUser(t.superAdmin),
        payload: { title: 'Operations', navGroup: 'planning' },
      });
      expect(res.statusCode).toBe(200);

      const stored = await pagesRepo(t.meta).findById(id);
      expect(stored).toMatchObject({ title: 'Operations', navGroup: 'planning' });
      const envelope = stored?.config as {
        title: { fallback: string };
        nav: { group: string };
      };
      // Without this mirror the next generation run reverts the rename: the
      // `unchanged` comparison covers title/navGroup but the edited-page guard
      // only reads config.generatedHash.
      expect(envelope.title.fallback).toBe('Operations');
      expect(envelope.nav.group).toBe('planning');
    });

    /**
     * The page gutter (02 §1.8) is a TOP-LEVEL envelope field, not part of the
     * per-template `config` body, so it rides the metadata PATCH. The absent /
     * null distinction is the whole contract: absent means "follow the
     * template", and it has to stay absent rather than being frozen to today's
     * default the first time anyone renames the page.
     */
    it('stores a page-padding override and clears it back to the template default', async () => {
      const id = await seed();
      const envelopeOf = async (): Promise<Record<string, unknown>> =>
        ((await pagesRepo(t.meta).findById(id))?.config ?? {}) as Record<string, unknown>;

      expect(await envelopeOf()).not.toHaveProperty('padding');

      const set = await t.app.inject({
        method: 'PATCH',
        url: `/api/v1/pages/${id}`,
        headers: asUser(t.superAdmin),
        payload: { padding: { x: 40, y: 12 } },
      });
      expect(set.statusCode).toBe(200);
      expect((await envelopeOf())['padding']).toEqual({ x: 40, y: 12 });

      // An unrelated edit must not disturb it.
      await t.app.inject({
        method: 'PATCH',
        url: `/api/v1/pages/${id}`,
        headers: asUser(t.superAdmin),
        payload: { title: 'Renamed' },
      });
      expect((await envelopeOf())['padding']).toEqual({ x: 40, y: 12 });

      const cleared = await t.app.inject({
        method: 'PATCH',
        url: `/api/v1/pages/${id}`,
        headers: asUser(t.superAdmin),
        payload: { padding: null },
      });
      expect(cleared.statusCode).toBe(200);
      // Deleted, not stored as null — a cleared page must be byte-identical to
      // one that never had an override.
      expect(await envelopeOf()).not.toHaveProperty('padding');
    });

    /**
     * `width` rides the same envelope channel as `padding` and carries the same
     * absent/null contract, so it gets the same three checks — plus the one
     * padding could not have: BOTH chrome fields in a single PATCH.
     *
     * That last case is the regression this test exists for. The two used to be
     * layered by two separate expressions, each starting from
     * `recomposed.envelope ?? currentEnvelope(page)` — i.e. both from the
     * PRE-patch document — so a patch carrying padding and width together kept
     * only whichever was spread last and silently dropped the other.
     */
    it('stores a content-width override, clears it, and survives a joint patch', async () => {
      const id = await seed();
      const envelopeOf = async (): Promise<Record<string, unknown>> =>
        ((await pagesRepo(t.meta).findById(id))?.config ?? {}) as Record<string, unknown>;

      expect(await envelopeOf()).not.toHaveProperty('width');

      const set = await t.app.inject({
        method: 'PATCH',
        url: `/api/v1/pages/${id}`,
        headers: asUser(t.superAdmin),
        payload: { width: 'narrow' },
      });
      expect(set.statusCode).toBe(200);
      expect((await envelopeOf())['width']).toBe('narrow');

      // Both at once — neither may drop the other.
      const both = await t.app.inject({
        method: 'PATCH',
        url: `/api/v1/pages/${id}`,
        headers: asUser(t.superAdmin),
        payload: { width: 'dash', padding: { x: 40, y: 12 } },
      });
      expect(both.statusCode).toBe(200);
      const after = await envelopeOf();
      expect(after['width']).toBe('dash');
      expect(after['padding']).toEqual({ x: 40, y: 12 });

      const cleared = await t.app.inject({
        method: 'PATCH',
        url: `/api/v1/pages/${id}`,
        headers: asUser(t.superAdmin),
        payload: { width: null },
      });
      expect(cleared.statusCode).toBe(200);
      expect(await envelopeOf()).not.toHaveProperty('width');
      // Clearing one must not clear the other.
      expect((await envelopeOf())['padding']).toEqual({ x: 40, y: 12 });
    });

    it('rejects a width that is not one of the named columns', async () => {
      const id = await seed();
      const res = await t.app.inject({
        method: 'PATCH',
        url: `/api/v1/pages/${id}`,
        headers: asUser(t.superAdmin),
        payload: { width: '1000px' },
      });
      expect(res.statusCode).toBe(422);
    });

    it('rejects a padding pair the renderer would refuse', async () => {
      const id = await seed();
      const res = await t.app.inject({
        method: 'PATCH',
        url: `/api/v1/pages/${id}`,
        headers: asUser(t.superAdmin),
        payload: { padding: { x: -4, y: 12 } },
      });
      expect(res.statusCode).toBe(422);
    });

    it('enforces expectedRevision as a 409 and leaves the row alone', async () => {
      const id = await seed();
      const res = await t.app.inject({
        method: 'PATCH',
        url: `/api/v1/pages/${id}`,
        headers: asUser(t.superAdmin),
        payload: { title: 'Nope', expectedRevision: 99 },
      });
      expect(res.statusCode).toBe(409);
      expect((await pagesRepo(t.meta).findById(id))?.title).toBe('Ops overview');
    });

    it('rejects a slug already taken by another page', async () => {
      const id = await seed();
      await create(t.superAdmin, { ...NEW_PAGE, slug: 'other', title: 'Other' });
      const res = await t.app.inject({
        method: 'PATCH',
        url: `/api/v1/pages/${id}`,
        headers: asUser(t.superAdmin),
        payload: { slug: 'other' },
      });
      expect(res.statusCode).toBe(409);
    });

    it('can re-enable a disabled page (the render path 404s on one)', async () => {
      const id = await seed();
      await t.app.inject({
        method: 'PATCH',
        url: `/api/v1/pages/${id}`,
        headers: asUser(t.superAdmin),
        payload: { isEnabled: false },
      });
      const res = await t.app.inject({
        method: 'PATCH',
        url: `/api/v1/pages/${id}`,
        headers: asUser(t.superAdmin),
        payload: { isEnabled: true },
      });
      expect(res.statusCode).toBe(200);
      expect((res.json().data as { isEnabled: boolean }).isEnabled).toBe(true);
    });
  });

  describe('template + data source', () => {
    it('rejects binding a table on a connection that was never analysed', async () => {
      // No snapshot ⇒ no schema to compose from. Saying so beats composing an
      // empty page and letting the admin wonder why it has no columns.
      const conn = await connectionsRepo(t.meta, TEST_CRYPTO).create({
        name: 'fresh',
        engine: 'sqlite',
        introspectDsn: 'file:fresh.db',
      });
      const res = await create(t.superAdmin, {
        ...NEW_PAGE,
        template: 'page-crud',
        connectionId: conn.id,
        table: 'public.orders',
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.message).toMatch(/analysed/i);
    });

    it('a metadata-only patch never rewrites the body', async () => {
      // The guard that stops a rename from throwing away hand-edited columns:
      // recompose runs only when template/connection/table actually changed.
      const id = (await create(t.superAdmin, { ...NEW_PAGE, template: 'page-crud' })).json().data
        .id as string;
      await t.app.inject({
        method: 'PATCH',
        url: `/api/v1/pages/${id}/config`,
        headers: asUser(t.superAdmin),
        payload: { config: { columns: [{ name: 'email', label: 'Email' }] } },
      });

      const res = await t.app.inject({
        method: 'PATCH',
        url: `/api/v1/pages/${id}`,
        headers: asUser(t.superAdmin),
        // Re-sending the SAME template is not a change and must not recompose.
        payload: { title: 'Renamed', template: 'page-crud' },
      });
      expect(res.statusCode).toBe(200);

      const stored = (await pagesRepo(t.meta).findById(id))?.config as {
        config: { columns: unknown[] };
      };
      expect(stored.config.columns).toHaveLength(1);
    });

    it('switching to a non-table-bound template keeps the body and records the type', async () => {
      // Blanking a dashboard's widgets because its `type` was re-picked would
      // destroy real work, so a non-bindable target only restamps the frame.
      const id = (await create(t.superAdmin, NEW_PAGE)).json().data.id as string;
      const res = await t.app.inject({
        method: 'PATCH',
        url: `/api/v1/pages/${id}`,
        headers: asUser(t.superAdmin),
        payload: { template: 'page-builder' },
      });
      expect(res.statusCode).toBe(200);
      expect((res.json().data as { type: string }).type).toBe('page-builder');

      const stored = (await pagesRepo(t.meta).findById(id))?.config as {
        template: string;
        config: Record<string, unknown>;
      };
      expect(stored.template).toBe('page-builder');
      expect(stored.config['layout']).toBeDefined();
    });
  });

  describe('config body', () => {
    it('accepts a valid layout and rejects one the renderer would reject', async () => {
      const id = (await create(t.superAdmin, NEW_PAGE)).json().data.id as string;
      const ok = await t.app.inject({
        method: 'PATCH',
        url: `/api/v1/pages/${id}/config`,
        headers: asUser(t.superAdmin),
        payload: {
          config: {
            templateVersion: 1,
            toolbar: [],
            overlays: [],
            layout: {
              version: 1,
              items: [{ i: 'a', widget: 'kpi-stat-card', x: 0, y: 0, w: 4, h: 3, config: {} }],
            },
          },
        },
      });
      expect(ok.statusCode).toBe(200);

      const bad = await t.app.inject({
        method: 'PATCH',
        url: `/api/v1/pages/${id}/config`,
        headers: asUser(t.superAdmin),
        // x: 99 is off the 12-column grid — pageLayoutSchema rejects it, and
        // the envelope superRefine surfaces that for kind: 'dashboard'.
        payload: {
          config: {
            layout: {
              version: 1,
              items: [{ i: 'a', widget: 'kpi-stat-card', x: 99, y: 0, w: 4, h: 3, config: {} }],
            },
          },
        },
      });
      expect(bad.statusCode).toBe(422);
    });

    it('leaves the envelope frame intact', async () => {
      const id = (await create(t.superAdmin, { ...NEW_PAGE, template: 'page-crud' })).json().data
        .id as string;
      await t.app.inject({
        method: 'PATCH',
        url: `/api/v1/pages/${id}/config`,
        headers: asUser(t.superAdmin),
        payload: { config: { columns: [{ name: 'email', label: 'Email' }] } },
      });
      const stored = (await pagesRepo(t.meta).findById(id))?.config as {
        template: string;
        nav: { slug: string };
        config: { columns: unknown[] };
      };
      expect(stored.template).toBe('page-crud');
      expect(stored.nav.slug).toBe('ops-overview');
      expect(stored.config.columns).toHaveLength(1);
    });
  });

  describe('duplicate and delete', () => {
    it('duplicates the body and the source page audience', async () => {
      const roles = rolesRepo(t.meta);
      const viewerRole = await roles.findBySlug('viewer');
      if (viewerRole === null) throw new Error('missing viewer role');
      const id = (await create(t.superAdmin, NEW_PAGE)).json().data.id as string;
      await permissionsRepo(t.meta).grant(viewerRole.id, 'page', id, { view: true, edit: true });

      const res = await t.app.inject({
        method: 'POST',
        url: `/api/v1/pages/${id}/duplicate`,
        headers: asUser(t.superAdmin),
        payload: { slug: 'ops-copy', title: 'Ops copy' },
      });
      expect(res.statusCode).toBe(200);
      const copy = res.json().data as { id: string; slug: string };
      const stored = (await pagesRepo(t.meta).findById(copy.id))?.config as {
        id: string;
        nav: { slug: string };
        title: { key: string; fallback: string };
      };
      // The copy is re-identified, not a byte copy: a duplicated envelope
      // still claiming the source id would be a second document for one page.
      expect(stored.id).toBe(copy.id);
      expect(stored.nav.slug).toBe('ops-copy');
      expect(stored.title).toEqual({ key: 'nav.ops-copy', fallback: 'Ops copy' });
      expect(await permissionsRepo(t.meta).listForResource('page', copy.id)).toHaveLength(1);
    });

    it('delete revokes the page grants no FK can reach', async () => {
      const roles = rolesRepo(t.meta);
      const viewerRole = await roles.findBySlug('viewer');
      if (viewerRole === null) throw new Error('missing viewer role');
      const id = (await create(t.superAdmin, NEW_PAGE)).json().data.id as string;
      await permissionsRepo(t.meta).grant(viewerRole.id, 'page', id, { view: true, edit: false });

      const res = await t.app.inject({
        method: 'DELETE',
        url: `/api/v1/pages/${id}`,
        headers: asUser(t.superAdmin),
      });
      expect(res.statusCode).toBe(200);
      expect(await pagesRepo(t.meta).findById(id)).toBeNull();
      // resource_ref is a polymorphic varchar — nothing cascades this.
      expect(await permissionsRepo(t.meta).listForResource('page', id)).toEqual([]);
    });

    it('refuses to delete a manifest-installed page', async () => {
      const page = await pagesRepo(t.meta).create({
        connectionId: null,
        slug: 'addon-page',
        type: 'page-crud',
        title: 'Add-on',
        navGroup: 'library',
        config: { v: 1 },
        origin: 'manifest',
      });
      await t.meta.db
        .updateTable('adminium_pages')
        .set({ manifestId: 'mf_1' })
        .where('id', '=', page.id)
        .execute();

      const res = await t.app.inject({
        method: 'DELETE',
        url: `/api/v1/pages/${page.id}`,
        headers: asUser(t.superAdmin),
      });
      expect(res.statusCode).toBe(409);
      expect(await pagesRepo(t.meta).findById(page.id)).not.toBeNull();
    });
  });

  describe('nav reorder', () => {
    it('renumbers each group densely from zero and audits the move', async () => {
      const a = (await create(t.superAdmin, NEW_PAGE)).json().data.id as string;
      const b = (await create(t.superAdmin, { ...NEW_PAGE, slug: 'b', title: 'B' })).json().data
        .id as string;
      const c = (await create(t.superAdmin, { ...NEW_PAGE, slug: 'c', title: 'C' })).json().data
        .id as string;

      const res = await t.app.inject({
        method: 'PUT',
        url: '/api/v1/pages/nav-order',
        headers: asUser(t.superAdmin),
        payload: {
          items: [
            { pageId: c, navGroup: 'workspace' },
            { pageId: a, navGroup: 'workspace' },
            { pageId: b, navGroup: 'library' },
          ],
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.moved).toBe(3);

      const repo = pagesRepo(t.meta);
      expect(await repo.findById(c)).toMatchObject({ navGroup: 'workspace', navOrder: 0 });
      expect(await repo.findById(a)).toMatchObject({ navGroup: 'workspace', navOrder: 1 });
      expect(await repo.findById(b)).toMatchObject({ navGroup: 'library', navOrder: 0 });

      const entries = await auditRepo(t.meta).list({ limit: 50 });
      expect(entries.some((entry) => entry.action === 'page.nav.reorder')).toBe(true);
    });
  });

  it('the accepted nav groups match the bootstrap tree exactly', () => {
    // Two independent declarations of the five buckets exist (the reply schema
    // and this request schema). If they drift, an admin can file a page into a
    // group that renders nowhere.
    expect([...pageNavGroup.options].sort()).toEqual([...NAV_GROUP_KEYS].sort());
  });
});
