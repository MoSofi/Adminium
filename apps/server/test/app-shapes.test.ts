// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tables built on an add-on's shape, on SQLite, Postgres and MySQL, with a copy
 * of the real Invoices & Receipts manifest (`fixtures/invoices-add-on.json`):
 *
 *  - an app built on `invoices/quote@1` installs with the add-on it needs
 *    (not installed before: the plan's add-on rows resolve it), its tables
 *    are its own (prefixed), its record says which part each is and which
 *    columns the shape owns, and the shape's rules are written with every
 *    nested table by its real id and recorded as the shape's;
 *  - a table that drops or retypes a shape column is refused
 *    `SHAPE_MISMATCH`, naming the column, before anything is written;
 *  - two apps built on one shape get two tables;
 *  - an add-on upgrade that drops a shape version an app is built on is
 *    refused; one that keeps it goes ahead and alters no app table;
 *  - a shape's rule the operator switches off or deletes stays so through
 *    the app's next update, and leaves the list the inspector reads.
 */
import { readFileSync } from 'node:fs';

import { validateManifest, type Manifest } from '@adminium/manifest';
import { appTablesRepo, manifestsRepo, overridesRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { writeManifestRules } from '../src/apps/manifest-rules.js';
import { mapTableRefs } from '../src/apps/real-refs.js';
import { addOnHarness, appManifest, CRYPTO, ENGINES, type Harness } from './app-add-ons.helpers.js';

type Doc = Record<string, unknown>;

/**
 * A copy of the real add-on's manifest, at the version a test needs;
 * `quoteVersion` moves its `quote` shape to another version (and the invoice's
 * lines, which name it, with it).
 */
function invoicesAddOn(version = '1.1.0', quoteVersion = 1): Doc {
  const text = readFileSync(new URL('./fixtures/invoices-add-on.json', import.meta.url), 'utf8').replaceAll('quote@1/', `quote@${String(quoteVersion)}/`);
  const doc = JSON.parse(text) as Doc;
  const block = doc['addOn'] as { shapes: { name: string; version: number }[] };
  return {
    ...doc,
    version,
    addOn: { ...block, shapes: block.shapes.map((shape) => (shape.name === 'quote' ? { ...shape, version: quoteVersion } : shape)) },
  };
}

/** A part of a shape, spelled out as an app's table: every column and rule, the part names as the app's tables. */
function tableOnPart(shape: string, part: string, ref: string, names: Record<string, string>, extra: Doc[] = []): Doc {
  const quote = ((invoicesAddOn()['addOn'] as { shapes: Doc[] }).shapes.find((s) => s['name'] === shape.split('@')[0]))!;
  const def = (quote['parts'] as Record<string, { columns: Doc[]; states?: Doc }>)[part]!;
  const map = (short: string) => names[short] ?? short;
  const columns = def.columns.map((column) => {
    const rules = column['rules'] as Doc | undefined;
    return {
      ...column,
      ...(typeof column['references'] === 'string' ? { references: map(column['references']) } : {}),
      ...(rules === undefined
        ? {}
        : {
            rules: Object.fromEntries(
              Object.entries(rules).map(([name, rule]) => [name, name === 'rollup' ? mapTableRefs(rule, map, { refKeys: ['from'] }).value : mapTableRefs(rule, map).value]),
            ),
          }),
    };
  });
  return {
    ref,
    builtOn: `invoices/${shape}`,
    part,
    columns: [...columns, ...extra],
    ...(def.states === undefined ? {} : { states: mapTableRefs(def.states, map).value }),
  };
}

const NAMES = { document: 'quotes', lines: 'quote_lines' };

function studio(key = 'studio', over: { version?: string; quotes?: (table: Doc) => Doc } = {}): Doc {
  const quotes = tableOnPart('quote@1', 'document', 'quotes', NAMES, [{ ref: 'client_note', type: 'text', nullable: true }]);
  return appManifest(key, {
    version: over.version ?? '0.2.0',
    compatibility: { minAdminiumVersion: '0.3.1', engines: ['postgres', 'mysql', 'sqlite'] },
    addOns: { requires: [{ key: 'invoices', range: '>=1.1.0', reason: { 'en-US': 'Quotes are made by this add-on.' } }] },
    requiredSchema: {
      prefixed: true,
      tables: [(over.quotes ?? ((t) => t))(quotes), tableOnPart('quote@1', 'lines', 'quote_lines', NAMES)],
    },
  });
}

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

const m = (harness: Harness) => manifestsRepo(harness.meta, CRYPTO);

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`tables built on an add-on's shape, on ${dialect}`, () => {
    it('installs with the add-on it needs, as its own tables, with the shape’s rules by their real tables', async () => {
      h = await addOnHarness(dialect);
      await h.stageAddOn(invoicesAddOn(), { bundled: true });
      const planned = await h.plan(studio());
      expect(planned.statusCode, planned.body).toBe(200);
      expect(planned.json().plan.problems).toEqual([]);
      expect(planned.json().plan.addOns[0]).toMatchObject({ key: 'invoices', action: 'install' });

      const installed = await h.install('studio', '0.2.0', { planChecksum: planned.json().plan.checksum });
      expect(installed.statusCode, installed.body).toBe(200);
      expect(await h.tableNames()).toEqual(expect.arrayContaining(['studio_quotes', 'studio_quote_lines']));
      expect(installed.json().rules.skipped).toEqual([]);

      const records = await appTablesRepo(h.meta).forInstall(h.connectionId, 'studio');
      const quotes = records.find((r) => r.ref === 'quotes')!;
      expect(quotes.builtOn).toBe('invoices/quote@1#document');
      expect(quotes.shapeColumns).toContain('number_seq');
      expect(quotes.shapeColumns).not.toContain('client_note');
      expect(records.find((r) => r.ref === 'quote_lines')!.builtOn).toBe('invoices/quote@1#lines');

      // Every nested table by its real id: the rollup's child, the state's children.
      const overrides = (await overridesRepo(h.meta).listForConnection(h.connectionId)).filter((o) => o.status === 'active');
      const linesId = overrides.find((o) => o.op === 'column.formula' && o.columnName === 'amount')!.tableName;
      expect(linesId).toMatch(/studio_quote_lines$/);
      expect(overrides.find((o) => o.op === 'column.rollup')!.value['from']).toBe(linesId);
      const states = overrides.find((o) => o.op === 'table.states')!.value as { children: Record<string, unknown>; moves: { draft: { requires: { children: Record<string, number> } }[] } };
      expect(Object.keys(states.children)).toEqual([linesId]);
      expect(Object.keys(states.moves.draft[0]!.requires.children)).toEqual([linesId]);

      // The inspector's list: the shape's rules, labelled with the add-on.
      const rules = await h.inject({ method: 'GET', url: `/connections/${h.connectionId}/shape-rules` });
      expect(rules.statusCode, rules.body).toBe(200);
      const list = rules.json().rules as { op: string; columnName: string | null; addOnName: string; guarantee: string }[];
      expect(list).toContainEqual(expect.objectContaining({ op: 'column.sequence', columnName: 'number_seq', addOnName: 'Invoices & Receipts', guarantee: 'numbers' }));
      expect(list).toContainEqual(expect.objectContaining({ op: 'column.formula', columnName: 'total', guarantee: 'totals' }));
      expect(list).toContainEqual(expect.objectContaining({ op: 'table.states', columnName: null, guarantee: 'edits' }));
    });

    it('refuses a table that retypes or drops a shape column, naming it, before anything is written', async () => {
      h = await addOnHarness(dialect);
      await h.stageAddOn(invoicesAddOn(), { bundled: true });
      const retyped = studio('studio', {
        quotes: (table) => ({ ...table, columns: (table['columns'] as Doc[]).map((c) => (c['ref'] === 'total' ? { ...c, type: 'int', scale: undefined } : c)) }),
      });
      const planned = await h.plan(retyped);
      expect(planned.statusCode, planned.body).toBe(200);
      expect(planned.json().plan.installable).toBe(false);
      expect(planned.json().plan.problems).toContainEqual(
        expect.objectContaining({ code: 'SHAPE_MISMATCH', table: 'quotes', message: expect.stringContaining('"quotes.total"') }),
      );
      const refused = await h.install('studio', '0.2.0');
      expect(refused.statusCode, refused.body).toBe(409);
      expect(refused.json().error.code).toBe('SHAPE_MISMATCH');
      expect(refused.json().error.message).toContain('"quotes.total"');
      expect((await m(h).list()).map((row) => row.row.manifestKey)).toEqual([]);
      expect(await h.tableNames()).not.toContain('studio_quotes');

      const dropped = studio('studio', {
        quotes: (table) => ({ ...table, columns: (table['columns'] as Doc[]).filter((c) => c['ref'] !== 'tax_name') }),
      });
      const again = await h.plan(dropped);
      expect(again.statusCode, again.body).toBe(200);
      expect(again.json().plan.problems).toContainEqual(expect.objectContaining({ code: 'SHAPE_MISMATCH', message: expect.stringContaining('"tax_name"') }));
    });

    it('gives two apps built on one shape two tables', async () => {
      h = await addOnHarness(dialect);
      await h.stageAddOn(invoicesAddOn(), { bundled: true });
      await h.stageApp(studio('studio'));
      expect((await h.install('studio', '0.2.0')).statusCode).toBe(200);
      await h.stageApp(studio('desk'));
      const second = await h.install('desk', '0.2.0');
      expect(second.statusCode, second.body).toBe(200);
      expect(await h.tableNames()).toEqual(expect.arrayContaining(['studio_quotes', 'desk_quotes']));
    });
  });
}

