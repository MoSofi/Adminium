// SPDX-License-Identifier: AGPL-3.0-only
/**
 * NO NEW QUOTE ON A CLOSED DEAL — a table built on an add-on's shape holds
 * its create to a condition on a column the app added, on SQLite, Postgres
 * and MySQL, with a copy of the real Invoices & Receipts manifest.
 *
 * The quotes are built on Invoices' `quote@1` document. The app keeps the
 * deal's state on the quote (`deal_state`, a copy that follows the deal) and
 * holds the create to it (`states.create.requires.where`: `deal_state` is
 * open), as it may already hold one of the shape's moves to such a column:
 *
 *  - the install takes it, and still refuses a condition on a column of the
 *    shape's (`SHAPE_MISMATCH`, naming it), before anything is written;
 *  - a staff member's new quote on a won or lost deal is refused, on an open
 *    one it is made (the copy fills `deal_state` before the create is judged);
 *  - history is not held: an import brings in a past quote of a won deal.
 */
import { readFileSync } from 'node:fs';

import { manifestsRepo, type MetaDb } from '@adminium/meta';
import { shapeConformanceIssues, shapeKey, validateManifest, type ShapeDefinitionView } from '@adminium/manifest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { mapTableRefs } from '../src/apps/real-refs.js';
import { addOnHarness, appManifest } from './app-add-ons.helpers.js';
import { LEGS, installInvoicing, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';

// The manifest uses a word read from 0.3.33 on (`shape.create`); until the release this server says 0.3.32.
vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.33' }));

type Doc = Record<string, unknown>;
const en = (text: string) => ({ 'en-US': text });
const id = { ref: 'id', type: 'int', role: 'pk' };
const invoicesAddOn = (): Doc => ({ ...(JSON.parse(readFileSync(new URL('./fixtures/invoices-add-on.json', import.meta.url), 'utf8')) as Doc), version: '1.1.0' });
const OPEN_ONLY: Doc = { requires: { where: [{ column: 'deal_state', eq: 'open' }] } };

/** A part of the quote shape, spelled out as the app's own table, with what the app adds to its columns and its states. */
function tableOnPart(part: string, ref: string, extra: Doc[] = [], states: (shape: Doc) => Doc = (shape) => shape): Doc {
  const names: Record<string, string> = { document: 'quotes', lines: 'quote_lines' };
  const shape = (invoicesAddOn()['addOn'] as { shapes: Doc[] }).shapes.find((one) => one['name'] === 'quote')!;
  const def = (shape['parts'] as Record<string, { columns: Doc[]; states?: Doc }>)[part]!;
  const map = (short: string) => names[short] ?? short;
  const columns = def.columns.map((column) => {
    const rules = column['rules'] as Doc | undefined;
    return {
      ...column,
      ...(typeof column['references'] === 'string' ? { references: map(column['references']) } : {}),
      ...(rules === undefined ? {} : { rules: Object.fromEntries(Object.entries(rules).map(([name, rule]) => [name, name === 'rollup' ? mapTableRefs(rule, map, { refKeys: ['from'] }).value : mapTableRefs(rule, map).value])) }),
    };
  });
  return { ref, builtOn: 'invoices/quote@1', part, columns: [...columns, ...extra], ...(def.states === undefined ? {} : { states: states(mapTableRefs(def.states, map).value as Doc) }) };
}

/** The sales app: deals, and quotes built on the shape whose create is held to `create`. */
function crm(create: Doc | null = OPEN_ONLY): Doc {
  return appManifest('crm', {
    version: '0.2.0',
    compatibility: { minAdminiumVersion: '0.3.33', engines: ['postgres', 'mysql', 'sqlite'] },
    addOns: { requires: [{ key: 'invoices', range: '>=1.1.0', reason: en('Quotes are made by this add-on.') }] },
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'deals', columns: [id, { ref: 'title', type: 'text', maxLength: 80 }, { ref: 'state', type: 'enum', enum: ['open', 'won', 'lost'], default: 'open' }] },
        tableOnPart(
          'document',
          'quotes',
          [
            { ref: 'deal_id', type: 'fk', references: 'deals' },
            // The deal's state, kept on the quote and following the deal: a column the app added.
            { ref: 'deal_state', type: 'text', maxLength: 16, nullable: true, rules: { copy: { via: 'deal_id', from: 'state', mode: 'always', follow: true } } },
          ],
          (shape) => (create === null ? shape : { ...shape, create }),
        ),
        tableOnPart('lines', 'quote_lines'),
      ],
    },
  });
}

/** The create held to a column of the shape's too. */
const onShapeColumn = (): Doc => crm({ requires: { where: [{ column: 'deal_state', eq: 'open' }, { column: 'currency', isNull: false }] } });

