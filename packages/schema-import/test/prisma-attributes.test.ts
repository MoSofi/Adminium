// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Prisma parser — providers, native-type refinements, block attributes and
 * default forms the Northwind schema does not use, plus the field shapes that
 * must be skipped with a warning rather than invented.
 */
import { describe, expect, it } from 'vitest';

import { parseSchemaFile } from '../src/index.js';
import { column, relationBetween, table } from './helpers.js';

const parse = (src: string) => parseSchemaFile(src, { format: 'prisma' });
const withProvider = (provider: string): string =>
  `datasource db {\n  provider = "${provider}"\n  url      = env("DATABASE_URL")\n}\n\n` +
  'model Thing {\n  id Int @id\n}\n';

describe('prisma — datasource providers', () => {
  it('maps mysql and sqlite, and warns for anything else', () => {
    expect(parse(withProvider('mysql')).model.dialect).toBe('mysql');
    expect(parse(withProvider('sqlite')).model.dialect).toBe('sqlite');
    expect(parse(withProvider('cockroachdb')).model.dialect).toBe('postgres');
    const other = parse(withProvider('sqlserver'));
    expect(other.model.dialect).toBe('generic');
    expect(other.warnings.some((w) => /provider "sqlserver" mapped to generic/.test(w))).toBe(true);
  });
});

describe('prisma — column shapes', () => {
  const src = `
generator client {
  provider = "prisma-client-js"
}

/// A widget in the catalogue.
model Widget {
  id          Int      @id @default(autoincrement())
  code        String   @unique @db.Char(8)
  title       String   @db.VarChar(120)
  body        String   @db.Text
  ref         String   @db.Uuid
  seenAt      DateTime @db.Timestamptz
  bornOn      DateTime @db.Date
  price       Decimal  @db.Money
  payload     Json     @db.JsonB
  sizes       Int[]
  slugSeed    String   @default(cuid())
  externalRef String   @default(dbgenerated("gen_random_uuid()"))
  kind        Kind     @default(BASIC)
  tagList     String   @default("[]")
  weights     Float[]  @default([1.5, 2.5])
  legacy      Unsupported("point")
  binary      Bytes
  ghost       SomeExternalType
  ghosts      SomeExternalType[]

  @@unique([code, title])
  @@index([title])
  @@fulltext([body])
  @@map("widgets")
}

enum Kind {
  BASIC
  PREMIUM @map("premium")
}
`;
  const { model, warnings } = parse(src);

  it('honours @@map and the /// doc comment', () => {
    expect(model.tables.map((t) => t.name)).toEqual(['widgets']);
    expect(table(model, 'widgets').comment).toBe('A widget in the catalogue.');
  });

  it('applies every @db.* refinement it models', () => {
    expect(column(model, 'widgets', 'code').logicalType).toBe('varchar');
    expect(column(model, 'widgets', 'code').maxLength).toBe(8);
    expect(column(model, 'widgets', 'title').maxLength).toBe(120);
    expect(column(model, 'widgets', 'body').logicalType).toBe('text');
    expect(column(model, 'widgets', 'ref').logicalType).toBe('uuid');
    expect(column(model, 'widgets', 'seenAt').logicalType).toBe('timestamptz');
    expect(column(model, 'widgets', 'bornOn').logicalType).toBe('date');
    expect(column(model, 'widgets', 'price').logicalType).toBe('decimal');
    expect(column(model, 'widgets', 'payload').logicalType).toBe('json');
  });

  it('marks list scalars as arrays', () => {
    expect(column(model, 'widgets', 'sizes').isArray).toBe(true);
    expect(column(model, 'widgets', 'weights').isArray).toBe(true);
  });

  it('classifies the remaining @default forms', () => {
    expect(column(model, 'widgets', 'slugSeed').default).toEqual({
      kind: 'expression',
      text: 'cuid()',
    });
    expect(column(model, 'widgets', 'externalRef').default).toEqual({
      kind: 'expression',
      text: 'gen_random_uuid()',
    });
    expect(column(model, 'widgets', 'kind').default).toEqual({ kind: 'literal', text: 'BASIC' });
    expect(column(model, 'widgets', 'tagList').default).toEqual({ kind: 'literal', text: '[]' });
    expect(column(model, 'widgets', 'weights').default).toEqual({
      kind: 'expression',
      text: '[1.5, 2.5]',
    });
  });

  it('reads an enum block, including @map on a member', () => {
    const kind = column(model, 'widgets', 'kind');
    expect(kind.logicalType).toBe('enum');
    expect(model.enums.find((e) => e.id === kind.enumRef)?.values).toEqual(['BASIC', 'premium']);
  });

  it('keeps an Unsupported() column as unknown and drops fields of unknown types', () => {
    expect(column(model, 'widgets', 'legacy').logicalType).toBe('unknown');
    expect(column(model, 'widgets', 'binary').logicalType).toBe('binary');
    expect(table(model, 'widgets').columns.map((c) => c.name)).not.toContain('ghost');
    expect(warnings.some((w) => /"Widget.legacy" has Unsupported\(\) type/.test(w))).toBe(true);
    expect(warnings.some((w) => /"Widget.ghost" of unknown type SomeExternalType skipped/.test(w))).toBe(
      true,
    );
    expect(warnings.some((w) => /"Widget.ghosts" of type SomeExternalType\[\] skipped/.test(w))).toBe(
      true,
    );
  });

  it('reads @@unique and @@index, and warns once for an unmodelled block attribute', () => {
    const widgets = table(model, 'widgets');
    expect(widgets.uniques.some((u) => u.columns.join(',') === 'code,title')).toBe(true);
    expect(widgets.indexes.map((i) => i.name)).toEqual(['widgets_title_idx']);
    expect(warnings.some((w) => /ignored @@fulltext attribute/.test(w))).toBe(true);
  });
});

