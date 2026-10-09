// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ADMINIUM DESIGNER BUILDS ON INVENTORY, END TO END, WITH A SCRIPTED MODEL.
 *
 * "A small clinic app: patients, visits, and track the supplies each visit
 * uses." The model writes the app's own tables and calls post_to_ledger; the
 * app is checked and applied, which installs the add-on in the project's
 * database (it is among the add-ons the server came with, so no card asks). Then the proof no model can give: a visit with one
 * supply line of two is marked seen, and the shelf holds two less.
 *
 * Inventory is the package as the add-ons repository builds it, put in the
 * folder a server finds the add-ons it comes with. Needs that checkout built
 * (`ADMINIUM_ADD_ONS_REPO`), its deciding file trusted
 * (`ADMINIUM_ADD_ON_DEV_TRUST=inventory`) and a server of 0.3.18 or later.
 * Without one of them the test is skipped and says which.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test, type APIResponse } from '@playwright/test';

import { createDesignerModelServer } from '../scripts/fake-llm.mjs';
import { ProjectHarness } from './projectHarness.js';

const KEY = 'inventory';
const APP_KEY = 'clinic-visits';
const REPO = process.env['ADMINIUM_ADD_ONS_REPO'];
const PACKAGE = REPO === undefined || REPO === '' ? null : join(REPO, 'packages', KEY);
const built = PACKAGE !== null && existsSync(join(PACKAGE, 'dist', 'server.js'));
const trusted = (process.env['ADMINIUM_ADD_ON_DEV_TRUST'] ?? '').split(',').includes(KEY);
const serverVersion = (JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'server', 'package.json'), 'utf8')) as { version: string }).version;
const [major = 0, minor = 0, patch = 0] = serverVersion.split(/[.-]/).map(Number);
const newEnough = major > 0 || minor > 3 || (minor === 3 && patch >= 18);
const REPLY = 'Supplies now come out of stock when a visit is marked seen.';

let project: ProjectHarness;
let model: Server;
let link: string;

async function ok<T>(res: APIResponse): Promise<T> {
  expect(res.ok(), `${String(res.status())} ${(await res.text()).slice(0, 600)}`).toBe(true);
  return (await res.json()) as T;
}

