// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `/invoices` surfaces under axe: the manager in gallery and list, its
 * New and Delete modals; the editor with EVERY optional block on and one of
 * each custom section type; the Add-section modal; the inspector on ten
 * sections; and the 390 px drawer — each in light and dark. Zero
 * serious/critical violations is the gate; the lesser counts are annotated
 * per state so a regression in them is visible in the report.
 *
 * Theme is the signed-in user's own pref (`PATCH /api/v1/me/prefs`, applied
 * on reload) and is restored to "inherit" afterwards, because the suite
 * shares one seeded account and runs serially.
 *
 * AN OPEN LAYER IS ANALYSED WITHIN ITSELF. Radix marks everything outside a
 * modal `aria-hidden` and traps focus inside it (the APG pattern); axe's
 * `aria-hidden-focus` rule reads the trapped-out background as "hidden but
 * focusable" and fails every overlay of every Radix surface in the product.
 * That is a primitive-versus-rule conflict recorded, not masked here: the
 * page-level states still run over the whole document.
 *
 * THE SCRATCH DOCUMENTS ARE MADE AND REMOVED THROUGH THE API, and this file
 * clears the workspace's invoice documents when it is done — `invoices.spec.ts`
 * asserts the empty states of a fresh install and Playwright runs
 * `invoices-a11y` first (`-` sorts before `.`).
 */
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';

import { signIn } from './helpers.js';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const BLOCKING = new Set(['critical', 'serious']);

/** The eighteen `*Show` flags (model/blocks.ts `OptionalFlag`). */
const OPTIONAL_FLAGS = [
  'shipShow',
  'sigShow',
  'termsShow',
  'attachShow',
  'approvalShow',
  'qrShow',
  'lateShow',
  'poShow',
  'mcShow',
  'recurShow',
  'discShow',
  'taxbShow',
  'payhShow',
  'legalShow',
  'refShow',
  'conShow',
  'loyShow',
  'delShow',
] as const;

/** One of each of the four user-authored types (model/ops.ts `newCustomSection`). */
const CUSTOM_SECTIONS = [
  { id: 'cs_a11y_text', type: 'text', title: 'Additional notes', body: 'Add your own copy here — scope, delivery notes, conditions or a message to the client.' },
  { id: 'cs_a11y_image', type: 'image', title: 'Image', url: '', caption: 'Add a caption', height: 200 },
  {
    id: 'cs_a11y_kv',
    type: 'kv',
    title: 'Reference details',
    rows: [
      { k: 'Cost centre', v: 'CC-4410' },
      { k: 'Contract', v: 'MSA-2026-08' },
    ],
  },
  {
    id: 'cs_a11y_gallery',
    type: 'gallery',
    title: 'Images',
    images: [
      { id: 'cs_a11y_gallerya', url: '' },
      { id: 'cs_a11y_galleryb', url: '' },
      { id: 'cs_a11y_galleryc', url: '' },
    ],
  },
] as const;

/** Ten inspector sections, reached by clicking their region on the sheet. */
const SECTION_SWEEP = ['branding', 'theme', 'from', 'customer', 'meta', 'items', 'tax', 'payment', 'notes', 'qr'] as const;

interface Sweep {
  states: number;
  minor: number;
  /** One entry per state that failed; asserted once at the end of the test. */
  failures: string[];
}

function inspector(page: Page): Locator {
  return page.locator('[data-testid="invoices-inspector"][data-variant="aside"]');
}

async function sweep(page: Page, label: string, tally: Sweep, testInfo: TestInfo, within?: string): Promise<void> {
  // Overlays fade in; axe reads computed colours, so a dialog measured mid-transition
  // reports its backdrop-blended colours and fails contrast it passes at rest.
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
  const builder = new AxeBuilder({ page }).withTags(TAGS);
  const results = await (within === undefined ? builder : builder.include(within)).analyze();
  const blocking = results.violations.filter((violation) => BLOCKING.has(violation.impact ?? ''));
  const lesser = results.violations.filter((violation) => !BLOCKING.has(violation.impact ?? ''));
  tally.states += 1;
  tally.minor += lesser.length;
  if (lesser.length > 0) {
    testInfo.annotations.push({ type: 'axe-lesser', description: `${label}: ${lesser.map((v) => `${String(v.impact)}:${v.id}`).join(', ')}` });
  }
  const report = blocking
    .map(
      (v) =>
        `${String(v.impact)}: ${v.id} — ${v.help}\n` +
        v.nodes
          .slice(0, 4)
          .map((n) => `    ${n.target.join(' ')}\n      ${n.html.slice(0, 200)}\n      ${n.any.map((check) => JSON.stringify(check.data)).join(' ')}`)
          .join('\n'),
    )
    .join('\n');
  // Collected, not thrown: one run should name EVERY failing state, not stop at the first.
  if (blocking.length > 0) tally.failures.push(`${label} — ${String(blocking.length)} blocking:\n${report}`);
}

