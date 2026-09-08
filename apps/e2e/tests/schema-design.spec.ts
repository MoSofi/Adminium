// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Schema authoring, end to end — 35-schema-authoring.md 35-T30.
 *
 * ─── Why this runs on all three engines ────────────────────────────────────
 *
 * The three dialects do not merely differ in syntax; they differ in what a
 * change IS. `add-column` is metadata on Postgres 11+, an instant operation on
 * MySQL 8.0.29+ and a rewrite before it, and on SQLite nearly everything that
 * is not "add a column" needs the twelve-step rebuild. A suite that runs on one
 * engine proves the least interesting third of that.
 *
 * The e2e workflow already runs three explicit jobs (sqlite, postgres, mysql)
 * over the same Northwind fixture, so this file rides them and asserts the
 * behaviour each engine actually has.
 *
 * ─── What it asserts, and why it is shallow on purpose ─────────────────────
 *
 * The unit suites cover the vocabulary, the planner, the hazard matrix and the
 * compiler; the integration suites execute real SQL. What none of them could
 * see is the sentence a person acts on: "I clicked this table to edit it."
 * Three browser passes found three bugs in exactly that gap — a designer that
 * proposed dropping every column, a name field that staged a table per
 * keystroke, a link that was accepted and silently discarded. So this file
 * drives the SCREEN and checks the plan it produces is the one the click meant.
 */
import { expect, test } from '@playwright/test';

import { ENGINE } from './constants.js';
import { seededConnectionId, signIn } from './helpers.js';

/** Open Design mode on the seeded connection. */
async function openDesign(page: import('@playwright/test').Page): Promise<void> {
  await signIn(page);
  await page.goto(`/studio/remap/${await seededConnectionId(page)}`);
  await page.getByRole('tab', { name: 'Design' }).click();
  await expect(page.getByRole('button', { name: 'New table' })).toBeVisible();
}

test.describe(`schema design [${ENGINE}]`, () => {
  test('loading an existing table proposes NOTHING until something is edited', async ({ page }) => {
    await openDesign(page);
    // The bug this guards: the designer used to stage a BLANK table with the
    // real table's id, so opening `customers` proposed dropping every column.
    await page.getByRole('button', { name: 'customers', exact: true }).click();
    await page.getByRole('button', { name: 'Review changes' }).click();
    await expect(page.getByText('No schema changes yet.')).toBeVisible();
  });

  test('an invalid table name is refused in the field, before any round trip', async ({ page }) => {
    await openDesign(page);
    await page.getByRole('button', { name: 'New table' }).click();
    await page.getByLabel('Table name').fill('not a name');
    await expect(
      page.getByText('Use lowercase letters, numbers and underscores, starting with a letter.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Review changes' })).toBeDisabled();
  });

  test('creating a table previews the exact statement and applies it', async ({ page }) => {
    await openDesign(page);
    await page.getByRole('button', { name: 'New table' }).click();
    await page.getByLabel('Table name').fill('e2e_notes');
    await page.getByRole('button', { name: 'Review changes' }).click();

    // D2: the preview IS the statement. Asserting the SQL text is what makes
    // that a contract rather than a claim.
    await expect(page.getByText(/create table if not exists/i)).toBeVisible();
    await expect(page.getByText('Safe').first()).toBeVisible();

    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(page.getByText(/Applied\./)).toBeVisible();
  });

  test('adding a column to that table plans exactly one step', async ({ page }) => {
    await openDesign(page);
    await page.getByRole('button', { name: 'e2e_notes', exact: true }).click();
    await page.getByRole('button', { name: 'Add column' }).click();
    const names = page.getByLabel('Name');
    await names.last().fill('body');
    await page.getByRole('button', { name: 'Review changes' }).click();

    await expect(page.getByText('Add column body (text)')).toBeVisible();
    // One step, not one per keystroke and not a drop of everything else.
    await expect(page.getByText(/^Drop column/)).toHaveCount(0);
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(page.getByText(/Applied\./)).toBeVisible();
  });

  test('a type change is classified honestly for THIS engine', async ({ page }) => {
    await openDesign(page);
    await page.getByRole('button', { name: 'e2e_notes', exact: true }).click();
    // `body` text → integer: lossy everywhere, and on SQLite it is the
    // twelve-step rebuild rather than an ALTER.
    const types = page.getByLabel('Type');
    await types.last().selectOption('integer');
    await page.getByRole('button', { name: 'Review changes' }).click();

    if (ENGINE === 'sqlite') {
      // §7: SQLite collapses rebuild-class changes into ONE rebuild step.
      await expect(page.getByText(/Rebuild e2e_notes/)).toBeVisible();
    } else {
      await expect(page.getByText(/Change body from text to integer/)).toBeVisible();
      await expect(page.getByText('Discards data').first()).toBeVisible();
    }
  });

  test('dropping the table names its consequences and requires confirmation', async ({ page }) => {
    await openDesign(page);
    await page.getByRole('button', { name: 'e2e_notes', exact: true }).click();
    await page.getByRole('button', { name: /Drop this table/i }).click();
    await page.getByRole('button', { name: 'Review changes' }).click();

    await expect(page.getByText(/Drop table e2e_notes/)).toBeVisible();
    await expect(page.getByText('Cannot be undone').or(page.getByText('Discards data')).first()).toBeVisible();

    // D8: a destructive apply is gated on typing the name.
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    const confirm = page.getByRole('dialog');
    await expect(confirm).toBeVisible();
    await confirm.getByRole('textbox').fill('e2e_notes');
    await confirm.getByRole('button', { name: /Drop|Apply|Confirm/ }).click();
    await expect(page.getByText(/Applied\./)).toBeVisible();
  });
});
