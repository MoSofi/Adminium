// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A board page's `config.board`: what its columns are, checked against the
 * app's own tables. A manifest that names them right validates; each test
 * breaks one name and reads the sentence that points at it.
 */
import { describe, expect, it } from 'vitest';

import { WORD_FLOORS, installFloorWords, pageBoardSchema, validateManifest } from '../src/index.js';

const id = { ref: 'id', type: 'int', role: 'pk' };

function manifest(board: unknown, over: { template?: string; floor?: string; bindings?: Record<string, string> } = {}) {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'crm',
    name: 'CRM',
    version: '1.0.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'AGPL-3.0-only',
    description: { key: 'd', fallback: 'A sales desk.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: over.floor ?? '0.3.28' },
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'stages', columns: [id, { ref: 'name', type: 'text', maxLength: 80 }, { ref: 'position', type: 'int' }] },
        { ref: 'companies', columns: [id, { ref: 'name', type: 'text', maxLength: 80 }] },
        {
          ref: 'deals',
          columns: [
            id,
            { ref: 'name', type: 'text', maxLength: 120 },
            { ref: 'stage_id', type: 'fk', references: 'stages', nullable: true },
            { ref: 'company_id', type: 'fk', references: 'companies', nullable: true },
            { ref: 'amount', type: 'money', nullable: true },
            { ref: 'weight', type: 'int', nullable: true },
            { ref: 'state', type: 'enum', enum: ['open', 'won', 'lost'], default: 'open' },
            { ref: 'kind', type: 'enum', enum: ['new', 'renewal', 'upsell'], default: 'new' },
            { ref: 'hot', type: 'bool', default: false },
            { ref: 'region', type: 'text', maxLength: 40, nullable: true },
            { ref: 'closes_on', type: 'date', nullable: true },
            { ref: 'notes', type: 'json', nullable: true },
          ],
        },
      ],
    },
    pages: [
      {
        ref: 'crm-pipeline',
        template: over.template ?? 'page-board',
        title: { key: 'p', fallback: 'Pipeline' },
        nav: { group: 'records', icon: 'square-kanban', order: 1 },
        bindings: over.bindings ?? { rows: 'deals' },
        config: { board },
      },
    ],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
  };
}

const FROM = { table: 'stages', label: 'name', order: 'position' };

const issuesOf = (board: unknown, over?: Parameters<typeof manifest>[1]) => {
  const result = validateManifest(manifest(board, over));
  return result.ok ? [] : result.issues;
};

