// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Column-spec composition for the page-column manager — the bridge from the
 * schema reply (`studioApi.getSchema`) to stored `config.columns[]` entries.
 *
 * Re-adding a removed column must produce exactly the spec a regeneration
 * would, so the presentation half (semantic, format, tones, mono, …) comes
 * from the SAME composer the generator uses (`buildColumnDef`,
 * @adminium/widgets/generate) — this module only maps the schema-reply DTO
 * into the composer's structural mirrors and post-shapes lookup columns.
 */

import {
  buildColumnDef,
  humanize,
  type CandidateColumn,
  type ClassifiedColumnInput,
  type GridColumnSpecInput,
} from '@adminium/widgets/generate';

import type { SchemaColumn, SchemaReply, SchemaTable } from '../api.js';

export type EnumValuesById = ReadonlyMap<string, readonly string[]>;

export function enumsOf(reply: SchemaReply | undefined): EnumValuesById {
  return new Map((reply?.model.enums ?? []).map((entry) => [entry.id, entry.values]));
}

/** Resolve the page's qualified source table in the schema reply. */
export function findTable(reply: SchemaReply | undefined, tableId: string | null): SchemaTable | null {
  if (reply === undefined || tableId === null) return null;
  return (
    reply.model.tables.find(
      (table) => table.id === tableId || `${table.schema}.${table.name}` === tableId,
    ) ?? null
  );
}

function isSecret(column: SchemaColumn): boolean {
  return column.semantics?.flags?.secret === true;
}

/** Columns of `table` that can be (re-)added: non-secret, not already present. */
export function addableColumns(table: SchemaTable, present: ReadonlySet<string>): SchemaColumn[] {
  return table.columns
    .filter((column) => !isSecret(column) && !present.has(column.name))
    .sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0));
}

/** Non-secret outbound-FK columns — the entry points of the lookup browser. */
export function fkColumns(table: SchemaTable): SchemaColumn[] {
  return table.columns.filter((column) => !isSecret(column) && column.references != null);
}

/** One inbound link: a non-secret FK column of another table pointing here. */
export interface InboundLink {
  table: SchemaTable;
  column: SchemaColumn;
}

/**
 * Tables whose FKs point AT `table` — the entry points of the reverse-link
 * (aggregate) section. Self-references count (a tree table links to itself);
 * secret FK columns are invisible, mirroring `fkColumns`.
 */
export function inboundLinks(reply: SchemaReply | undefined, table: SchemaTable): InboundLink[] {
  if (reply === undefined) return [];
  const ids = new Set([table.id, `${table.schema}.${table.name}`]);
  const links: InboundLink[] = [];
  for (const candidate of reply.model.tables) {
    for (const column of candidate.columns) {
      if (isSecret(column)) continue;
      const ref = column.references;
      if (ref != null && ids.has(ref.tableId)) links.push({ table: candidate, column });
    }
  }
  return links;
}

/** Non-secret columns offered as a lookup's display value. */
export function displayableColumns(table: SchemaTable): SchemaColumn[] {
  return table.columns.filter((column) => !isSecret(column));
}

function toCandidate(column: SchemaColumn, enums: EnumValuesById): CandidateColumn {
  const enumValues = column.enumRef != null ? enums.get(column.enumRef) : undefined;
  return {
    name: column.name,
    ordinal: column.ordinal,
    logicalType: column.logicalType,
    nullable: column.nullable,
    isPrimaryKey: column.isPrimaryKey,
    isUnique: column.isUnique,
    isGenerated: column.isGenerated,
    defaultKind: column.default?.kind ?? null,
    maxLength: column.maxLength,
    ...(enumValues === undefined ? {} : { enumValues }),
    references: column.references ?? null,
  };
}

function toClassified(column: SchemaColumn): ClassifiedColumnInput {
  return {
    column: column.name,
    semantic: column.semantics?.primary ?? 'plain',
    format: column.semantics?.format ?? null,
    secret: column.semantics?.flags?.secret ?? false,
    pii: column.semantics?.flags?.pii ?? null,
    maskedByDefault: column.semantics?.flags?.maskedByDefault ?? false,
  };
}

