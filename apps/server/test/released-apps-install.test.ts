// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Released apps still install, on every engine this run can reach.
 *
 * The manifests are the byte-exact released copies the manifest package keeps
 * (`packages/manifest/test/fixtures/released/`, listed in its `index.json`):
 *
 *  - each released app installs on a fresh connection;
 *  - Client Portal installs with the released Invoices & Receipts add-on it
 *    requires staged beside it, its tables built on the add-on's shapes;
 *  - Point of Sale and the released Online Ordering install side by side on
 *    one connection, each with its own tables;
 *  - a release that no longer updates the plain-named 0.1.3 installs (its
 *    `updatesFrom` starts at 0.2.0) is refused as an update, at the plan and
 *    at the update, and the 0.1.3 install stays as it was;
 *  - once the 0.1.3 app is uninstalled with its tables kept, a fresh install
 *    of a prefixed release sits beside those tables and Point of Sale's —
 *    and one declaring its menu on the core menu shape shares Point of Sale's.
 *
 * The asserts are "still installs", never a snapshot of the plan.
 */
import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';

import { addOnHarness, type Harness as AddOnHarness } from './app-add-ons.helpers.js';
import { ENGINES, installHarness, type Dialect, type Harness } from './app-install-harness.js';
import { orderingSharingMenu } from '../../../packages/manifest/test/menu-sharing-fixture.js';

type Doc = Record<string, unknown>;

const dir = new URL('../../../packages/manifest/test/fixtures/released/', import.meta.url);
const INDEX = JSON.parse(readFileSync(new URL('index.json', dir), 'utf8')) as { file: string }[];
const DOCS = INDEX.filter((entry) => entry.file.endsWith('.manifest.json')).map(
  (entry) => [entry.file, JSON.parse(readFileSync(new URL(entry.file, dir), 'utf8')) as Doc] as const,
);
const APPS = DOCS.filter(([, doc]) => doc['kind'] === 'app');
const released = (key: string): Doc => {
  const found = DOCS.find(([, doc]) => doc['key'] === key);
  if (found === undefined) throw new Error(`no released manifest for "${key}"`);
  return structuredClone(found[1]);
};

/** The apps that install with no add-on required (this harness stages none); the others have their own case. */
const ALONE = APPS.filter(([, doc]) => ((doc['addOns'] as { requires?: unknown[] } | undefined)?.requires ?? []).length === 0);

/** The apps whose release is 0.1.3: plain table names, no `updatesFrom`. */
const PLAIN = APPS.filter(([, doc]) => doc['version'] === '0.1.3');

/** What a release after 0.1.3 declares: it updates nothing older than 0.2.0. */
function successor(doc: Doc, over: { prefixed?: boolean } = {}): Doc {
  const schema = doc['requiredSchema'] as Doc;
  return {
    ...doc,
    version: '0.2.0',
    compatibility: { ...(doc['compatibility'] as Doc), updatesFrom: '>=0.2.0' },
    ...(over.prefixed === true ? { requiredSchema: { ...schema, prefixed: true } } : {}),
  };
}

const refs = (doc: Doc): string[] => ((doc['requiredSchema'] as { tables: { ref: string }[] }).tables ?? []).map((t) => t.ref);

async function tableNames(h: Harness, dialect: Dialect): Promise<string[]> {
  const statement =
    dialect === 'sqlite'
      ? `SELECT name AS name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`
      : dialect === 'postgres'
        ? `SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public'`
        : `SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()`;
  return (await h.rows(statement)).map((row) => String(row['name'] ?? row['NAME'] ?? row['TABLE_NAME']));
}

/** The harness's request helper takes GET and POST; the uninstall is a DELETE. */
const del = (h: Harness, url: string, payload: Doc) =>
  (h.inject as (request: { method: string; url: string; payload?: Doc }) => ReturnType<Harness['inject']>)({ method: 'DELETE', url, payload });

let open: Harness | null = null;
let openAddOns: AddOnHarness | null = null;
afterEach(async () => {
  await open?.close();
  open = null;
  await openAddOns?.close();
  openAddOns = null;
});

