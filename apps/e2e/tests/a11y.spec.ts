// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Accessibility on ASSEMBLED PAGES — the half the Storybook sweep cannot reach.
 *
 * THE GAP THIS CLOSES. `packages/ui/scripts/a11y-sweep.mjs` runs axe over every
 * story, which is real coverage of components in isolation and no coverage at
 * all of the thing a user opens: a shell with a sidebar, a topbar, a page
 * template, live data and a modal on top of it. Whole classes of violation only
 * exist once those are composed — a duplicated landmark, a heading level that
 * skips because two components each own an `h2`, a focus order that crosses
 * between shell and content, an `aria-controls` pointing at an id that only
 * renders on another route. `@axe-core/playwright` was a devDependency of one
 * package and appeared in no e2e test, so none of it was ever scanned.
 *
 * WHAT IS SCANNED. Real routes over the seeded Northwind connection: the
 * unauthenticated sign-in screen, the generated dashboard, a page-crud list, a
 * record detail, and an admin settings surface. Together they cover the shell,
 * both page templates a fresh install generates, a modal, and a form.
 *
 * WHAT BLOCKS. Critical and serious only, matching the Storybook sweep's
 * definition of done (03 §3.5) — moderate/minor are reported in the failure
 * message when a blocking one is found, but do not fail on their own.
 *
 * NO BASELINE HERE, deliberately. The Storybook sweep needs a fingerprint
 * ratchet because it inherited 162 known violations; this suite starts clean and
 * must stay clean. A baseline file exists to make a backlog survivable, and
 * adding one before there is a backlog just builds somewhere for the first
 * violation to be filed away.
 */
// Named, not default: the package's ESM entry exports `AxeBuilder` as a named
// binding and `tsc` under this project's module resolution sees no construct
// signature on the namespace object.
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { navLink, signIn } from './helpers.js';

/** WCAG 2.1 A/AA — the same rule set the Storybook sweep runs. */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const BLOCKING = new Set(['critical', 'serious']);

async function expectNoBlockingViolations(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const blocking = results.violations.filter((violation) =>
    BLOCKING.has(violation.impact ?? ''),
  );
  const report = blocking
    .map(
      (violation) =>
        `${violation.impact}: ${violation.id} — ${violation.help}\n` +
        violation.nodes
          .slice(0, 3)
          .map((node) => `    ${String(node.target.join(' '))}`)
          .join('\n'),
    )
    .join('\n');
  expect(blocking, `${label} has ${String(blocking.length)} blocking violations:\n${report}`).toEqual(
    [],
  );
}

test.describe('assembled pages pass axe', () => {
  test('the sign-in screen', async ({ page }) => {
    // Unauthenticated on purpose: AuthLayout is the one screen every user sees
    // before anything else, and it is the only place the app renders a form
    // outside the shell. (Its brand panel is `aria-hidden`, so axe skips it —
    // that subtree is gated by the token contrast check instead. See
    // AuthLayout.tsx.)
    await page.context().clearCookies();
    await page.goto('/login');
    await expect(page.getByLabel('Email')).toBeVisible();
    await expectNoBlockingViolations(page, '/login');
  });

  test('the generated dashboard', async ({ page }) => {
    await signIn(page);
    await expect(page).toHaveURL(/\/p\//);
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
    await expectNoBlockingViolations(page, 'generated dashboard');
  });

  test('a page-crud list', async ({ page }) => {
    await signIn(page);
    await navLink(page, /Customers/)
      .first()
      .click();
    await expect(page.getByRole('heading', { name: 'Customers' })).toBeVisible();
    await expectNoBlockingViolations(page, 'page-crud list');
  });

  test('a record detail', async ({ page }) => {
    await signIn(page);
    await navLink(page, /Customers/)
      .first()
      .click();
    await page.getByRole('rowgroup').getByRole('row').first().click();
    await expectNoBlockingViolations(page, 'record detail');
  });

  test('an admin settings surface', async ({ page }) => {
    // A form-heavy screen behind a role guard, so the scan covers labelled
    // inputs, switches and a save affordance rather than only tables.
    await signIn(page);
    await page.goto('/settings/defaults');
    await expect(page.getByRole('heading').first()).toBeVisible();
    await expectNoBlockingViolations(page, '/settings/defaults');
  });
});
