// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE THREE LAYOUTS, DRIVEN.
 *
 * A layout is not a second form engine — the same document, the same controls,
 * the same values, arranged differently — so what a browser has to prove is
 * what the arrangement DECIDES: that a wizard shows one step at a time and
 * will not let anybody past a step it has refused, that quick-create answers
 * its fields from pills rather than a column of labels, and that a named image
 * field stands beside the rest instead of among them.
 *
 * Each test writes the page's `config.form`, drives the dialog, and puts the
 * page back the way it found it.
 */
import { expect, test, type Page } from '@playwright/test';

import { signIn } from './helpers.js';

async function pageIdFor(page: Page, slug: string): Promise<string> {
  const list = await page.request.get('/api/v1/pages');
  const { data: pages } = (await list.json()) as { data: { id: string; slug: string }[] };
  const found = pages.find((entry) => entry.slug === slug);
  expect(found, `the seed generates a ${slug} page`).toBeDefined();
  return String(found?.id);
}

/** Put `form` on the page's stored config, and answer how to take it off. */
async function withForm(page: Page, pageId: string, form: unknown): Promise<() => Promise<void>> {
  const reply = await page.request.get(`/api/v1/pages/${pageId}`);
  const body = (await reply.json()) as { data: { config?: Record<string, unknown> } };
  const original = { ...(body.data.config ?? {}) };
  const next = { ...original, form };
  const written = await page.request.patch(`/api/v1/pages/${pageId}/config`, { data: { config: next } });
  expect(written.ok(), await written.text()).toBe(true);
  return async () => {
    const restored = { ...original };
    delete restored['form'];
    await page.request.patch(`/api/v1/pages/${pageId}/config`, { data: { config: restored } });
  };
}

test.describe('the form layouts', () => {
  test('a wizard shows one step at a time, and Back is disabled on the first', async ({ page }) => {
    await signIn(page);
    const pageId = await pageIdFor(page, 'shippers');
    const undo = await withForm(page, pageId, {
      v: 2,
      preset: 'wizard',
      sections: [
        { id: 'who', label: 'Company', hint: 'Who ships it', columns: 2, fields: [{ column: 'company_name', required: true }] },
        { id: 'how', label: 'Contact', hint: 'How to reach them', columns: 2, fields: [{ column: 'phone' }] },
      ],
    });
    try {
      await page.goto('/p/shippers');
      await page.getByRole('button', { name: /New shipper|New row|New/ }).first().click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();

      // Step one: its own field, the rail saying so, and Back DIMMED rather
      // than hidden — a control that does nothing has to say so (DP13).
      await expect(dialog.getByLabel(/Company Name/)).toBeVisible();
      await expect(dialog.getByLabel(/Phone/)).toHaveCount(0);
      await expect(dialog.getByTestId('record-form-back')).toBeDisabled();

      // Continue checks THIS step before it advances.
      await dialog.getByTestId('record-form-next').click();
      await expect(dialog.getByText('This field is required.')).toBeVisible();
      await expect(dialog.getByLabel(/Phone/)).toHaveCount(0);

      await dialog.getByLabel(/Company Name/).fill('Northwind Freight');
      await dialog.getByTestId('record-form-next').click();
      await expect(dialog.getByLabel(/Phone/)).toBeVisible();
      await expect(dialog.getByTestId('record-form-back')).toBeEnabled();
      // The last step submits rather than continuing.
      await expect(dialog.getByTestId('record-form-next')).toHaveCount(0);

      await dialog.getByLabel(/Phone/).fill('555-0100');
      /*
       * The last step also carries `shipper_id`: this table's key has no
       * database default, so the READ-TIME safety net appends the column the
       * database will demand to the last section (D10) — a designed form can be
       * incomplete, it can never be unable to create.
       */
      const key = dialog.getByLabel(/Shipper Id/);
      await expect(key).toBeVisible();
      await key.fill(String(900 + Math.floor(Math.random() * 90)));
      await dialog.getByRole('button', { name: /Create shipper|Create/ }).first().click();
      await expect(dialog).toBeHidden({ timeout: 20_000 });
      await expect(page.getByText('Northwind Freight').first()).toBeVisible();
    } finally {
      await undo();
    }
  });

  test('quick create answers its fields from pills, and a named image stands aside', async ({ page }) => {
    await signIn(page);
    const pageId = await pageIdFor(page, 'employees');
    const undo = await withForm(page, pageId, {
      v: 2,
      preset: 'quick-create',
      sections: [
        {
          id: 'main',
          columns: 1,
          fields: [
            { column: 'last_name', placeholder: 'Who is joining?' },
            { column: 'notes' },
            { column: 'hire_date' },
            { column: 'reports_to' },
          ],
        },
      ],
    });
    try {
      await page.goto('/p/employees');
      await page.getByRole('button', { name: /New employee|New row|New/ }).first().click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();

      // The title carries no label — its placeholder is the label (comp 145).
      await expect(dialog.getByPlaceholder('Who is joining?')).toBeVisible();
      const pills = dialog.getByTestId('quick-pills');
      await expect(pills).toBeVisible();

      // The date pill's menu: the four presets AND the comp's own date input,
      // because the comp stores a label and a column stores a date (DP12).
      await dialog.getByTestId('quick-pill-hire_date').click();
      await expect(page.getByRole('button', { name: 'Today' })).toBeVisible();
      await expect(page.getByLabel('Pick a date')).toBeVisible();
      await page.getByRole('button', { name: 'Tomorrow' }).click();
      await expect(dialog.getByTestId('quick-pill-hire_date')).not.toHaveText(/Hire Date/);
    } finally {
      await undo();
    }
  });

  test('a section that names an image field puts it beside the others', async ({ page }) => {
    await signIn(page);
    const pageId = await pageIdFor(page, 'employees');
    const undo = await withForm(page, pageId, {
      v: 2,
      preset: 'sectioned',
      sections: [
        {
          id: 'main',
          label: 'Who',
          columns: 2,
          aside: 'photo_path',
          fields: [{ column: 'photo_path' }, { column: 'last_name' }, { column: 'first_name' }],
        },
      ],
    });
    try {
      await page.goto('/p/employees');
      await page.getByRole('button', { name: /New employee|New row|New/ }).first().click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      // 150px, the comp's own — a named section feature rather than a per-row
      // pixel grid nobody could express (DP14).
      const aside = dialog.locator('[data-part="section-aside"] > div').first();
      await expect(aside).toBeVisible();
      await expect(aside).toHaveClass(/w-\[150px\]/);
    } finally {
      await undo();
    }
  });
});
