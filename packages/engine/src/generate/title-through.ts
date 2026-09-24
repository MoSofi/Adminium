// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Remedy 2 — a calendar on the RELATED table, titled through the foreign key.
 *
 * The case: the operator picks `patients` for a calendar. Patients have no
 * date; their appointments do, one FK hop away. The answer that needs nobody
 * to author anything is a calendar over `appointments`, each event titled with
 * the patient's name — the FK already declares the join, so there is no join
 * key to pick and no projection to choose. That is the whole reason this is the
 * foolproof form of "combine two tables" and a view is not (D1): a view would
 * be authored, and it would compose read-only.
 *
 * ─── How the title gets there ─────────────────────────────────────────────
 *
 * The candidate rules know nothing about lookups, and should not have to. So
 * the related table is shown to them with ONE extra, virtual column — the
 * lookup's alias — and told that column is its display column. The calendar
 * rule then composes exactly as it would for a table with a real title, and
 * the envelope is rewritten afterwards: the alias leaves every binding's
 * `select` and arrives as a `lookups` entry, the server's
 * `alias:fk.targetColumn` grammar, resolved and permission-checked there.
 *
 * ─── Why the calendar item carries a pick-list ────────────────────────────
 *
 * The calendar's "Add event" writes its typed text into `titleColumn`. Here
 * that is not a column — it is the patient's name, and typing a name cannot
 * create a patient. So the calendar item is told where the title comes from
 * (`titleLookup`) and handed a second query (`choicesBinding`) listing the
 * patients, and the composer becomes a choice: pick the patient, and the new
 * row is written with that patient's key. The page stays writable, which is
 * what separates this remedy from a view.
 *
 * Calendar only. It is the template whose title is its whole face, and the
 * one the plan scoped this remedy to.
 */

import { buildCandidateView } from '@adminium/widgets/generate';
import type { CandidateTableInput } from '@adminium/widgets/generate';
import type { QueryDescriptor } from '@adminium/widgets/page-config';

/** The templates this remedy applies to. */
export const TITLE_THROUGH_TEMPLATES: readonly string[] = ['page-calendar'];

/** How many rows the composer's pick-list offers. */
const CHOICES_LIMIT = 500;

/** Where a title comes from when it is not a column of the bound table. */
export interface TitleLookup {
  /** The FK column on the bound table — what "Add event" writes. */
  column: string;
  /** The referenced table's id. */
  table: string;
  /** The referenced column (its key). */
  keyColumn: string;
  /** The referenced table's display column — what the event shows. */
  labelColumn: string;
}

export interface TitleThrough {
  /** The row key the title arrives under. */
  alias: string;
  /** `alias:fk.labelColumn` — the server's lookup grammar. */
  spec: string;
  lookup: TitleLookup;
  /** The pick-list query: the referenced table's keys and labels. */
  choices: QueryDescriptor;
  /** The bound table as the candidate rules should see it. */
  entry: CandidateTableInput;
}

/**
 * Prepare `entry` to be titled through its FK column `fkColumn`, or say why
 * it cannot be. The title is the referenced table's display column, or the
 * column `labelColumn` names (an app's calendar says `patient_id.name`).
 */
export function titleThroughEntry(
  entry: CandidateTableInput,
  candidateModel: readonly CandidateTableInput[],
  fkColumn: string,
  connectionId: string,
  labelColumn?: string,
): TitleThrough | { reason: string } {
  const column = entry.table.columns.find((c) => c.name === fkColumn);
  const ref = column?.references ?? null;
  if (column === undefined || ref === null) {
    return { reason: `column ${fkColumn} of ${entry.table.id} is not a foreign key` };
  }
  if (ref.tableId === entry.table.id) {
    return { reason: `column ${fkColumn} points back at ${entry.table.id} itself` };
  }
  const target = candidateModel.find((e) => e.table.id === ref.tableId);
  if (labelColumn !== undefined && target?.table.columns.some((c) => c.name === labelColumn) !== true) {
    return { reason: `the table ${ref.tableId} has no column ${labelColumn}` };
  }
  const label = labelColumn ?? target?.classified.displayColumn ?? null;
  if (target === undefined || label === null || label === undefined) {
    return { reason: `the table ${ref.tableId} has no column to use as a title` };
  }

  const taken = new Set(entry.table.columns.map((c) => c.name));
  const alias = [`${fkColumn}__display`, `${fkColumn}__title`].find((a) => !taken.has(a));
  if (alias === undefined) {
    return { reason: `the names Adminium would give the title are taken on ${entry.table.id}` };
  }

  const targetView = buildCandidateView(target.table, target.classified);
  return {
    alias,
    spec: `${alias}:${fkColumn}.${label}`,
    lookup: { column: fkColumn, table: target.table.id, keyColumn: ref.column, labelColumn: label },
    choices: {
      kind: 'table-query',
      connectionId,
      source: targetView.source,
      shape: 'record-list',
      select: [ref.column, label],
      orderBy: [{ column: label, dir: 'asc' }],
      limit: CHOICES_LIMIT,
    },
    entry: {
      // Generated, so no composer ever offers it as a form field.
      table: {
        ...entry.table,
        columns: [
          ...entry.table.columns,
          { name: alias, logicalType: 'text', nullable: true, isGenerated: true },
        ],
      },
      classified: {
        ...entry.classified,
        displayColumn: alias,
        columns: [...entry.classified.columns, { column: alias, semantic: 'plain' }],
      },
    },
  };
}

/** Every column name a descriptor reads, outside `select`. */
function columnsReadOutsideSelect(d: QueryDescriptor): string[] {
  return [
    ...(d.groupBy ?? []),
    ...(d.orderBy ?? []).map((o) => o.column),
    ...(d.filters ?? []).map((f) => f.column),
    ...(d.aggregations ?? []).flatMap((a) => (a.column === undefined ? [] : [a.column])),
    ...(d.bucket === undefined ? [] : [d.bucket.column]),
    ...(d.window === undefined ? [] : [d.window.column]),
  ];
}

/**
 * Rewrite a composed envelope so the virtual title column becomes a lookup.
 *
 * An item whose binding reads the alias anywhere but `select` — grouped by it,
 * sorted by it, counted — is DROPPED rather than kept: a lookup is a projected
 * value, and the server cannot group or sort by it. Only optional items can
 * reach that branch; the calendar itself reads the title through `select`.
 */
export function applyTitleThrough(
  envelope: Record<string, unknown>,
  through: TitleThrough,
): Record<string, unknown> {
  const config = envelope['config'] as Record<string, unknown>;
  const layout = config['layout'] as { items: { i: string; widget: string; config: Record<string, unknown> }[] };
  const items = [];
  for (const item of layout.items) {
    const binding = item.config['binding'] as QueryDescriptor | undefined;
    if (binding !== undefined && columnsReadOutsideSelect(binding).includes(through.alias)) continue;
    const nextConfig: Record<string, unknown> = { ...item.config };
    if (binding !== undefined && (binding.select ?? []).includes(through.alias)) {
      nextConfig['binding'] = {
        ...binding,
        select: (binding.select ?? []).filter((c) => c !== through.alias),
        lookups: [...(binding.lookups ?? []), through.spec],
      };
    }
    if (item.widget === 'calendar-month') {
      nextConfig['titleLookup'] = through.lookup;
      nextConfig['choicesBinding'] = through.choices;
    }
    items.push({ ...item, config: nextConfig });
  }
  return { ...envelope, config: { ...config, layout: { ...layout, items } } };
}
