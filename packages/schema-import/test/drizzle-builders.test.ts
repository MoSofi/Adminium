// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Drizzle parser — builder chains and extras the Northwind schema does not
 * use: mysqlEnum, identity/generated modifiers, sql`` defaults, the app-level
 * `$default` family, sqlite tables, and the unresolvable shapes that must warn
 * rather than throw.
 */
import { describe, expect, it } from 'vitest';

import { parseSchemaFile, SchemaImportError } from '../src/index.js';
import { column, relationBetween, table } from './helpers.js';

const parse = (src: string) => parseSchemaFile(src, { format: 'drizzle' });

describe('drizzle — column builders', () => {
  it('reads sql`` defaults as now/uuid/expression', () => {
    const { model } = parse(`
const events = pgTable('events', {
  id: uuid('id').primaryKey().default(sql\`gen_random_uuid()\`),
  createdAt: timestamp('created_at').default(sql\`CURRENT_TIMESTAMP\`),
  seq: integer('seq').default(sql\`nextval('events_seq')\`),
  live: boolean('live').default(true),
  label: text('label').default('none'),
});
`);
    expect(column(model, 'events', 'id').default).toEqual({ kind: 'uuid' });
    expect(column(model, 'events', 'created_at').default).toEqual({ kind: 'now' });
    expect(column(model, 'events', 'seq').default).toEqual({
      kind: 'expression',
      text: "nextval('events_seq')",
    });
    expect(column(model, 'events', 'live').default).toEqual({ kind: 'literal', text: 'true' });
    expect(column(model, 'events', 'label').default).toEqual({ kind: 'literal', text: 'none' });
  });

  it('ignores application-level defaults that never reach the database', () => {
    const { model } = parse(`
const events = pgTable('events', {
  id: uuid('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  slug: text('slug').$default(() => nanoid()),
  touchedAt: timestamp('touched_at').$onUpdate(() => new Date()),
  seenAt: timestamp('seen_at').$onUpdateFn(() => new Date()),
  tag: text('tag').$type<Tag>(),
});
`);
    for (const name of ['id', 'slug', 'touched_at', 'seen_at', 'tag']) {
      expect(column(model, 'events', name).default).toBeNull();
    }
  });

  it('reads identity, generated and array modifiers', () => {
    const { model } = parse(`
const rows = pgTable('rows', {
  id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
  seq: integer('seq').generatedByDefaultAsIdentity(),
  labels: text('labels').array(),
  slugCopy: text('slug_copy').generatedAlwaysAs(sql\`lower(slug)\`),
  slug: text('slug'),
});
`);
    expect(column(model, 'rows', 'id').default).toEqual({ kind: 'autoincrement' });
    expect(column(model, 'rows', 'seq').default).toEqual({ kind: 'autoincrement' });
    expect(column(model, 'rows', 'labels').isArray).toBe(true);
    expect(column(model, 'rows', 'slug_copy').isGenerated).toBe(true);
  });

  it('reads mysqlEnum values inline and honours sqlite autoIncrement primary keys', () => {
    const { model: mysql } = parse(`
const jobs = mysqlTable('jobs', {
  id: int('id').primaryKey(),
  state: mysqlEnum('state', ['queued', 'running', 'done']).notNull(),
});
`);
    const state = column(mysql, 'jobs', 'state');
    expect(state.logicalType).toBe('enum');
    expect(mysql.enums.find((e) => e.id === state.enumRef)?.values).toEqual([
      'queued',
      'running',
      'done',
    ]);

    const { model: sqlite } = parse(`
const notes = sqliteTable('notes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  body: text('body').notNull(),
});
`);
    expect(sqlite.dialect).toBe('sqlite');
    expect(column(sqlite, 'notes', 'id').default).toEqual({ kind: 'autoincrement' });
  });

  it('falls back to the property key when the builder has no explicit db name', () => {
    const { model } = parse(`
const rows = pgTable('rows', {
  id: serial().primaryKey(),
  createdAt: timestamp(),
});
`);
    expect(table(model, 'rows').columns.map((c) => c.name)).toEqual(['id', 'createdAt']);
  });

  it('warns once per unknown builder and unknown modifier, keeping the column', () => {
    const { model, warnings } = parse(`
const rows = pgTable('rows', {
  id: serial('id').primaryKey(),
  loc: geography('loc', { type: 'point' }),
  note: text('note').unknownModifier(),
});
`);
    expect(column(model, 'rows', 'loc').logicalType).toBe('unknown');
    expect(column(model, 'rows', 'loc').dbType).toBe('geography');
    expect(warnings.some((w) => /unknown drizzle column builder "geography"/.test(w))).toBe(true);
    expect(warnings.some((w) => /ignored drizzle modifier \.unknownModifier\(\)/.test(w))).toBe(true);
  });

  it('warns and drops an entry whose value is not a builder call', () => {
    const { model, warnings } = parse(`
const rows = pgTable('rows', {
  id: serial('id').primaryKey(),
  copied: otherTable.id,
});
`);
    expect(table(model, 'rows').columns.map((c) => c.name)).toEqual(['id']);
    expect(warnings.some((w) => /"rows"\."copied" is not a builder call/.test(w))).toBe(true);
  });
});