/**
 * The spec a regeneration would emit for one of the source table's columns —
 * minus `fk.display` (the FK chip's display column): that stamp needs the
 * REFERENCED table's classifier display-column pick, which the schema reply
 * does not carry. A re-added FK column keeps the chip's raw-value fallback
 * until the next regeneration composes the stamp in.
 */
export function specForTableColumn(
  column: SchemaColumn,
  enums: EnumValuesById,
): GridColumnSpecInput {
  return buildColumnDef(toCandidate(column, enums), toClassified(column));
}

const ALIAS_SAFE = /[^A-Za-z0-9_]+/g;

function sanitizeAliasPart(part: string): string {
  const safe = part.replace(ALIAS_SAFE, '_');
  return /^[A-Za-z_]/.test(safe) ? safe : `_${safe}`;
}

/**
 * Row-key alias for a lookup column — `client_id__name`, deduped against the
 * page's existing column names (the server refuses colliding aliases, and two
 * lookups may share a target name).
 */
export function lookupAliasFor(
  path: readonly string[],
  select: string,
  taken: ReadonlySet<string>,
): string {
  const base = [...path, select].map(sanitizeAliasPart).join('__').slice(0, 56) || 'lookup';
  if (!taken.has(base)) return base;
  for (let i = 2; ; i += 1) {
    const candidate = `${base}_${String(i)}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** `client_id` → `Client`; `customerId` → `Customer`; bare names pass through. */
function stripIdSuffix(fkColumn: string): string {
  const stripped = fkColumn.replace(/_?[iI][dD]$/, '');
  return stripped.length > 0 ? stripped : fkColumn;
}

/** Header text for a lookup — `client_id` + `name` → "Client Name". */
export function lookupLabelFor(path: readonly string[], select: string): string {
  const lastHop = path.at(-1) ?? '';
  return `${humanize(stripIdSuffix(lastHop))} ${humanize(select)}`.trim();
}

export interface ReverseSpecInput {
  /** The inbound link to aggregate over. */
  link: InboundLink;
  /** Current column names on the page — alias collision guard. */
  taken: ReadonlySet<string>;
}

/**
 * A stored reverse-link (count) column spec: a synthetic integer projection
 * over the rows of `link.table` whose `link.column` points at each record —
 * never sortable (the alias is not a base column the server could ORDER BY),
 * never a form field. Composed as a literal rather than through
 * `buildColumnDef`: there is no source column to derive presentation from,
 * a count IS its own presentation.
 */
export function specForReverse(input: ReverseSpecInput): GridColumnSpecInput {
  const { link, taken } = input;
  const alias = lookupAliasFor([link.table.name], 'count', taken);
  return {
    name: alias,
    label: `${humanize(link.table.name)} Count`,
    logicalType: 'integer',
    semantic: null,
    format: null,
    reverse: { table: link.table.id, fkColumn: link.column.name, agg: 'count' },
    pii: false,
    mono: true,
    align: 'end',
    sortable: false,
    hidden: false,
    primaryKey: false,
    nullable: true,
    hasDefault: false,
    unique: false,
    readOnly: true,
    maxLength: null,
    isDisplay: false,
  };
}

export interface LookupSpecInput {
  /** FK column chain from the page's source table (≥ 1 hop). */
  path: readonly string[];
  /** The chosen column of the final referenced table. */
  target: SchemaColumn;
  enums: EnumValuesById;
  /** Current column names on the page — alias collision guard. */
  taken: ReadonlySet<string>;
}

/**
 * A stored lookup-column spec: the target column's presentation (from the
 * shared composer) under a synthetic alias, marked as a projection — never
 * sortable (the alias is not a base column the server could ORDER BY), never
 * a form field, carrying none of the source table's form facts.
 */
export function specForLookup(input: LookupSpecInput): GridColumnSpecInput {
  const base = specForTableColumn(input.target, input.enums);
  const spec: GridColumnSpecInput = {
    ...base,
    name: lookupAliasFor(input.path, input.target.name, input.taken),
    label: lookupLabelFor(input.path, input.target.name),
    lookup: { path: [...input.path], select: input.target.name },
    sortable: false,
    hidden: false,
    readOnly: true,
    primaryKey: false,
    unique: false,
    hasDefault: false,
    nullable: true,
    isDisplay: false,
  };
  return spec;
}
