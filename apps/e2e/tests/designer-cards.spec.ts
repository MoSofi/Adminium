// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ADMINIUM DESIGNER BUILDS ON OFFERS, END TO END, WITH A SCRIPTED MODEL.
 *
 * "Sell gift cards at the till, and let people pay with one." The model
 * writes the till's own tables and calls build_on_shape twice with them; the
 * person is asked once, on a card, for the add-on (it is among the add-ons
 * the server came with, and adds its tables), and says yes; the app is
 * checked and applied, which installs the add-on in the project's database.
 * Then the proof no model can give: a ticket with a line that loads 25.00 is
 * paid and the card holds 25.00; the card then pays a 10.00 ticket and holds
 * 15.00.
 *
 * Offers is the package as the add-ons repository builds it, put in the
 * folder a server finds the add-ons it comes with. Needs that checkout built
 * (`ADMINIUM_ADD_ONS_REPO`), its deciding file trusted
 * (`ADMINIUM_ADD_ON_DEV_TRUST=offers`) and a server of 0.3.19 or later.
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

const KEY = 'offers';
const APP_KEY = 'corner-till';
const REPO = process.env['ADMINIUM_ADD_ONS_REPO'];
const PACKAGE = REPO === undefined || REPO === '' ? null : join(REPO, 'packages', KEY);
const built = PACKAGE !== null && existsSync(join(PACKAGE, 'dist', 'server.js'));
const trusted = (process.env['ADMINIUM_ADD_ON_DEV_TRUST'] ?? '').split(',').includes(KEY);
const serverVersion = (JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'server', 'package.json'), 'utf8')) as { version: string }).version;
const [major = 0, minor = 0, patch = 0] = serverVersion.split(/[.-]/).map(Number);
const newEnough = major > 0 || minor > 3 || (minor === 3 && patch >= 19);
const REPLY = 'A line on a ticket can now sell a gift card, and a payment can be a card.';
const PAID = { post: { column: 'status', in: ['paid'] }, reverse: { column: 'status', from: ['paid'], in: ['void'] } };

let project: ProjectHarness;
let model: Server;
let link: string;

async function ok<T>(res: APIResponse): Promise<T> {
  expect(res.ok(), `${String(res.status())} ${(await res.text()).slice(0, 600)}`).toBe(true);
  return (await res.json()) as T;
}

