// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `/invoices` surface against the BUILT stack (34-invoices-add-on.md
 * §3.9, 34-T51): the manager, the New modal's twelve starters, the editor's
 * canvas + inspector, the Add-section modal, the language family, the
 * invoice-from-template path and the list layout.
 *
 * The dashboard suite mounts these through the real router with a fetch stub;
 * the server suite covers the routes in process. What ONLY this file sees:
 * the two lazy chunks mount from the built bundle, a starter minted by the
 * server arrives through a real socket with the ladder the money law says it
 * should have, and a save → reload round trip survives the database.
 *
 * ORDER IS THE FIXTURE. `describe.configure({ mode: 'serial' })` plus the
 * suite's one worker: the empty states are asserted on a cleared workspace,
 * every later test builds on the template the second one creates, and the
 * last test removes what is left. Everything is torn down through the API in
 * `afterAll` so a re-run starts from the same empty install.
 *
 * TWO INSPECTORS ARE MOUNTED AT ONCE (Editor.tsx: the `lg:hidden` drawer
 * under the canvas and the `hidden lg:block` aside). Every panel test id
 * therefore matches twice — `inspector()` scopes to the aside, `drawer()` to
 * the other, and no bare `getByTestId` may address a panel.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

import { signIn } from './helpers.js';

/** The comp's twelve starters (1119-1130) in modal order: key, name, category label. */
const STARTERS: readonly (readonly [string, string, string])[] = [
  ['standard', 'Standard invoice', 'Business'],
  ['receipt', 'Payment receipt', 'Payments'],
  ['proforma', 'Proforma invoice', 'Business'],
  ['credit', 'Credit note', 'Adjustments'],
  ['quote', 'Quote / estimate', 'Sales'],
  ['subscription', 'Subscription invoice', 'Recurring'],
  ['deposit', 'Deposit invoice', 'Payments'],
  ['hourly', 'Hourly / time', 'Services'],
  ['milestone', 'Milestone invoice', 'Projects'],
  ['commercial', 'Commercial invoice', 'Shipping'],
  ['donation', 'Donation receipt', 'Nonprofit'],
  ['retainer', 'Retainer invoice', 'Services'],
];

/**
 * The fifteen standard blocks the *Standard invoice* starter leaves OFF —
 * `OPTIONAL_SECTIONS` (model/blocks.ts) minus the three its patch switches on
 * (`shipShow`, `sigShow`, `termsShow`), in the comp's own order (1258-1263).
 */
const OFF_AFTER_STANDARD = [
  'Attachments',
  'Approval',
  'Payment QR',
  'Late fees',
  'PO terms',
  'Multi-currency',
  'Recurring',
  'Discount codes',
  'Tax breakdown',
  'Payment history',
  'Legal footer',
  'Refund policy',
  'Contact',
  'Loyalty points',
  'Delivery timeline',
];

/** The desktop-inspector aside — the drawer under the canvas carries the same ids. */
function inspector(page: Page): Locator {
  return page.locator('[data-testid="invoices-inspector"][data-variant="aside"]');
}
function drawer(page: Page): Locator {
  return page.locator('[data-testid="invoices-inspector"][data-variant="drawer"]');
}
function canvasSection(page: Page, section: string): Locator {
  return page.locator(`[data-testid="invoices-section"][data-section="${section}"]`);
}
function canvasBlock(page: Page, block: string): Locator {
  return page.locator(`[data-testid="invoices-block"][data-block="${block}"]`);
}

/**
 * The shell's toast stack sits bottom-end and pauses on hover, so it covers
 * the canvas's trailing *Add section*. Dismiss what is on screen first.
 */
async function dismissToasts(page: Page): Promise<void> {
  const dismiss = page.locator('button[aria-label="Dismiss"]');
  for (let guard = 0; guard < 6; guard += 1) {
    if ((await dismiss.count()) === 0) return;
    await dismiss.first().click({ timeout: 2_000 }).catch(() => undefined);
  }
}

