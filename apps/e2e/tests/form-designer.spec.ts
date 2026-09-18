// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE FORM DESIGNER, DRIVEN.
 *
 * Every reorder assertion elsewhere in this repo is a call into the pure model
 * (`form-designer/model.test.ts`), which proves the reducer and nothing about
 * dnd-kit: the sensor, its 4px activation distance and the dragged row's own
 * styling are browser-only. The in-app Browser pane cannot see them — its rAF
 * never ticks, so a dnd-kit drag never moves — so the pointer path is pinned
 * here, with the negative control that stops it passing vacuously.
 *
 * The rest of the file is the gate's own list: group into sections, change a
 * control, set a starting value, preview, save, and then CREATE a record with
 * the form that was just designed — because a designer whose output the dialog
 * does not honour is a designer that designs nothing.
 */
import { expect, test } from '@playwright/test';

import { signIn } from './helpers.js';

/** The shippers page: three columns, one of them a plain text name. */
async function openDesigner(page: import('@playwright/test').Page): Promise<string> {
  const list = await page.request.get('/api/v1/pages');
  const { data: pages } = (await list.json()) as { data: { id: string; slug: string }[] };
  const shippers = pages.find((entry) => entry.slug === 'shippers');
  expect(shippers, 'the seed generates a shippers page').toBeDefined();
  const pageId = String(shippers?.id);
  await page.goto(`/studio/pages/${pageId}`);
  await expect(page.getByTestId('form-field-list')).toBeVisible();
  return pageId;
}

/** Put the page back the way the suite found it. */
async function resetForm(page: import('@playwright/test').Page, pageId: string): Promise<void> {
  const reply = await page.request.get(`/api/v1/pages/${pageId}`);
  const body = (await reply.json()) as { data: { config?: Record<string, unknown> } };
  const config = { ...(body.data.config ?? {}) };
  delete config['form'];
  await page.request.patch(`/api/v1/pages/${pageId}/config`, { data: { config } });
}

test.describe('the form designer', () => {
  test('reorders a field by pointer drag, and not by moving the pointer alone', async ({ page }) => {
    await signIn(page);
    const pageId = await openDesigner(page);
    try {
      const rows = page.locator('[data-testid="form-field-row"]');
      const first = String(await rows.nth(0).getAttribute('data-field'));
      const second = String(await rows.nth(1).getAttribute('data-field'));
      expect(first).not.toEqual(second);

      const handle = page.locator(`[data-testid="form-field-handle"][data-field="${first}"]`);
      await handle.scrollIntoViewIfNeeded();
      // Read the boxes AFTER the page has settled: the designer card renders
      // once its page query resolves, and a box taken before that is a
      // coordinate the row has since moved away from.
      const box = async () => ({
        grip: (await handle.boundingBox())!,
        target: (await rows.nth(1).boundingBox())!,
      });
      let { grip, target } = await box();

      /*
       * THE NEGATIVE CONTROL. The same moves without pressing the button leave
       * the order alone — which is what makes the drag below evidence that the
       * sensor engaged, rather than evidence that something re-rendered.
       */
      await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
      await page.mouse.move(grip.x + grip.width / 2, target.y + target.height * 0.9, { steps: 8 });
      await expect(rows.nth(0)).toHaveAttribute('data-field', first);

      ({ grip, target } = await box());
      await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
      await page.mouse.down();
      // Past the 4px activation distance, then over the second row.
      await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2 + 8, { steps: 4 });
      await page.mouse.move(grip.x + grip.width / 2, target.y + target.height * 0.9, { steps: 12 });
      // Mid-drag the row lifts: dnd-kit's own state, rendered.
      await expect(page.locator(`[data-testid="form-field-row"][data-field="${first}"]`)).toHaveClass(
        /shadow-card/,
      );
      await page.mouse.up();

      await expect(rows.nth(0)).toHaveAttribute('data-field', second);
      await expect(rows.nth(1)).toHaveAttribute('data-field', first);
    } finally {
      await resetForm(page, pageId);
    }
  });

  test('designs a form, saves it, and the create dialog draws exactly that', async ({ page }) => {
    test.slow();
    await signIn(page);
    const pageId = await openDesigner(page);
    try {
      // A second section, and the first field moved into it with the arrows —
      // the keyboard path, which is also how a field crosses a section.
      await page.getByTestId('form-add-section').click();
      const sections = page.locator('[data-testid="form-field-list"] section');
      await expect(sections).toHaveCount(2);
      const rows = page.locator('[data-testid="form-field-row"]');
      const moved = String(await rows.nth(0).getAttribute('data-field'));
      const upTo = await rows.count();
      for (let i = 0; i < upTo; i += 1) {
        await page.locator(`[data-testid="form-field-row"][data-field="${moved}"]`).getByTestId('form-field-down').click();
      }
      await expect(sections.nth(1).locator('[data-testid="form-field-row"]')).toHaveCount(1);

      // Name the sections, so the dialog draws the comp's section heads.
      const labels = page.getByTestId('form-section-label');
      await labels.nth(0).fill('Details');
      await labels.nth(1).fill('Contact');

      // A control and a starting value on the field that moved.
      const row = page.locator(`[data-testid="form-field-row"][data-field="${moved}"]`);
      await row.getByTestId('form-field-settings-open').click();
      const settings = page.getByTestId('form-field-settings');
      await expect(settings).toBeVisible();
      await settings.getByTestId('form-field-label').fill('Phone number');
      // The control select offers only what this column may legally be given.
      const controls = await settings.getByTestId('form-field-control').locator('option').allTextContents();
      expect(controls.length).toBeGreaterThan(1);
      await settings.getByTestId('form-field-control').selectOption(controls[controls.length - 1] as string);
      await settings.getByTestId('form-field-initial').selectOption('literal');
      await settings.getByTestId('form-field-initial-value').fill('+1 555 0100');

      // The preview is the REAL dialog rendering the draft.
      await page.getByTestId('form-preview-open').click();
      const preview = page.getByRole('dialog');
      await expect(preview).toBeVisible();
      await expect(preview.getByRole('heading', { name: 'Contact' })).toBeVisible();
      await preview.getByRole('button', { name: /Cancel/ }).click();

      await page.getByTestId('studio-pages-save').click();
      await expect(page).toHaveURL(/\/studio\/pages$/);

      // What was stored: the designed document, with the settings on it.
      const saved = await page.request.get(`/api/v1/pages/${pageId}`);
      const stored = (await saved.json()) as {
        data: { config: { form?: { sections: { label?: string; fields: Record<string, unknown>[] }[] } } };
      };
      const form = stored.data.config.form;
      expect(form?.sections.map((section) => section.label)).toEqual(['Details', 'Contact']);
      expect(form?.sections[1]?.fields[0]).toMatchObject({
        label: 'Phone number',
        initial: { kind: 'literal', value: '+1 555 0100' },
      });

      // …and the create dialog honours it: two section heads and the new label.
      await page.goto('/p/shippers');
      await page.getByRole('button', { name: /New shipper|New row|New/ }).first().click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('heading', { name: 'Details' })).toBeVisible();
      await expect(dialog.getByRole('heading', { name: 'Contact' })).toBeVisible();
      await expect(dialog.getByLabel(/Phone number/)).toBeVisible();
    } finally {
      await resetForm(page, pageId);
    }
  });
});
