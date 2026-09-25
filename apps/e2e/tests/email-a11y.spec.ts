// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The email surfaces under axe: the manager in gallery and list, grouped by
 * topic, its actions menu, the New / Import / Delete modals and archived mode;
 * the editor with every block kind, the inspector's Design panels, the block
 * picker, the image picker, the test-send and Send-campaign modals, the
 * language menu, the mirror modal and the discard-changes modal — each in
 * light and dark, LTR (en_US) and RTL (ar_EG). Zero serious/critical
 * violations is the gate; the lesser counts are annotated per state so a
 * regression in them is visible in the report.
 *
 * Theme and locale are the signed-in user's own prefs (`PATCH /api/v1/me/prefs`,
 * applied on reload) and are restored to "inherit" afterwards, because the
 * suite shares one seeded account and runs serially. Every selector below is a
 * test id or a role without a name: in Arabic the names are Arabic.
 *
 * An OPEN LAYER is analysed within itself. Radix marks everything outside a
 * modal menu/dialog `aria-hidden` and traps focus inside it (the APG pattern);
 * axe's `aria-hidden-focus` rule reads the trapped-out background — the search
 * box, the tabs — as "hidden but focusable" and fails every overlay of every
 * Radix surface in the product. That is a primitive-versus-rule conflict
 * (`inert` on the app root would settle it) and is recorded, not masked here:
 * the page-level states still run over the whole document.
 */
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

import { signIn } from './helpers.js';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const BLOCKING = new Set(['critical', 'serious']);

/** The 24 pickable kinds plus the two legacy ones, each with its default data. */
const ALL_BLOCKS = [
  ['email.heading', { text: 'Section heading', level: 1 }],
  ['email.text', { paras: ['Write your copy here.', 'A second paragraph.'] }],
  ['email.button', { label: 'Call to action', url: 'https://example.com' }],
  ['email.divider', { height: 24, line: true }],
  ['email.spacer', { size: 16 }],
  ['email.footer', { text: 'Legacy footer block' }],
  ['email.image', { alt: 'Hero image — 600 × 240', url: '', height: 160 }],
  ['email.two-col', { a: 'Left column copy.', b: 'Right column copy.' }],
  ['email.list', { items: ['First point', 'Second point', 'Third point'] }],
  ['email.quote', { text: 'It cut our reporting time in half.', author: 'Priya R., Northwind Co' }],
  ['email.social', { links: [{ label: 'Website', icon: 'globe', url: 'https://example.com' }] }],
  ['email.html', { code: '<p style="font-size:14px">Your HTML here</p>' }],
  ['email.box', { label: 'Amount', value: '$0.00' }],
  ['email.stats', { stats: [{ value: '128', label: 'Tasks done' }, { value: '3', label: 'Releases' }] }],
  ['email.product', { items: [{ name: 'Item name', meta: 'Variant · SKU', qty: 'x1', price: '$290.00' }] }],
  ['email.multi-currency', { kicker: 'Amount due in other currencies', amount: 290, fx: [{ code: 'EUR', sym: '€', rate: 0.92 }] }],
  ['email.tax-breakdown', { kicker: 'Tax breakdown', lines: [{ label: 'State tax (6%)', amount: '$17.40' }] }],
  ['email.discount-codes', { kicker: 'Discount codes', codes: [{ code: 'WELCOME10', label: '10% welcome credit', amount: '-$29.00' }] }],
  ['email.payment-history', { kicker: 'Payment history', items: [{ date: 'Jul 2, 2026', method: 'Visa ·· 4242', amount: '$290.00' }] }],
  ['email.recurring', { freq: 'Monthly', next: 'Aug 12, 2026', note: 'until cancelled' }],
  ['email.loyalty', { balance: 1240, earned: 290, level: 'Gold' }],
  ['email.delivery', { kicker: 'Delivery timeline', steps: [{ label: 'Ordered', status: 'done' }, { label: 'Shipped', status: 'current' }, { label: 'Delivered', status: 'todo' }] }],
  ['email.po-terms', { kicker: 'Purchase order terms', text: 'Goods remain returnable within 14 days of delivery.' }],
  ['email.legal', { kicker: '', text: 'This email and any attachments are confidential.' }],
  ['email.refund-policy', { kicker: 'Refund policy', text: 'Full refunds within 30 days of purchase.' }],
  ['email.contact', { kicker: 'Questions? Contact us', name: 'Support', email: 'support@example.com', phone: '+1 (555) 010-0100' }],
] as const;