const SLOW = 180_000;

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`released apps install — ${dialect}`, () => {
    it.each(ALONE.map(([file, doc]) => [file, doc] as const))(
      '%s installs on a fresh connection',
      async (_file, doc) => {
        const h = (open = await installHarness(dialect));
        const installed = await h.install(structuredClone(doc));
        expect(installed.statusCode, installed.body).toBe(200);
      },
      SLOW,
    );

    it(
      'Client Portal installs with the released Invoices & Receipts it requires, on the add-on’s shapes',
      async () => {
        const h = (openAddOns = await addOnHarness(dialect));
        await h.stageAddOn(released('invoices'), { bundled: true });
        const portal = released('clients');
        const planned = await h.plan(portal);
        expect(planned.statusCode, planned.body).toBe(200);
        expect(planned.json().plan.problems).toEqual([]);
        expect(planned.json().plan.installable).toBe(true);
        expect(planned.json().plan.addOns).toContainEqual(expect.objectContaining({ key: 'invoices', action: 'install' }));

        const installed = await h.install('clients', String(portal['version']), { planChecksum: planned.json().plan.checksum });
        expect(installed.statusCode, installed.body).toBe(200);
        expect(await h.tableNames()).toEqual(expect.arrayContaining(['clients_invoices', 'clients_invoice_lines', 'clients_proposals']));
      },
      SLOW,
    );

    it(
      'Point of Sale then Online Ordering 0.1.3 install on one connection, each with its own tables',
      async () => {
        const h = (open = await installHarness(dialect));
        const pos = released('pos');
        const ordering = released('ordering');
        const first = await h.install(pos);
        expect(first.statusCode, first.body).toBe(200);
        const second = await h.install(ordering);
        expect(second.statusCode, second.body).toBe(200);
        const names = await tableNames(h, dialect);
        expect(names).toEqual(expect.arrayContaining([...refs(pos).map((ref) => `pos_${ref}`), ...refs(ordering)]));
      },
      SLOW,
    );

    it(
      'Online Ordering 0.1.3 is planned beside Point of Sale with no collision and nothing offered',
      async () => {
        const h = (open = await installHarness(dialect));
        expect((await h.install(released('pos'))).statusCode).toBe(200);
        await h.stage(released('ordering'));
        const planned = await h.inject({ method: 'POST', url: '/apps/plan', payload: { key: 'ordering', version: '0.1.3', connectionId: h.connectionId } });
        expect(planned.statusCode, planned.body).toBe(200);
        const plan = (JSON.parse(planned.body) as { plan: { installable: boolean; problems: unknown[] } }).plan;
        expect(plan.problems).toEqual([]);
        expect(plan.installable).toBe(true);
      },
      SLOW,
    );

    it.each(PLAIN.map(([file, doc]) => [file, doc] as const))(
      '%s is not updated in place by a release that updates from 0.2.0',
      async (_file, doc) => {
        const h = (open = await installHarness(dialect));
        const key = String(doc['key']);
        // Staged before the install, as a download from the catalogue lands it.
        await h.stage(successor(doc));
        const installed = await h.install(structuredClone(doc));
        expect(installed.statusCode, installed.body).toBe(200);

        const planned = await h.inject({ method: 'POST', url: '/apps/plan', payload: { key, version: '0.2.0', connectionId: h.connectionId } });
        expect(planned.statusCode, planned.body).toBe(422);
        expect(JSON.parse(planned.body)).toMatchObject({ error: { code: 'VALIDATION_FAILED', details: { reason: 'UPDATE_NOT_SUPPORTED', from: '0.1.3', to: '0.2.0', updatesFrom: '>=0.2.0' } } });

        const updated = await h.inject({ method: 'POST', url: `/apps/${key}/update` });
        expect(updated.statusCode, updated.body).toBe(422);
        expect(JSON.parse(updated.body)).toMatchObject({ error: { details: { reason: 'UPDATE_NOT_SUPPORTED' } } });

        const listed = JSON.parse((await h.inject({ method: 'GET', url: '/apps' })).body) as { apps: { key: string; version: string }[] };
        expect(listed.apps.find((app) => app.key === key)?.version).toBe('0.1.3');
        expect(await tableNames(h, dialect)).toEqual(expect.arrayContaining(refs(doc)));
      },
      SLOW,
    );

    it(
      'after Online Ordering 0.1.3 is uninstalled with its tables kept, a prefixed release installs fresh beside them and Point of Sale',
      async () => {
        const h = (open = await installHarness(dialect));
        const ordering = released('ordering');
        expect((await h.install(released('pos'))).statusCode).toBe(200);
        expect((await h.install(ordering)).statusCode).toBe(200);
        const removed = await del(h, '/apps/ordering', { dropTables: false });
        expect(removed.statusCode, removed.body).toBe(200);

        const next = successor(ordering, { prefixed: true });
        await h.stage(next);
        const payload = { key: 'ordering', version: '0.2.0', connectionId: h.connectionId };
        // Asked with no answer, the plan collides with nothing (the kept tables are its own).
        const asked = await h.inject({ method: 'POST', url: '/apps/plan', payload });
        expect(asked.statusCode, asked.body).toBe(200);
        const problems = (JSON.parse(asked.body) as { plan: { problems: { code: string }[] } }).plan.problems;
        expect(problems.filter((p) => p.code === 'PREFIX_COLLISION')).toEqual([]);

        // Installed under its own prefix: new tables, the kept ones and Point of Sale's untouched.
        const fresh = { ...payload, altPrefix: 'ordering_' };
        const planned = await h.inject({ method: 'POST', url: '/apps/plan', payload: fresh });
        expect(planned.statusCode, planned.body).toBe(200);
        const plan = (JSON.parse(planned.body) as { plan: { installable: boolean; problems: unknown[] } }).plan;
        expect(plan.problems).toEqual([]);
        expect(plan.installable).toBe(true);
        const installed = await h.inject({ method: 'POST', url: '/apps/install', payload: fresh });
        expect(installed.statusCode, installed.body).toBe(200);
        const names = await tableNames(h, dialect);
        expect(names).toEqual(expect.arrayContaining(refs(next).map((ref) => `ordering_${ref}`)));
        expect(names).toEqual(expect.arrayContaining(refs(ordering)));
        expect(names).toContain('pos_menu_items');
      },
      SLOW,
    );

    it(
      'a fresh prefixed install after the 0.1.3 uninstall creates its own prefixed tables without being asked',
      async () => {
        const h = (open = await installHarness(dialect));
        const ordering = released('ordering');
        expect((await h.install(ordering)).statusCode).toBe(200);
        const removed = await del(h, '/apps/ordering', { dropTables: false });
        expect(removed.statusCode, removed.body).toBe(200);

        const next = successor(ordering, { prefixed: true });
        await h.stage(next);
        const payload = { key: 'ordering', version: '0.2.0', connectionId: h.connectionId };
        const planned = await h.inject({ method: 'POST', url: '/apps/plan', payload });
        expect(planned.statusCode, planned.body).toBe(200);
        const plan = (JSON.parse(planned.body) as { plan: { installable: boolean; problems: unknown[]; names: Record<string, string> } }).plan;
        expect(plan.problems).toEqual([]);
        expect(plan.installable).toBe(true);
        for (const ref of refs(next)) expect(plan.names[ref]).toBe(`ordering_${ref}`);

        const installed = await h.inject({ method: 'POST', url: '/apps/install', payload });
        expect(installed.statusCode, installed.body).toBe(200);
        const names = await tableNames(h, dialect);
        expect(names).toEqual(expect.arrayContaining(refs(next).map((ref) => `ordering_${ref}`)));
        // The kept plain tables are still there, untouched.
        expect(names).toEqual(expect.arrayContaining(refs(ordering)));
      },
      SLOW,
    );

    it(
      'a fresh Online Ordering 0.2.0 beside Point of Sale and kept 0.1.3 tables is offered Point of Sale’s menu',
      async () => {
        const h = (open = await installHarness(dialect));
        const ordering = released('ordering');
        expect((await h.install(released('pos'))).statusCode).toBe(200);
        expect((await h.install(ordering)).statusCode).toBe(200);
        const removed = await del(h, '/apps/ordering', { dropTables: false });
        expect(removed.statusCode, removed.body).toBe(200);

        // Its menu tables declared on the core menu shape, prefixed, updating from 0.2.0.
        const next = orderingSharingMenu();
        await h.stage(next);
        const payload = { key: 'ordering', version: '0.2.0', connectionId: h.connectionId };
        const planned = await h.inject({ method: 'POST', url: '/apps/plan', payload });
        expect(planned.statusCode, planned.body).toBe(200);
        const plan = (JSON.parse(planned.body) as { plan: { problems: unknown[]; installable: boolean; names: Record<string, string>; shareOffers?: { with: string; action: string }[] } }).plan;
        expect(plan.problems).toEqual([]);
        expect(plan.installable).toBe(true);
        expect(plan.shareOffers).toEqual([expect.objectContaining({ with: 'pos', action: 'share' })]);
        expect(plan.names['menu_items']).toBe('pos_menu_items');
        expect(plan.names['orders']).toBe('ordering_orders');

        const installed = await h.inject({ method: 'POST', url: '/apps/install', payload });
        expect(installed.statusCode, installed.body).toBe(200);
        const names = await tableNames(h, dialect);
        // Point of Sale's menu shared, the kept plain tables untouched, the new tables its own.
        expect(names).toEqual(expect.arrayContaining(['pos_menu_items', 'ordering_orders', 'ordering_order_items', ...refs(ordering)]));
        expect(names).not.toContain('ordering_menu_items');
      },
      SLOW,
    );
  });
}