async function setPrefs(page: Page, prefs: { theme: string | null; locale: string | null }): Promise<void> {
  const reply = await page.request.patch('/api/v1/me/prefs', { data: prefs });
  expect(reply.ok(), `prefs → ${String(reply.status())}`).toBe(true);
}

interface Scratch {
  /** The template carrying every optional block and all four custom types. */
  fullId: string;
  /** A second row so the manager draws more than one card and a group. */
  siblingId: string;
}

async function makeScratch(page: Page): Promise<Scratch> {
  const created = await page.request.post('/api/v1/invoices', { data: { kind: 'template', name: 'A11y sweep', starter: 'standard' } });
  expect(created.status(), await created.text()).toBe(201);
  const doc = (await created.json()) as { id: string; status: string; topic: string; lang: string; body: Record<string, unknown> };

  const body: Record<string, unknown> = { ...doc.body };
  for (const flag of OPTIONAL_FLAGS) body[flag] = true;
  body['custom'] = CUSTOM_SECTIONS;
  body['blockOrder'] = [...(doc.body['blockOrder'] as string[]), ...CUSTOM_SECTIONS.map((section) => `cus:${section.id}`)];
  body['discountRate'] = '5'; // the ladder's discount row only draws above zero

  const put = await page.request.put(`/api/v1/invoices/${doc.id}`, {
    data: { name: 'A11y sweep', status: doc.status, topic: doc.topic, lang: doc.lang, body },
  });
  expect(put.ok(), await put.text()).toBe(true);

  const sibling = await page.request.post(`/api/v1/invoices/${doc.id}/languages`, { data: { lang: 'de' } });
  expect(sibling.status(), await sibling.text()).toBe(201);
  return { fullId: doc.id, siblingId: ((await sibling.json()) as { id: string }).id };
}

/** Leave the workspace as `invoices.spec.ts` needs to find it: empty. */
async function clearInvoices(page: Page): Promise<void> {
  const reply = await page.request.get('/api/v1/invoices');
  if (!reply.ok()) return;
  for (const row of ((await reply.json()) as { items: { id: string }[] }).items) {
    await page.request.delete(`/api/v1/invoices/${row.id}`);
  }
}

