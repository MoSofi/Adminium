// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Schema authoring, end to end.
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
      // SQLite collapses rebuild-class changes into ONE rebuild step.
      await expect(page.getByText(/Rebuild e2e_notes/)).toBeVisible();
    } else {
      await expect(page.getByText(/Change body from text to integer/)).toBeVisible();
      await expect(page.getByText('Discards data').first()).toBeVisible();
    }
  });

  /*
   * ─── The three controls phase B added (plan 50, D23) ─────────────────────
   *
   * Each of these was a thing the model, the planner and the compiler could
   * already do and the SCREEN could not ask for. They run here, on all three
   * engines, because each one is a different operation per engine: a CHECK is
   * an ALTER on postgres and MySQL and a rebuild on SQLite, and auto-increment
   * on an existing key is catalog-only, a table copy and a rebuild respectively.
   */
  test('a table with a starting value and a choice column', async ({ page }) => {
    await openDesign(page);
    await page.getByRole('button', { name: 'New table' }).click();
    await page.getByLabel('Table name').fill('e2e_props');

    // The key, with no generator at all — so the next test has something to
    // turn auto-increment ON for.
    await page.getByLabel('Starts as').first().selectOption('none');

    await page.getByRole('button', { name: 'Add column' }).click();
    await page.getByLabel('Name').last().fill('created_at');
    await page.getByLabel('Type').last().selectOption('timestamp');
    await page.getByLabel('Starts as').last().selectOption('now');

    await page.getByRole('button', { name: 'Add column' }).click();
    await page.getByLabel('Name').last().fill('status');
    await page.getByLabel('Type').last().selectOption('enum');

    // A choice column with nothing to choose from cannot be reviewed (B5).
    await expect(page.getByRole('button', { name: 'Review changes' })).toBeDisabled();
    await expect(page.getByText(/Give status at least one allowed value/)).toBeVisible();

    await page.getByRole('button', { name: 'Add value' }).click();
    await page.getByLabel('Value 1').fill('draft');
    await page.getByRole('button', { name: 'Add value' }).click();
    await page.getByLabel('Value 2').fill('sent');

    await page.getByRole('button', { name: 'Review changes' }).click();
    // The statement carries both — the default the database fills in, and the
    // constraint that keeps `status` to its two answers. SQLite's `now` is the
    // server's wall clock, the clock every value Adminium writes there is in.
    // MySQL's column gets no default at all: its `CURRENT_TIMESTAMP` would be
    // UTC's wall clock in a DATETIME read on this server's, so Adminium fills
    // the moment itself on every create instead.
    if (ENGINE === 'mysql') {
      await expect(page.getByText(/`created_at` datetime,/i)).toBeVisible();
      await expect(page.getByText(/current_timestamp/i)).toHaveCount(0);
    } else {
      await expect(page.getByText(/current_timestamp|datetime\('now', 'localtime'\)/i)).toBeVisible();
    }
    await expect(page.getByText(/check.*status.*in.*draft/is)).toBeVisible();

    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(page.getByText(/Applied\./)).toBeVisible();
  });

  test('changing the allowed values on a table that already exists', async ({ page }) => {
    await openDesign(page);
    await page.getByRole('button', { name: 'e2e_props', exact: true }).click();

    // The values came back out of the database (B7) — without that, opening
    // this table at all staged an enum column with no values.
    await expect(page.getByLabel('Value 1')).toHaveValue('draft');
    await expect(page.getByLabel('Value 2')).toHaveValue('sent');

    await page.getByRole('button', { name: 'Remove sent' }).click();
    await page.getByRole('button', { name: 'Add value' }).click();
    await page.getByLabel('Value 2').fill('posted');

    await page.getByRole('button', { name: 'Review changes' }).click();
    if (ENGINE === 'sqlite') {
      await expect(page.getByText(/Rebuild e2e_props/)).toBeVisible();
    } else {
      // B6: the DROP names the constraint the database actually assigned.
      await expect(page.getByText(/Drop check constraint/)).toBeVisible();
      await expect(page.getByText(/Restrict status to its allowed values/)).toBeVisible();
    }
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(page.getByText(/Applied\./)).toBeVisible();
  });

  test('turning auto-increment on for a key that already exists', async ({ page }) => {
    await openDesign(page);
    await page.getByRole('button', { name: 'e2e_props', exact: true }).click();

    /*
     * SQLite has nothing to turn on: `id integer primary key` IS the rowid
     * alias, so a key created WITHOUT a generator still counts up and reads
     * back as one. Asserting a rebuild here would be asserting a change the
     * engine cannot make — the honest assertion is that the control already
     * says so and the plan is empty.
     */
    if (ENGINE === 'sqlite') {
      await expect(page.getByLabel('Starts as').first()).toHaveValue('autoincrement');
      return;
    }

    await page.getByLabel('Starts as').first().selectOption('autoincrement');
    await page.getByRole('button', { name: 'Review changes' }).click();
    {
      // Not `set-default`: auto-increment is not a default on any engine, and
      // the step that pretended it was threw at apply (D23).
      await expect(page.getByText('Generate id automatically')).toBeVisible();
      if (ENGINE === 'postgres') {
        await expect(page.getByText(/ADD GENERATED BY DEFAULT AS IDENTITY/i)).toBeVisible();
        await expect(page.getByText(/setval/i)).toBeVisible();
      } else {
        // The statement, not the rationale — both mention the word, and the
        // one that matters is the SQL D2 promises will run.
        await expect(page.getByText(/MODIFY COLUMN .*AUTO_INCREMENT/i)).toBeVisible();
      }
    }

    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    // MySQL copies the table for this, so it asks for the name first.
    const confirm = page.getByRole('dialog');
    if (await confirm.isVisible().catch(() => false)) {
      await confirm.getByRole('textbox').fill('e2e_props');
      await confirm.getByRole('button', { name: /Apply|Confirm/ }).click();
    }
    await expect(page.getByText(/Applied\./)).toBeVisible();
  });

  test('the props table is cleaned up', async ({ page }) => {
    await openDesign(page);
    await page.getByRole('button', { name: 'e2e_props', exact: true }).click();
    await page.getByRole('button', { name: /Drop this table/i }).click();
    await page.getByRole('button', { name: 'Review changes' }).click();
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    const confirm = page.getByRole('dialog');
    await expect(confirm).toBeVisible();
    await confirm.getByRole('textbox').fill('e2e_props');
    await confirm.getByRole('button', { name: 'Apply changes' }).click();
    await expect(page.getByText(/Applied\./)).toBeVisible();
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
