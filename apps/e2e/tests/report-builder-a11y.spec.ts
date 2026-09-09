// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `/report-builder` surfaces under axe (43-report-builder.md 43-T14): the
 * manager in gallery and list, its New and Delete modals; the editor with ALL
 * 25 block kinds on one sheet; the inspector on the header AND on every one
 * of the 25 kinds — not a sample (43-T07's done-when); the palette sheet; the
 * discard modal; and the 390 px drawer — each in light and dark. Zero
 * serious/critical violations is the gate; the lesser counts are annotated
 * per state so a regression in them is visible in the report.
 *
 * Theme is the signed-in user's own pref (`PATCH /api/v1/me/prefs`, applied
 * on reload) and is restored to "inherit" afterwards, because the suite shares
 * one seeded account and runs serially.
 *
 * AN OPEN LAYER IS ANALYSED WITHIN ITSELF. Radix marks everything outside a
 * modal `aria-hidden` and traps focus inside it (the APG pattern); axe's
 * `aria-hidden-focus` rule reads the trapped-out background as "hidden but
 * focusable" and fails every overlay of every Radix surface in the product.
 * That is a primitive-versus-rule conflict recorded in 39 §6.1, not masked
 * here: the page-level states still run over the whole document.
 *
 * THE SCRATCH DOCUMENTS ARE MADE AND REMOVED THROUGH THE API, and this file
 * clears the workspace's report documents when it is done —
 * `report-builder.spec.ts` asserts the empty states of a fresh install and
 * Playwright runs `report-builder-a11y` first (`-` sorts before `.`).
 */
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';

import { signIn } from './helpers.js';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const BLOCKING = new Set(['critical', 'serious']);

/** The palette's order (comp `palDefs`, 608) — every one of them is swept. */
const KINDS = [
  'heading',
  'text',
  'kpi',
  'bar',
  'line',
  'table',
  'signature',
  'terms',
  'attachments',
  'approval',
  'qr',
  'latefees',
  'poterms',
  'multicurrency',
  'recurring',
  'discount',
  'taxbreak',
  'payhistory',
  'legal',
  'refund',
  'contact',
  'loyalty',
  'delivery',
  'image',
  'divider',
] as const;

interface Sweep {
  states: number;
  minor: number;
  /** One entry per state that failed; asserted once at the end of the test. */
  failures: string[];
}

function inspector(page: Page): Locator {
  return page.locator('[data-testid="report-inspector"][data-variant="aside"]');
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
  /** The template carrying one block of every kind, and a background image. */
  fullId: string;
  /** A second row so the manager draws more than one card. */
  siblingId: string;
}

/** A 1×1 PNG — enough to put the sheet's background branch and the image block on screen. */
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function makeScratch(page: Page): Promise<Scratch> {
  const created = await page.request.post('/api/v1/report-documents', { data: { kind: 'template', name: 'A11y sweep', starter: 'exec' } });
  expect(created.status(), await created.text()).toBe(201);
  const doc = (await created.json()) as { id: string; status: string; body: Record<string, unknown> };

  // One block of every kind, on one sheet. The server's normalizer fills each
  // kind's own fields, so only `kind` and an id are needed here.
  const blocks = KINDS.map((kind, index) => ({
    id: `a11y_${kind}`,
    kind,
    title: kind,
    w: index % 5 === 0 ? 'half' : 'full',
    show: index !== 3,
    ...(kind === 'image' ? { url: PNG, text: 'A chart of the quarter' } : {}),
  }));
  const body: Record<string, unknown> = { ...doc.body, blocks, bgImage: PNG, bgTint: 0.82 };

  const put = await page.request.put(`/api/v1/report-documents/${doc.id}`, { data: { name: 'A11y sweep', status: doc.status, body } });
  expect(put.ok(), await put.text()).toBe(true);

  const sibling = await page.request.post(`/api/v1/report-documents/${doc.id}/duplicate`);
  expect(sibling.status(), await sibling.text()).toBe(201);
  return { fullId: doc.id, siblingId: ((await sibling.json()) as { id: string }).id };
}

/** Leave the workspace as `report-builder.spec.ts` needs to find it: empty. */
async function clearDocuments(page: Page): Promise<void> {
  const reply = await page.request.get('/api/v1/report-documents');
  if (!reply.ok()) return;
  for (const row of ((await reply.json()) as { items: { id: string }[] }).items) {
    await page.request.delete(`/api/v1/report-documents/${row.id}`);
  }
}

