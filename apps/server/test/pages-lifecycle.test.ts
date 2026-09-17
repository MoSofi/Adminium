// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Page lifecycle routes — the Studio page manager's server surface:
 *
 * - the gate is the workspace-scoped `system:pages:manage`, NOT the per-page
 *   `page:<id>:edit` the layout PATCH uses;
 * - create validates slug uniqueness and composes a valid envelope;
 * - a metadata edit writes the row AND the envelope, so regeneration cannot
 *   silently revert it;
 * - delete cleans the `page:` grants no foreign key can reach;
 * - reorder renumbers each nav group densely;
 * - `If-Match` (expectedRevision) is enforced as a 409.
 */
import { readFileSync } from 'node:fs';

import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generatePages, hashEnvelope, parseDatabaseModel } from '@adminium/engine';
import {
  auditRepo,
  connectionsRepo,
  createSqliteMetaDb,
  firstRun,
  pagesRepo,
  permissionsRepo,
  rolesRepo,
  snapshotsRepo,
  usersRepo,
  type DsnCrypto,
  type GeneratedPageInput,
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
import { toGeneratedPageInput } from '../src/generate/run.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { pagesRoutes } from '../src/routes/pages/index.js';
import { makeEnv, type InjectPayload } from './helpers.js';

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

  const create = (user: User, body: InjectPayload) =>
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

    it('annotates every listed page with its connection name, in one query', async () => {
      // The manager lists every source's pages in one flat list, so the id
      // alone leaves "which database is this from?" unanswerable — and the
      // client cannot fetch the names itself: `GET /connections` rides
      // CONNECTIONS_MANAGE, which a pages manager need not hold.
      const conn = await connectionsRepo(t.meta, TEST_CRYPTO).create({
        name: 'Warehouse',
        engine: 'sqlite',
        introspectDsn: 'file:warehouse.db',
      });
      await pagesRepo(t.meta).create({
        connectionId: conn.id,
        slug: 'orders',
        type: 'page-crud',
        title: 'Orders',
        navGroup: 'library',
        config: { v: 1 },
        origin: 'generated',
      });
      // No connection at all — a name here would be an invention.
      await create(t.superAdmin, NEW_PAGE);

      const rows = (
        await t.app.inject({ method: 'GET', url: '/api/v1/pages', headers: asUser(t.superAdmin) })
      ).json().data as { slug: string; connectionId: string | null; connectionName: string | null }[];
      expect(rows.find((row) => row.slug === 'orders')).toMatchObject({
        connectionId: conn.id,
        connectionName: 'Warehouse',
      });
      expect(rows.find((row) => row.slug === 'ops-overview')).toMatchObject({
        connectionId: null,
        connectionName: null,
      });
    });

    it('reports a paused connection so the manager cannot call its pages live', async () => {
      // `buildNavTree` drops every page of a paused source out of the nav into
      // `pausedPages`, so `isEnabled: true` on one of them does NOT mean live —
      // the manager needs the pause to say so instead of a green pill.
      const connections = connectionsRepo(t.meta, TEST_CRYPTO);
      const conn = await connections.create({
        name: 'Clinic',
        engine: 'sqlite',
        introspectDsn: 'file:clinic.db',
      });
      await pagesRepo(t.meta).create({
        connectionId: conn.id,
        slug: 'charges',
        type: 'page-crud',
        title: 'Charges',
        navGroup: 'library',
        config: { v: 1 },
        origin: 'generated',
      });
      await create(t.superAdmin, NEW_PAGE);

      const read = async (): Promise<
        { slug: string; connectionPaused: boolean }[]
      > =>
        (await t.app.inject({ method: 'GET', url: '/api/v1/pages', headers: asUser(t.superAdmin) }))
          .json().data as { slug: string; connectionPaused: boolean }[];

      // While it is serving, nothing is paused — including the page that has no
      // connection at all, which must not inherit a pause it cannot have.
      expect((await read()).map((row) => [row.slug, row.connectionPaused])).toEqual(
        expect.arrayContaining([
          ['charges', false],
          ['ops-overview', false],
        ]),
      );

      await connections.setDisabled(conn.id, true);
      expect((await read()).map((row) => [row.slug, row.connectionPaused])).toEqual(
        expect.arrayContaining([
          ['charges', true],
          ['ops-overview', false],
        ]),
      );

      // And it clears on resume rather than sticking.
      await connections.setDisabled(conn.id, false);
      expect((await read()).find((row) => row.slug === 'charges')?.connectionPaused).toBe(false);
    });

    it('carries the connection name on a mutation reply too, not just the list', async () => {
      // The reply schema is shared with `GET /pages`; a create that returned no
      // name would be a row the client renders differently from the same row
      // one refetch later.
      const conn = await connectionsRepo(t.meta, TEST_CRYPTO).create({
        name: 'Warehouse',
        engine: 'sqlite',
        introspectDsn: 'file:warehouse2.db',
      });
      const created = await create(t.superAdmin, { ...NEW_PAGE, connectionId: conn.id });
      expect(created.json().data).toMatchObject({ connectionName: 'Warehouse' });
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
     * The page gutter is a TOP-LEVEL envelope field, not part of the
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

    it('round-trips a config.derived block untouched', async () => {
      // The one link between "the Studio saves it" and "the read path computes
      // it" that nothing else asserts. Both the PATCH body and the envelope
      // type the config as `z.record(z.string(), z.unknown())`, so an added
      // block is free and needs no CONFIG_VERSION bump — but "free by schema"
      // and "survives the round trip" are different claims.
      const derived = {
        measures: [
          {
            id: 'subtotal',
            table: 'public.invoice_items',
            fkColumn: 'invoice_id',
            fn: 'sum',
            of: { terms: [{ sign: 'plus', factors: ['line_total'] }] },
          },
        ],
        fields: [
          {
            id: 'total',
            scale: 2,
            expr: { op: 'add', args: [{ measure: 'subtotal' }, { lit: '0' }] },
          },
        ],
      };
      const id = (await create(t.superAdmin, { ...NEW_PAGE, template: 'page-crud' })).json().data
        .id as string;
      const patched = await t.app.inject({
        method: 'PATCH',
        url: `/api/v1/pages/${id}/config`,
        headers: asUser(t.superAdmin),
        payload: { config: { columns: [{ name: 'total', label: 'Total', derived: { ref: 'total' } }], derived } },
      });
      expect(patched.statusCode).toBe(200);

      const read = await t.app.inject({
        method: 'GET',
        url: `/api/v1/pages/${id}`,
        headers: asUser(t.superAdmin),
      });
      expect(read.statusCode).toBe(200);
      // The reply IS the envelope — the config body rides on it directly.
      const envelope = read.json().data as { config: { derived?: unknown; columns?: unknown[] } };
      expect(envelope.config.derived).toEqual(derived);
      expect(envelope.config.columns).toHaveLength(1);
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

    /**
     * A recompose is a hand-made choice on a row the generator still owns:
     * the admin picked THIS template and THIS table, and recompose leaves
     * `origin: 'generated'` alone. So the only thing standing between that
     * choice and the next generation run is the H5 edited-page guard —
     * `isEditedEnvelope`, which reads a stored document as edited when it no
     * longer hashes to its embedded `config.generatedHash`, and as freely
     * overwritable when there is no hash at all.
     *
     * Both halves of the run are asserted because they fail differently: the
     * update pass reverts the page to the generator's template+table, and the
     * prune pass deletes it outright once the generator stops emitting it.
     * What makes the loss unrecoverable is that a hand-authored derived column
     * cannot be regenerated from any snapshot.
     */
    describe('a recomposed page survives the next generation run', () => {
      const DEMO_IR: unknown = JSON.parse(
        readFileSync(new URL('./fixtures/llm/demo-schema.json', import.meta.url), 'utf8'),
      );

      /**
       * Generate the demo app for real (same engine call `runGeneration`
       * makes), then rebind its `orders` page onto another table through the
       * route. Returns what a second run needs to replay.
       */
      async function recomposedGeneratedPage(): Promise<{
        connectionId: string;
        snapshotId: string;
        emitted: GeneratedPageInput[];
        pageId: string;
      }> {
        const conn = await connectionsRepo(t.meta, TEST_CRYPTO).create({
          name: 'shop',
          engine: 'postgres',
          introspectDsn: 'postgres://ro@localhost/shop',
        });
        const snap = await snapshotsRepo(t.meta).create({
          connectionId: conn.id,
          source: 'introspection',
          schema: DEMO_IR,
          checksum: 'sha-shop-1',
        });
        const emitted = generatePages(parseDatabaseModel(DEMO_IR), {
          connectionId: conn.id,
        }).pages.map(toGeneratedPageInput);
        await pagesRepo(t.meta).upsertGenerated(conn.id, emitted, {
          snapshotId: snap.snapshot.id,
          hashEnvelope,
        });

        const orders = (await pagesRepo(t.meta).listForConnection(conn.id)).find(
          (page) => page.slug === 'orders',
        );
        if (orders === undefined) throw new Error('the demo schema should generate an orders page');

        const res = await t.app.inject({
          method: 'PATCH',
          url: `/api/v1/pages/${orders.id}`,
          headers: asUser(t.superAdmin),
          payload: { table: 'public.customers' },
        });
        expect(res.statusCode).toBe(200);

        const stored = await pagesRepo(t.meta).findById(orders.id);
        // The premise: recompose rebinds the body but leaves the row generated.
        expect(stored?.origin).toBe('generated');
        expect((stored?.config as { source: { table: string } }).source.table).toBe(
          'public.customers',
        );
        return {
          connectionId: conn.id,
          snapshotId: snap.snapshot.id,
          emitted,
          pageId: orders.id,
        };
      }

      it('the update pass does not revert it to the generator\u2019s table', async () => {
        const { connectionId, snapshotId, emitted, pageId } = await recomposedGeneratedPage();

        const result = await pagesRepo(t.meta).upsertGenerated(connectionId, emitted, {
          snapshotId,
          hashEnvelope,
        });

        const stored = await pagesRepo(t.meta).findById(pageId);
        expect((stored?.config as { source: { table: string } }).source.table).toBe(
          'public.customers',
        );
        expect(result.skippedEdited).toContain(pageId);
      });

      it('the prune pass keeps it once the generator stops emitting it', async () => {
        const { connectionId, snapshotId, emitted, pageId } = await recomposedGeneratedPage();

        // The orders table drops out of the run (excluded in the wizard, or
        // gone from the schema): the recomposed page is now an orphan, and an
        // unedited orphan is deleted.
        const result = await pagesRepo(t.meta).upsertGenerated(
          connectionId,
          emitted.filter((page) => page.id !== pageId),
          { snapshotId, hashEnvelope },
        );

        expect(await pagesRepo(t.meta).findById(pageId)).not.toBeNull();
        expect(result.pruned).toBe(0);
        expect(result.keptEdited).toContain(pageId);
      });
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
