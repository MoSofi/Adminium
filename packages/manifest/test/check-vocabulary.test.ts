// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The design question's words as one manifest can check them: the line
 * table's `check`, the add-on's `checker` with its keyed reads, and the
 * release that reads them.
 */
import { describe, expect, it } from 'vitest';

import { checkerOf, installFloorWords, validateManifest, WORD_FLOORS } from '../src/index.js';

type Doc = Record<string, unknown>;
const pk = { ref: 'id', type: 'int', role: 'pk' };
const IDENTITY = { manifestVersion: 1, publisher: { id: 'adminium', name: 'Adminium' }, license: 'MIT', version: '1.0.0', categories: ['data'], compatibility: { minAdminiumVersion: '0.3.43' } };

const issuesOf = (doc: unknown): string[] => {
  const result = validateManifest(doc);
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}: ${issue.message}`);
};

const CHECKER = {
  design: 'designs',
  reads: [
    { id: 'ready', table: 'ready', by: { column: 'id', from: 'design.ready_id' } },
    { id: 'parts', table: 'ready_parts', by: { column: 'ready_id', from: 'ready.id' } },
  ],
};

function kit(checker: Doc = CHECKER, provides: Doc[] = [{ contract: 'design-check', version: 1, server: 'dist/check.js' }]): Doc {
  return {
    ...IDENTITY,
    kind: 'add-on',
    key: 'design-kit',
    name: 'Design kit',
    description: { key: 'design-kit.description', fallback: 'Designs.' },
    addOn: { attaches: [{ app: '*', range: '*' }], connect: { kind: 'none' }, provides, checker },
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'ready', columns: [pk, { ref: 'title', type: 'text', maxLength: 80 }] },
        { ref: 'ready_parts', columns: [pk, { ref: 'ready_id', type: 'fk', references: 'ready' }, { ref: 'max_chars', type: 'int' }] },
        { ref: 'designs', columns: [pk, { ref: 'ready_id', type: 'fk', references: 'ready', nullable: true }] },
      ],
    },
  };
}

function shop(check: Doc, over: Doc = {}): Doc {
  return {
    ...IDENTITY,
    compatibility: { minAdminiumVersion: '0.3.43', engines: ['postgres', 'mysql', 'sqlite'] },
    kind: 'app',
    key: 'printing',
    name: 'Print shop',
    description: { key: 'mft.printing.desc', fallback: 'A shop.' },
    categories: ['commerce'],
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'orders', columns: [pk] },
        {
          ref: 'order_lines',
          check,
          columns: [pk, { ref: 'order_id', type: 'fk', references: 'orders' }, { ref: 'design_id', type: 'int', nullable: true, rules: { addOnLink: { addOn: 'design-kit', table: 'designs' } } }],
        },
        { ref: 'line_features', columns: [pk, { ref: 'line_id', type: 'fk', references: 'order_lines' }, { ref: 'feature', type: 'text', maxLength: 40 }, { ref: 'price', type: 'money', scale: 2, nullable: true }] },
      ],
    },
    pages: [{ ref: 'printing-home', template: 'page-dashboard', title: { key: 'mft.printing.page.home', fallback: 'Home' }, nav: { group: 'manifest:sample', icon: 'layout-dashboard', order: 1 } }],
    frontends: [{ side: 'staff', kind: 'none' }, { side: 'customer', kind: 'none' }],
    addOns: { requires: [{ key: 'design-kit', range: '^1.0.0', reason: { 'en-US': 'Designs.' } }] },
    ...over,
  };
}

const RULE = { by: { addOn: 'design-kit' }, design: 'design_id', paid: { table: 'line_features', via: 'line_id', feature: 'feature' } };

describe('the line table\'s design rule', () => {
  it('validates as written, and with no paid features at all', () => {
    expect(issuesOf(shop(RULE))).toEqual([]);
    expect(issuesOf(shop({ by: { addOn: 'design-kit' }, design: 'design_id' }))).toEqual([]);
  });

  it('is answered by an add-on the app names', () => {
    expect(issuesOf(shop(RULE, { addOns: { requires: [] } }))).toContainEqual(expect.stringContaining('"design-kit" is not an add-on this manifest names'));
  });

  it('names a design link into that add-on', () => {
    expect(issuesOf(shop({ ...RULE, design: 'order_id' }))).toContainEqual(expect.stringContaining('a column with rules.addOnLink into "design-kit"'));
    expect(issuesOf(shop({ ...RULE, design: 'nothing' }))).toContainEqual(expect.stringContaining('has no column "nothing"'));
  });

  it('keeps paid features in a child of the line, one feature a row', () => {
    expect(issuesOf(shop({ ...RULE, paid: { ...RULE.paid, table: 'nowhere' } }))).toContainEqual(expect.stringContaining('"nowhere" is not one of this manifest\'s tables'));
    expect(issuesOf(shop({ ...RULE, paid: { ...RULE.paid, via: 'feature' } }))).toContainEqual(expect.stringContaining('is not a foreign key to "order_lines"'));
    expect(issuesOf(shop({ ...RULE, paid: { ...RULE.paid, feature: 'price' } }))).toContainEqual(expect.stringContaining('names a feature'));
  });

  it('is an app\'s: an add-on\'s own tables carry none', () => {
    const doc = kit() as { requiredSchema: { tables: Doc[] } };
    doc.requiredSchema.tables[2] = { ...doc.requiredSchema.tables[2]!, check: { by: { addOn: 'other-kit' }, design: 'ready_id' } };
    expect(issuesOf(doc)).toContainEqual(expect.stringContaining('carry no design rule'));
  });
});

describe('the add-on\'s checker', () => {
  it('validates, and reads back typed', () => {
    expect(issuesOf(kit())).toEqual([]);
    const result = validateManifest(kit());
    expect(result.ok && checkerOf(result.manifest)).toEqual(CHECKER);
  });

  it('provides design-check exactly once', () => {
    expect(issuesOf(kit(CHECKER, []))).toContainEqual(expect.stringContaining('provides the contract "design-check" exactly once'));
  });

  it('reads only its own tables, each keyed by the design or an earlier read', () => {
    expect(issuesOf(kit({ ...CHECKER, design: 'orders' }))).toContainEqual(expect.stringContaining('"orders" is not one of this add-on\'s own tables'));
    expect(issuesOf(kit({ ...CHECKER, reads: [{ id: 'parts', table: 'ready_parts', by: { column: 'ready_id', from: 'ready.id' } }] }))).toContainEqual(expect.stringContaining('a read is keyed by a column of the design or of an earlier read'));
    expect(issuesOf(kit({ ...CHECKER, reads: [{ id: 'ready', table: 'ready', by: { column: 'id', from: 'design.nothing' } }] }))).toContainEqual(expect.stringContaining('has no column "nothing"'));
    expect(issuesOf(kit({ ...CHECKER, reads: [{ id: 'design', table: 'ready', by: { column: 'id', from: 'design.ready_id' } }] }))).toContainEqual(expect.stringContaining('"design" is the design row itself'));
  });
});

describe('the words of the design question', () => {
  it('are named where they are used, at 0.3.43', () => {
    expect(installFloorWords(shop(RULE)).map((one) => one.word)).toContain('table.check');
    expect(installFloorWords(kit())).toContainEqual(expect.objectContaining({ word: 'addOn.checker', path: 'addOn.checker' }));
    expect(WORD_FLOORS['table.check']).toBe('0.3.43');
    expect(WORD_FLOORS['addOn.checker']).toBe('0.3.43');
  });
});