test.describe('the /report-builder surfaces under axe (43-T14)', () => {
  test.describe.configure({ mode: 'serial' });
  let scratch: Scratch | null = null;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await signIn(page);
    await clearDocuments(page);
    scratch = await makeScratch(page);
    await page.close();
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await setPrefs(page, { theme: null, locale: null });
    await clearDocuments(page);
    await page.close();
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`${theme}: the manager, the editor with all 25 kinds, and every panel`, async ({ page }, testInfo) => {
      test.setTimeout(420_000);
      if (scratch === null) throw new Error('the scratch documents were not created');
      const tally: Sweep = { states: 0, minor: 0, failures: [] };
      await signIn(page);
      await setPrefs(page, { theme, locale: null });

      // --- the manager --------------------------------------------------------
      await page.goto('/report-builder');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.getByTestId('report-card').first()).toBeVisible();
      await sweep(page, 'manager · gallery', tally, testInfo);
      await testInfo.attach(`a11y-${theme}-manager-gallery`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

      await page.getByTestId('report-layout').getByRole('radio').nth(1).click();
      await expect(page.getByTestId('report-list')).toBeVisible();
      await sweep(page, 'manager · list', tally, testInfo);
      await testInfo.attach(`a11y-${theme}-manager-list`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
      await page.getByTestId('report-layout').getByRole('radio').nth(0).click();

      await page.getByTestId('report-new').click();
      await expect(page.getByTestId('report-new-grid')).toBeVisible();
      await sweep(page, 'manager · new modal', tally, testInfo, '[role="dialog"]');
      await testInfo.attach(`a11y-${theme}-new-modal`, { body: await page.screenshot(), contentType: 'image/png' });
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toBeHidden();

      const card = page.getByTestId('report-card').first();
      await card.hover();
      await card.getByRole('button', { name: 'Delete' }).click();
      await expect(page.getByTestId('report-delete-confirm')).toBeVisible();
      await sweep(page, 'manager · delete modal', tally, testInfo, '[role="dialog"]');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toBeHidden();

      // --- the editor, all 25 kinds on one sheet ------------------------------
      await page.goto(`/report-builder/${scratch.fullId}`);
      await expect(page.getByTestId('report-paper')).toBeVisible();
      await expect(page.getByTestId('report-block')).toHaveCount(25);
      // The sheet is ALWAYS LIGHT (D10) — including in the dark theme.
      await sweep(page, 'editor · canvas, all 25 kinds', tally, testInfo);
      await testInfo.attach(`a11y-${theme}-editor-all-kinds`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

      // The palette column, and the header panel with a background uploaded.
      await sweep(page, 'editor · palette', tally, testInfo, '[data-testid="report-palette"]');
      await expect(inspector(page).getByTestId('report-header-panel')).toBeVisible();
      await sweep(page, 'editor · inspector header', tally, testInfo, '[data-testid="report-inspector"][data-variant="aside"]');
      await testInfo.attach(`a11y-${theme}-inspector-header`, { body: await page.screenshot(), contentType: 'image/png' });

      // --- EVERY kind's field group, not a sample (43-T07) ---------------------
      for (const kind of KINDS) {
        // The card, not its centre: a text-shaped block's centre is its inline
        // textarea, whose click the comp stops (316) so typing never re-selects.
        await page.locator(`[data-testid="report-block"][data-kind="${kind}"]`).first().click({ position: { x: 6, y: 6 } });
        await expect(inspector(page).locator(`[data-testid="report-block-panel"][data-kind="${kind}"]`)).toBeVisible();
        await sweep(page, `editor · inspector ${kind}`, tally, testInfo, '[data-testid="report-inspector"][data-variant="aside"]');
      }
      await testInfo.attach(`a11y-${theme}-inspector-delivery`, { body: await page.screenshot(), contentType: 'image/png' });

      // --- the overlays -------------------------------------------------------
      await page.getByTestId('report-delete').click();
      await expect(page.getByTestId('report-delete-confirm')).toBeVisible();
      await sweep(page, 'editor · delete modal', tally, testInfo, '[role="dialog"]');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toBeHidden();

      // A dirty draft leaving the editor → the discard modal (D4/O6).
      const name = page.getByTestId('report-editor-name');
      await name.click();
      await name.fill('A11y sweep edited');
      await expect(page.getByTestId('report-save-chip')).toHaveText('Unsaved changes');
      await page.locator('[data-part="topbar-back"]').click();
      await expect(page.getByTestId('report-discard-body')).toBeVisible();
      await sweep(page, 'editor · discard modal', tally, testInfo, '[role="dialog"]');
      await testInfo.attach(`a11y-${theme}-discard-modal`, { body: await page.screenshot(), contentType: 'image/png' });
      await page.getByTestId('report-discard-confirm').click();
      await expect(page.getByRole('heading', { level: 1, name: 'Reports' })).toBeVisible();

      // --- the narrow editor, its drawer and its palette sheet (D18) ----------
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/report-builder/${scratch.fullId}`);
      await expect(page.locator('[data-testid="report-inspector"][data-variant="drawer"]')).toBeVisible();
      await sweep(page, 'editor · 390 px drawer', tally, testInfo);
      await testInfo.attach(`a11y-${theme}-editor-390`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

      await page.getByTestId('report-add-block').click();
      await expect(page.getByTestId('report-palette-sheet')).toBeVisible();
      await sweep(page, 'editor · 390 px palette sheet', tally, testInfo, '[role="dialog"]');
      await page.keyboard.press('Escape');
      await page.setViewportSize({ width: 1280, height: 720 });

      testInfo.annotations.push({ type: 'axe-summary', description: `${String(tally.states)} states, ${String(tally.minor)} lesser findings` });
      expect(tally.failures, `${String(tally.failures.length)} of ${String(tally.states)} states have blocking violations:\n\n${tally.failures.join('\n\n')}`).toEqual([]);
    });
  }
});
