// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A table found under an add-on's name. An add-on released before the install
 * floor reads its HOST's tables, so one that is there is simply used. An
 * add-on that installs like an app keeps tables of its OWN: one found there
 * is judged as an app's is — a table missing what it writes, shaped for
 * something else, or holding another type, is a problem said in the plan.
 */
import { describe, expect, it } from 'vitest';

import { planInstall, validateManifest, type Manifest, type SchemaModelView } from '../src/index.js';
import { KIT } from './add-on-kit-fixture.js';

const parsed = (doc: unknown): Manifest => {
  const result = validateManifest(structuredClone(doc));
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.manifest;
};
const LIKE_APP = parsed(KIT);
/** The same tables, as an add-on declared them before the install floor: no prefix, no rules, no pages or roles. */
const BEFORE = parsed({
  kind: 'add-on',
  manifestVersion: 1,
  key: 'kit',
  name: 'Kit',
  version: '1.0.0',
  publisher: { id: 'adminium', name: 'Adminium' },
  license: 'MIT',
  description: { key: 'kit.description', fallback: 'Keeps stock.' },
  categories: ['data'],
  compatibility: { minAdminiumVersion: '0.3.1' },
  addOn: { attaches: [{ app: '*', range: '*' }], connect: { kind: 'none' } },
  requiredSchema: { tables: [{ ref: 'items', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'name', type: 'text', maxLength: 80 }, { ref: 'sku', type: 'text', maxLength: 40, nullable: true }, { ref: 'on_hand', type: 'decimal', scale: 2, default: 0 }] }] },
});

const found = (columns: SchemaModelView['tables'][number]['columns']): SchemaModelView => ({ dialect: 'postgres', tables: [{ ref: 'items', columns }] });
const whole = [
  { ref: 'id', logicalType: 'integer', isPrimaryKey: true },
  { ref: 'name', logicalType: 'varchar', maxLength: 80 },
  { ref: 'sku', logicalType: 'varchar', maxLength: 40, nullable: true },
  { ref: 'on_hand', logicalType: 'decimal' },
];
const codes = (manifest: Manifest, model: SchemaModelView) => planInstall(manifest, model).problems.map((problem) => `${problem.code} ${problem.table}.${problem.column ?? ''}`);

describe('a table already there under an add-on\'s name', () => {
  it('that has everything is taken as it is, by either kind of add-on', () => {
    expect(codes(LIKE_APP, found(whole))).toEqual([]);
    expect(codes(BEFORE, found(whole))).toEqual([]);
  });

  it('missing a column it writes is a problem for an add-on that keeps its own tables', () => {
    const short = found(whole.filter((column) => column.ref !== 'on_hand'));
    expect(codes(LIKE_APP, short)).toEqual(['COLUMNS_REQUIRED items.on_hand']);
    expect(planInstall(LIKE_APP, short).installable).toBe(false);
    expect(planInstall(LIKE_APP, short).problems[0]!.message).toContain('which this add-on writes');
    // An add-on from before reads its host's table: what is missing there is its own install's refusal, not the plan's.
    expect(codes(BEFORE, short)).toEqual([]);
  });

  it('that needs a column it never writes is not its table', () => {
    const theirs = found([...whole, { ref: 'warehouse_id', logicalType: 'integer', nullable: false }]);
    expect(codes(LIKE_APP, theirs)).toEqual(['FOREIGN_TABLE items.warehouse_id']);
    expect(codes(BEFORE, theirs)).toEqual([]);
  });

  it('holding another type in one of its columns is a problem', () => {
    const typed = found(whole.map((column) => (column.ref === 'on_hand' ? { ref: 'on_hand', logicalType: 'varchar', maxLength: 20 } : column)));
    expect(codes(LIKE_APP, typed)).toEqual(['COLUMN_TYPE_CONFLICT items.on_hand']);
    expect(codes(BEFORE, typed)).toEqual([]);
  });
});

describe('an add-on\'s role under a context', () => {
  it('fits the slug column, as an app\'s does', () => {
    const long = structuredClone(KIT) as unknown as { roles: { key: string }[] };
    long.roles[0]!.key = 'a-role-whose-name-goes-on-and-on-and-on-for-far-too-long-to-fit-any-slug';
    const manifest = parsed(long);
    const plan = planInstall(manifest, { dialect: 'postgres', tables: [] }, { prefix: 'kit_', records: {}, others: [], dialect: 'postgres' });
    expect(plan.problems.map((problem) => problem.code)).toContain('IDENTIFIER_TOO_LONG');
    expect(planInstall(LIKE_APP, { dialect: 'postgres', tables: [] }, { prefix: 'kit_', records: {}, others: [], dialect: 'postgres' }).problems).toEqual([]);
  });
});
