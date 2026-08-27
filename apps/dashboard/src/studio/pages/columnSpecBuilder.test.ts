// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The column-spec composition behind the manager's Add affordances: schema
 * DTO → composer inputs, lookup aliasing/labeling, and the projection
 * overrides that keep a lookup column out of sort and forms.
 */
import { gridColumnSpecSchema } from '@adminium/widgets';
import { describe, expect, it } from 'vitest';

import type { SchemaColumn, SchemaTable } from '../api.js';
import {
  addableColumns,
  displayableColumns,
  enumsOf,
  findTable,
  fkColumns,
  inboundLinks,
  lookupAliasFor,
  lookupLabelFor,
  specForLookup,
  specForReverse,
  specForTableColumn,
} from './columnSpecBuilder.js';

const money: SchemaColumn = {
  name: 'amount',
  ordinal: 3,
  logicalType: 'decimal',
  nullable: true,
  semantics: { primary: 'money', format: 'currency', flags: {} },
};

const statusEnum: SchemaColumn = {
  name: 'status',
  ordinal: 5,
  logicalType: 'enum',
  nullable: false,
  enumRef: 'main.invoices.status',
  semantics: { primary: 'status-workflow', format: null, flags: {} },
};

const clientFk: SchemaColumn = {
  name: 'client_id',
  ordinal: 4,
  logicalType: 'integer',
  nullable: true,
  references: { tableId: 'main.clients', column: 'client_id' },
  semantics: { primary: 'fk', format: null, flags: {} },
};

const secret: SchemaColumn = {
  name: 'api_token',
  ordinal: 6,
  logicalType: 'varchar',
  semantics: { primary: 'external-id', format: null, flags: { secret: true } },
};

const table: SchemaTable = {
  id: 'main.invoices',
  schema: 'main',
  name: 'invoices',
  columns: [
    { name: 'invoice_id', ordinal: 1, logicalType: 'integer', isPrimaryKey: true, nullable: false },
    { name: 'title', ordinal: 2, logicalType: 'varchar' },
    money,
    clientFk,
    statusEnum,
    secret,
  ],
  primaryKey: ['invoice_id'],
  rowCountEstimate: null,
};

/** References invoices twice — one visible FK, one secret (must stay hidden). */
const lineItems: SchemaTable = {
  id: 'main.line_items',
  schema: 'main',
  name: 'line_items',
  columns: [
    { name: 'line_id', ordinal: 1, logicalType: 'integer', isPrimaryKey: true, nullable: false },
    {
      name: 'invoice_id',
      ordinal: 2,
      logicalType: 'integer',
      references: { tableId: 'main.invoices', column: 'invoice_id' },
      semantics: { primary: 'fk', format: null, flags: {} },
    },
    {
      name: 'hidden_invoice_ref',
      ordinal: 3,
      logicalType: 'integer',
      references: { tableId: 'main.invoices', column: 'invoice_id' },
      semantics: { primary: 'fk', format: null, flags: { secret: true } },
    },
  ],
  primaryKey: ['line_id'],
  rowCountEstimate: null,
};

const reply = {
  connectionId: 'c1',
  snapshotId: 's1',
  checksum: 'x',
  createdAt: 0,
  source: 'introspection',
  model: {
    tables: [table, lineItems],
    enums: [{ id: 'main.invoices.status', values: ['paid', 'pending', 'overdue'] }],
  },
  appliedOverrides: 0,
};

describe('schema navigation helpers', () => {
  it('finds the source table by qualified id', () => {
    expect(findTable(reply, 'main.invoices')?.name).toBe('invoices');
    expect(findTable(reply, 'main.nope')).toBeNull();
    expect(findTable(undefined, 'main.invoices')).toBeNull();
  });

  it('offers only absent, non-secret columns for re-adding', () => {
    const names = addableColumns(table, new Set(['invoice_id', 'title'])).map((c) => c.name);
    expect(names).toEqual(['amount', 'client_id', 'status']); // no api_token, ordinal order
  });

  it('lists FK entry points and displayable columns without secrets', () => {
    expect(fkColumns(table).map((c) => c.name)).toEqual(['client_id']);
    expect(displayableColumns(table).map((c) => c.name)).not.toContain('api_token');
  });
});

