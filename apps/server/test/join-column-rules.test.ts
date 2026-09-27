// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A joined text (a stay's guest name) as an operator's rule, on every
 * engine: it reads text and whole-number columns only — a decimal is
 * `8.250` on one database and `8.25` on another, a yes or no `true` or `1`,
 * a day or a moment is read on the server's clock — and never a column kept
 * from readers into one that is not.
 */
import { parseDatabaseModel } from '@adminium/engine';
import { overridesRepo, snapshotsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { columnRuleIssue, keptColumnIssue } from '../src/connections/column-rules-validation.js';
import { applyOverrides } from '../src/connections/effective-schema.js';
import { installInvoicing, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { wrenManifest } from './wren-house-fixture.js';

describe.each(LEGS)('a joined text as an operator writes it — %s', (dialect, available) => {
  let h: InvoicingHarness | undefined;
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, wrenManifest());
  }, 180_000);
  afterAll(async () => h?.close());

  const model = async () => {
    const snapshot = (await snapshotsRepo(h!.meta).latest(h!.connectionId))!;
    return applyOverrides(parseDatabaseModel(snapshot.schema), await overridesRepo(h!.meta).listForConnection(h!.connectionId, { status: 'active' }));
  };
  const stays = async () => {
    const m = await model();
    return { m, table: m.tables.find((t) => t.name === h!.real('stays'))! };
  };

  it.runIf(available)('reads text and whole-number columns, and nothing else', async () => {
    const { m, table } = await stays();
    const guestName = table.columns.find((c) => c.name === 'guest_name')!;
    const join = (parts: string[]) => columnRuleIssue('column.formula', { formula: { join: parts } }, guestName, m);
    expect(join(['first_name', ' ', 'last_name'])).toBeNull();
    expect(join(['first_name', ' × ', 'guests'])).toBeNull();
    expect(join(['first_name', ' ', 'room_total'])).toMatch(/^A joined text reads text and whole-number columns; "room_total" is (decimal|float)\.$/);
    expect(join(['first_name', ' ', 'arrive'])).toMatch(/^A joined text reads text and whole-number columns; "arrive" is /);
  });

  it.runIf(available)('never reads a column kept from readers into one that is not', async () => {
    const table = (await stays()).table;
    await overridesRepo(h!.meta).create({ connectionId: h!.connectionId, op: 'column.pii', tableName: table.id, columnName: 'last_name', value: { masked: true, kind: 'name' } as never, origin: 'user' });
    const m = await model();
    const issue = keptColumnIssue('column.formula', { formula: { join: ['first_name', ' ', 'last_name'] } }, { table: table.id, column: 'guest_name' }, m, new Map());
    expect(issue).toContain('is personal data, so no formula reads it unless it is marked personal too.');
  });
});
