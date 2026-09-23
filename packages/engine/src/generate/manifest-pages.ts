// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app manifest's `pages`, checked against the manifest's own tables.
 *
 * A manifest declares pages (`page-calendar` over "appointments") and the
 * tables they read (`requiredSchema`). Nothing used to connect the two: a page
 * with no `bindings` installed as an empty layout — a blank rectangle — and a
 * calendar bound to a table with no usable date composed nothing at all. Both
 * were only discoverable by installing the app and looking.
 *
 * This answers it from the manifest alone, with the same `templateFit` the
 * create screen uses, over a model built from `requiredSchema` — so an app's
 * own CI can refuse to publish a page its own tables cannot back, and the
 * install preview can say which pages will arrive unbound.
 *
 * STRUCTURAL INPUT. The engine does not depend on `@adminium/manifest`; the
 * shapes below are the parts of it this reads, which keeps an app repo's gate
 * able to load the engine's `dist/` without the manifest package beside it.
 */

import { getPageTemplateManifest } from '@adminium/widgets/generate';

import { applyClassification } from '../classify/index.js';
import { isTableBoundTemplate } from '../config-schema/table-bound.js';
import { parseDatabaseModel, type DatabaseModel } from '../schema-model.js';
import { templateFit, type TemplateFit } from './fit.js';

export interface ManifestPageInput {
  ref: string;
  template: string;
  /** Page-local name → `requiredSchema` table ref. */
  bindings?: Readonly<Record<string, string>> | undefined;
}

export interface ManifestColumnInput {
  ref: string;
  type: string;
  role?: string | undefined;
  nullable?: boolean | undefined;
  enum?: readonly string[] | undefined;
  references?: string | undefined;
  /** A literal of the column's type, or `now` on a timestamptz. */
  default?: string | number | boolean | undefined;
  /** `text` only: installed as `varchar(maxLength)`. */
  maxLength?: number | undefined;
  /** A `code` rule makes a text column exactly as wide as its codes. */
  rules?: { code?: { prefix?: string | undefined; length: number } | undefined } | undefined;
}

export interface ManifestPagesInput {
  pages?: readonly ManifestPageInput[] | undefined;
  requiredSchema?:
    | { tables: readonly { ref: string; columns: readonly ManifestColumnInput[] }[] }
    | undefined;
}

export type ManifestPageIssueCode =
  /** A table-bound template with no `bindings`: it installs as a blank page. */
  | 'PAGE_UNBOUND'
  /** Several bindings and none keyed `rows`: which table the page reads is a guess. */
  | 'PAGE_BINDING_AMBIGUOUS'
  /** Bound to a table `requiredSchema` does not declare. */
  | 'PAGE_BINDING_UNKNOWN'
  /** A template id no renderer knows. */
  | 'PAGE_TEMPLATE_UNKNOWN'
  /** Bound, but the table cannot back the template (the fit report says why). */
  | 'PAGE_UNFIT';

export interface ManifestPageIssue {
  page: string;
  code: ManifestPageIssueCode;
  message: string;
  table?: string;
  /** For `PAGE_UNFIT`: what the template needs, as data. */
  fit?: TemplateFit;
}

/**
 * Whether any renderer knows this template id — table-bound or not. For a
 * caller that may not import the widget registry itself (the server).
 */
export function isKnownPageTemplate(template: string): boolean {
  return isTableBoundTemplate(template) || getPageTemplateManifest(template) !== undefined;
}

/**
 * The table a table-bound page reads, from its `bindings`.
 *
 * Two conventions are in the fleet and both resolve here: a single entry
 * (`{ orders: 'orders' }`) names its table whatever the key, and several
 * entries use `rows` for the page's own table (`{ rows: 'rooms', … }`) — the
 * key the hotel and factory manifests already write. Null when there is no
 * binding, or several with no `rows`.
 */
export function pageSourceTable(page: ManifestPageInput): string | null {
  const entries = Object.entries(page.bindings ?? {});
  if (entries.length === 0) return null;
  if (entries.length === 1) return entries[0]?.[1] ?? null;
  return page.bindings?.['rows'] ?? null;
}

/** Manifest column type → the engine's logical type, as the installer creates it. */
const LOGICAL: Readonly<Record<string, string>> = {
  id: 'varchar',
  text: 'text',
  int: 'integer',
  bigint: 'bigint',
  decimal: 'decimal',
  money: 'decimal',
  float: 'float',
  bool: 'boolean',
  enum: 'enum',
  json: 'json',
  date: 'date',
  timestamptz: 'timestamptz',
  uuid: 'uuid',
  blob: 'binary',
};

const SCHEMA = 'public';

/**
 * A model of what installing `requiredSchema` creates — the same model the
 * install would introspect, near enough for the rules: types, keys, the
 * foreign keys' targets and an enum's values.
 */
