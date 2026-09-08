// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The send flows against the built stack and the SMTP sink
 * (39-email-templates-and-campaigns.md 39-T19): New template from *Welcome
 * email* → rename inline → edit the heading → Save → Test → one message in the
 * sink carrying the on-screen heading and the mark as a CID part → Duplicate
 * → Add language `de_DE` (translated, no warn) → insert a divider → *Apply to
 * all* → Save → both rows changed → attach a PDF from Files → Test → the PDF
 * is a part → Delete → Undo → Archived → *Delete for good* → New campaign from
 * that template → Send to all users → the run reaches *Sent* with every
 * active user counted and the card reads *N sent* → Schedule for +2 min →
 * *Scheduled · time* → *Cancel schedule* → Export → Import (Skip) creates
 * nothing. Everything the flow creates is removed at the end, the sink
 * included.
 */
import { expect, test, type Page } from '@playwright/test';

import { SINK_URL, type SinkMessage } from './constants.js';
import { seededConnectionId, signIn } from './helpers.js';

const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\nxref\n0 4\n0000000000 65535 f \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n0\n%%EOF\n',
  'utf8',
);

interface Detail {
  needsTranslation: boolean;
  document: { blocks: { block: string }[] };
}

interface Run {
  id: string;
  status: string;
  sent: number;
  failed: number;
  skipped: number;
  total: number;
}

async function sinkMessages(page: Page): Promise<SinkMessage[]> {
  const reply = await page.request.get(`${SINK_URL}/messages`);
  expect(reply.ok()).toBe(true);
  return (await reply.json()) as SinkMessage[];
}

/** The worker delivers on its own clock; poll the sink until `pick` finds the message. */
async function waitForSink(page: Page, pick: (messages: SinkMessage[]) => SinkMessage | undefined, label: string): Promise<SinkMessage> {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const found = pick(await sinkMessages(page));
    if (found !== undefined) return found;
    await page.waitForTimeout(500);
  }
  throw new Error(`the sink never received ${label}`);
}

async function waitForRun(page: Page, campaignId: string): Promise<Run> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const reply = await page.request.get(`/api/v1/email-templates/${campaignId}/runs`);
    expect(reply.ok()).toBe(true);
    const latest = ((await reply.json()) as { runs: Run[] }).runs[0];
    if (latest !== undefined && latest.status !== 'scheduled' && latest.status !== 'running') return latest;
    await page.waitForTimeout(500);
  }
  throw new Error('the campaign run never finished');
}

async function detail(page: Page, id: string): Promise<Detail> {
  const reply = await page.request.get(`/api/v1/email-templates/${id}`);
  expect(reply.ok()).toBe(true);
  return (await reply.json()) as Detail;
}