async function invoices(meta: MetaDb): Promise<void> {
  const document = invoicesAddOn();
  const addOn = document['addOn'] as { attaches?: { app: string }[] };
  addOn.attaches = [...(addOn.attaches ?? []).filter((one) => one.app !== 'crm'), { app: 'crm' }];
  await manifestsRepo(meta, { encrypt: (v) => v, decrypt: (v) => v }).install({ manifestKey: 'invoices', version: '1.1.0', kind: 'add-on', source: 'file', document: document as never });
}

describe('the word, as the validator and the shape check read it', () => {
  const shapes = new Map(((invoicesAddOn()['addOn'] as { shapes: ShapeDefinitionView[] }).shapes ?? []).map((shape) => [shapeKey('invoices', shape), shape]));
  const said = (manifest: Doc) => shapeConformanceIssues(manifest as never, shapes).map((issue) => issue.message);
  const issuesOf = (manifest: Doc) => {
    const result = validateManifest(manifest);
    return result.ok ? [] : result.issues.map((issue) => issue.message);
  };

  it('takes a create held to a column the app added, and names a column of the shape\'s', () => {
    expect(issuesOf(crm())).toEqual([]);
    expect(said(crm())).toEqual([]);
    expect(said(crm(null))).toEqual([]);
    expect(issuesOf(onShapeColumn())).toEqual([]);
    expect(said(onShapeColumn())).toEqual(["a condition an app adds to the shape's create reads a column the app added, never currency"]);
    // A linked row is the shape's to ask, however it is written.
    expect(said(crm({ requires: { linked: [{ via: 'deal_id', where: [{ column: 'state', eq: 'open' }] }] } }))).toEqual(["create is the shape's (an app may only hold it to a condition on a column it added)"]);
  });
});

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`no new quote on a closed deal, on ${dialect}`, () => {
    let h: InvoicingHarness;
    beforeAll(async () => {
      h = await installInvoicing(dialect, crm(), invoices, {}, { install: { addOns: [{ key: 'invoices', version: '1.1.0' }] } });
      await h.rows(`INSERT INTO ${h.real('deals')} (id, title, state) VALUES (1, 'Open deal', 'open'), (2, 'Won deal', 'won'), (3, 'Lost deal', 'lost')`);
    }, 240_000);
    afterAll(async () => {
      await h?.close();
    });

    const codeOf = async (attempt: Promise<unknown>) =>
      attempt.then(
        () => 'written',
        (error: { code?: string }) => error.code ?? String(error),
      );
    const quotesOf = async (deal: number) => (await h.rows(`SELECT deal_state FROM ${h.real('quotes')} WHERE deal_id = ${String(deal)}`)).map((row) => row['deal_state']);

    it('refuses a new quote on a won or a lost deal, and makes one on an open deal', async () => {
      const w = await writerFor(h);
      for (const deal of [2, 3]) {
        const refusal = await w.create('quotes', { deal_id: deal }).then(
          () => null,
          (error: { code: string; statusCode: number; details: Doc }) => error,
        );
        expect([deal, refusal]).toMatchObject([deal, { code: 'STATE_MOVE_REFUSED', statusCode: 409, details: { column: 'status', from: null, create: true } }]);
        expect(await quotesOf(deal)).toEqual([]);
      }
      const made = await w.create('quotes', { deal_id: 1 });
      expect(made['deal_state']).toBe('open');
      expect(await quotesOf(1)).toEqual(['open']);
      // Every staff door but history: a bulk edit's create, a rule's, a record's action.
      for (const origin of ['bulk', 'automation', 'action'] as const) {
        expect([origin, await codeOf(w.create('quotes', { deal_id: 2 }, { ...w.desk, origin }))]).toEqual([origin, 'STATE_MOVE_REFUSED']);
      }
    });

    it('is not held for history: an import brings in a past quote of a won deal', async () => {
      const w = await writerFor(h);
      expect(await codeOf(w.create('quotes', { deal_id: 2 }, { ...w.desk, origin: 'import' }))).toBe('written');
      expect(await quotesOf(2)).toEqual(['won']);
    });

    it('the install takes the word, and refuses a condition on a column of the shape\'s before anything is written', async () => {
      const a = await addOnHarness(dialect);
      try {
        await a.stageAddOn(invoicesAddOn(), { bundled: true });
        const planned = await a.plan(onShapeColumn());
        expect(planned.statusCode, planned.body).toBe(200);
        expect(planned.json().plan.installable).toBe(false);
        expect(planned.json().plan.problems).toContainEqual(expect.objectContaining({ code: 'SHAPE_MISMATCH', table: 'quotes', message: expect.stringContaining('never currency') }));
        const refused = await a.install('crm', '0.2.0');
        expect(refused.statusCode, refused.body).toBe(409);
        expect(refused.json().error.code).toBe('SHAPE_MISMATCH');
        expect(await a.tableNames()).not.toContain('crm_quotes');
      } finally {
        await a.close();
      }
    });
  });
}