describe('specForTableColumn', () => {
  it('composes the same presentation regeneration would', () => {
    const spec = specForTableColumn(statusEnum, enumsOf(reply));
    expect(spec.name).toBe('status');
    expect(spec.label).toBe('Status');
    expect(spec.enumValues).toEqual(['paid', 'pending', 'overdue']);
    // status-workflow gets the rule-7 tone map, exactly like the generator.
    expect(spec.enumTones).toMatchObject({ paid: 'pos', pending: 'warn', overdue: 'danger' });
    expect(gridColumnSpecSchema.safeParse(spec).success).toBe(true);
  });

  it('keeps FK config so the chip and record-open still work', () => {
    const spec = specForTableColumn(clientFk, enumsOf(reply));
    expect(spec.fk).toEqual({ table: 'main.clients', column: 'client_id' });
  });
});

describe('lookup specs', () => {
  it('aliases are sanitized and deduped against existing names', () => {
    expect(lookupAliasFor(['client_id'], 'name', new Set())).toBe('client_id__name');
    expect(lookupAliasFor(['client_id'], 'name', new Set(['client_id__name']))).toBe(
      'client_id__name_2',
    );
    expect(lookupAliasFor(['weird col'], 'na me', new Set())).toBe('weird_col__na_me');
  });

  it('labels read as "<entity> <column>" off the last hop', () => {
    expect(lookupLabelFor(['client_id'], 'name')).toBe('Client Name');
    expect(lookupLabelFor(['client_id', 'company_id'], 'name')).toBe('Company Name');
  });

  it('marks the spec as a projection: not sortable, never a form field', () => {
    const target: SchemaColumn = {
      name: 'name',
      logicalType: 'varchar',
      nullable: false,
      semantics: { primary: 'person-name', format: null, flags: {} },
    };
    const spec = specForLookup({
      path: ['client_id'],
      target,
      enums: enumsOf(reply),
      taken: new Set(['title']),
    });
    expect(spec).toMatchObject({
      name: 'client_id__name',
      label: 'Client Name',
      lookup: { path: ['client_id'], select: 'name' },
      sortable: false,
      readOnly: true,
      primaryKey: false,
      hidden: false,
      nullable: true,
    });
    expect(gridColumnSpecSchema.safeParse(spec).success).toBe(true);
  });

  it('carries the target column presentation (money renders as money)', () => {
    const spec = specForLookup({
      path: ['client_id'],
      target: money,
      enums: enumsOf(reply),
      taken: new Set(),
    });
    expect(spec.semantic).toBe('money');
    expect(spec.format).toBe('currency');
    expect(spec.align).toBe('end');
  });
});

describe('reverse-link specs', () => {
  it('discovers inbound links, skipping secret FK columns', () => {
    const links = inboundLinks(reply, table);
    expect(links.map((link) => `${link.table.name}.${link.column.name}`)).toEqual([
      'line_items.invoice_id',
    ]);
    expect(inboundLinks(undefined, table)).toEqual([]);
    // Nothing references line_items.
    expect(inboundLinks(reply, lineItems)).toEqual([]);
  });

  it('composes a count projection: integer, not sortable, never a form field', () => {
    const [link] = inboundLinks(reply, table);
    const spec = specForReverse({ link: link as NonNullable<typeof link>, taken: new Set() });
    expect(spec).toMatchObject({
      name: 'line_items__count',
      label: 'Line Items Count',
      logicalType: 'integer',
      reverse: { table: 'main.line_items', fkColumn: 'invoice_id', agg: 'count' },
      sortable: false,
      readOnly: true,
      hidden: false,
      mono: true,
      align: 'end',
    });
    expect(gridColumnSpecSchema.safeParse(spec).success).toBe(true);
  });

  it('dedupes the alias against existing column names', () => {
    const [link] = inboundLinks(reply, table);
    const spec = specForReverse({
      link: link as NonNullable<typeof link>,
      taken: new Set(['line_items__count']),
    });
    expect(spec.name).toBe('line_items__count_2');
  });
});