const COMBOS = [
  { theme: 'light', locale: 'en_US', dir: 'ltr' },
  { theme: 'dark', locale: 'en_US', dir: 'ltr' },
  { theme: 'light', locale: 'ar_EG', dir: 'rtl' },
  { theme: 'dark', locale: 'ar_EG', dir: 'rtl' },
] as const;

interface Sweep {
  states: number;
  minor: number;
}

async function sweep(page: Page, label: string, tally: Sweep, testInfo: TestInfo, within?: string): Promise<void> {
  // Overlays fade in; axe reads computed colours, so a dialog measured mid-transition
  // reports its backdrop-blended colours and fails contrast it passes at rest.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        // Not a spinner, whose animation never finishes.
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
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
          .map((n) => `    ${n.target.join(' ')}\n      ${n.html.slice(0, 160)}\n      ${n.any.map((check) => JSON.stringify(check.data)).join(' ')}`)
          .join('\n'),
    )
    .join('\n');
  expect(blocking, `${label} has ${String(blocking.length)} blocking violations:\n${report}`).toEqual([]);
}

async function setPrefs(page: Page, prefs: { theme: string | null; locale: string | null }): Promise<void> {
  const reply = await page.request.patch('/api/v1/me/prefs', { data: prefs });
  expect(reply.ok(), `prefs → ${String(reply.status())}`).toBe(true);
}

interface Scratch {
  templateId: string;
  siblingId: string;
  campaignId: string;
}

async function makeScratch(page: Page): Promise<Scratch> {
  const created = await page.request.post('/api/v1/email-templates', { data: { kind: 'template', name: 'A11y sweep', starter: null } });
  expect(created.status()).toBe(201);
  const doc = (await created.json()) as { id: string };
  const put = await page.request.put(`/api/v1/email-templates/${doc.id}`, {
    data: {
      name: 'A11y sweep',
      category: 'lifecycle',
      enabled: false,
      document: {
        subject: 'A11y sweep',
        preheader: 'All twenty-six blocks',
        footer: 'Sent by Adminium',
        brand: null,
        attachments: [],
        blocks: ALL_BLOCKS.map(([kind, data], index) => ({ id: `b_${String(index)}`, block: kind, data, style: {} })),
      },
    },
  });
  expect(put.ok()).toBe(true);
  // A sibling so a structural edit asks the mirror question.
  const sibling = await page.request.post(`/api/v1/email-templates/${doc.id}/languages`, { data: { locale: 'de_DE' } });
  expect(sibling.status()).toBe(201);
  const campaign = await page.request.post('/api/v1/email-templates', { data: { kind: 'campaign', name: 'A11y campaign', starter: null } });
  expect(campaign.status()).toBe(201);
  return { templateId: doc.id, siblingId: ((await sibling.json()) as { id: string }).id, campaignId: ((await campaign.json()) as { id: string }).id };
}

async function removeScratch(page: Page, scratch: Scratch): Promise<void> {
  for (const id of [scratch.siblingId, scratch.templateId, scratch.campaignId]) {
    await page.request.delete(`/api/v1/email-templates/${id}`);
  }
}