test.describe('the Designer builds a till on Offers', () => {
  test.skip(!built, 'the add-ons checkout is not built here: set ADMINIUM_ADD_ONS_REPO to it and run `npm run build` in packages/offers');
  test.skip(!trusted, 'an add-on\'s deciding file runs only when trusted: set ADMINIUM_ADD_ON_DEV_TRUST=offers');
  test.skip(!newEnough, `this build is ${serverVersion}: Offers runs on a server from 0.3.19 on`);
  test.use({ storageState: { cookies: [], origins: [] } });

  // eslint-disable-next-line no-empty-pattern -- Playwright reads fixtures from this pattern, and the hook needs none.
  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(240_000);
    // The package as it would be published, beside its fingerprint, in the folder of add-ons a server comes with.
    const bundle = mkdtempSync(join(tmpdir(), 'adminium-designer-cards-'));
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
    const money = (ref: string, label: string) => ({ ref, type: 'money', scale: 'currency', nullable: true, label: { 'en-US': label } });
    // What the model writes itself: the till's own tables, nothing about cards.
    const files = {
      'manifest/tables/tickets.json': {
        ref: 'tickets',
        label: { 'en-US': 'Ticket' },
        labelPlural: { 'en-US': 'Tickets' },
        columns: [
          { ref: 'id', type: 'int', role: 'pk' },
          { ref: 'status', type: 'enum', enum: ['open', 'paid', 'void'], default: 'open', label: { 'en-US': 'Status' } },
          money('due', 'Still to pay'),
        ],
      },
      'manifest/tables/ticket_lines.json': {
        ref: 'ticket_lines',
        label: { 'en-US': 'Line' },
        labelPlural: { 'en-US': 'Lines' },
        columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'ticket_id', type: 'fk', references: 'tickets' }, money('line_total', 'Total')],
      },
      'manifest/tables/payments.json': {
        ref: 'payments',
        label: { 'en-US': 'Payment' },
        labelPlural: { 'en-US': 'Payments' },
        columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'ticket_id', type: 'fk', references: 'tickets' }, money('amount', 'Amount')],
      },
      [`manifest/pages/${APP_KEY}-tickets.json`]: page('tickets', 'Tickets', 1),
      [`manifest/pages/${APP_KEY}-ticket-lines.json`]: page('ticket_lines', 'Lines', 2),
      [`manifest/pages/${APP_KEY}-payments.json`]: page('payments', 'Payments', 3),
      'manifest/roles.json': [{ key: 'staff', name: 'Till staff', permissions: [...grants('tickets'), ...grants('ticket_lines'), ...grants('payments')] }],
    };
    model = createDesignerModelServer({
      appKey: APP_KEY,
      appName: 'Corner Till',
      files: Object.fromEntries(Object.entries(files).map(([file, value]) => [file, JSON.stringify(value, null, 2)])),
      then: [
        ['build_on_shape', { add_on: KEY, shape: 'card-sale@1', tables: { 'card-sale@1/order': 'tickets', 'card-sale@1/lines': 'ticket_lines' }, when: PAID }],
        [
          'build_on_shape',
          {
            add_on: KEY,
            shape: 'card-payment@1',
            tables: { 'card-payment@1/order': 'tickets', 'card-payment@1/payments': 'payments' },
            columns: { amount: 'amount', due: 'due' },
            when: { post: { create: true }, reverse: { column: 'voided_at', set: true } },
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

  test('the rules are written by the tool, the app is applied with Offers, and a card is sold and then pays', async ({ page }, testInfo) => {
    testInfo.setTimeout(300_000);
    await page.goto(link);
    await page.getByRole('textbox', { name: 'Describe your app' }).fill('Sell gift cards at the till, and let people pay with one.');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/design\/ds_[0-9a-z]{24}$/);

    const staff = page.request;
    // Offers is in this server's store and not installed: the first shape asks for it, with what it adds.
    await expect(page.getByText('This app needs the add-on Offers & gift cards')).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText(/^It adds \d+ tables to your database\.$/)).toBeVisible();
    await page.getByRole('button', { name: 'Install it' }).click();
    // The turn: both rules written (the second asks nothing), the app checked, applied with its add-on, saved as v1.
    await expect(page.getByText(REPLY)).toBeVisible({ timeout: 180_000 });
    await expect(page.getByText(/^Saved as v1$/)).toBeVisible();
    await page.getByRole('button', { name: /steps ·/ }).click();
    await expect(page.getByText('Checked the app — no errors')).toBeVisible();

    // What the tool wrote into the folder: the shape's columns and rules on the till's own tables, and no "builtOn".
    const read = (ref: string) => JSON.parse(project.read(`apps/${APP_KEY}/manifest/tables/${ref}.json`)) as { builtOn?: string; columns: { ref: string }[]; postings?: { id: string; into: unknown; map: unknown }[] };
    expect(read('ticket_lines').columns.map((column) => column.ref)).toEqual(['id', 'ticket_id', 'line_total', 'gift_card_id', 'load_amount']);
    expect(read('ticket_lines').postings?.[0]).toMatchObject({ id: 'card-load', into: { addOn: KEY, ledger: 'value', action: 'issue' }, map: { card: 'gift_card_id', amount: 'load_amount' } });
    expect(read('payments').postings?.[0]).toMatchObject({ id: 'card', into: { addOn: KEY, ledger: 'value', action: 'spend' }, map: { card: 'card_id', due: { parent: 'due' }, amount: 'amount' } });
    for (const ref of ['tickets', 'ticket_lines', 'payments']) expect(read(ref).builtOn, ref).toBeUndefined();

    // The drawing: the lines and the payments are joined to Offers.
    await page.getByRole('tab', { name: 'Architecture' }).click();
    await expect(page.getByRole('heading', { name: 'How Corner Till fits together' })).toBeVisible();
    await page.getByRole('switch').click();
    await expect(page.getByRole('button', { name: /^ticket_lines/ }).filter({ hasText: 'Posts into Offers' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^payments/ }).filter({ hasText: 'Posts into Offers' })).toBeVisible();

    // ── what no model can show: a card is loaded, and pays ───────────────
    const connections = await ok<{ connections: { id: string }[] }>(await staff.get('/api/v1/connections'));
    const connectionId = connections.connections[0]!.id;
    const schema = await ok<{ model: { tables: { id: string; name: string }[] } }>(await staff.get(`/api/v1/connections/${connectionId}/schema`));
    const tableOf = (name: string) => {
      const found = schema.model.tables.find((one) => one.name === name);
      expect(found, `${name} among ${schema.model.tables.map((one) => one.name).join(', ')}`).toBeDefined();
      return encodeURIComponent(found!.id);
    };
    type Row = Record<string, unknown> & { id: number };
    const one = async (name: string, id: number) => (await ok<{ data: Row }>(await staff.get(`/api/v1/data/${connectionId}/${tableOf(name)}/${String(id)}`))).data;
    const create = async (name: string, values: Record<string, unknown>) => (await ok<{ data: Row }>(await staff.post(`/api/v1/data/${connectionId}/${tableOf(name)}`, { data: { values } }))).data;
    const change = async (name: string, id: number, values: Record<string, unknown>) => ok(await staff.patch(`/api/v1/data/${connectionId}/${tableOf(name)}/${String(id)}`, { data: { values } }));

    // A card made for the sale: it holds nothing and is not active until the ticket is paid.
    const card = await create('offers_gift_cards', { recipient_name: 'Ada' });
    const sale = await create('corner_till_tickets', { status: 'open' });
    await create('corner_till_ticket_lines', { ticket_id: sale.id, gift_card_id: card.id, load_amount: '25.00', line_total: '25.00' });
    expect(Number((await one('offers_gift_cards', card.id))['balance'])).toBe(0);
    await change('corner_till_tickets', sale.id, { status: 'paid' });
    const loaded = await one('offers_gift_cards', card.id);
    expect([String(loaded['status']), Number(loaded['balance'])]).toEqual(['active', 25]);

    // The card pays what is due on another ticket, and no more.
    const bought = await create('corner_till_tickets', { due: '10.00' });
    const payment = await create('corner_till_payments', { ticket_id: bought.id, card_code: String(loaded['code']) });
    const paid = await one('corner_till_payments', payment.id);
    expect([Number(paid['amount']), Number(paid['card_balance_after'])]).toEqual([10, 15]);
    expect(Number((await one('offers_gift_cards', card.id))['balance'])).toBe(15);
    // Taken back, the card holds it again.
    await change('corner_till_payments', payment.id, { voided_at: new Date().toISOString() });
    expect(Number((await one('offers_gift_cards', card.id))['balance'])).toBe(25);
  });
});