describe('pinned shape versions (sqlite)', () => {
  it('refuses an add-on upgrade that drops a shape version an installed app is built on — a switched-off one too', async () => {
    h = await addOnHarness('sqlite');
    await h.stageAddOn(invoicesAddOn(), { bundled: true });
    await h.stageApp(studio());
    expect((await h.install('studio', '0.2.0')).statusCode).toBe(200);
    expect((await h.inject({ method: 'POST', url: '/apps/studio/disable' })).statusCode).toBe(200);
    await h.stageAddOn(invoicesAddOn('1.2.0', 2));
    const refused = await h.inject({ method: 'POST', url: '/add-ons/invoices/upgrade' });
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json().error.code).toBe('ADD_ON_SHAPE_IN_USE');
    expect(refused.json().error.details).toMatchObject({ app: 'studio', shape: 'invoices/quote@1' });
    expect((await m(h).findByKey('invoices'))!.row.version).toBe('1.1.0');
  });

  it('lets an upgrade that keeps the version through, altering no app table', async () => {
    h = await addOnHarness('sqlite');
    await h.stageAddOn(invoicesAddOn(), { bundled: true });
    await h.stageApp(studio());
    expect((await h.install('studio', '0.2.0')).statusCode).toBe(200);
    const before = await h.tableNames();
    await h.stageAddOn(invoicesAddOn('1.2.0'));
    const upgraded = await h.inject({ method: 'POST', url: '/add-ons/invoices/upgrade' });
    expect(upgraded.statusCode, upgraded.body).toBe(200);
    expect(await h.tableNames()).toEqual(before);
  });
});