test.describe('email surfaces under axe', () => {
  test.describe.configure({ mode: 'serial' });
  let scratch: Scratch | null = null;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await signIn(page);
    scratch = await makeScratch(page);
    await page.close();
  });

  test.afterAll(async ({ browser }) => {
    // API only: `signIn` reads the English navigation label, and the last combination
    // leaves the shared account in Arabic until this reset lands.
    const page = await browser.newPage();
    await setPrefs(page, { theme: null, locale: null });
    if (scratch !== null) await removeScratch(page, scratch);
    await page.close();
  });

  for (const combo of COMBOS) {
    test(`${combo.theme} · ${combo.locale}: manager, editor and every overlay`, async ({ page }, testInfo) => {
      test.setTimeout(300_000);
      if (scratch === null) throw new Error('scratch documents were not created');
      const tally: Sweep = { states: 0, minor: 0 };
      await setPrefs(page, { theme: null, locale: null }); // the previous combination's prefs would sign in in Arabic
      await signIn(page);
      await setPrefs(page, { theme: combo.theme, locale: combo.locale });

      // --- manager -------------------------------------------------------------
      await page.goto('/email-templates');
      await expect(page.locator('html')).toHaveAttribute('dir', combo.dir);
      await expect(page.locator('html')).toHaveAttribute('data-theme', combo.theme);
      await expect(page.getByTestId('email-card').first()).toBeVisible();
      await sweep(page, 'manager · gallery', tally, testInfo);
      await page.getByTestId('email-layout').getByRole('radio').nth(1).click();
      await expect(page.getByRole('table').first()).toBeVisible();
      await sweep(page, 'manager · list', tally, testInfo);
      await page.getByTestId('email-layout').getByRole('radio').nth(0).click();
      await page.getByTestId('email-group-by').getByRole('radio').nth(1).click();
      await expect(page.getByTestId('email-group-header').first()).toBeVisible();
      await sweep(page, 'manager · topic groups', tally, testInfo);
      await page.getByTestId('email-group-by').getByRole('radio').nth(0).click();

      await page.getByTestId('email-actions-menu').click();
      await expect(page.getByRole('menu')).toBeVisible();
      await sweep(page, 'manager · actions menu', tally, testInfo, '[role="menu"]');
      await page.getByRole('menuitem').nth(0).click(); // Import template
      await expect(page.getByTestId('email-import-file')).toBeAttached();
      await sweep(page, 'manager · import modal', tally, testInfo, '[role="dialog"]');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toBeHidden();

      await page.getByTestId('email-new').click();
      await expect(page.getByTestId('email-new-grid')).toBeVisible();
      await sweep(page, 'manager · new modal', tally, testInfo, '[role="dialog"]');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toBeHidden();

      const card = page.getByTestId('email-card').filter({ hasText: 'A11y sweep' }).first();
      await card.hover();
      await card.getByTestId('email-card-actions').getByRole('button').last().click(); // Delete
      await expect(page.getByTestId('email-delete-confirm')).toBeVisible();
      await sweep(page, 'manager · delete modal', tally, testInfo, '[role="dialog"]');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toBeHidden();

      await page.getByTestId('email-actions-menu').click();
      await page.getByRole('menuitem').nth(4).click(); // Archived
      await expect(page.getByTestId('email-archived-chip')).toBeVisible();
      await sweep(page, 'manager · archived mode', tally, testInfo);

      // --- editor --------------------------------------------------------------
      await page.goto(`/email-templates/${scratch.templateId}`);
      await expect(page.getByTestId('email-block')).toHaveCount(ALL_BLOCKS.length);
      await expect(page.getByTestId('email-mail-shell')).toBeVisible();
      await sweep(page, 'editor · canvas + sections', tally, testInfo);

      await page.getByTestId('email-block').nth(9).click(); // quote → Design tab, block panel
      await expect(page.getByTestId('email-block-panel')).toHaveAttribute('data-kind', 'email.quote');
      await sweep(page, 'editor · block panel', tally, testInfo);

      await page.getByTestId('email-block').nth(6).click(); // image
      await page.getByTestId('email-choose-image').click();
      await expect(page.getByTestId('email-image-url')).toBeVisible();
      await sweep(page, 'editor · image picker', tally, testInfo, '[role="dialog"]');
      await page.getByRole('tab').nth(1).click(); // Upload
      await expect(page.getByTestId('email-image-upload')).toBeAttached();
      await sweep(page, 'editor · image picker upload', tally, testInfo, '[role="dialog"]');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toBeHidden();

      await page.getByTestId('email-design-back').click();
      await page.getByTestId('email-pinned-row').nth(0).click();
      await expect(page.getByTestId('email-branding-panel')).toBeVisible();
      await sweep(page, 'editor · branding panel', tally, testInfo);
      await page.getByTestId('email-design-back').click();
      await page.getByTestId('email-pinned-row').nth(1).click();
      await sweep(page, 'editor · subject panel', tally, testInfo);
      await page.getByTestId('email-design-back').click();
      await page.getByTestId('email-pinned-row').nth(2).click();
      await expect(page.getByTestId('email-attachments-panel')).toBeVisible();
      await sweep(page, 'editor · attachments panel', tally, testInfo);
      await page.getByTestId('email-design-back').click();
      await page.getByTestId('email-pinned-row').nth(3).click();
      await sweep(page, 'editor · footer panel', tally, testInfo);
      await page.getByTestId('email-design-back').click();

      await page.getByTestId('email-language-button').click();
      await expect(page.getByTestId('email-language-menu')).toBeVisible();
      await sweep(page, 'editor · language menu', tally, testInfo, '[data-testid="email-language-menu"]');
      await page.keyboard.press('Escape');

      await page.getByTestId('email-test').click();
      await expect(page.getByTestId('email-test-send')).toBeVisible();
      await sweep(page, 'editor · test-send modal', tally, testInfo, '[role="dialog"]');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toBeHidden();

      await page.getByTestId('email-add-section').click();
      await expect(page.getByTestId('email-picker-tile').first()).toBeVisible();
      await sweep(page, 'editor · block picker', tally, testInfo, '[role="dialog"]');
      await page.getByTestId('email-picker-tile').first().click(); // inserts → the sibling asks the mirror question
      await expect(page.getByTestId('email-mirror-body')).toBeVisible();
      await sweep(page, 'editor · mirror modal', tally, testInfo, '[role="dialog"]');
      await page.getByTestId('email-mirror-only').click();
      await expect(page.getByTestId('email-save-chip')).toBeVisible();

      // An in-app navigation while dirty → the discard-changes modal (D1 guard). The
      // sidebar entry exists in every language; a history `back` here would be a
      // cross-document navigation the router blocker never sees.
      await page.getByRole('navigation').locator('a[href="/email-templates"]').first().click();
      await expect(page.getByTestId('email-discard-confirm')).toBeVisible();
      await sweep(page, 'editor · discard modal', tally, testInfo, '[role="dialog"]');
      await page.getByTestId('email-discard-confirm').click();
      await expect(page.getByTestId('email-editor-header')).toBeHidden();

      // --- campaign ------------------------------------------------------------
      await page.goto(`/email-templates/${scratch.campaignId}`);
      await expect(page.getByTestId('email-editor-header')).toBeVisible();
      await page.getByTestId('email-send').click();
      await expect(page.getByTestId('email-campaign-send')).toBeVisible();
      await sweep(page, 'campaign · send modal', tally, testInfo, '[role="dialog"]');
      await page.getByTestId('email-campaign-when').getByRole('radio').nth(1).click();
      await expect(page.getByTestId('email-campaign-at')).toBeVisible();
      await sweep(page, 'campaign · send modal (schedule)', tally, testInfo, '[role="dialog"]');
      await page.keyboard.press('Escape');

      testInfo.annotations.push({ type: 'axe-summary', description: `${String(tally.states)} states, ${String(tally.minor)} lesser findings` });
      await testInfo.attach(`sweep-${combo.theme}-${combo.locale}`, { body: await page.screenshot(), contentType: 'image/png' });
    });
  }
});
