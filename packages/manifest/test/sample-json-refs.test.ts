// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A row named inside a json value (`{"@ref": "<label>"}` in a funnel's steps,
 * a page's link): the bundle's check holds it to a column's `@ref` rules (an
 * earlier row, never one of a table only for an empty table) and refuses one
 * deeper than the loader reads. Words (`@t`) and a rule (`@rule`) inside
 * json are held to the same depth; a `@rule` in a column takes a text column,
 * and a key the install may not have is never a refusal.
 */
import { describe, expect, it } from 'vitest';

import { SAMPLE_JSON_DEPTH, sampleBundleIssues, sampleJsonRefs, validateManifest, type Manifest } from '../src/index.js';

const MANIFEST = {
  kind: 'app',
  manifestVersion: 1,
  key: 'studio',
  name: 'Studio',
  version: '1.0.0',
  publisher: { id: 'adminium', name: 'Adminium' },
  license: 'AGPL-3.0-only',
  description: { key: 'd', fallback: 'A studio.' },
  categories: ['crm'],
  compatibility: { minAdminiumVersion: '0.1.0' },
  requiredSchema: {
    tables: [
      { ref: 'settings', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'name', type: 'text' }] },
      { ref: 'pages', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'name', type: 'text' }] },
      { ref: 'funnels', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'name', type: 'text' }, { ref: 'steps', type: 'json' }, { ref: 'rule_id', type: 'text', nullable: true }, { ref: 'runs', type: 'int', nullable: true }] },
    ],
  },
  pages: [{ ref: 'studio-funnels', template: 'page-crud', title: { key: 't', fallback: 'Funnels' }, nav: { group: 'library', icon: 'list', order: 1 }, bindings: { rows: 'funnels' } }],
  frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
};

function manifest(): Manifest {
  const result = validateManifest(MANIFEST);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.manifest as Manifest;
}

const bundle = (steps: unknown, more: { pagesAfter?: boolean; columns?: Record<string, unknown> } = {}) => {
  const pages = { ref: 'pages', rows: [{ '@label': 'page:open-day', name: 'Open day' }] };
  const funnels = { ref: 'funnels', rows: [{ '@label': 'funnel:one', name: 'One', steps, ...more.columns }] };
  return {
    format: 'adminium.sample/1',
    app: 'studio',
    tables: [{ ref: 'settings', onlyIfEmpty: true, rows: [{ '@label': 'settings:one', name: 'Ours' }] }, ...(more.pagesAfter === true ? [funnels, pages] : [pages, funnels])],
  };
};
const issues = (value: ReturnType<typeof bundle>) => sampleBundleIssues(value as never, manifest()).map((issue) => `${issue.path}: ${issue.message}`);

/** A value with `inner` nested `levels` objects down from the column's value. */
const nested = (levels: number, inner: unknown): unknown => (levels === 0 ? inner : { down: nested(levels - 1, inner) });

describe('a row named inside a json value', () => {
  it('passes for an earlier row, at any place in the value', () => {
    expect(issues(bundle([{ kind: 'page', key: { '@ref': 'page:open-day' } }]))).toEqual([]);
    expect(issues(bundle({ steps: [{ kind: 'page', key: { '@ref': 'page:open-day' } }] }))).toEqual([]);
  });

  it('refuses one that is not an earlier row', () => {
    expect(issues(bundle([{ kind: 'page', key: { '@ref': 'page:missing' } }]))).toEqual(['tables.2.rows.0.steps: "page:missing" is not an earlier row: a referenced row must come first.']);
    expect(issues(bundle([{ kind: 'page', key: { '@ref': 'page:open-day' } }], { pagesAfter: true }))).toEqual(['tables.1.rows.0.steps: "page:open-day" is not an earlier row: a referenced row must come first.']);
  });

  it('refuses one of a table only for an empty table', () => {
    expect(issues(bundle([{ kind: 'page', key: { '@ref': 'settings:one' } }]))).toEqual(['tables.2.rows.0.steps: "settings:one" is in a table only for an empty table, so it may not be written: nothing points at it.']);
  });

  it('reads as deep as the loader resolves, and refuses one deeper', () => {
    // The column's value is level 0: the deepest a directive is read is SAMPLE_JSON_DEPTH.
    expect(sampleJsonRefs(nested(SAMPLE_JSON_DEPTH, { '@ref': 'page:open-day' }))).toEqual({ labels: ['page:open-day'], deeper: false });
    expect(sampleJsonRefs(nested(SAMPLE_JSON_DEPTH + 1, { '@ref': 'page:open-day' }))).toEqual({ labels: [], deeper: true });
    expect(sampleJsonRefs(nested(SAMPLE_JSON_DEPTH + 1, { '@person': 'dana' }))).toEqual({ labels: [], deeper: true });
    // Plain text that only mentions a directive is no directive.
    expect(sampleJsonRefs(nested(SAMPLE_JSON_DEPTH + 1, 'write {"@ref": "x"} here'))).toEqual({ labels: [], deeper: false });
    expect(issues(bundle(nested(SAMPLE_JSON_DEPTH, { '@ref': 'page:open-day' })))).toEqual([]);
    expect(issues(bundle(nested(SAMPLE_JSON_DEPTH + 1, { '@ref': 'page:open-day' })))).toEqual([
      `tables.2.rows.0.steps: A "@ref", "@person", "@t" or "@rule" inside "steps" is more than ${String(SAMPLE_JSON_DEPTH)} levels down, where it is not read: move it up.`,
    ]);
  });

  it('holds words and a rule inside json to the same depth', () => {
    for (const inner of [{ '@t': { 'en-US': 'Booths' } }, { '@rule': 'brochure-asked' }]) {
      expect(issues(bundle(nested(SAMPLE_JSON_DEPTH, inner))), JSON.stringify(inner)).toEqual([]);
      expect(issues(bundle(nested(SAMPLE_JSON_DEPTH + 1, inner))), JSON.stringify(inner)).toEqual([
        `tables.2.rows.0.steps: A "@ref", "@person", "@t" or "@rule" inside "steps" is more than ${String(SAMPLE_JSON_DEPTH)} levels down, where it is not read: move it up.`,
      ]);
    }
  });

  it('takes a rule by its key in a text column, whichever rules the install has', () => {
    expect(issues(bundle([], { columns: { rule_id: { '@rule': 'brochure-asked' } } }))).toEqual([]);
    // A key the manifest ships no rule under is the install's to settle (written empty), never a refusal.
    expect(issues(bundle([], { columns: { rule_id: { '@rule': 'no-such-rule' } } }))).toEqual([]);
    expect(issues(bundle([], { columns: { runs: { '@rule': 'brochure-asked' } } }))).toEqual(['tables.2.rows.0.runs: "funnels.runs" is not a text column, so it cannot hold a rule.']);
    expect(issues(bundle([], { columns: { rule_id: { '@rule': 'Not A Key' } } }))).toEqual(['tables.2.rows.0.rule_id: "rule_id" holds a directive that is not well formed.']);
  });

  it('leaves a column\'s own directive to the column\'s rules', () => {
    expect(sampleJsonRefs({ '@ref': 'page:open-day' })).toEqual({ labels: [], deeper: false });
    expect(sampleJsonRefs('text')).toEqual({ labels: [], deeper: false });
  });
});