describe('a board page names its columns', () => {
  it('validates columns from a table, with a title and totals, and columns from an enum', () => {
    expect(issuesOf({ column: 'stage_id', columnsFrom: FROM, title: 'name', totals: [{ column: 'amount', fn: 'sum' }] })).toEqual([]);
    expect(issuesOf({ column: 'stage_id', columnsFrom: { table: 'stages', label: 'name' } })).toEqual([]);
    expect(issuesOf({ column: 'stage_id', columnsFrom: FROM, totals: [{ column: 'amount', fn: 'sum' }, { column: 'weight', fn: 'avg' }] })).toEqual([]);
    expect(issuesOf({ column: 'state', title: 'name' })).toEqual([]);
  });

  it('refuses a column the table lacks, or one that is no link to the columns’ table', () => {
    expect(issuesOf({ column: 'stage', columnsFrom: FROM })).toEqual([{ path: 'pages.0.config.board.column', message: '"deals" has no column "stage"' }]);
    expect(issuesOf({ column: 'company_id', columnsFrom: FROM })).toEqual([
      { path: 'pages.0.config.board.column', message: '"deals.company_id" is not a link to "stages"' },
    ]);
    expect(issuesOf({ column: 'state', columnsFrom: FROM })).toEqual([{ path: 'pages.0.config.board.column', message: '"deals.state" is not a link to "stages"' }]);
  });

  it('refuses a column that is no enum when no table is named', () => {
    expect(issuesOf({ column: 'stage_id' })).toEqual([
      {
        path: 'pages.0.config.board.column',
        message: '"deals.stage_id" is not an enum: name the table its columns come from in columnsFrom, or place cards by an enum column',
      },
    ]);
  });

  it('refuses a table the app lacks, and a label or an order that table lacks', () => {
    expect(issuesOf({ column: 'stage_id', columnsFrom: { table: 'phases', label: 'name' } }).map((issue) => issue.path)).toEqual([
      'pages.0.config.board.column',
      'pages.0.config.board.columnsFrom.table',
    ]);
    expect(issuesOf({ column: 'stage_id', columnsFrom: { table: 'stages', label: 'title', order: 'rank' } })).toEqual([
      { path: 'pages.0.config.board.columnsFrom.label', message: '"stages" has no column "title"' },
      { path: 'pages.0.config.board.columnsFrom.order', message: '"stages" has no column "rank"' },
    ]);
  });

  it('refuses a title the table lacks, and a total that is no number, is said twice, or is a third', () => {
    expect(issuesOf({ column: 'state', title: 'subject' })).toEqual([{ path: 'pages.0.config.board.title', message: '"deals" has no column "subject"' }]);
    expect(issuesOf({ column: 'state', totals: [{ column: 'name', fn: 'sum' }] })).toEqual([
      { path: 'pages.0.config.board.totals.0.column', message: '"deals.name" is not a number or money, so it cannot be totalled' },
    ]);
    expect(issuesOf({ column: 'state', totals: [{ column: 'worth', fn: 'sum' }] })).toEqual([
      { path: 'pages.0.config.board.totals.0.column', message: '"deals" has no column "worth"' },
    ]);
    expect(issuesOf({ column: 'state', totals: [{ column: 'amount', fn: 'sum' }, { column: 'amount', fn: 'sum' }] })).toEqual([
      { path: 'pages.0.config.board.totals.1', message: '"amount" is totalled this way twice' },
    ]);
    const three = [{ column: 'amount', fn: 'sum' }, { column: 'amount', fn: 'avg' }, { column: 'weight', fn: 'sum' }];
    expect(issuesOf({ column: 'state', totals: three }).map((issue) => issue.path)).toEqual(['pages.0.config.board.totals']);
    expect(issuesOf({ column: 'state', totals: [{ column: 'amount', fn: 'max' }] }).map((issue) => issue.path)).toEqual(['pages.0.config.board.totals.0.fn']);
  });

  it('takes only: the cards on the board, by a value or a list of values of up to three columns', () => {
    expect(issuesOf({ column: 'stage_id', columnsFrom: FROM, only: { state: 'open' } })).toEqual([]);
    expect(issuesOf({ column: 'stage_id', columnsFrom: FROM, only: { state: ['open', 'won'], hot: true, weight: [1, 2, 3] } })).toEqual([]);
    // A link by the key it holds, text, and an enum board narrowed by another column.
    expect(issuesOf({ column: 'stage_id', columnsFrom: FROM, only: { company_id: [4, 9], region: 'north' } })).toEqual([]);
    expect(issuesOf({ column: 'kind', only: { state: 'open' } })).toEqual([]);
  });

  it('refuses an only on a column the table lacks, on the board’s own column, or on one that is not compared', () => {
    const at = (name: string) => `pages.0.config.board.only.${name}`;
    expect(issuesOf({ column: 'stage_id', columnsFrom: FROM, only: { status: 'open' } })).toEqual([{ path: at('status'), message: '"deals" has no column "status"' }]);
    expect(issuesOf({ column: 'stage_id', columnsFrom: FROM, only: { stage_id: 2 } })).toEqual([
      { path: at('stage_id'), message: `"stage_id" is what the board's columns are: leave a column out of the board by its own table or enum, not by only` },
    ]);
    expect(issuesOf({ column: 'state', only: { state: 'open' } }).map((issue) => issue.path)).toEqual([at('state')]);
    for (const [name, value] of [['amount', 100], ['closes_on', '2026-01-01'], ['notes', 'x']] as const) {
      const issues = issuesOf({ column: 'stage_id', columnsFrom: FROM, only: { [name]: value } });
      expect(issues.map((issue) => issue.path), name).toEqual([at(name)]);
      expect(issues[0]?.message, name).toContain('only compares a choice, a yes/no, a link, text or a whole number');
    }
  });

  it('refuses an only whose value the column cannot hold, or says twice', () => {
    const at = (name: string) => `pages.0.config.board.only.${name}`;
    expect(issuesOf({ column: 'stage_id', columnsFrom: FROM, only: { state: 'closed' } })).toEqual([
      { path: at('state'), message: '"closed" is not one of the values of "deals.state" (open, won, lost)' },
    ]);
    expect(issuesOf({ column: 'stage_id', columnsFrom: FROM, only: { state: ['open', 'gone'] } }).map((issue) => issue.message)).toEqual([
      '"gone" is not one of the values of "deals.state" (open, won, lost)',
    ]);
    expect(issuesOf({ column: 'stage_id', columnsFrom: FROM, only: { hot: 'yes' } })).toEqual([{ path: at('hot'), message: '"yes" is not a value "deals.hot" (bool) can hold' }]);
    expect(issuesOf({ column: 'stage_id', columnsFrom: FROM, only: { weight: 1.5 } })).toEqual([{ path: at('weight'), message: '1.5 is not a value "deals.weight" (int) can hold' }]);
    expect(issuesOf({ column: 'stage_id', columnsFrom: FROM, only: { weight: '3' } }).map((issue) => issue.path)).toEqual([at('weight')]);
    expect(issuesOf({ column: 'stage_id', columnsFrom: FROM, only: { company_id: true } }).map((issue) => issue.path)).toEqual([at('company_id')]);
    expect(issuesOf({ column: 'stage_id', columnsFrom: FROM, only: { region: 7 } }).map((issue) => issue.path)).toEqual([at('region')]);
    expect(issuesOf({ column: 'stage_id', columnsFrom: FROM, only: { state: ['open', 'open'] } })).toEqual([{ path: at('state'), message: '"state" lists a value twice' }]);
  });

  it('refuses a link’s value of the wrong kind for the key of the table it links to, where that table is the app’s own', () => {
    const at = 'pages.0.config.board.only.company_id';
    // `companies` is keyed by a whole number: text there installs, and then the server cannot compare it with the column.
    expect(issuesOf({ column: 'stage_id', columnsFrom: FROM, only: { company_id: '7' } })).toEqual([
      { path: at, message: '"7" is not a value "deals.company_id" can hold: it links to "companies", whose key is a whole number' },
    ]);
    expect(issuesOf({ column: 'stage_id', columnsFrom: FROM, only: { company_id: [4, 'nine'] } }).map((issue) => issue.path)).toEqual([at]);
    expect(issuesOf({ column: 'stage_id', columnsFrom: FROM, only: { company_id: 7 } })).toEqual([]);
    // A table keyed by text takes text, and no number.
    const textKeyed = (only: unknown) => {
      const m = manifest({ column: 'stage_id', columnsFrom: FROM, only });
      const companies = m.requiredSchema.tables.find((t) => t.ref === 'companies')!;
      companies.columns = [{ ref: 'id', type: 'id', role: 'pk' }, { ref: 'name', type: 'text', maxLength: 80 }];
      const result = validateManifest(m);
      return result.ok ? [] : result.issues;
    };
    expect(textKeyed({ company_id: 'acme' })).toEqual([]);
    expect(textKeyed({ company_id: 7 })).toEqual([{ path: at, message: '7 is not a value "deals.company_id" can hold: it links to "companies", whose key is text' }]);
  });

  it('refuses an only of no column, of a fourth, of no value, of more than twenty, or of a value that is none', () => {
    const paths = (only: unknown) => issuesOf({ column: 'stage_id', columnsFrom: FROM, only }).map((issue) => issue.path);
    expect(paths({})).toEqual(['pages.0.config.board.only']);
    expect(paths({ state: 'open', hot: true, weight: 1, region: 'north' })).toEqual(['pages.0.config.board.only']);
    expect(paths({ state: [] })).toEqual(['pages.0.config.board.only.state']);
    expect(paths({ weight: Array.from({ length: 21 }, (_, n) => n) })).toEqual(['pages.0.config.board.only.weight']);
    expect(paths({ state: null })).toEqual(['pages.0.config.board.only.state']);
    expect(paths({ state: { eq: 'open' } })).toEqual(['pages.0.config.board.only.state']);
    expect(paths([{ column: 'state', in: ['open'] }])).toEqual(['pages.0.config.board.only']);
  });

  it('is strict: a key it does not know is refused, and so is a board with no column', () => {
    expect(pageBoardSchema.safeParse({ column: 'state', lanes: 'owner_id' }).success).toBe(false);
    expect(pageBoardSchema.safeParse({ column: 'stage_id', columnsFrom: { table: 'stages', label: 'name', tone: 'colour' } }).success).toBe(false);
    expect(issuesOf({ columnsFrom: FROM }).map((issue) => issue.path)).toEqual(['pages.0.config.board.column']);
  });

  it('is refused on a page that is no board, and on a board bound to no table of the app', () => {
    expect(issuesOf({ column: 'state' }, { template: 'page-crud' })).toEqual([
      { path: 'pages.0.config.board', message: 'only a page-board takes its columns from config.board, not a page-crud' },
    ]);
    expect(issuesOf({ column: 'state' }, { bindings: { rows: 'orders' } }).map((issue) => issue.message)).toContain(
      'a board names its columns on a page bound to a table of the app',
    );
  });

  it('is a word of 0.3.28: found where it is written, and refused under an older floor', () => {
    const doc = manifest({ column: 'stage_id', columnsFrom: FROM });
    expect(installFloorWords(doc)).toContainEqual({ word: 'config.board', path: 'pages.0.config.board' });
    expect(WORD_FLOORS['config.board']).toBe('0.3.28');
    const old = issuesOf({ column: 'stage_id', columnsFrom: FROM }, { floor: '0.3.26' }).map((issue) => issue.message);
    expect(old.some((message) => message.includes('"config.board" is read by Adminium 0.3.28 and later'))).toBe(true);
  });
});