describe('a shape rule the operator changed is theirs (sqlite)', () => {
  it('stays switched off, or gone, through the app’s next update', async () => {
    h = await addOnHarness('sqlite');
    await h.stageAddOn(invoicesAddOn(), { bundled: true });
    await h.stageApp(studio());
    expect((await h.install('studio', '0.2.0')).statusCode).toBe(200);
    const repo = overridesRepo(h.meta);
    const active = () => repo.listForConnection(h!.connectionId);
    const sequence = (await active()).find((o) => o.op === 'column.sequence')!;
    const formula = (await active()).find((o) => o.op === 'column.formula' && o.columnName === 'total')!;
    await repo.setStatus(sequence.id, 'disabled');
    await repo.delete(formula.id);

    await h.stageApp(studio('studio', { version: '0.2.1' }));
    const updated = await h.inject({ method: 'POST', url: '/apps/studio/update' });
    expect(updated.statusCode, updated.body).toBe(200);
    const after = await active();
    expect(after.filter((o) => o.op === 'column.sequence').map((o) => o.status)).toEqual(['disabled']);
    expect(after.some((o) => o.op === 'column.formula' && o.columnName === 'total')).toBe(false);
    // Once changed, no longer labelled the add-on's.
    const rules = (await h.inject({ method: 'GET', url: `/connections/${h.connectionId}/shape-rules` })).json().rules as { op: string; columnName: string | null }[];
    expect(rules.some((r) => r.op === 'column.sequence')).toBe(false);
    expect(rules.some((r) => r.op === 'column.formula' && r.columnName === 'total')).toBe(false);
    expect(rules.some((r) => r.op === 'column.formula' && r.columnName === 'tax')).toBe(true);

    // And through the one after: the record remembers it is the operator's.
    await h.stageApp(studio('studio', { version: '0.2.2' }));
    expect((await h.inject({ method: 'POST', url: '/apps/studio/update' })).statusCode).toBe(200);
    const later = await active();
    expect(later.filter((o) => o.op === 'column.sequence').map((o) => o.status)).toEqual(['disabled']);
    expect(later.some((o) => o.op === 'column.formula' && o.columnName === 'total')).toBe(false);
  });
});

