// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A RULE AN INSTALL CANNOT KEEP IS NOT LEFT OUT QUIETLY.
 *
 * Two faults met by one app. A stamp that copies a column of the row when
 * something happens (how far under list a quote was when it was approved)
 * was judged as a stamp of a person's name, which needs a text column — so a
 * copy of a number was refused. And the install then went through without
 * the rule, saying so only in its reply: the app ran, and remembered nothing.
 *
 * Here: a copy lands in a column of its source's kind, on every engine, and
 * is written when its moment comes; a copy across kinds is refused; and a
 * rule this server judges wrong for a table the install itself made stops
 * the install by name, while one left out for the operator's sake is still
 * only skipped.
 */
import { parseDatabaseModel } from '@adminium/engine';
import type { Manifest } from '@adminium/manifest';
import { overridesRepo, snapshotsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { RuleRefusedError, writeManifestRules } from '../src/apps/manifest-rules.js';
import { columnRuleIssue } from '../src/connections/column-rules-validation.js';
import { applyOverrides } from '../src/connections/effective-schema.js';
import { LEGS, installInvoicing, invoicingManifest, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };
const approved = { column: 'approval', values: ['approved'] };

/** A quote that remembers, when it is approved, how far under list it stood and how many of its lines had no list price. */
const tables = (): Record<string, unknown>[] => [
  {
    ref: 'quotes',
    columns: [
      id,
      { ref: 'title', type: 'text', maxLength: 80 },
      { ref: 'under_list_pct', type: 'decimal', scale: 2, default: 0 },
      { ref: 'unlisted_lines', type: 'int', default: 0 },
      { ref: 'valid_until', type: 'date', nullable: true },
      { ref: 'approval', type: 'enum', enum: ['none', 'asked', 'approved'], default: 'none' },
      { ref: 'approved_pct', type: 'decimal', scale: 2, nullable: true, rules: { stamp: { set: { copy: 'under_list_pct' }, on: approved } } },
      { ref: 'approved_unlisted_lines', type: 'int', nullable: true, rules: { stamp: { set: { copy: 'unlisted_lines' }, on: approved } } },
      { ref: 'approved_valid_until', type: 'date', nullable: true, rules: { stamp: { set: { copy: 'valid_until' }, on: approved } } },
      { ref: 'approved_title', type: 'text', maxLength: 80, nullable: true, rules: { stamp: { set: { copy: 'title' }, on: approved } } },
      // Whether it may go: only while it is no further under list than was approved.
      { ref: 'may_send', type: 'int', rules: { formula: { if: [{ and: [{ eq: ['approval', 'approved'] }, { lte: ['under_list_pct', { coalesce: ['approved_pct', -1] }] }] }, 1, 0] } } },
    ],
  },
];
const manifest = (): Record<string, unknown> => ({ ...invoicingManifest(tables()), pages: [{ ref: 'studio-quotes', template: 'page-crud', title: { key: 't', fallback: 'Quotes' }, nav: { group: 'library', icon: 'list', order: 1 }, bindings: { rows: 'quotes' } }] });

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`a stamp that copies a column, and a rule an install cannot keep [${dialect}]`, () => {
    let h: InvoicingHarness & { reply: Record<string, unknown> };
    const model = async () => applyOverrides(parseDatabaseModel((await snapshotsRepo(h.meta).latest(h.connectionId))!.schema), await overridesRepo(h.meta).listForConnection(h.connectionId, { status: 'active' }));
    const quotes = async () => (await model()).tables.find((table) => table.name === 'studio_quotes')!;
    beforeAll(async () => {
      h = await installInvoicing(dialect, manifest());
    }, 240_000);
    afterAll(async () => {
      await h?.close();
    });

    it('installs every stamp, whatever kind of column it copies: none is skipped', async () => {
      expect((h.reply as { rules?: { skipped: unknown[] } }).rules?.skipped ?? []).toEqual([]);
      const columns = (await quotes()).columns;
      for (const name of ['approved_pct', 'approved_unlisted_lines', 'approved_valid_until', 'approved_title']) expect(columns.find((column) => column.name === name)!.stamp, name).toBeDefined();
    });

    it('writes the copy when its moment comes, and a formula of the same write reads it', async () => {
      const w = await writerFor(h);
      const quote = await w.create('quotes', { title: 'Desk rows', under_list_pct: 9.09, unlisted_lines: 2, valid_until: '2026-11-30' });
      const read = async () => (await h.rows(`SELECT approved_pct, approved_unlisted_lines, approved_valid_until, approved_title, may_send FROM studio_quotes WHERE id = ${String(quote['id'])}`))[0]!;
      expect(await read()).toMatchObject({ approved_pct: null, approved_unlisted_lines: null, approved_title: null });
      await w.update('quotes', quote['id'], { approval: 'approved' });
      let row = await read();
      expect([Number(row['approved_pct']), Number(row['approved_unlisted_lines']), String(row['approved_valid_until']).length > 0 && row['approved_valid_until'] !== null, row['approved_title'], Number(row['may_send'])]).toEqual([9.09, 2, true, 'Desk rows', 1]);
      // Cut further after the approval: what was approved stays as it was, and no longer covers the quote.
      await w.update('quotes', quote['id'], { under_list_pct: 50 });
      row = await read();
      expect([Number(row['approved_pct']), Number(row['may_send'])]).toEqual([9.09, 0]);
      // Asked and approved again: the new figure is remembered.
      await w.update('quotes', quote['id'], { approval: 'asked' });
      await w.update('quotes', quote['id'], { approval: 'approved' });
      row = await read();
      expect([Number(row['approved_pct']), Number(row['may_send'])]).toEqual([50, 1]);
    });

    it('refuses a copy into a column of another kind, and one of a column the table lacks', async () => {
      const whole = await model();
      const table = whole.tables.find((one) => one.name === 'studio_quotes')!;
      const column = (name: string) => table.columns.find((one) => one.name === name)!;
      const judge = (into: string, from: string) => columnRuleIssue('column.stamp', { set: { copy: from }, on: approved }, column(into), whole, new Set());
      expect(judge('approved_pct', 'under_list_pct')).toBeNull();
      expect(judge('approved_unlisted_lines', 'under_list_pct')).toBeNull();
      expect(judge('approved_pct', 'title')).toMatch(/of its own kind/);
      expect(judge('approved_title', 'under_list_pct')).toMatch(/of its own kind/);
      expect(judge('approved_title', 'nowhere')).toMatch(/has no column "nowhere"/);
      expect(judge('approved_pct', 'approved_pct')).toMatch(/not .* itself/);
      // A stamp of a person's name still needs a text column.
      expect(columnRuleIssue('column.stamp', { set: 'user-name', on: 'create' }, column('approved_pct'), whole, new Set())).toMatch(/names someone needs a text column/);
    });

    it('stops on a rule it judges wrong for a table the install made, by name; without the word it is only skipped', async () => {
      // The same app with one rule no manifest check would let through, handed straight to the writer: a person's name stamped into a number.
      const wrong = structuredClone(manifest()) as { version: string; requiredSchema: { tables: { columns: { ref: string; rules?: Record<string, unknown> }[] }[] } };
      wrong.requiredSchema.tables[0]!.columns.find((column) => column.ref === 'approved_unlisted_lines')!.rules = { stamp: { set: 'user-name', on: approved } };
      const input = { meta: h.meta, manifest: wrong as unknown as Manifest, connectionId: h.connectionId, createdBy: null };
      const quiet = await writeManifestRules(input);
      expect(quiet.skipped.filter((skip) => skip.column === 'approved_unlisted_lines').map((skip) => skip.reason)).toEqual([expect.stringMatching(/names someone needs a text column/)]);
      const stopped = await writeManifestRules({ ...input, refuse: true }).then(
        () => null,
        (error: unknown) => error,
      );
      expect(stopped).toBeInstanceOf(RuleRefusedError);
      expect(stopped).toMatchObject({ statusCode: 422, details: { reason: 'RULE_REFUSED', rules: [{ column: 'approved_unlisted_lines', op: 'column.stamp' }] } });
      expect((stopped as Error).message).toMatch(/approved_unlisted_lines \(column\.stamp\)/);
      // The app as it is really written goes through with the word: nothing of it is refused.
      await expect(writeManifestRules({ ...input, manifest: manifest() as unknown as Manifest, refuse: true })).resolves.toMatchObject({ skipped: [] });
    });
  });
}