export function modelFromRequiredSchema(manifest: ManifestPagesInput): DatabaseModel {
  const tables = manifest.requiredSchema?.tables ?? [];
  const pkOf = (ref: string): ManifestColumnInput | undefined => {
    const table = tables.find((t) => t.ref === ref);
    return table?.columns.find((c) => c.role === 'pk') ?? table?.columns.find((c) => c.ref === 'id');
  };
  const enums: Record<string, unknown>[] = [];
  const out = tables.map((table) => {
    const pk = pkOf(table.ref);
    return {
      schema: SCHEMA,
      name: table.ref,
      primaryKey: pk === undefined ? [] : [pk.ref],
      columns: table.columns.map((column, index) => {
        const isPk = pk?.ref === column.ref;
        const base: Record<string, unknown> = {
          name: column.ref,
          ordinal: index + 1,
          isPrimaryKey: isPk,
          // NOT NULL unless the manifest says `nullable: true` — the installer's
          // rule. This used to read `?? true` and modelled every undeclared
          // column as optional, which a required-field check never is.
          nullable: isPk ? false : column.nullable === true,
        };
        // What the database fills when an insert leaves the column out: an
        // int key numbers itself, and a declared default is a default.
        if (isPk && (column.type === 'int' || column.type === 'bigint')) {
          base['default'] = { kind: 'autoincrement' };
        } else if (column.default === 'now' && column.type === 'timestamptz') {
          base['default'] = { kind: 'now' };
        } else if (column.default !== undefined) {
          base['default'] = { kind: 'literal', text: String(column.default) };
        }
        if (column.type === 'fk' && column.references !== undefined) {
          const target = pkOf(column.references);
          base['logicalType'] = target === undefined ? 'integer' : (LOGICAL[target.type] ?? 'integer');
          base['references'] = {
            tableId: `${SCHEMA}.${column.references}`,
            column: target?.ref ?? 'id',
          };
          return base;
        }
        base['logicalType'] = LOGICAL[column.type] ?? 'text';
        const code = column.rules?.code;
        if (column.type === 'text' && column.maxLength !== undefined) {
          base['logicalType'] = 'varchar';
          base['maxLength'] = column.maxLength;
        } else if (column.type === 'text' && code !== undefined) {
          // As the installer creates it: a unique varchar as wide as the code.
          base['logicalType'] = 'varchar';
          base['maxLength'] = (code.prefix ?? '').length + code.length;
        }
        if (column.type === 'enum' && column.enum !== undefined) {
          // Exactly what the installer creates (`enumTypeFor` in the server's
          // install-ddl): a CHECK-constrained varchar whose width is 32 when
          // every value fits, else 64 — NOT a native enum. The classifier's
          // workflow rule reads that width, and a check that modelled a
          // friendlier column than the one installed would pass a page the
          // real install then cannot build.
          const id = `${SCHEMA}.${table.ref}.${column.ref}`;
          enums.push({ id, name: column.ref, values: [...column.enum], source: 'check' });
          base['logicalType'] = 'varchar';
          base['maxLength'] = column.enum.every((value) => value.length <= 32) ? 32 : 64;
          base['enumRef'] = id;
        }
        return base;
      }),
    };
  });
  return applyClassification(
    parseDatabaseModel({
      dialect: 'postgres',
      name: 'manifest',
      defaultSchema: SCHEMA,
      schemas: [SCHEMA],
      tables: out,
      enums,
    }),
  );
}

/**
 * Every problem with a manifest's pages, from the manifest alone.
 *
 * Severity is the CALLER's: the installer reports these and still installs
 * (a page that arrives unbound shows the "no table" notice rather than
 * breaking the install of an app already released), while an app's own CI
 * fails on any of them so no new release ships one.
 */
export function checkManifestPages(manifest: ManifestPagesInput): ManifestPageIssue[] {
  const declared = new Set((manifest.requiredSchema?.tables ?? []).map((t) => t.ref));
  const issues: ManifestPageIssue[] = [];
  let model: DatabaseModel | null = null;

  for (const page of manifest.pages ?? []) {
    const bound = isTableBoundTemplate(page.template);
    if (!isKnownPageTemplate(page.template)) {
      issues.push({
        page: page.ref,
        code: 'PAGE_TEMPLATE_UNKNOWN',
        message: `page "${page.ref}" names template "${page.template}", which no renderer knows`,
      });
      continue;
    }
    if (!bound) continue;

    const entries = Object.keys(page.bindings ?? {});
    const table = pageSourceTable(page);
    if (entries.length === 0) {
      issues.push({
        page: page.ref,
        code: 'PAGE_UNBOUND',
        message:
          `page "${page.ref}" (${page.template}) declares no table in \`bindings\`, so it ` +
          'installs as an empty page',
      });
      continue;
    }
    if (table === null) {
      issues.push({
        page: page.ref,
        code: 'PAGE_BINDING_AMBIGUOUS',
        message:
          `page "${page.ref}" binds ${String(entries.length)} tables and none is keyed \`rows\`, ` +
          'so the table it reads is ambiguous',
      });
      continue;
    }
    if (!declared.has(table)) {
      issues.push({
        page: page.ref,
        code: 'PAGE_BINDING_UNKNOWN',
        table,
        message: `page "${page.ref}" is bound to "${table}", which requiredSchema does not declare`,
      });
      continue;
    }

    model ??= modelFromRequiredSchema(manifest);
    const fit = templateFit(model, `${SCHEMA}.${table}`, page.template);
    if (!fit.satisfied) {
      const slots = fit.unfilled.map((s) => s.slot).join(', ');
      issues.push({
        page: page.ref,
        code: 'PAGE_UNFIT',
        table,
        fit,
        message:
          `page "${page.ref}" (${page.template}) cannot be built from "${table}"` +
          (slots === '' ? '' : `: nothing fills its ${slots} area`),
      });
    }
  }
  return issues;
}