test.describe('the /invoices surfaces under axe', () => {
  test.describe.configure({ mode: 'serial' });
  let scratch: Scratch | null = null;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await signIn(page);
    await clearInvoices(page);
    scratch = await makeScratch(page);
    await page.close();
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await setPrefs(page, { theme: null, locale: null });
    await clearInvoices(page);
    await page.close();
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`${theme}: the manager, the editor with every block, and every overlay`, async ({ page }, testInfo) => {
      test.setTimeout(300_000);
      if (scratch === null) throw new Error('the scratch documents were not created');
      const tally: Sweep = { states: 0, minor: 0, failures: [] };
      await signIn(page);
      await setPrefs(page, { theme, locale: null });

      // --- the manager --------------------------------------------------------
      await page.goto('/invoices');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.getByTestId('invoices-card').first()).toBeVisible();
      await sweep(page, 'manager · gallery', tally, testInfo);
      await testInfo.attach(`a11y-${theme}-manager-gallery`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

      await page.getByTestId('invoices-group-by').getByRole('radio').nth(1).click();
      await expect(page.getByTestId('invoices-group-header').first()).toBeVisible();
      await sweep(page, 'manager · topic groups', tally, testInfo);
      await page.getByTestId('invoices-group-by').getByRole('radio').nth(0).click();

      await page.getByTestId('invoices-layout').getByRole('radio').nth(1).click();
      await expect(page.getByTestId('invoices-list')).toBeVisible();
      await sweep(page, 'manager · list', tally, testInfo);
      await testInfo.attach(`a11y-${theme}-manager-list`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
      await page.getByTestId('invoices-layout').getByRole('radio').nth(0).click();

      await page.getByTestId('invoices-new').click();
      await expect(page.getByTestId('invoices-new-grid')).toBeVisible();
      await sweep(page, 'manager · new modal', tally, testInfo, '[role="dialog"]');
      await testInfo.attach(`a11y-${theme}-new-modal`, { body: await page.screenshot(), contentType: 'image/png' });
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toBeHidden();

      const card = page.getByTestId('invoices-card').first();
      await card.hover();
      await card.getByRole('button', { name: 'Delete' }).click();
      await expect(page.getByTestId('invoices-delete-confirm')).toBeVisible();
      await sweep(page, 'manager · delete modal', tally, testInfo, '[role="dialog"]');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toBeHidden();

      // --- the editor, every optional block on --------------------------------
      await page.goto(`/invoices/${scratch.fullId}`);
      await expect(page.getByTestId('invoices-paper')).toBeVisible();
      // 23 built-ins (every gate open) + the four custom sections.
      await expect(page.getByTestId('invoices-block')).toHaveCount(27);
      await sweep(page, 'editor · canvas, every block', tally, testInfo);
      await testInfo.attach(`a11y-${theme}-editor-every-block`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

      for (const section of SECTION_SWEEP) {
        await page.locator(`[data-testid="invoices-section"][data-section="${section}"]`).first().click();
        await expect(inspector(page).locator(`[data-testid="invoices-inspector-panel"][data-section="${section}"]`)).toBeVisible();
        await sweep(page, `editor · inspector ${section}`, tally, testInfo, '[data-testid="invoices-inspector"][data-variant="aside"]');
      }
      await testInfo.attach(`a11y-${theme}-inspector-qr`, { body: await page.screenshot(), contentType: 'image/png' });

      // A custom section's own panel (the `cus:` branch of `insMeta`, comp 1565).
      await page.locator('[data-testid="invoices-section"][data-section="cus:cs_a11y_kv"]').click();
      await expect(inspector(page).locator('[data-testid="invoices-inspector-panel"][data-section="cus:cs_a11y_kv"]')).toBeVisible();
      await sweep(page, 'editor · inspector custom kv', tally, testInfo, '[data-testid="invoices-inspector"][data-variant="aside"]');

      // The Images panel (the header's own button).
      await page.getByTestId('invoices-images').click();
      await expect(inspector(page).locator('[data-testid="invoices-inspector-panel"][data-section="images"]')).toBeVisible();
      await sweep(page, 'editor · inspector images', tally, testInfo, '[data-testid="invoices-inspector"][data-variant="aside"]');

      // --- the overlays -------------------------------------------------------
      await page.getByTestId('invoices-add-section').click();
      await expect(page.getByTestId('invoices-add-modal')).toBeVisible();
      // Every gate is open, so the standard row collapses to its one sentence (comp 1653).
      await expect(page.getByTestId('invoices-add-none')).toBeVisible();
      await sweep(page, 'editor · add-section modal', tally, testInfo, '[role="dialog"]');
      await testInfo.attach(`a11y-${theme}-add-section-modal`, { body: await page.screenshot(), contentType: 'image/png' });
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toBeHidden();

      await page.getByTestId('invoices-language-button').click();
      await expect(page.getByTestId('invoices-language-menu')).toBeVisible();
      await sweep(page, 'editor · language menu', tally, testInfo, '[data-testid="invoices-language-menu"]');
      await page.keyboard.press('Escape');

      await page.getByTestId('invoices-delete').click();
      await expect(page.getByTestId('invoices-delete-confirm')).toBeVisible();
      await sweep(page, 'editor · delete modal', tally, testInfo, '[role="dialog"]');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toBeHidden();

      // A dirty draft leaving the editor → the discard modal (O22 →).
      const name = page.getByTestId('invoices-editor-name');
      await name.click();
      await name.fill('A11y sweep edited');
      await expect(page.getByTestId('invoices-save-chip')).toHaveText('Unsaved changes');
      await page.locator('[data-part="topbar-back"]').click();
      await expect(page.getByTestId('invoices-discard-body')).toBeVisible();
      await sweep(page, 'editor · discard modal', tally, testInfo, '[role="dialog"]');
      await testInfo.attach(`a11y-${theme}-discard-modal`, { body: await page.screenshot(), contentType: 'image/png' });
      await page.getByTestId('invoices-discard-confirm').click();
      await expect(page.getByRole('heading', { level: 1, name: 'Invoices' })).toBeVisible();

      // --- the narrow editor and its drawer -----------------------------------
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/invoices/${scratch.fullId}`);
      await expect(page.locator('[data-testid="invoices-inspector"][data-variant="drawer"]')).toBeVisible();
      await sweep(page, 'editor · 390 px drawer', tally, testInfo);
      await testInfo.attach(`a11y-${theme}-editor-390`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
      await page.setViewportSize({ width: 1280, height: 720 });

      testInfo.annotations.push({ type: 'axe-summary', description: `${String(tally.states)} states, ${String(tally.minor)} lesser findings` });
      expect(tally.failures, `${String(tally.failures.length)} of ${String(tally.states)} states have blocking violations:\n\n${tally.failures.join('\n\n')}`).toEqual([]);
    });
  }
});
