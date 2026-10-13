// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app's section of the sidebar, as a browser draws it.
 *
 * What only a browser can show: the section's twelve entries in the order the
 * server gives them, with the pages its app keeps off the sidebar drawn
 * nowhere in the rail and still offered by the command palette; an entry that
 * is not a page opening the dashboard's own screen in place, with the line
 * that says the screen is narrowed to one app and the way back to everything;
 * the staff side's entry opening as a document of its own; and a search hit
 * that opens in the record's app.
 *
 * The section is handed to the dashboard by this test, in the reply of the
 * real server's own bootstrap: the words that make one (`nav.offRail`,
 * `navLinks`, `frontends[].records`) are read from the release to come, which
 * the server under test is not yet, so no manifest that says them installs
 * here. What the server answers for such a manifest, and to whom, is proved
 * against the whole server on three engines (`apps/server/test/app-rail.test.ts`,
 * `record-opens-in-app.test.ts`). Every other request of this spec is the
 * real server's.
 */
import { expect, test, type Page } from '@playwright/test';

import { signIn } from './helpers.js';

const KEY = 'e2e-rail';

interface Item {
  pageId: string;
  slug: string;
  labelKey: string;
  fallback: string;
  icon: string;
  order: number;
  [key: string]: unknown;
}

/** The reply of the real bootstrap, with one app's section added; a real page of the seeded workspace stands in for the app's. */
async function withSection(page: Page): Promise<{ real: Item }> {
  let real: Item | undefined;
  await page.route('**/api/v1/bootstrap*', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { data: { nav: { groups: { items: Item[] }[] }; appSections?: unknown[] } };
    const first = body.data.nav.groups.flatMap((group) => group.items).find((item) => typeof item['sourceTable'] === 'string');
    if (first === undefined) throw new Error('the seeded workspace has no table page to stand in');
    real = first;
    const blank = { connectionId: null, connectionName: null, currency: null, sourceTable: null, appKey: KEY, addOnKey: null };
    const pageItem = (slug: string, fallback: string, order: number, more: Record<string, unknown> = {}): Item => ({ ...blank, pageId: `page_${slug}`, slug, labelKey: `nav.${slug}`, fallback, icon: 'list', order, ...more });
    const link = (ref: string, fallback: string, order: number, href: string, document = false): Item => ({ ...blank, pageId: `link:${ref}`, slug: '', labelKey: `nav.link.${KEY}.${ref}`, fallback, icon: 'workflow', order, link: { href, document } });
    body.data.appSections = [
      ...(body.data.appSections ?? []),
      {
        appKey: KEY,
        label: 'E2E Rail',
        version: '1.0.0',
        staff: null,
        groups: [
          {
            key: '',
            label: null,
            items: [
              pageItem('e2e-rail-overview', 'Rail overview', 1),
              pageItem('e2e-rail-pipeline', 'Rail pipeline', 2),
              // The one real page: it opens.
              { ...first, appKey: KEY, fallback: 'Rail deals', labelKey: 'nav.e2e-rail-deals', order: 3 },
              pageItem('e2e-rail-companies', 'Rail companies', 4),
              pageItem('e2e-rail-contacts', 'Rail contacts', 5),
              pageItem('e2e-rail-quotes', 'Rail quotes', 6),
              link('approvals', 'Rail approvals', 7, `/apps/${KEY}/staff/approvals`, true),
              pageItem('e2e-rail-enquiries', 'Rail enquiries', 8),
              pageItem('e2e-rail-jobs', 'Rail jobs', 9),
              pageItem('e2e-rail-stages', 'Rail stages', 10, { offRail: true }),
            ],
          },
          { key: 'setup', label: 'Set up', items: [link('rules', 'Rail rules', 1, `/automations?app=${KEY}`), link('emails', 'Rail emails', 2, `/email-templates?app=${KEY}`), link('sample-data', 'Rail sample data', 3, `/studio/apps/${KEY}`)] },
          { key: 'supply', label: 'Rail supply', items: [pageItem('e2e-rail-suppliers', 'Rail suppliers', 1, { offRail: true })] },
        ],
      },
    ];
    await route.fulfill({ response, json: body });
  });
  await signIn(page);
  await expect(page.locator('[data-part="nav-app-section"]').filter({ hasText: 'E2E Rail' })).toBeVisible();
  return { real: real as Item };
}

const section = (page: Page) => page.locator('[data-part="nav-app-section"]').filter({ hasText: 'E2E Rail' });