function localMinute(at: number): string {
  const date = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const idFromUrl = (page: Page): string => page.url().split('/').pop() ?? '';

/** Toasts stack over the bottom-right cards and intercept a hover; clear them before card actions. */
async function dismissToasts(page: Page): Promise<void> {
  const dismiss = page.locator('[role="status"], [role="alert"]').getByRole('button', { name: 'Dismiss' });
  for (let i = 0; i < 12 && (await dismiss.count()) > 0; i += 1) {
    await dismiss.first().click();
  }
  await expect(dismiss).toHaveCount(0);
}

test.describe('email send flows (39-T19)', () => {
  test('template → test → languages → mirror → attachment → undo → archive → campaign → export/import', async ({ page }, testInfo) => {
    test.setTimeout(600_000);
    page.setDefaultTimeout(20_000); // a stuck locator fails fast instead of eating the budget
    await signIn(page);
    await page.request.delete(`${SINK_URL}/messages`);
    const connectionId = await seededConnectionId(page);
    const created = new Set<string>();
    let fileId: string | null = null;
    const chip = page.getByTestId('email-save-chip');
    const users = ((await (await page.request.get('/api/v1/users?status=active')).json()) as { users: { email: string }[] }).users;
    expect(users.length).toBeGreaterThan(1);

    try {
      // --- New template from Welcome email; rename inline; edit the heading; Save ---
      await page.goto('/email-templates');
      await page.getByTestId('email-new').click();
      await page.locator('[data-testid="email-starter"][data-starter="welcome"]').click();
      await expect(page.getByTestId('email-editor-header')).toBeVisible();
      const templateId = idFromUrl(page);
      created.add(templateId);
      await page.getByTestId('email-editor-name').fill('Welcome flow');
      const heading = page.getByTestId('email-heading-input');
      await heading.click();
      await heading.press('End');
      await heading.pressSequentially(' hello-e2e-marker');
      await expect(chip).toHaveText('Unsaved changes');
      await page.getByTestId('email-save').click();
      await expect(chip).toHaveText('All changes saved');

      // --- Test → the sink holds the on-screen heading and the mark as a CID part ---
      await page.getByTestId('email-test').click();
      await page.getByPlaceholder('name@company.com, …').pressSequentially('qa@example.com,');
      await page.getByTestId('email-test-send').click();
      await expect(page.getByText('Test sent!')).toBeVisible();
      await page.getByRole('button', { name: 'Done' }).click();
      const first = await waitForSink(page, (all) => all.find((m) => m.to.includes('qa@example.com')), 'the first test send');
      expect(first.html).toContain('hello-e2e-marker');
      expect(first.attachments.some((a) => a.cid !== null && a.contentType === 'image/png')).toBe(true);
      await testInfo.attach('sink-first-message', { body: JSON.stringify({ ...first, html: first.html.slice(0, 600) }, null, 2), contentType: 'application/json' });

      // --- Duplicate (from the header), then back to the original ---
      await page.getByTestId('email-editor-header').getByRole('button', { name: 'Duplicate' }).click();
      await expect(page.getByText('Template duplicated')).toBeVisible();
      const listed = ((await (await page.request.get('/api/v1/email-templates?kind=template')).json()) as { items: { id: string; name: string }[] }).items;
      const copy = listed.find((doc) => doc.name === 'Welcome flow (copy)');
      expect(copy).toBeDefined();
      if (copy !== undefined) created.add(copy.id);
      await page.goto(`/email-templates/${templateId}`);

      // --- Add language de_DE: the starter family is translated, so no warn pill ---
      await page.getByTestId('email-language-button').click();
      await page.getByTestId('email-language-row').filter({ hasText: 'Deutsch' }).click();
      await expect(page.getByTestId('email-language-button')).toContainText('Deutsch');
      const deId = idFromUrl(page);
      expect(deId).not.toBe(templateId);
      created.add(deId);
      expect((await detail(page, deId)).needsTranslation).toBe(false);
      await expect(page.getByTestId('email-heading-input')).toHaveValue(/Willkommen/);
      await testInfo.attach('editor-de', { body: await page.screenshot(), contentType: 'image/png' });
      await page.goto(`/email-templates/${templateId}`);

      // --- Insert a divider → Apply to all → Save → both rows changed ---
      const blocksBefore = (await detail(page, templateId)).document.blocks.length;
      const blocksBeforeDe = (await detail(page, deId)).document.blocks.length;
      await page.getByTestId('email-add-section').click();
      await page.locator('[data-testid="email-picker-tile"][data-kind="email.divider"]').click();
      await expect(page.getByTestId('email-mirror-body')).toBeVisible();
      await page.getByTestId('email-mirror-all').click();
      await page.getByTestId('email-save').click();
      await expect(chip).toHaveText('All changes saved');
      expect((await detail(page, templateId)).document.blocks.length).toBe(blocksBefore + 1);
      expect((await detail(page, deId)).document.blocks.length).toBe(blocksBeforeDe + 1);

      // --- Attach a PDF from Files → Test → the PDF is a part ---
      // The insert left the Design tab open on the divider; the pinned rows live on Sections.
      await page.getByTestId('email-design-back').click();
      const upload = await page.request.post(`/api/v1/files?${new URLSearchParams({ filename: 'onboarding.pdf', connectionId }).toString()}`, {
        headers: { 'content-type': 'application/pdf' },
        data: PDF,
      });
      expect(upload.status()).toBe(201);
      fileId = ((await upload.json()) as { data: { id: string } }).data.id;
      await page.getByTestId('email-pinned-row').nth(2).click();
      await page.locator(`[data-testid="email-workspace-document"][data-file-id="${fileId}"]`).click();
      await expect(page.getByTestId('email-attachment-row')).toHaveCount(1);
      await page.getByTestId('email-save').click();
      await expect(chip).toHaveText('All changes saved');
      await page.getByTestId('email-test').click();
      await page.getByPlaceholder('name@company.com, …').pressSequentially('qa2@example.com,');
      await page.getByTestId('email-test-send').click();
      await expect(page.getByText('Test sent!')).toBeVisible();
      await page.getByRole('button', { name: 'Done' }).click();
      const second = await waitForSink(page, (all) => all.find((m) => m.to.includes('qa2@example.com')), 'the second test send');
      expect(second.attachments.some((a) => a.contentType === 'application/pdf' && a.filename === 'onboarding.pdf')).toBe(true);

      // --- Delete → Undo ---
      await page.getByTestId('email-editor-header').getByRole('button', { name: 'Delete' }).click();
      await page.getByTestId('email-delete-confirm').click();
      await expect(page.getByRole('heading', { level: 1, name: 'Email templates' })).toBeVisible();
      await page.getByRole('button', { name: 'Undo' }).click();
      await expect(page.getByTestId('email-card').filter({ hasText: 'Welcome flow' }).first()).toBeVisible();

      // --- The copy: Delete, then Archived → Delete for good ---
      await dismissToasts(page);
      const copyCard = page.getByTestId('email-card').filter({ hasText: 'Welcome flow (copy)' });
      await copyCard.hover();
      await copyCard.getByRole('button', { name: 'Delete' }).click();
      await page.getByTestId('email-delete-confirm').click();
      await expect(copyCard).toBeHidden();
      await page.getByTestId('email-actions-menu').click();
      await page.getByRole('menuitem', { name: 'Archived' }).click();
      await expect(page.getByTestId('email-archived-chip')).toBeVisible();
      await dismissToasts(page);
      const archivedCopy = page.getByTestId('email-card').filter({ hasText: 'Welcome flow (copy)' });
      await archivedCopy.hover();
      await archivedCopy.getByRole('button', { name: 'Delete for good' }).click();
      await page.getByTestId('email-delete-confirm').click();
      await expect(archivedCopy).toBeHidden();
      if (copy !== undefined) created.delete(copy.id);
      await page.getByRole('button', { name: 'Leave archived' }).click();

      // --- New campaign from that template → Send to all users → Sent with sent = N ---
      await page.getByRole('tab', { name: /Campaigns/ }).click();
      await page.getByTestId('email-new').click();
      await page.getByTestId('email-from-template').filter({ hasText: 'Welcome flow' }).first().click();
      await expect(page.getByTestId('email-editor-header')).toBeVisible();
      const campaignId = idFromUrl(page);
      created.add(campaignId);
      await page.request.delete(`${SINK_URL}/messages`);
      await page.getByTestId('email-send').click();
      await expect(page.getByTestId('email-campaign-count')).toHaveText(new RegExp(`^${String(users.length)} recipients`));
      await page.getByTestId('email-campaign-send').click();
      await expect(page.getByText('Campaign sent!')).toBeVisible();
      await page.getByRole('button', { name: 'Done' }).click();
      const run = await waitForRun(page, campaignId);
      expect(run.status).toBe('sent');
      expect(run.sent).toBe(users.length);
      expect(run.failed).toBe(0);
      await waitForSink(page, (all) => (all.length >= users.length ? all[0] : undefined), `${String(users.length)} campaign messages`);
      const delivered = await sinkMessages(page);
      expect(new Set(delivered.flatMap((m) => m.to))).toEqual(new Set(users.map((u) => u.email)));
      await page.goto('/email-templates');
      await page.getByRole('tab', { name: /Campaigns/ }).click();
      await expect(page.getByTestId('email-card').filter({ hasText: 'Welcome flow' }).first()).toContainText(`${String(users.length)} sent`);
      await testInfo.attach('campaign-card-sent', { body: await page.screenshot(), contentType: 'image/png' });

      // --- Schedule for +2 min → Scheduled · time → Cancel schedule ---
      await page.goto(`/email-templates/${campaignId}`);
      await page.getByTestId('email-send').click();
      await page.getByRole('radio', { name: 'Schedule' }).click();
      await page.getByTestId('email-campaign-at').fill(localMinute(Date.now() + 2 * 60_000));
      await page.getByTestId('email-campaign-send').click();
      await expect(page.getByText('Campaign scheduled!')).toBeVisible();
      await page.getByRole('button', { name: 'Done' }).click();
      await expect(page.getByTestId('email-run-chip')).toHaveAttribute('data-status', 'scheduled');
      await expect(page.getByTestId('email-run-chip')).toContainText('Scheduled · ');
      await testInfo.attach('campaign-scheduled', { body: await page.screenshot(), contentType: 'image/png' });
      await page.getByTestId('email-cancel-run').click();
      await expect(page.getByText('Schedule cancelled')).toBeVisible();
      await expect(page.getByTestId('email-run-chip')).toBeHidden();

      // --- Export all → Import (Skip) creates nothing ---
      await page.goto('/email-templates');
      await expect(page.getByTestId('email-card').first()).toBeVisible();
      const countBefore = await page.getByTestId('email-card').count();
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        (async () => {
          await page.getByTestId('email-actions-menu').click();
          await page.getByRole('menuitem', { name: 'Export all' }).click();
        })(),
      ]);
      const bundlePath = await download.path();
      expect(bundlePath).not.toBeNull();
      await page.getByTestId('email-actions-menu').click();
      await page.getByRole('menuitem', { name: 'Import template' }).click();
      await page.getByTestId('email-import-file').setInputFiles(bundlePath as string);
      await expect(page.getByTestId('email-import-summary')).toContainText('already exist');
      await page.getByTestId('email-import-confirm').click();
      await expect(page.getByText(/^0 imported · 0 replaced · \d+ skipped$/)).toBeVisible();
      await expect(page.getByTestId('email-card')).toHaveCount(countBefore);
    } finally {
      for (const id of created) await page.request.delete(`/api/v1/email-templates/${id}`);
      if (fileId !== null) await page.request.delete(`/api/v1/files/${fileId}`);
      await page.request.delete(`${SINK_URL}/messages`);
    }
  });
});