interface Row {
  id: string;
  kind: string;
  name: string;
}

async function listInvoices(page: Page): Promise<Row[]> {
  const reply = await page.request.get('/api/v1/invoices');
  expect(reply.ok(), `GET /api/v1/invoices → ${String(reply.status())}`).toBe(true);
  return ((await reply.json()) as { items: Row[] }).items;
}

/** A fresh install: no invoice documents at all (the empty states' precondition). */
async function clearInvoices(page: Page): Promise<void> {
  for (const row of await listInvoices(page)) {
    await page.request.delete(`/api/v1/invoices/${row.id}`);
  }
}

function idFromUrl(page: Page): string {
  const id = new URL(page.url()).pathname.split('/').pop() ?? '';
  expect(id, `no document id in ${page.url()}`).not.toBe('');
  return id;
}

test.describe('the /invoices surface (34-T51)', () => {
  test.describe.configure({ mode: 'serial' });

  /** The Standard-invoice template every later test edits; set by the second test. */
  let templateId = '';

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await signIn(page);
    await clearInvoices(page);
    await page.close();
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await signIn(page);
    await clearInvoices(page);
    await page.close();
  });

  test('the manager mounts from the built bundle with both empty states', async ({ page }, testInfo) => {
    await signIn(page);
    await page.goto('/invoices');
    await expect(page.getByRole('heading', { level: 1, name: 'Invoices' })).toBeVisible();
    await expect(page.getByText('Reusable templates & the invoices you build from them.')).toBeVisible();
    await expect(page.getByTestId('invoices-new')).toHaveText('New template');

    const tabs = page.getByRole('tab');
    await expect(tabs).toHaveText([/^Templates/, /^Invoices/]);
    await expect(page.getByTestId('tab-count')).toHaveText(['0', '0']);

    const empty = page.getByTestId('invoices-empty');
    await expect(empty.getByRole('heading', { name: 'No templates yet' })).toBeVisible();
    await expect(empty.getByText('Create a reusable invoice template your team can build from.')).toBeVisible();
    await expect(empty.getByRole('button', { name: 'New template' })).toBeVisible();
    await testInfo.attach('manager-empty-templates', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

    await page.getByRole('tab', { name: 'Invoices' }).click();
    await expect(page.getByTestId('invoices-new')).toHaveText('New invoice');
    await expect(empty.getByRole('heading', { name: 'No invoices yet' })).toBeVisible();
    await expect(empty.getByText('Build your first invoice from a template or a blank canvas.')).toBeVisible();
    await testInfo.attach('manager-empty-invoices', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  });

  test('New template → Blank + twelve starters → Standard invoice opens the editor', async ({ page }, testInfo) => {
    await signIn(page);
    await page.goto('/invoices');
    await page.getByTestId('invoices-new').click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Start from a blank canvas or a ready-made template.')).toBeVisible();
    // The dashed Blank tile plus the twelve starters (comp 108-141).
    await expect(page.getByTestId('invoices-starter')).toHaveCount(13);
    await expect(page.locator('[data-testid="invoices-starter"][data-starter=""]')).toContainText('Blank invoice');
    for (const [key, name, category] of STARTERS) {
      const tile = page.locator(`[data-testid="invoices-starter"][data-starter="${key}"]`);
      await expect(tile, `starter ${key}`).toContainText(name);
      await expect(tile, `starter ${key} category`).toContainText(category);
    }
    await testInfo.attach('new-template-modal', { body: await page.screenshot(), contentType: 'image/png' });

    await page.locator('[data-testid="invoices-starter"][data-starter="standard"]').click();
    await expect(page).toHaveURL(/\/invoices\/[^/]+$/);
    templateId = idFromUrl(page);

    const header = page.getByTestId('invoices-editor-header');
    await expect(header).toBeVisible();
    await expect(header).toContainText('Template');
    await expect(page.getByTestId('invoices-editor-name')).toHaveValue('Standard invoice');
    await expect(page.getByTestId('invoices-save-chip')).toHaveText('All changes saved');
    await expect(page.getByTestId('invoices-save')).toHaveText('Save template');

    await expect(page.getByTestId('invoices-paper')).toBeVisible();
    await expect(canvasSection(page, 'branding')).toContainText('Branding · click to edit');
    await expect(page.getByTestId('invoices-title')).toHaveText('INVOICE');
    await expect(page.getByTestId('invoices-number')).toHaveText('INV-1000');
    await expect(page.getByTestId('invoices-item-row')).toHaveCount(3);
    await expect(page.getByTestId('invoices-subtotal')).toHaveText('$3,800.00');
    await expect(page.getByTestId('invoices-totals')).toContainText('Tax (8%)');
    await expect(page.getByTestId('invoices-tax')).toHaveText('$304.00');
    await expect(page.getByTestId('invoices-total')).toHaveText('$4,104.00');

    // The three the standard starter switches on (starters.ts `patch`).
    await expect(canvasBlock(page, 'shipping')).toBeVisible();
    await expect(canvasBlock(page, 'signature')).toBeVisible();
    await expect(canvasBlock(page, 'terms')).toBeVisible();
    await testInfo.attach('editor-standard-invoice', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  });

  test('an edit dirties the chip, Save makes ONE PUT, and the reload keeps it', async ({ page }, testInfo) => {
    await signIn(page);
    await page.goto(`/invoices/${templateId}`);
    const chip = page.getByTestId('invoices-save-chip');
    await expect(chip).toHaveText('All changes saved');

    const customer = page.getByRole('textbox', { name: 'Customer name' });
    await expect(customer).toHaveValue('Northwind Traders');
    await customer.click();
    await customer.fill('Northwind Traders GmbH');
    await expect(chip).toHaveText('Unsaved changes');
    await testInfo.attach('editor-dirty', { body: await page.screenshot(), contentType: 'image/png' });

    let puts = 0;
    const count = (request: { method: () => string; url: () => string }): void => {
      if (request.method() === 'PUT' && request.url().includes('/api/v1/invoices/')) puts += 1;
    };
    page.on('request', count);
    await page.getByTestId('invoices-save').click();
    await expect(chip).toHaveText('All changes saved');
    page.off('request', count);
    expect(puts, 'the explicit save is exactly one PUT (O22 → 39 D1)').toBe(1);

    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Customer name' })).toHaveValue('Northwind Traders GmbH');
    await expect(page.getByTestId('invoices-save-chip')).toHaveText('All changes saved');
    await testInfo.attach('editor-saved-reloaded', { body: await page.screenshot(), contentType: 'image/png' });
  });

  test('the Add-section modal lists exactly the off blocks; Late fees goes on and off', async ({ page }, testInfo) => {
    await signIn(page);
    await page.goto(`/invoices/${templateId}`);
    await dismissToasts(page);
    await page.getByTestId('invoices-add-section').click();

    const modal = page.getByTestId('invoices-add-modal');
    await expect(modal).toBeVisible();
    await expect(page.getByTestId('invoices-add-custom')).toHaveCount(4);
    await expect(page.getByTestId('invoices-add-builtin')).toHaveText(OFF_AFTER_STANDARD);
    await testInfo.attach('add-section-modal', { body: await page.screenshot(), contentType: 'image/png' });

    await page.locator('[data-testid="invoices-add-builtin"][data-block="latefees"]').click();
    await expect(modal).toBeHidden();
    const block = canvasBlock(page, 'latefees');
    await expect(block).toBeVisible();
    await expect(block).toContainText('Late payment fee');
    await expect(inspector(page).getByTestId('invoices-inspector-header')).toContainText('Late fees');
    await expect(inspector(page).locator('[data-testid="invoices-inspector-panel"][data-section="latefees"]')).toBeVisible();
    await testInfo.attach('add-section-latefees-on', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

    await inspector(page).getByTestId('invoices-remove-section').click();
    await expect(canvasBlock(page, 'latefees')).toHaveCount(0);
    // `hideSec` (comp 1361) falls the selection back to the items panel.
    await expect(inspector(page).getByTestId('invoices-inspector-header')).toContainText('Line items');
    await testInfo.attach('add-section-latefees-off', { body: await page.screenshot(), contentType: 'image/png' });
  });

  test('the title region opens Title & theme; swatch, currency, decimals and status write through', async ({ page }, testInfo) => {
    await signIn(page);
    await page.goto(`/invoices/${templateId}`);
    await page.getByTestId('invoices-title').click();
    const aside = inspector(page);
    await expect(aside.getByTestId('invoices-inspector-header')).toContainText('Title & theme');
    await expect(aside.getByTestId('invoices-inspector-header')).toContainText('Colour, currency, status');
    await testInfo.attach('inspector-theme', { body: await page.screenshot(), contentType: 'image/png' });

    // The comp's five swatches (1577); the second is the teal.
    const swatches = aside.getByTestId('invoices-swatch');
    await expect(swatches).toHaveCount(5);
    await swatches.nth(1).click();
    await expect(swatches.nth(1)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('invoices-paper')).toHaveCSS('--adm-invoice-accent', '#0d9488');

    await aside.locator('[data-testid="invoices-option"][data-value="€"]').click();
    await expect(page.getByTestId('invoices-total')).toHaveText('€4,104.00');

    await aside.getByTestId('invoices-toggle').first().click();
    await expect(page.getByTestId('invoices-total')).toHaveText('€4,104');

    await aside.locator('[data-testid="invoices-option"][data-value="paid"]').click();
    // The sheet's pill is three plain elements read from the draft (§0.4.6 item 2).
    await expect(page.getByTestId('invoices-status')).toHaveText('Paid');
    await testInfo.attach('canvas-theme-applied', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  });

  test('undo and redo walk the theme edits back and forward', async ({ page }, testInfo) => {
    // Continues the previous test's unsaved draft is NOT possible (a fresh
    // mount), so make the round trip inside this one.
    await signIn(page);
    await page.goto(`/invoices/${templateId}`);
    await page.getByTestId('invoices-title').click();
    const aside = inspector(page);
    const undo = page.getByTestId('invoices-undo');
    const redo = page.getByTestId('invoices-redo');
    await expect(undo).toBeDisabled();
    await expect(redo).toBeDisabled();

    await aside.locator('[data-testid="invoices-option"][data-value="£"]').click();
    await expect(page.getByTestId('invoices-total')).toContainText('£');
    await expect(undo).toBeEnabled();

    await undo.click();
    await expect(page.getByTestId('invoices-total')).not.toContainText('£');
    await expect(redo).toBeEnabled();
    await testInfo.attach('editor-after-undo', { body: await page.screenshot(), contentType: 'image/png' });

    await redo.click();
    await expect(page.getByTestId('invoices-total')).toContainText('£');
    await testInfo.attach('editor-after-redo', { body: await page.screenshot(), contentType: 'image/png' });

    // Leave the document as the previous test left it.
    await undo.click();
    await expect(page.getByTestId('invoices-total')).not.toContainText('£');
  });

  test('Back with a dirty draft raises the discard modal; Keep editing stays', async ({ page }, testInfo) => {
    await signIn(page);
    await page.goto(`/invoices/${templateId}`);
    const name = page.getByTestId('invoices-editor-name');
    await name.click();
    await name.fill('Standard invoice (dirty)');
    await expect(page.getByTestId('invoices-save-chip')).toHaveText('Unsaved changes');

    await page.locator('[data-part="topbar-back"]').click();
    await expect(page.getByTestId('invoices-discard-body')).toContainText('Your edits to Standard invoice (dirty) will be lost.');
    await expect(page.getByRole('dialog')).toContainText('Discard unsaved changes?');
    await testInfo.attach('discard-modal', { body: await page.screenshot(), contentType: 'image/png' });

    await page.getByTestId('invoices-discard-keep').click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByTestId('invoices-editor-header')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/invoices/${templateId}$`));

    // Discard for real so the fixture keeps its name.
    await page.locator('[data-part="topbar-back"]').click();
    await page.getByTestId('invoices-discard-confirm').click();
    await expect(page.getByRole('heading', { level: 1, name: 'Invoices' })).toBeVisible();
    await expect(page.getByTestId('invoices-card-name')).toHaveText(['Standard invoice']);
  });

  test('the language menu creates the linked Deutsch copy and both groupings show it', async ({ page }, testInfo) => {
    await signIn(page);
    await page.goto(`/invoices/${templateId}`);
    await page.getByTestId('invoices-language-button').click();
    const menu = page.getByTestId('invoices-language-menu');
    await expect(menu).toBeVisible();
    const rows = menu.getByTestId('invoices-language-row');
    // The comp's six DOCUMENT languages (1185-1190), not the UI's eight locales.
    await expect(rows).toHaveCount(6);
    await expect(rows).toHaveText([/English/, /Deutsch/, /Français/, /Español/, /Português/, /日本語/]);
    await expect(rows.nth(0)).toHaveAttribute('data-state', 'editing');
    await expect(rows.nth(1)).toContainText('Create');
    await testInfo.attach('language-menu', { body: await page.screenshot(), contentType: 'image/png' });

    await rows.nth(1).click();
    await expect(page).toHaveURL(/\/invoices\/[^/]+$/);
    await expect(page.getByTestId('invoices-editor-name')).toHaveValue('Standard invoice · Deutsch');
    await expect(page.getByTestId('invoices-title')).toHaveText('RECHNUNG');
    await expect(page.getByRole('textbox', { name: 'Terms', exact: true })).toHaveValue('Netto 30');
    await expect(page.getByTestId('invoices-language-button')).toContainText('DE');
    await testInfo.attach('editor-deutsch', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

    await page.goto('/invoices');
    await expect(page.getByTestId('invoices-card')).toHaveCount(2);
    await page.getByTestId('invoices-group-by').getByRole('radio', { name: 'Language' }).click();
    const headers = page.getByTestId('invoices-group-header');
    await expect(headers).toHaveCount(2);
    await expect(headers.nth(0)).toContainText('English');
    await expect(headers.nth(1)).toContainText('Deutsch · German');
    await testInfo.attach('manager-group-language', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

    await page.getByTestId('invoices-group-by').getByRole('radio', { name: 'Topic' }).click();
    await expect(page.getByTestId('invoices-group-header')).toHaveCount(1);
    await expect(page.getByTestId('invoices-group-header')).toContainText('Recurring');
    await expect(page.getByTestId('invoices-group-sub')).toHaveText('2 documents · 2 languages');
    await testInfo.attach('manager-group-topic', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    await page.getByTestId('invoices-group-by').getByRole('radio', { name: 'None' }).click();
  });

  test('New invoice offers Your templates; the pick mints INV-1001', async ({ page }, testInfo) => {
    await signIn(page);
    await page.goto('/invoices');
    await page.getByRole('tab', { name: 'Invoices' }).click();
    await expect(page.getByTestId('invoices-new')).toHaveText('New invoice');
    await page.getByTestId('invoices-new').click();

    const your = page.getByTestId('invoices-your-templates');
    await expect(your).toBeVisible();
    await expect(your).toContainText('Your templates');
    const tile = page.locator(`[data-testid="invoices-from-template"][data-template="${templateId}"]`);
    await expect(tile).toContainText('Standard invoice');
    await testInfo.attach('new-invoice-modal', { body: await page.screenshot(), contentType: 'image/png' });

    await tile.click();
    await expect(page).toHaveURL(/\/invoices\/[^/]+$/);
    await expect(page.getByTestId('invoices-editor-header')).toContainText('Invoice');
    await expect(page.getByTestId('invoices-number')).toHaveText('INV-1001');
    await expect(page.getByTestId('invoices-save')).toHaveText('Save invoice');
    await testInfo.attach('editor-invoice-from-template', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  });

  test('the list layout renames, duplicates in place and deletes behind the modal', async ({ page }, testInfo) => {
    await signIn(page);
    await page.goto('/invoices');
    await page.getByTestId('invoices-layout').getByRole('radio', { name: 'List' }).click();
    const table = page.getByTestId('invoices-list');
    await expect(table).toBeVisible();
    await expect(table.getByRole('columnheader')).toHaveText(['Name', 'Status', 'Updated', 'Actions']);
    await expect(page.getByTestId('invoices-row')).toHaveCount(2);
    await testInfo.attach('manager-list', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

    // Rename the English template inline; Enter commits (comp 1391).
    const first = page.getByTestId('invoices-row').first();
    await first.getByRole('button', { name: 'Rename' }).click();
    const rename = page.getByTestId('invoices-rename');
    await rename.fill('Standard invoice renamed');
    await rename.press('Enter');
    await expect(page.getByTestId('invoices-row').first()).toContainText('Standard invoice renamed');
    await testInfo.attach('manager-list-renamed', { body: await page.screenshot(), contentType: 'image/png' });

    // Duplicate lands directly after its source, as "{name} (copy)" (comp 1384).
    await page.getByTestId('invoices-row').first().getByRole('button', { name: 'Duplicate' }).click();
    await expect(page.getByText('Template duplicated')).toBeVisible();
    await expect(page.getByTestId('invoices-row')).toHaveCount(3);
    await expect(page.getByTestId('invoices-row').nth(1)).toContainText('Standard invoice renamed (copy)');
    await testInfo.attach('manager-list-duplicated', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    await dismissToasts(page);

    await page.getByTestId('invoices-row').nth(1).getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('dialog')).toContainText('Delete Standard invoice renamed (copy)?');
    await expect(page.getByTestId('invoices-delete-body')).toHaveText('This can’t be undone. The template will be permanently removed.');
    await testInfo.attach('delete-modal', { body: await page.screenshot(), contentType: 'image/png' });
    await page.getByTestId('invoices-delete-confirm').click();
    await expect(page.getByTestId('invoices-row')).toHaveCount(2);
    await page.getByTestId('invoices-layout').getByRole('radio', { name: 'Gallery' }).click();
  });

  test('at 390 px the editor keeps the canvas and moves the inspector into its drawer', async ({ page }, testInfo) => {
    // `signIn` waits for the primary nav, which the narrow shell collapses — sign in wide first.
    await signIn(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/invoices/${templateId}`);
    await expect(page.getByTestId('invoices-canvas')).toBeVisible();
    await expect(page.getByTestId('invoices-paper')).toBeVisible();
    await expect(drawer(page)).toBeVisible();
    await expect(inspector(page)).toBeHidden();
    await drawer(page).scrollIntoViewIfNeeded();
    await expect(drawer(page).getByTestId('invoices-inspector-header')).toBeVisible();

    // The shell must never scroll SIDEWAYS: the header's action row is one flex line and
    // held itself at 471 px inside this 390 px viewport until it was told to wrap.
    const scroll = await page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth }));
    expect(scroll.scrollW, `the editor scrolls the page horizontally at 390 px (${String(scroll.scrollW)} > ${String(scroll.clientW)})`).toBeLessThanOrEqual(scroll.clientW);
    await testInfo.attach('editor-390', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

    await page.goto('/invoices');
    await expect(page.getByTestId('invoices-card')).toHaveCount(2);
    await testInfo.attach('manager-390', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  });
});
