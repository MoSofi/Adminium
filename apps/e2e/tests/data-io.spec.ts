// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/imports` and `/exports` — that the two data-io screens still arrive,
 * now that their bodies are behind a dynamic import.
 *
 * Neither route had coverage at any level: `dataio.test.tsx` mounts the two
 * page components directly, so it proves the components render and says nothing
 * about the ROUTE — and a route whose body is lazy fails in ways a direct mount
 * cannot see (a bad specifier, a missing default, a Suspense boundary in the
 * wrong place). That is precisely the change `data-io/routes.tsx` just made:
 * both bodies moved out of the entry chunk, which is also what made the
 * `page-wizard` template's own lazy binding real rather than nominal.
 *
 * The assertions are deliberately shallow — the page frame, and one control
 * that only exists inside the lazily-loaded body. Anything deeper belongs with
 * the wizard's own suite; this one answers "did the chunk arrive and mount".
 */
import { expect, test } from '@playwright/test';

import { signIn } from './helpers.js';

test.describe('data-io routes load their bodies', () => {
  test('/imports renders the wizard behind its Suspense boundary', async ({ page }) => {
    await signIn(page);
    await page.goto('/imports');

    // The frame paints first: the surface and its topbar title are outside the
    // Suspense boundary on purpose, so a navigation never looks like it failed.
    await expect(page.getByRole('heading', { name: 'Import data' })).toBeVisible();

    // …and the body follows. The step rail is inside the lazy chunk.
    await expect(page.getByText('Map columns')).toBeVisible();
    await expect(page.getByText('Drop a CSV file to import')).toBeVisible();
  });

  test('/exports renders the exports manager behind its Suspense boundary', async ({ page }) => {
    await signIn(page);
    await page.goto('/exports');

    await expect(page.getByRole('heading', { name: 'Data exports' })).toBeVisible();
    await expect(page.getByText('Exports are kept for 30 days, then expire.')).toBeVisible();
  });
});

/**
 * A whole import, on the dashboard's own page: the wizard is one component
 * with two hosts (this page, and a part on an app's own screen), and this is
 * the proof that it still works where it came from. Three lines are pasted
 * into Customers, one of them a customer who is already there; the lines are
 * looked at before anything is written; the run leaves that customer as they
 * are and brings in the other two; and the rows are in the table. The two it
 * made are taken away again, whatever happened.
 */
test.describe('a whole import on the dashboard’s page', () => {
  test('three pasted lines are previewed, run and in the table; the one already here is left as it was', async ({ page }) => {
    await signIn(page);
    const problems: string[] = [];
    page.on('pageerror', (error) => problems.push(String(error)));
    const connections = (await (await page.request.get('/api/v1/connections')).json()) as { connections: { id: string }[] };
    const connectionId = connections.connections[0]!.id;
    const schema = (await (await page.request.get(`/api/v1/connections/${connectionId}/schema`)).json()) as { model: { tables: { id: string; name: string }[] } };
    const customers = encodeURIComponent(schema.model.tables.find((table) => table.name === 'customers')!.id);
    const row = async (id: string): Promise<{ status: number; data?: Record<string, unknown> }> => {
      const reply = await page.request.get(`/api/v1/data/${connectionId}/${customers}/${id}`);
      return reply.ok() ? { status: 200, data: ((await reply.json()) as { data: Record<string, unknown> }).data } : { status: reply.status() };
    };
    // The key column's name, and the customer who is already here, as the seed has them.
    const alfki = (await row('ALFKI')).data!;
    const key = Object.keys(alfki).find((column) => alfki[column] === 'ALFKI')!;
    const made = ['ZZIM1', 'ZZIM2'];
    const clear = async (): Promise<void> => {
      for (const id of made) await page.request.delete(`/api/v1/data/${connectionId}/${customers}/${id}`).catch(() => undefined);
    };
    await clear();

    try {
      await page.goto('/imports');
      await expect(page.getByText('Drop a CSV file to import')).toBeVisible();
      await page.getByTestId('import-target').selectOption({ label: 'Customers' });
      const box = page.getByTestId('import-paste').getByRole('textbox');
      await expect(box).toBeEnabled();
      await box.fill([`${key},company_name,city`, 'ZZIM1,Import One,Kiel', 'ALFKI,Somebody Else Entirely,Nowhere', 'ZZIM2,Import Two,Lyon'].join('\n'));
      await page.getByTestId('import-paste-use').click();

      // The columns are matched by their names; the lines are matched on the key, and a line already here is left.
      await expect(page.locator('[data-part="mapping-row"]')).toHaveCount(3);
      await expect.poll(() => page.locator('[data-part="mapping-row"] [data-part="mapping-target"]').evaluateAll((all) => all.map((select) => (select as HTMLSelectElement).value))).toEqual([key, 'company_name', 'city']);
      await page.getByTestId('import-match-on').selectOption(key);
      await expect(page.getByTestId('import-when-here')).toHaveValue('skip');
      await page.getByTestId('wizard-validate').click();

      // Looked at before anything is written: two new, one already here, and nothing in the table yet.
      const preview = page.getByTestId('import-preview');
      await expect(preview.locator('[data-line]')).toHaveCount(3);
      expect(await preview.locator('[data-line]').evaluateAll((lines) => lines.map((line) => line.getAttribute('data-status')))).toEqual(['new', 'here', 'new']);
      await expect(preview.locator('[data-count="new"]')).toContainText('2');
      await expect(preview.locator('[data-count="here"]')).toContainText('1');
      await expect(page.getByTestId('validation-summary')).toHaveText('2 new lines will be brought in.');
      await expect(page.getByTestId('validation-rest')).toHaveText('1 already here will be left as they are');
      expect((await row('ZZIM1')).status).toBe(404);
      await expect(page.getByTestId('wizard-run')).toHaveText('Bring in 2 new lines');
      await page.getByTestId('wizard-run').click();

      // The job runs and the review says what it did: three lines, two made, one skipped because it was here.
      const review = page.getByTestId('import-review');
      await expect(review).toBeVisible({ timeout: 30_000 });
      expect(await review.locator('.font-mono').allTextContents()).toEqual(['3', '2', '0', '1']);
      await expect(page.getByTestId('import-already-here')).toHaveText('Already here, left as they were: 1');
      // The dashboard's page has no "Close": that is a part's, on a screen that can put the wizard away.
      await expect(page.getByTestId('wizard-close')).toHaveCount(0);

      // In the table: the two new rows as pasted, and the customer who was here exactly as before.
      expect((await row('ZZIM1')).data).toMatchObject({ company_name: 'Import One', city: 'Kiel' });
      expect((await row('ZZIM2')).data).toMatchObject({ company_name: 'Import Two', city: 'Lyon' });
      expect((await row('ALFKI')).data).toEqual(alfki);
      expect(problems).toEqual([]);
    } finally {
      await clear();
    }
  });
});
