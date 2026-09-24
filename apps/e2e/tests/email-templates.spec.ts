// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The email manager against the built stack (39-email-templates-and-
 * campaigns.md, first slice: the manager).
 *
 * The dashboard suite mounts the manager through the real router with a
 * fetch stub (`email/manager/manager.test.tsx`); the server suite covers the
 * routes in process. What only this file sees: the lazy route mounts from
 * the BUILT bundle, the seed's seven built-ins × eight locales come back
 * through a real socket as fifty-six cards, and a duplicate + Undo makes
 * the round trip and leaves the fixture as it found it. The send flows (test
 * send, campaign run) join here once the SMTP sink lands.
 */
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { signIn } from './helpers.js';

/** The 24 pickable kinds plus the two legacy ones, each with its default data (the registry's `defaultBlockData`). */
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

test.describe('email templates manager', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await page.goto('/email-templates');
    await expect(page.getByRole('heading', { level: 1, name: 'Email templates' })).toBeVisible();
  });

  test('mounts from the built bundle with the seeded built-ins, grouped by topic', async ({ page }, testInfo) => {
    await expect(page.getByText('Design reusable emails & the campaigns you send from them.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'New template' })).toBeVisible();
    // Seven built-in flows × eight locales: password reset, team invitation,
    // notification, document ready, booking confirmation, sign-in code and
    // address changed (`BUILTIN_EMAIL_TEMPLATE_KEYS`).
    await expect(page.getByTestId('email-card')).toHaveCount(56);
    await expect(page.getByTestId('tab-count').first()).toHaveText('56');
    await testInfo.attach('manager-gallery', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

    // A topic is one flow (`groupDocuments` keys on the template key), so seven.
    await page.getByRole('radio', { name: 'Topic' }).click();
    const headers = page.getByTestId('email-group-header');
    await expect(headers).toHaveCount(7);
    await expect(page.getByTestId('email-group-sub').first()).toHaveText('8 languages');
    await testInfo.attach('manager-topics', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

    // One table per topic group, each with the comp's five columns.
    await page.getByRole('radio', { name: 'List' }).click();
    await expect(page.getByRole('table')).toHaveCount(7);
    await expect(page.getByRole('table').first().getByRole('columnheader')).toHaveText(['Name', 'Lang', 'Status', 'Updated', 'Actions']);
    await testInfo.attach('manager-list', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    // Leave the prefs as found: they persist in localStorage for later specs.
    await page.getByRole('radio', { name: 'Gallery' }).click();
    await page.getByRole('radio', { name: 'None' }).click();
  });

  test('the actions menu has the five items in order; New opens the starters', async ({ page }, testInfo) => {
    await page.getByRole('button', { name: 'More actions' }).click();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem')).toHaveText(['Import template', 'Manage senders', 'Export all', 'Email settings', 'Archived']);
    await testInfo.attach('actions-menu', { body: await page.screenshot(), contentType: 'image/png' });
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'New template' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Start blank or from a ready-made email design.')).toBeVisible();
    // Blank + the twelve starters.
    await expect(dialog.getByTestId('email-starter')).toHaveCount(13);
    await testInfo.attach('new-modal', { body: await page.screenshot(), contentType: 'image/png' });
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('duplicate makes the round trip and Undo removes the copy', async ({ page }) => {
    const before = await page.getByTestId('email-card').count();
    // The actions slide in on hover (comp CSS 43-44) — a mouse user hovers the card first.
    const card = page.getByTestId('email-card').first();
    await card.hover();
    await card.getByRole('button', { name: 'Duplicate' }).click();
    await expect(page.getByText('Template duplicated')).toBeVisible();
    await expect(page.getByTestId('email-card')).toHaveCount(before + 1);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByTestId('email-card')).toHaveCount(before);
  });

  test('a card opens the editor; typing dirties, Save PUTs, Back returns', async ({ page }, testInfo) => {
    // Chosen by name, not position: which built-in sorts first changes whenever one is added.
    const card = page
      .getByTestId('email-card')
      .filter({ has: page.getByText('Notification', { exact: true }) })
      .first();
    // Mid-page, clear of the sticky top bar: with fifty-six cards the one found can
    // sit where scrolling it "into view" parks it under the bar (postgres run).
    await card.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    // By keyboard, as the card promises: focus inside it slides the action row
    // in. A hover-revealed row under a moving pointer let the card itself take
    // the click on postgres and mysql, where this card lands lower on the page.
    const edit = card.getByRole('button', { name: 'Edit' });
    await edit.focus();
    await edit.press('Enter');
    await expect(page.getByTestId('email-editor-header')).toBeVisible();
    const name = page.getByTestId('email-editor-name');
    await expect(name).toHaveValue('Notification');
    await expect(page.getByTestId('email-save-chip')).toHaveText('All changes saved');
    await expect(page.getByTestId('email-language-button')).toContainText('English (US)');
    await testInfo.attach('editor-shell', { body: await page.screenshot(), contentType: 'image/png' });

    await name.click();
    await name.press('End');
    await name.type(' (edited)');
    await expect(page.getByTestId('email-save-chip')).toHaveText('Unsaved changes');
    await page.getByTestId('email-language-button').click();
    await expect(page.getByTestId('email-language-menu').getByTestId('email-language-row')).toHaveCount(8);
    await testInfo.attach('editor-language-menu', { body: await page.screenshot(), contentType: 'image/png' });
    await page.keyboard.press('Escape');

    const put = page.waitForRequest((request) => request.method() === 'PUT' && request.url().includes('/api/v1/email-templates/'));
    await page.getByTestId('email-save').click();
    await put;
    await expect(page.getByTestId('email-save-chip')).toHaveText('All changes saved');

    // Undo the rename through the same path so the fixture is as it was.
    await name.click();
    await name.fill('Notification');
    await page.getByTestId('email-save').click();
    await expect(page.getByTestId('email-save-chip')).toHaveText('All changes saved');
    await page.getByRole('link', { name: 'Back' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Email templates' })).toBeVisible();
    await expect(page.getByTestId('email-card')).toHaveCount(56);
  });

  test('the canvas draws every block kind without blocking a11y violations (axe)', async ({ page }, testInfo) => {
    // A scratch template holding every kind, made and removed through the API.
    const created = await page.request.post('/api/v1/email-templates', { data: { kind: 'template', name: 'Every kind', starter: null } });
    expect(created.status()).toBe(201);
    const doc = (await created.json()) as { id: string; document: { subject: string; preheader: string; footer: string; brand: unknown; attachments: unknown[] } };
    try {
      const put = await page.request.put(`/api/v1/email-templates/${doc.id}`, {
        data: {
          name: 'Every kind',
          category: 'lifecycle',
          enabled: false,
          document: {
            subject: 'Every kind',
            preheader: 'All twenty-six blocks',
            footer: 'Sent by Adminium',
            brand: null,
            attachments: [],
            blocks: ALL_BLOCKS.map(([kind, data], index) => ({ id: `b_${String(index)}`, block: kind, data, style: {} })),
          },
        },
      });
      expect(put.ok()).toBe(true);
      await page.goto(`/email-templates/${doc.id}`);
      await expect(page.getByTestId('email-block')).toHaveCount(ALL_BLOCKS.length);
      await testInfo.attach('canvas-all-kinds', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
      const results = await new AxeBuilder({ page })
        .include('[data-testid="email-canvas"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      const blocking = results.violations.filter((violation) => violation.impact === 'critical' || violation.impact === 'serious');
      const report = blocking.map((v) => `${String(v.impact)}: ${v.id} — ${v.help}\n` + v.nodes.slice(0, 3).map((n) => `    ${n.target.join(' ')}`).join('\n')).join('\n');
      expect(blocking, `canvas has ${String(blocking.length)} blocking violations:\n${report}`).toEqual([]);

      // The inspector: a block opens the Design tab with its panel; the style axes write through.
      await page.getByTestId('email-block').nth(9).click(); // email.quote
      await expect(page.getByTestId('email-design-header')).toContainText('Quote');
      await expect(page.getByTestId('email-block-panel')).toHaveAttribute('data-kind', 'email.quote');
      await page.getByTestId('email-style-align').nth(1).click();
      await expect(page.getByTestId('email-save-chip')).toHaveText('Unsaved changes');
      await testInfo.attach('inspector-block', { body: await page.screenshot(), contentType: 'image/png' });
      // Back to Sections (the pinned rows live there), then the Brand & sender panel.
      await page.getByTestId('email-design-back').click();
      await expect(page.getByTestId('email-sections-tab')).toBeVisible();
      await testInfo.attach('inspector-sections', { body: await page.screenshot(), contentType: 'image/png' });
      await page.getByTestId('email-pinned-row').first().click();
      await expect(page.getByTestId('email-branding-panel')).toBeVisible();
      await testInfo.attach('inspector-branding', { body: await page.screenshot(), contentType: 'image/png' });
      await page.getByTestId('email-design-back').click();

      // The insert flow against the built bundle.
      await page.getByTestId('email-add-section').click();
      await expect(page.getByTestId('email-picker-where')).toHaveText('Added at the end of the email');
      await expect(page.getByTestId('email-picker-tile')).toHaveCount(24);
      await testInfo.attach('block-picker', { body: await page.screenshot(), contentType: 'image/png' });
      await page.keyboard.press('Escape');
      await page.getByRole('radio', { name: 'Mobile' }).click();
      await expect(page.getByTestId('email-mail-shell')).toHaveAttribute('data-device', 'mobile');
      await testInfo.attach('canvas-mobile', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    } finally {
      await page.request.delete(`/api/v1/email-templates/${doc.id}`);
    }
  });

  test('Choose image uploads into the block; Send test collects recipients', async ({ page }, testInfo) => {
    // A scratch template with one image block, made and removed through the API; the upload it makes is removed too.
    const created = await page.request.post('/api/v1/email-templates', { data: { kind: 'template', name: 'Overlay scratch', starter: null } });
    expect(created.status()).toBe(201);
    const doc = (await created.json()) as { id: string };
    let uploadedFileId: string | null = null;
    try {
      const put = await page.request.put(`/api/v1/email-templates/${doc.id}`, {
        data: {
          name: 'Overlay scratch',
          category: 'lifecycle',
          enabled: false,
          document: {
            subject: 'Overlay scratch',
            preheader: '',
            footer: 'Sent by Adminium',
            brand: null,
            attachments: [],
            blocks: [{ id: 'b_img', block: 'email.image', data: { alt: 'Hero image — 600 × 240', url: '', height: 160 }, style: {} }],
          },
        },
      });
      expect(put.ok()).toBe(true);
      await page.goto(`/email-templates/${doc.id}`);
      await page.getByTestId('email-block').first().click();
      await expect(page.getByTestId('email-block-panel')).toHaveAttribute('data-kind', 'email.image');

      // Choose an image → Upload: the file goes to POST /files and its id lands in the block.
      await page.getByTestId('email-choose-image').click();
      const picker = page.getByRole('dialog', { name: 'Choose an image' });
      await expect(picker).toBeVisible();
      await testInfo.attach('image-picker-files', { body: await page.screenshot(), contentType: 'image/png' });
      await picker.getByRole('tab', { name: 'Upload' }).click();
      await expect(picker.getByText('Drop an image here')).toBeVisible();
      await testInfo.attach('image-picker-upload', { body: await page.screenshot(), contentType: 'image/png' });
      const posted = page.waitForResponse((response) => response.request().method() === 'POST' && /\/api\/v1\/files(\?|$)/.test(response.url()));
      await picker.getByTestId('email-image-upload').setInputFiles({
        name: 'hero.png',
        mimeType: 'image/png',
        buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'),
      });
      const upload = await posted;
      expect(upload.status()).toBe(201);
      uploadedFileId = ((await upload.json()) as { data: { id: string } }).data.id;
      await expect(picker).toBeHidden();
      const image = page.getByTestId('email-canvas').getByRole('img', { name: 'hero' });
      await expect(image).toHaveAttribute('src', /\/files\//);
      await expect(page.getByTestId('email-save-chip')).toHaveText('Unsaved changes');
      await testInfo.attach('canvas-uploaded-image', { body: await page.screenshot(), contentType: 'image/png' });

      // Send test email: recipients as chips and the footer count. The send
      // itself joins with the SMTP sink.
      await page.getByTestId('email-test').click();
      const modal = page.getByRole('dialog', { name: 'Send test email' });
      await expect(modal).toBeVisible();
      await expect(modal.getByTestId('email-test-send')).toBeDisabled();
      await modal.getByPlaceholder('name@company.com, …').pressSequentially('qa@example.com,');
      await expect(modal.getByTestId('email-test-count')).toHaveText('1 recipient');
      await expect(modal.getByTestId('email-test-send')).toBeEnabled();
      await testInfo.attach('test-send-modal', { body: await page.screenshot(), contentType: 'image/png' });
      await modal.getByRole('button', { name: 'Cancel' }).click();
      await expect(modal).toBeHidden();
    } finally {
      await page.request.delete(`/api/v1/email-templates/${doc.id}`);
      if (uploadedFileId !== null) await page.request.delete(`/api/v1/files/${uploadedFileId}`);
    }
  });

  test('Send campaign collects the audience and the time, then meets the relay', async ({ page }, testInfo) => {
    // A scratch campaign, made and removed through the API. The stack has no SMTP relay, so the send
    // ends at the server's refusal — the SMTP sink and the real run join.
    const created = await page.request.post('/api/v1/email-templates', { data: { kind: 'campaign', name: 'Launch scratch', starter: null } });
    expect(created.status()).toBe(201);
    const doc = (await created.json()) as { id: string };
    try {
      await page.goto(`/email-templates/${doc.id}`);
      await expect(page.getByTestId('email-editor-header')).toBeVisible();
      await expect(page.getByTestId('email-save')).toHaveText('Save');
      await page.getByTestId('email-send').click();
      const modal = page.getByRole('dialog', { name: 'Send campaign' });
      await expect(modal).toBeVisible();
      await expect(modal.getByText('Workspace users')).toBeVisible();
      // The count is the live audience: every active user minus opt-outs.
      await expect(modal.getByTestId('email-campaign-count')).toHaveText(/^\d+ recipients?/);
      await testInfo.attach('campaign-modal', { body: await page.screenshot(), contentType: 'image/png' });
      await modal.getByRole('radio', { name: 'Schedule' }).click();
      await modal.getByTestId('email-campaign-at').fill('2999-01-01T10:00');
      await expect(modal.getByTestId('email-campaign-send')).toHaveText('Schedule campaign');
      await testInfo.attach('campaign-modal-schedule', { body: await page.screenshot(), contentType: 'image/png' });
      await modal.getByRole('radio', { name: 'Now' }).click();
      const posted = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith(`/api/v1/email-templates/${doc.id}/send`));
      await modal.getByTestId('email-campaign-send').click();
      const reply = await posted;
      if (reply.status() === 202) {
        await expect(page.getByText('Campaign sent!')).toBeVisible();
      } else {
        expect(reply.status()).toBe(409);
        await expect(modal.getByRole('alert')).toContainText('SMTP');
      }
      await testInfo.attach('campaign-modal-after-send', { body: await page.screenshot(), contentType: 'image/png' });
      await page.keyboard.press('Escape');
    } finally {
      await page.request.delete(`/api/v1/email-templates/${doc.id}`);
    }
  });

  test('archived mode is reachable from the menu and leaves through the chip', async ({ page }) => {
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Archived' }).click();
    await expect(page.getByTestId('email-archived-chip')).toBeVisible();
    await expect(page.getByText('No archived templates')).toBeVisible();
    await page.getByRole('button', { name: 'Leave archived' }).click();
    await expect(page.getByTestId('email-archived-chip')).toBeHidden();
    await expect(page.getByTestId('email-card')).toHaveCount(56);
  });
});