describe('drizzle — references and extras', () => {
  it('maps every onDelete/onUpdate spelling', () => {
    const { model } = parse(`
const users = pgTable('users', { id: serial('id').primaryKey() });
const a = pgTable('a', { id: serial('id').primaryKey(), u: integer('u').references(() => users.id, { onDelete: 'restrict' }) });
const b = pgTable('b', { id: serial('id').primaryKey(), u: integer('u').references(() => users.id, { onDelete: 'set default' }) });
const c = pgTable('c', { id: serial('id').primaryKey(), u: integer('u').references(() => users.id, { onDelete: 'no action', onUpdate: 'cascade' }) });
const d = pgTable('d', { id: serial('id').primaryKey(), u: integer('u').references(() => users.id, { onDelete: 'nonsense' }) });
`);
    expect(relationBetween(model, 'a', 'users')?.onDelete).toBe('restrict');
    expect(relationBetween(model, 'b', 'users')?.onDelete).toBe('set-default');
    expect(relationBetween(model, 'c', 'users')?.onDelete).toBe('no-action');
    expect(relationBetween(model, 'c', 'users')?.onUpdate).toBe('cascade');
    expect(relationBetween(model, 'd', 'users')?.onDelete).toBeNull();
  });

  it('warns when .references() points at a table variable that is not declared', () => {
    const { model, warnings } = parse(`
const posts = pgTable('posts', {
  id: serial('id').primaryKey(),
  authorId: integer('author_id').references(() => usersFromAnotherFile.id),
});
`);
    expect(column(model, 'posts', 'author_id').references).toBeNull();
    expect(warnings.some((w) => /unknown table variable "usersFromAnotherFile"/.test(w))).toBe(true);
  });

  it('warns when the .references() argument is not an arrow to a column', () => {
    const { warnings } = parse(`
const posts = pgTable('posts', {
  id: serial('id').primaryKey(),
  authorId: integer('author_id').references(fkTarget),
});
`);
    expect(warnings.some((w) => /could not resolve \.references\(\) target/.test(w))).toBe(true);
  });

  it('reads unique()/index() extras chained through .on()', () => {
    const { model } = parse(`
const members = pgTable('members', {
  id: serial('id').primaryKey(),
  orgId: integer('org_id').notNull(),
  email: text('email').notNull(),
}, (t) => [
  unique('uq_members_org_email').on(t.orgId, t.email),
  index('idx_members_email').on(t.email),
]);
`);
    const members = table(model, 'members');
    expect(members.uniques).toEqual([
      { name: 'uq_members_org_email', columns: ['org_id', 'email'] },
    ]);
    expect(members.indexes.find((i) => i.name === 'idx_members_email')?.columns).toEqual(['email']);
  });

  it('names an anonymous index() after its table and columns', () => {
    const { model } = parse(`
const members = pgTable('members', {
  id: serial('id').primaryKey(),
  email: text('email').notNull(),
}, (t) => ({ byEmail: index().on(t.email) }));
`);
    expect(table(model, 'members').indexes.map((i) => i.name)).toEqual(['members_email_idx']);
  });

  it('warns that a composite foreignKey() in extras is not resolved', () => {
    const { warnings } = parse(`
const lines = pgTable('lines', {
  orderId: integer('order_id').notNull(),
  sku: text('sku').notNull(),
}, (t) => [
  primaryKey({ columns: [t.orderId, t.sku] }),
  foreignKey({ columns: [t.orderId], foreignColumns: [orders.id] }),
]);
`);
    expect(warnings.some((w) => /composite foreignKey\(\) in extras not resolved/.test(w))).toBe(
      true,
    );
  });

  it('skips a table whose column map is not an object literal', () => {
    const { model, warnings } = parse(`
const shared = pgTable('shared', sharedColumns);
const ok = pgTable('ok', { id: serial('id').primaryKey() });
`);
    expect(model.tables.map((t) => t.name)).toEqual(['ok']);
    expect(warnings.some((w) => /"shared" has a non-literal column map/.test(w))).toBe(true);
  });

  it('ignores a spread in the column map and keeps the explicit columns', () => {
    const { model } = parse(`
const rows = pgTable('rows', {
  ...timestamps,
  id: serial('id').primaryKey(),
  label: text('label'),
});
`);
    expect(table(model, 'rows').columns.map((c) => c.name)).toEqual(['id', 'label']);
  });

  it('records precision only for numeric column types, and scale only when given', () => {
    const { model } = parse(`
const rows = pgTable('rows', {
  id: serial('id').primaryKey(),
  ratio: numeric('ratio', { precision: 10 }),
  exact: numeric('exact', { precision: 10, scale: 4 }),
  code: varchar('code', { length: 12, precision: 10 }),
});
`);
    expect(column(model, 'rows', 'ratio').numericPrecision).toBe(10);
    expect(column(model, 'rows', 'ratio').numericScale).toBeNull();
    expect(column(model, 'rows', 'exact').numericScale).toBe(4);
    expect(column(model, 'rows', 'code').numericPrecision).toBeNull();
    expect(column(model, 'rows', 'code').maxLength).toBe(12);
  });

  it('keeps a bare identifier default as an expression and ignores .onUpdateNow()', () => {
    const { model } = parse(`
const rows = mysqlTable('rows', {
  id: int('id').primaryKey(),
  seed: text('seed').default(DEFAULT_SEED),
  touchedAt: timestamp('touched_at').defaultNow().onUpdateNow(),
});
`);
    expect(column(model, 'rows', 'seed').default).toEqual({
      kind: 'expression',
      text: 'DEFAULT_SEED',
    });
    expect(column(model, 'rows', 'touched_at').default).toEqual({ kind: 'now' });
  });

  it('names a pgEnum after its variable when the enum name is not a literal', () => {
    const { model } = parse(`
const statusEnum = pgEnum(STATUS_NAME, ['open', 'closed']);
const rows = pgTable('rows', {
  id: serial('id').primaryKey(),
  status: statusEnum('status').notNull(),
});
`);
    const status = column(model, 'rows', 'status');
    expect(status.logicalType).toBe('enum');
    expect(model.enums.find((e) => e.id === status.enumRef)?.values).toEqual(['open', 'closed']);
  });

  it('throws when the file declares no drizzle tables at all', () => {
    expect(() => parse("export const helper = () => 'nothing here';")).toThrow(SchemaImportError);
  });
});
