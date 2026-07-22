/**
 * M4-T08 end-to-end: live-PG Northwind → create connection → POST
 * /connections/:id/generate (introspects on demand) → adminium_pages rows
 * (crud pages with sane columns + one dashboard with 4 KPIs, line, donut) →
 * bootstrap nav populated → idempotent re-run.
 *
 * Probe-gated per the standing rule: CI without a local PostgreSQL stays
 * green (`describe.skipIf(!pgAvailable())`).
 *
 * Builds its own app (instead of buildDataTestApp) because the generate
 * route plugin must be registered before `app.ready()`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { pagesRepo, type MetaDb, type User } from '@adminium/meta';
import { adapterRegistry } from '@adminium/engine/adapter';
import { pageEnvelopeSchema, widgetConfigSchema } from '@adminium/engine/config';

import { buildServer, type AdminiumServer } from '../src/app.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { registerAdapters } from '../src/connections/register-adapters.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { connectionsRoutes } from '../src/routes/connections/index.js';
import { generateRoutes } from '../src/routes/generate/index.js';
import { login, makeMeta } from './auth-helpers.js';
import { createNorthwindDb, pgAvailable, type TestPg } from './connections-helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

interface TestContext {
  app: AdminiumServer;
  meta: MetaDb;
  manager: ConnectionManager;
  admin: User;
}

async function buildGenerateTestApp(): Promise<TestContext> {
  // Real auth: seeded super admin + session cookie (auth-helpers) so the
  // bootstrap route and the rbac grants run the production paths.
  const { meta, admin } = await makeMeta();
  await registerAdapters(adapterRegistry);

  const manager = new ConnectionManager({
    meta,
    crypto: dsnCryptoFromSecret(TEST_SECRET),
    metaDsn: null,
    blockLoopback: false,
  });

  const app = await buildServer({ env: makeEnv(), logger: false, metaDb: meta });
  await app.register(rbacPlugin, { meta });
  await app.register(
    async (api) => {
      await api.register(connectionsRoutes({ manager, meta }));
      await api.register(generateRoutes({ manager, meta }));
    },
    { prefix: '/api/v1' },
  );
  app.addHook('onClose', async () => {
    await manager.disposeAll();
  });
  await app.ready();
  return { app, meta, manager, admin };
}

describe.skipIf(!pgAvailable())('POST /connections/:id/generate (live PG Northwind)', () => {
  let pg: TestPg;
  let t: TestContext;
  let cookie: string;
  let connectionId: string;

  beforeAll(async () => {
    pg = createNorthwindDb();
    t = await buildGenerateTestApp();
    const session = await login(t.app);
    if (session.cookie === null) throw new Error('login failed');
    cookie = session.cookie;
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/connections',
      headers: { cookie },
      payload: { name: 'northwind', engine: 'postgres', dsn: pg.dsn },
    });
    expect(res.statusCode).toBe(201);
    connectionId = (res.json() as { id: string }).id;
  }, 60_000);

  afterAll(async () => {
    await t?.app.close();
    pg?.drop();
  });

  it('requires the connections manage grant', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/v1/connections/${connectionId}/generate`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('introspects on demand, generates, and persists the page set', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/v1/connections/${connectionId}/generate`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      pages: number;
      navGroups: string[];
      introspected: boolean;
      intent: string;
      result: { created: number; pruned: number };
    };
    expect(body.introspected).toBe(true); // no prior snapshot
    expect(body.intent).toBe('full-admin');
    expect(body.pages).toBeGreaterThanOrEqual(13); // 12 crud + ≥1 dashboard
    expect(body.result.created).toBe(body.pages);
    expect(body.navGroups).toEqual(expect.arrayContaining(['workspace', 'library', 'people']));

    const pages = await pagesRepo(t.meta).listForConnection(connectionId);
    expect(pages).toHaveLength(body.pages);
    for (const page of pages) {
      expect(page.origin).toBe('generated');
      expect(() => pageEnvelopeSchema.parse(page.config)).not.toThrow();
    }
  }, 60_000);

  it('emitted crud pages have sane columns for customers/orders/products', async () => {
    const repo = pagesRepo(t.meta);
    const customers = await repo.findBySlug(connectionId, 'customers');
    const orders = await repo.findBySlug(connectionId, 'orders');
    const products = await repo.findBySlug(connectionId, 'products');
    expect(customers?.type).toBe('page-crud');
    expect(orders?.type).toBe('page-crud');
    expect(products?.type).toBe('page-crud');

    // Columns use @adminium/widgets' gridColumnSpecSchema vocabulary.
    const customersConfig = (customers?.config as { config: Record<string, unknown> }).config;
    const columns = customersConfig['columns'] as {
      name: string;
      semantic: string;
      hidden?: boolean;
    }[];
    // The visible set stays capped at ~8 (05 rule 2); the PK is emitted as a
    // hidden spec (not dropped) so forms/detail/rowId can still resolve it.
    const visible = columns.filter((c) => !c.hidden);
    expect(visible.length).toBeGreaterThanOrEqual(3);
    expect(visible.length).toBeLessThanOrEqual(8);
    expect(visible[0]?.name).toBe('company_name');
    const pk = columns.find((c) => c.name === 'customer_id');
    expect(pk?.hidden).toBe(true);
    expect(pk?.semantic).toBe('pk-id');

    const ordersConfig = (orders?.config as { config: Record<string, unknown> }).config;
    const orderColumns = ordersConfig['columns'] as {
      name: string;
      semantic: string;
      fk?: { table: string; column: string };
    }[];
    const fk = orderColumns.find((c) => c.name === 'customer_id');
    expect(fk?.semantic).toBe('fk');
    expect(fk?.fk?.table).toBe('public.customers');
    expect(ordersConfig['defaultSort']).toEqual([{ column: 'order_id', dir: 'desc' }]);
  });

  it('emits one dashboard with 4 KPIs + line + donut over orders', async () => {
    const pages = await pagesRepo(t.meta).listForConnection(connectionId);
    const dashboards = pages.filter((p) => p.type === 'page-dashboard');
    expect(dashboards).toHaveLength(1);
    const config = (dashboards[0]?.config as { config: Record<string, unknown> }).config;
    const layout = config['layout'] as { items: { widget: string; config: Record<string, unknown> }[] };
    expect(layout.items.filter((i) => i.widget === 'kpi-stat-card')).toHaveLength(4);
    const line = layout.items.find((i) => i.widget === 'chart-line-area');
    const donut = layout.items.find((i) => i.widget === 'chart-donut');
    expect(line).toBeDefined();
    expect(donut).toBeDefined();
    for (const item of layout.items) {
      expect(() => widgetConfigSchema.parse(item)).not.toThrow();
      const binding = item.config['binding'] as { connectionId: string };
      expect(binding.connectionId).toBe(connectionId);
    }
    const lineBinding = line?.config['binding'] as { source: { name: string } };
    expect(lineBinding.source.name).toBe('orders');
  });

  it('populates the bootstrap nav tree', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: {
        nav: { groups: { key: string; items: { slug: string }[] }[] };
        configVersion: number;
      };
    };
    const groups = new Map(body.data.nav.groups.map((g) => [g.key, g.items]));
    expect([...groups.keys()]).toEqual(expect.arrayContaining(['workspace', 'library', 'people']));
    expect(groups.get('workspace')?.map((i) => i.slug)).toContain('dashboard');
    expect(groups.get('library')?.map((i) => i.slug)).toEqual(
      expect.arrayContaining(['customers', 'orders', 'products']),
    );
    expect(groups.get('people')?.map((i) => i.slug)).toContain('employees');
    expect(body.data.configVersion).toBeGreaterThan(0);
  });

  it('re-running generation is idempotent (nothing rewritten)', async () => {
    const before = await pagesRepo(t.meta).listForConnection(connectionId);
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/v1/connections/${connectionId}/generate`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      introspected: boolean;
      result: {
        created: number;
        updated: number;
        unchanged: number;
        pruned: number;
        keptEdited: string[];
      };
    };
    expect(body.introspected).toBe(false); // snapshot reused
    expect(body.result.created).toBe(0);
    expect(body.result.updated).toBe(0);
    expect(body.result.pruned).toBe(0);
    expect(body.result.keptEdited).toEqual([]);
    expect(body.result.unchanged).toBe(before.length);
    const after = await pagesRepo(t.meta).listForConnection(connectionId);
    expect(after.map((p) => ({ id: p.id, revision: p.revision, updatedAt: p.updatedAt }))).toEqual(
      before.map((p) => ({ id: p.id, revision: p.revision, updatedAt: p.updatedAt })),
    );
  }, 60_000);

  it('audits the generation run', async () => {
    const rows = await t.meta.db
      .selectFrom('adminium_audit_log')
      .selectAll()
      .where('action', '=', 'schema.generate')
      .execute();
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0]?.category).toBe('schema');
  });
});