describe('a rule switched off before an uninstall (sqlite)', () => {
  it('is not written again beside itself when the app is installed again', async () => {
    h = await addOnHarness('sqlite');
    await h.stageAddOn(invoicesAddOn(), { bundled: true });
    await h.stageApp(studio());
    expect((await h.install('studio', '0.2.0')).statusCode).toBe(200);
    const repo = overridesRepo(h.meta);
    const sequence = (await repo.listForConnection(h.connectionId)).find((o) => o.op === 'column.sequence')!;
    await repo.setStatus(sequence.id, 'disabled');
    expect((await h.inject({ method: 'DELETE', url: '/apps/studio' })).statusCode).toBe(200);
    await h.stageApp(studio());
    const again = await h.install('studio', '0.2.0');
    expect(again.statusCode, again.body).toBe(200);
    const rows = (await repo.listForConnection(h.connectionId)).filter((o) => o.op === 'column.sequence');
    expect(rows.map((o) => o.status)).toEqual(['disabled']);
  });
});

describe('the live-model check on nested tables (sqlite)', () => {
  it('never stores a rule naming a table the app does not have here', async () => {
    h = await addOnHarness('sqlite');
    await h.stageAddOn(invoicesAddOn(), { bundled: true });
    await h.stageApp(studio());
    expect((await h.install('studio', '0.2.0')).statusCode).toBe(200);
    // The lines table's record is gone (a hand edit of the store, a half-made copy).
    await h.meta.db.deleteFrom('adminium_app_tables').where('ref', '=', 'quote_lines').execute();
    const parsed = validateManifest(studio());
    expect(parsed.ok).toBe(true);
    const result = await writeManifestRules({
      meta: h.meta,
      manifest: (parsed as { manifest: Manifest }).manifest,
      connectionId: h.connectionId,
      createdBy: null,
    });
    // Refused by the one check every nested ref gets, whatever op names it.
    const missing = 'It names "quote_lines", which this app does not have here.';
    expect(result.skipped).toContainEqual(expect.objectContaining({ op: 'column.rollup', reason: missing }));
    expect(result.skipped).toContainEqual(expect.objectContaining({ op: 'table.states', reason: missing }));
    const rollups = (await overridesRepo(h.meta).listForConnection(h.connectionId)).filter((o) => o.op === 'column.rollup');
    expect(rollups).toEqual([]);
  });
});
