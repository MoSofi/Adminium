// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Sequelize parser — attribute and option shapes the Northwind models do not
 * use: the Model.init class form, camelCase timestamps, model-name references,
 * Sequelize.literal defaults and the type expressions that cannot be resolved
 * statically.
 */
import { describe, expect, it } from 'vitest';

import { parseSchemaFile, SchemaImportError } from '../src/index.js';
import { column, relationBetween, table } from './helpers.js';

const parse = (src: string) => parseSchemaFile(src, { format: 'sequelize' });

describe('sequelize — model declaration forms', () => {
  it('reads the Model.init class form and its modelName option', () => {
    const { model, warnings } = parse(`
class Account extends Model {}
Account.init(
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    email: { type: DataTypes.STRING, unique: true },
  },
  { sequelize, modelName: 'account', tableName: 'accounts' },
);

class Session extends Model {}
Session.init(
  {
    id: { type: DataTypes.INTEGER, primaryKey: true },
    accountId: { type: DataTypes.INTEGER, references: { model: 'account', key: 'id' }, onDelete: 'CASCADE' },
  },
  { sequelize, tableName: 'sessions' },
);
`);
    expect(model.tables.map((t) => t.name).sort()).toEqual(['accounts', 'sessions']);
    // STRING with no length argument is varchar(255).
    expect(column(model, 'accounts', 'email').maxLength).toBe(255);
    // `references: { model: 'account' }` names the MODEL, not the table.
    expect(relationBetween(model, 'sessions', 'accounts')?.onDelete).toBe('cascade');
    expect(warnings.some((w) => /has no tableName option/.test(w))).toBe(false);
  });

  it('takes the model name verbatim when tableName is absent, with a warning', () => {
    const { model, warnings } = parse(`
const User = sequelize.define('user', { id: { type: DataTypes.INTEGER, primaryKey: true } });
`);
    expect(model.tables.map((t) => t.name)).toEqual(['user']);
    expect(warnings.some((w) => /model "user" has no tableName option/.test(w))).toBe(true);
  });

  it('synthesizes camelCase timestamps when underscored is off', () => {
    const { model } = parse(`
const Post = sequelize.define(
  'post',
  { id: { type: DataTypes.INTEGER, primaryKey: true } },
  { tableName: 'posts', timestamps: true },
);
`);
    expect(table(model, 'posts').columns.map((c) => c.name)).toEqual([
      'id',
      'createdAt',
      'updatedAt',
    ]);
  });

  it('skips a define() whose name or attributes are not literals', () => {
    const { model, warnings } = parse(`
const A = sequelize.define(modelName, { id: { type: DataTypes.INTEGER, primaryKey: true } }, { tableName: 'a' });
const B = sequelize.define('b', sharedAttributes, { tableName: 'b' });
const C = sequelize.define('c', { id: { type: DataTypes.INTEGER, primaryKey: true } }, { tableName: 'c' });
`);
    expect(model.tables.map((t) => t.name)).toEqual(['c']);
    expect(warnings.some((w) => /non-literal name or attributes skipped/.test(w))).toBe(true);
  });

  it('throws when the file declares no models', () => {
    expect(() => parse('const sequelize = new Sequelize(url); DataTypes.STRING;')).toThrow(
      SchemaImportError,
    );
  });
});

describe('sequelize — attribute options', () => {
  const src = `
const Row = sequelize.define(
  'row',
  {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    token: DataTypes.UUIDV4,
    ratio: { type: DataTypes.DECIMAL, allowNull: true },
    weight: { type: DataTypes.FLOAT(8, 3) },
    live: { type: DataTypes.BOOLEAN, defaultValue: true },
    hits: { type: DataTypes.INTEGER, defaultValue: 0 },
    note: { type: DataTypes.TEXT, defaultValue: null },
    startedAt: { type: DataTypes.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    slugSeed: { type: DataTypes.TEXT, defaultValue: Sequelize.literal('gen_slug()') },
    computed: { type: DataTypes.TEXT, defaultValue: someHelper },
    blank: { type: DataTypes.ENUM },
  },
  { tableName: 'rows', timestamps: false },
);
`;
  const { model } = parse(src);

  it('maps DataTypes.UUIDV4 as both a type and a default', () => {
    expect(column(model, 'rows', 'id').default).toEqual({ kind: 'uuid' });
    expect(column(model, 'rows', 'token').logicalType).toBe('uuid');
  });

  it('leaves precision and scale null when DECIMAL has no arguments', () => {
    const ratio = column(model, 'rows', 'ratio');
    expect(ratio.logicalType).toBe('decimal');
    expect(ratio.numericPrecision).toBeNull();
    expect(ratio.numericScale).toBeNull();
    const weight = column(model, 'rows', 'weight');
    expect(weight.numericPrecision).toBe(8);
    expect(weight.numericScale).toBe(3);
  });

  it('classifies boolean, numeric, null and literal() defaults', () => {
    expect(column(model, 'rows', 'live').default).toEqual({ kind: 'literal', text: 'true' });
    expect(column(model, 'rows', 'hits').default).toEqual({ kind: 'literal', text: '0' });
    expect(column(model, 'rows', 'note').default).toBeNull();
    expect(column(model, 'rows', 'startedAt').default).toEqual({ kind: 'now' });
    expect(column(model, 'rows', 'slugSeed').default).toEqual({
      kind: 'expression',
      text: 'gen_slug()',
    });
    expect(column(model, 'rows', 'computed').default).toEqual({
      kind: 'expression',
      text: 'someHelper',
    });
  });

  it('degrades an argument-less ENUM to text rather than an empty enum', () => {
    expect(column(model, 'rows', 'blank').logicalType).toBe('text');
    expect(model.enums).toHaveLength(0);
  });

  it('warns on type expressions it cannot recognise, in both attribute spellings', () => {
    const { model: m, warnings } = parse(`
const Row = sequelize.define(
  'row',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true },
    shorthand: someExternalType,
    spelled: { type: DataTypes.SOMETHING_NEW },
  },
  { tableName: 'rows', timestamps: false },
);
`);
    expect(table(m, 'rows').columns.map((c) => c.name)).toEqual(['id', 'spelled']);
    expect(column(m, 'rows', 'spelled').logicalType).toBe('unknown');
    expect(warnings.some((w) => /skipped attribute with unrecognized type expression/.test(w))).toBe(
      true,
    );
    expect(warnings.some((w) => /type expression not recognized; mapped to unknown/.test(w))).toBe(
      true,
    );
  });

  it('maps every onDelete/onUpdate spelling on a reference', () => {
    const { model: m } = parse(`
const Parent = sequelize.define('parent', { id: { type: DataTypes.INTEGER, primaryKey: true } }, { tableName: 'parents', timestamps: false });
const A = sequelize.define('a', {
  id: { type: DataTypes.INTEGER, primaryKey: true },
  p: { type: DataTypes.INTEGER, references: { model: 'parents' }, onDelete: 'restrict' },
}, { tableName: 'a', timestamps: false });
const B = sequelize.define('b', {
  id: { type: DataTypes.INTEGER, primaryKey: true },
  p: { type: DataTypes.INTEGER, references: { model: 'parents' }, onDelete: 'SET DEFAULT', onUpdate: 'no action' },
}, { tableName: 'b', timestamps: false });
`);
    expect(relationBetween(m, 'a', 'parents')?.onDelete).toBe('restrict');
    expect(relationBetween(m, 'b', 'parents')?.onDelete).toBe('set-default');
    expect(relationBetween(m, 'b', 'parents')?.onUpdate).toBe('no-action');
  });
});