test.describe('an app\'s section of the sidebar', () => {
  test('draws the twelve entries in order, and none of the pages kept off the sidebar', async ({ page }) => {
    await withSection(page);
    await expect(section(page).getByRole('link')).toHaveText([
      'Rail overview',
      'Rail pipeline',
      'Rail deals',
      'Rail companies',
      'Rail contacts',
      'Rail quotes',
      'Rail approvals',
      'Rail enquiries',
      'Rail jobs',
      'Rail rules',
      'Rail emails',
      'Rail sample data',
    ]);
    await expect(section(page).getByText('Set up')).toBeVisible();
    // Kept off the sidebar: no entry, and no heading for a group left empty.
    await expect(page.getByRole('navigation', { name: 'Primary' }).getByText('Rail stages')).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Primary' }).getByText('Rail supply')).toHaveCount(0);
    // The staff side opens as a document of its own, never inside this bundle.
    const approvals = section(page).getByRole('link', { name: 'Rail approvals' });
    await expect(approvals).toHaveAttribute('href', `/apps/${KEY}/staff/approvals`);
    await expect(approvals).toHaveAttribute('target', '_blank');
  });

  test('a page of the section opens; the palette still offers a page kept off the sidebar, and the entries that are not pages', async ({ page }) => {
    const { real } = await withSection(page);
    await section(page).getByRole('link', { name: 'Rail deals' }).click();
    await expect(page).toHaveURL(new RegExp(`/p/${real.slug}$`));

    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    await palette.getByRole('combobox').fill('Rail stages');
    await expect(palette.getByRole('option', { name: /Rail stages/ })).toBeVisible();

    await palette.getByRole('combobox').fill('Rail sample');
    await palette.getByRole('option', { name: /Rail sample data/ }).click();
    await expect(page).toHaveURL(new RegExp(`/studio/apps/${KEY}$`));
  });

  test('Rules opens Automations narrowed to the app, says so, and leads back to every rule', async ({ page }) => {
    await withSection(page);
    const rules = section(page).getByRole('link', { name: 'Rail rules' });
    await rules.click();
    await expect(page).toHaveURL(new RegExp(`/automations\\?app=${KEY}$`));
    await expect(rules).toHaveAttribute('aria-current', 'page');
    const note = page.getByTestId('app-filter-note');
    await expect(note).toContainText('Only the rules of E2E Rail are shown.');
    await page.getByTestId('app-filter-clear').click();
    await expect(page).toHaveURL(/\/automations$/);
    await expect(note).toHaveCount(0);
    await expect(rules).not.toHaveAttribute('aria-current', 'page');
  });

  test('Emails opens the emails narrowed to the app: the server is asked for that app\'s alone', async ({ page }) => {
    await withSection(page);
    const asked = page.waitForRequest((request) => request.url().includes('/api/v1/email-templates?') && new URL(request.url()).searchParams.get('app') === KEY);
    await section(page).getByRole('link', { name: 'Rail emails' }).click();
    await expect(page).toHaveURL(new RegExp(`/email-templates\\?app=${KEY}$`));
    const response = await (await asked).response();
    expect(response?.status()).toBe(200);
    // No app of that key brought an email here: the narrowed list is empty, never everybody's.
    expect(((await response!.json()) as { items: unknown[] }).items).toEqual([]);
    await expect(page.getByTestId('app-filter-note')).toContainText('Only the emails of E2E Rail are shown.');
    await page.getByTestId('app-filter-clear').click();
    await expect(page).toHaveURL(/\/email-templates$/);
    await expect(page.getByTestId('app-filter-note')).toHaveCount(0);
  });

  test('a search hit that opens in its app is followed to the app\'s address', async ({ page, context }) => {
    await withSection(page);
    await page.route('**/api/v1/search?**', async (route) => {
      await route.fulfill({
        json: { data: { groups: [{ type: 'record', connectionId: 'c', table: 'e2e_rail_deals', pageSlug: '', count: 1, hits: [{ connectionId: 'c', table: 'e2e_rail_deals', recordId: '12', label: 'Atrium refit', pageSlug: '', opens: { appKey: KEY, path: '/deals/12', url: `/apps/${KEY}/staff/deals/12` } }] }] } },
      });
    });
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await palette.getByRole('combobox').fill('atrium');
    const opened = context.waitForEvent('page');
    await palette.getByRole('option', { name: /Atrium refit/ }).click();
    const tab = await opened;
    expect(new URL(tab.url()).pathname).toBe(`/apps/${KEY}/staff/deals/12`);
    await tab.close();
  });
});