describe('prisma — relations', () => {
  it('remaps @@id / @@unique / relation fields through @map column names', () => {
    const { model } = parse(`
model Order {
  orderNumber Int    @map("order_no")
  siteId      Int    @map("site_id")
  customerId  Int    @map("customer_id")
  customer    Customer @relation(fields: [customerId], references: [id], onDelete: Cascade)

  @@id([orderNumber, siteId])
  @@unique([siteId, customerId])
}

model Customer {
  id     Int     @id
  orders Order[]
}
`);
    expect(table(model, 'Order').primaryKey).toEqual(['order_no', 'site_id']);
    expect(table(model, 'Order').uniques).toEqual([
      { name: null, columns: ['site_id', 'customer_id'] },
    ]);
    expect(column(model, 'Order', 'customer_id').references).toEqual({
      tableId: 'public.Customer',
      column: 'id',
    });
    expect(relationBetween(model, 'Order', 'Customer')?.onDelete).toBe('cascade');
  });

  it('emits a composite relation when the FK spans several columns', () => {
    const { model } = parse(`
model Line {
  id        Int  @id
  orderNo   Int
  siteId    Int
  order     Order @relation(fields: [orderNo, siteId], references: [orderNumber, siteId], onDelete: Restrict)
}

model Order {
  orderNumber Int
  siteId      Int
  lines       Line[]

  @@id([orderNumber, siteId])
}
`);
    const rel = relationBetween(model, 'Line', 'Order');
    expect(rel?.from.columns).toEqual(['orderNo', 'siteId']);
    expect(rel?.to.columns).toEqual(['orderNumber', 'siteId']);
    expect(rel?.onDelete).toBe('restrict');
  });

  it('ignores // comments and stray lines inside a model block', () => {
    const { model } = parse(`
model Thing {
  // the primary key
  id    Int    @id
  label String

  @@map("things")
}
`);
    expect(table(model, 'things').columns.map((c) => c.name)).toEqual(['id', 'label']);
  });
});
