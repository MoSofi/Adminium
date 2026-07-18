/**
 * M7 wave-2 e2e — the archetype TEMPLATE PAGES on the seeded Northwind app.
 *
 * The generator emits §14 archetype pages next to each table's page-crud
 * (packages/engine/src/generate/archetype.ts); Northwind's own triggers are
 * `employees.reports_to` → `page-directory` and `orders.order_date` + a title
 * column → `page-calendar` (pinned by generate-baseline.test.ts). Until this
 * wave those envelopes resolved to NO renderer and PageRenderer showed the
 * "Unknown page template" card — this spec pins the wiring end to end:
 * bootstrap nav exposes the pages, each mounts its REAL renderer, and one
 * template-level interaction works per page (no data writes — the suite runs
 * serially with the CRUD legs and must not mutate the seeded rows).
 *
 * Role/label selectors + Playwright auto-waiting only — no arbitrary sleeps.
 */
import { expect, test } from '@playwright/test';

import { navLink, signIn } from './helpers.js';

test.describe('archetype template pages on the seeded Northwind connection', () => {
  test('nav exposes the generated archetype pages beside their crud siblings', async ({
    page,
  }) => {
    await signIn(page);
    await expect(navLink(page, /Employees Directory/).first()).toBeVisible();
    await expect(navLink(page, /Orders Calendar/).first()).toBeVisible();
  });

  test('employees-directory mounts the page-directory renderer (org-chart variant)', async ({
    page,
  }) => {
    await signIn(page);
    await navLink(page, /Employees Directory/).first().click();
    await expect(page).toHaveURL(/\/p\/employees-directory/);

    // The real renderer, not the unknown-template card (09 §3.1).
    await expect(page.getByText('Unknown page template')).toHaveCount(0);
    const directory = page.locator('[data-part="page-directory"]');
    await expect(directory).toBeVisible();

    // Northwind employees carries the `reports_to` self-FK, so the hero slot
    // composes `org-chart` (annex §13 domain.people-self-fk) — a real tree
    // with the seeded people in it, not a fallback silhouette.
    const tree = page.getByRole('tree');
    await expect(tree).toBeVisible();
    await expect(page.getByRole('treeitem').first()).toBeVisible();

    // Interaction: collapse/expand a manager node — template-local state,
    // no writes. `aria-expanded` is only stamped on genuinely expandable
    // nodes (OrgChart.tsx), so the toggle must flip it.
    const toggle = page.locator('[data-testid^="org-toggle-"]').first();
    await expect(toggle).toBeVisible();
    const item = page.getByRole('treeitem').filter({ has: toggle }).first();
    const before = await item.getAttribute('aria-expanded');
    await toggle.click();
    await expect(item).toHaveAttribute(
      'aria-expanded',
      before === 'true' ? 'false' : 'true',
    );
  });

  test('orders-calendar mounts the page-calendar renderer', async ({ page }) => {
    await signIn(page);
    await navLink(page, /Orders Calendar/).first().click();
    await expect(page).toHaveURL(/\/p\/orders-calendar/);

    // The real renderer, not the unknown-template card.
    await expect(page.getByText('Unknown page template')).toHaveCount(0);
    await expect(page.getByTestId('page-calendar')).toBeVisible();

    // The month grid mounts (CalendarMonth renders a role=grid of day cells).
    await expect(page.getByRole('grid').first()).toBeVisible();
    await expect(page.locator('[data-part="calendar-day"]').first()).toBeVisible();

    // Interaction: open the agenda's inline composer and cancel it — the
    // compose affordance exists because the page has a bound source, and
    // cancelling proves the template interaction loop without inserting an
    // order into the seeded data.
    await page.getByRole('button', { name: 'Add event' }).click();
    const composer = page.getByTestId('agenda-compose');
    await expect(composer.getByPlaceholder('Event title…')).toBeVisible();
    await composer.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByPlaceholder('Event title…')).toHaveCount(0);
  });
});