test.describe('the Designer builds a supplies app on Inventory', () => {
  test.skip(!built, 'the add-ons checkout is not built here: set ADMINIUM_ADD_ONS_REPO to it and run `npm run build` in packages/inventory');
  test.skip(!trusted, 'an add-on\'s deciding file runs only when trusted: set ADMINIUM_ADD_ON_DEV_TRUST=inventory');
  test.skip(!newEnough, `this build is ${serverVersion}: a table posts into an add-on from 0.3.18 on`);
  test.use({ storageState: { cookies: [], origins: [] } });

  // eslint-disable-next-line no-empty-pattern -- Playwright reads fixtures from this pattern, and the hook needs none.
  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(240_000);
    // The package as it would be published, beside its fingerprint, in the folder of add-ons a server comes with.
    const bundle = mkdtempSync(join(tmpdir(), 'adminium-designer-stock-'));
    const [packed] = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', bundle], { cwd: PACKAGE!, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) as { filename: string }[];
    const tarball = join(bundle, `${KEY}-${/(\d+\.\d+\.\d+)\.tgz$/.exec(packed!.filename)![1]!}.tgz`);
    writeFileSync(tarball, readFileSync(join(bundle, packed!.filename)));
    writeFileSync(`${tarball}.integrity`, `sha512-${createHash('sha512').update(readFileSync(tarball)).digest('base64')}\n`);

    project = await ProjectHarness.create({}, ['react', 'react-dom']);
    const slug = (ref: string) => `${APP_KEY}-${ref.split('_').join('-')}`;
    const page = (ref: string, title: string, order: number) => ({
      ref: slug(ref),
      template: 'page-crud',
      title: { key: `${APP_KEY}.${ref}`, fallback: title },
      nav: { group: 'main', icon: 'list-checks', order },
      bindings: { rows: ref },
    });
    const grants = (ref: string) => [`table:@${ref}:read`, `table:@${ref}:create`, `table:@${ref}:update`, `page:@${slug(ref)}:view`];
    // What the model writes itself: the app's own tables, nothing about stock.
    const files = {
      'manifest/tables/patients.json': {
        ref: 'patients',
        label: { 'en-US': 'Patient' },
        labelPlural: { 'en-US': 'Patients' },
        keyField: 'name',
        columns: [
          { ref: 'id', type: 'int', role: 'pk' },
          { ref: 'name', type: 'text', maxLength: 120, default: '', label: { 'en-US': 'Name' } },
        ],
      },
      'manifest/tables/visits.json': {
        ref: 'visits',
        label: { 'en-US': 'Visit' },
        labelPlural: { 'en-US': 'Visits' },
        columns: [
          { ref: 'id', type: 'int', role: 'pk' },
          { ref: 'patient_id', type: 'fk', references: 'patients' },
          { ref: 'status', type: 'enum', enum: ['booked', 'seen', 'cancelled'], default: 'booked', label: { 'en-US': 'Status' } },
        ],
      },
      'manifest/tables/visit_supplies.json': {
        ref: 'visit_supplies',
        label: { 'en-US': 'Supply used' },
        labelPlural: { 'en-US': 'Supplies used' },
        columns: [
          { ref: 'id', type: 'int', role: 'pk' },
          { ref: 'visit_id', type: 'fk', references: 'visits' },
        ],
      },
      [`manifest/pages/${APP_KEY}-patients.json`]: page('patients', 'Patients', 1),
      [`manifest/pages/${APP_KEY}-visits.json`]: page('visits', 'Visits', 2),
      [`manifest/pages/${APP_KEY}-visit-supplies.json`]: page('visit_supplies', 'Supplies used', 3),
      'manifest/roles.json': [{ key: 'staff', name: 'Clinic staff', permissions: [...grants('patients'), ...grants('visits'), ...grants('visit_supplies')] }],
    };
    model = createDesignerModelServer({
      appKey: APP_KEY,
      appName: 'Clinic Visits',
      files: Object.fromEntries(Object.entries(files).map(([file, value]) => [file, JSON.stringify(value, null, 2)])),
      then: [
        [
          'post_to_ledger',
          {
            add_on: KEY,
            ledger: 'stock',
            action: 'use-item',
            table: 'visit_supplies',
            via: 'visit_id',
            when: { post: { column: 'status', in: ['seen'] }, reverse: { column: 'status', from: ['seen'], in: ['booked', 'cancelled'] } },
            role: 'staff',
          },
        ],
      ],
      reply: REPLY,
    });
    await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', resolve));
    const modelUrl = `http://127.0.0.1:${String((model.address() as AddressInfo).port)}`;
    link = await project.design({ ADMINIUM_AI_OLLAMA_BASE_URL: modelUrl, ADMINIUM_AI_MODEL: 'ollama/fake', ADMINIUM_BUNDLED_ADD_ONS: bundle, ADMINIUM_ADD_ON_DEV_TRUST: KEY });
  });

  test.afterAll(async () => {
    await project?.close();
    await new Promise<void>((resolve) => (model === undefined ? resolve() : model.close(() => resolve())));
  });

  // eslint-disable-next-line no-empty-pattern -- Playwright reads fixtures from this pattern, and the hook needs none.
  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) await testInfo.attach('design server output', { body: project.output(), contentType: 'text/plain' });
  });

  test('the rule is written by the tool, the app is applied with Inventory, and a visit marked seen takes its supplies', async ({ page }, testInfo) => {
    testInfo.setTimeout(300_000);
    await page.goto(link);
    await page.getByRole('textbox', { name: 'Describe your app' }).fill('A small clinic app: patients, visits, and track the supplies each visit uses.');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/design\/ds_[0-9a-z]{24}$/);

    const staff = page.request;
    // Inventory is in this server's store and not installed: the rule asks for it first, with what it adds.
    await expect(page.getByText('This app needs the add-on Inventory')).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText(/^It adds \d+ tables to your database\.$/)).toBeVisible();
    await page.getByRole('button', { name: 'Install it' }).click();
    // The turn: the rule written, the app checked, applied with its add-on, saved as v1.
    await expect(page.getByText(REPLY)).toBeVisible({ timeout: 180_000 });
    await expect(page.getByText(/^Saved as v1$/)).toBeVisible();
    await page.getByRole('button', { name: /steps ·/ }).click();
    await expect(page.getByText('Checked the app — no errors')).toBeVisible();
    await expect(page.getByText('Built on an add-on')).toBeVisible();

    // What the tool wrote into the folder.
    const table = JSON.parse(project.read(`apps/${APP_KEY}/manifest/tables/visit_supplies.json`)) as { columns: { ref: string }[]; postings: { into: unknown; map: unknown }[] };
    expect(table.columns.map((column) => column.ref)).toEqual(['id', 'visit_id', 'item_id', 'qty']);
    expect(table.postings[0]).toMatchObject({ into: { addOn: KEY, ledger: 'stock', action: 'use-item' }, map: { item: 'item_id', quantity: 'qty' } });

    // The drawing: the supplies table is joined to Inventory.
    await page.getByRole('tab', { name: 'Architecture' }).click();
    await expect(page.getByRole('heading', { name: 'How Clinic Visits fits together' })).toBeVisible();
    await page.getByRole('switch').click();
    await expect(page.getByRole('button', { name: /^visit_supplies/ }).filter({ hasText: 'Posts into Inventory' })).toBeVisible();

    // ── what no model can show: stock moves ─────────────────────────────
    const connections = await ok<{ connections: { id: string }[] }>(await staff.get('/api/v1/connections'));
    const connectionId = connections.connections[0]!.id;
    const schema = await ok<{ model: { tables: { id: string; name: string }[] } }>(await staff.get(`/api/v1/connections/${connectionId}/schema`));
    const tableOf = (name: string) => {
      const found = schema.model.tables.find((one) => one.name === name);
      expect(found, `${name} among ${schema.model.tables.map((one) => one.name).join(', ')}`).toBeDefined();
      return encodeURIComponent(found!.id);
    };
    const rows = async <T>(name: string) => (await ok<{ data: T[] }>(await staff.get(`/api/v1/data/${connectionId}/${tableOf(name)}?pageSize=200`))).data;
    const create = async (name: string, values: Record<string, unknown>) => (await ok<{ data: { id: number } }>(await staff.post(`/api/v1/data/${connectionId}/${tableOf(name)}`, { data: { values } }))).data.id;

    // A month of stock, by the add-on's own button.
    await ok(await staff.post(`/api/v1/add-ons/${KEY}/sample-data`));
    await expect.poll(async () => (await ok<{ loaded: boolean }>(await staff.get(`/api/v1/add-ons/${KEY}/sample-data`))).loaded, { timeout: 180_000, intervals: [1000] }).toBe(true);
    // A shelf that holds enough of something, and that shelf made the one a use with no place takes from.
    type Point = { item_id: number; place_id: number; on_hand: unknown; item_name: string };
    const shelf = (await rows<Point>('inventory_stock_points')).find((point) => Number(point.on_hand) >= 5)!;
    expect(shelf, 'a stock point of the sample with five or more on hand').toBeDefined();
    const [settings] = await rows<{ id: number }>('inventory_settings');
    await ok(await staff.patch(`/api/v1/data/${connectionId}/${tableOf('inventory_settings')}/${String(settings!.id)}`, { data: { values: { default_place_id: shelf.place_id } } }));
    const onHand = async () => Number((await rows<Point>('inventory_stock_points')).find((point) => point.item_id === shelf.item_id && point.place_id === shelf.place_id)!.on_hand);
    const had = await onHand();

    const patient = await create('clinic_visits_patients', { name: 'Mara Lindqvist' });
    const visit = await create('clinic_visits_visits', { patient_id: patient });
    await create('clinic_visits_visit_supplies', { visit_id: visit, item_id: shelf.item_id, qty: 2 });
    // Booked: nothing is taken yet.
    expect(await onHand()).toBe(had);
    await ok(await staff.patch(`/api/v1/data/${connectionId}/${tableOf('clinic_visits_visits')}/${String(visit)}`, { data: { values: { status: 'seen' } } }));
    expect(await onHand()).toBe(had - 2);
    // And given back when the visit is not seen after all.
    await ok(await staff.patch(`/api/v1/data/${connectionId}/${tableOf('clinic_visits_visits')}/${String(visit)}`, { data: { values: { status: 'booked' } } }));
    expect(await onHand()).toBe(had);
  });
});
