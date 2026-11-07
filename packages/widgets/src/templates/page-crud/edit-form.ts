// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The edit form of a table's row, as both pages that edit one build it: the
 * list (`PageCrud`) and the record page (`PageRecord`). One builder, so the
 * same row edits with the same fields, in the same order, under the same words
 * on both. The record page's dialog was once the flat stack of columns, which
 * showed a designed form's table as raw enum values and type badges.
 */
import { useEffect, useState } from 'react';

import { formDocumentFor, type CrudFormConfig, type FormColumnFact, type FormRelationFact } from '../../page-config/index.js';
import type { GridColumnSpec } from '../../families/tables/column-spec.js';
import type { CrudApi, CrudRow } from './crud-api.js';
import { MAX_CHILD_ROWS, type ChildFacts, type ChildRow } from './RecordForm.js';

/**
 * THE FORM DOCUMENT (D10). A page carries one only when somebody designed a
 * form; with none it is derived from the live column facts, which is what
 * makes the dialog follow the table rather than the day the page was made.
 *
 * With no facts at all (an older server, a page with no source table) there
 * is nothing to derive from: `null`, and the form renders the flat stack of
 * the columns it is given.
 *
 * THE STORED SPEC WINS over the server's freshly-built one, because the
 * derivation stamps a control per column and a control chosen from the wrong
 * spec is frozen into the document before any renderer sees it. What the page
 * knows and the schema does not: an admin bound this page's attachments to a
 * column, which makes it a FILE column for this page and a plain `text` column
 * everywhere else.
 */
export function editFormDocumentOf(
  form: CrudFormConfig | null | undefined,
  formColumns: readonly FormColumnFact[] | undefined,
  formRelations: readonly FormRelationFact[] | undefined,
  columns: readonly GridColumnSpec[],
): CrudFormConfig | null {
  if (formColumns === undefined || formColumns.length === 0) return null;
  const stored = new Map(columns.map((column) => [column.name, column]));
  const merged = formColumns.map((fact) => {
    const own = stored.get(String((fact.spec as { name?: unknown }).name ?? ''));
    return own === undefined ? fact : { ...fact, spec: { ...fact.spec, ...own } };
  });
  return formDocumentFor(form ?? null, {
    columns: merged,
    ...(formRelations === undefined ? {} : { relations: formRelations }),
  });
}

/**
 * The columns the FORM renders, which is not the same list as a grid's: every
 * column of the table, in table order, with the spec the server built from the
 * effective schema. The stored spec wins where there is one: it carries what
 * an admin edited on this page (a label, a file block, an enum tone), which the
 * server's freshly-built spec knows nothing about.
 */
export function editableColumnsOf(
  columns: readonly GridColumnSpec[],
  formColumns: readonly FormColumnFact[] | undefined,
): readonly GridColumnSpec[] {
  if (formColumns === undefined || formColumns.length === 0) return columns;
  const stored = new Map(columns.map((column) => [column.name, column]));
  return formColumns.map((fact) => {
    const specced = fact.spec as unknown as GridColumnSpec;
    return stored.get(specced.name) ?? specced;
  });
}

/**
 * The lines each line-items field already holds, for the row being edited.
 * One read per relation while `record` is set (the dialog is asked for), and
 * none at all for a form with no such field or a host that cannot read
 * related rows.
 *
 * `pending` while the read is out: the form takes its lines once, when it
 * mounts, so a dialog opened before they arrive would show none and keep
 * showing none. The caller holds the dialog until they are in.
 */
export function useEditChildren(
  record: CrudRow | null,
  childFacts: Readonly<Record<string, ChildFacts>> | undefined,
  api: CrudApi,
): { children: Record<string, ChildRow[]> | undefined; pending: boolean } {
  const [read, setRead] = useState<{ record: CrudRow; children: Record<string, ChildRow[]> } | null>(null);
  const readRelated = api.listRelated?.bind(api);
  const wanted = Object.entries(childFacts ?? {});
  const reads = record !== null && readRelated !== undefined && wanted.length > 0;
  useEffect(() => {
    if (!reads || record === null || readRelated === undefined) {
      setRead(null);
      return;
    }
    let alive = true;
    void Promise.all(
      wanted.map(async ([relationId, fact]) => {
        try {
          const rows = await readRelated({
            table: fact.table,
            column: fact.foreignColumn,
            value: record[fact.parentKeyColumn],
            limit: MAX_CHILD_ROWS,
          });
          return [
            relationId,
            rows.map((row) => ({
              key: Object.fromEntries(fact.primaryKey.map((name: string) => [name, row[name]])),
              values: row,
            })),
          ] as const;
        } catch {
          // A table this caller cannot read leaves the field empty rather than
          // the dialog broken; the write path refuses the save anyway.
          return [relationId, []] as const;
        }
      }),
    ).then((entries) => {
      if (alive) setRead({ record, children: Object.fromEntries(entries) });
    });
    return () => {
      alive = false;
    };
    // `wanted` and `readRelated` are made from `childFacts` and `api` on every draw.
  }, [record, childFacts, api]);
  const held = reads && read?.record === record ? read.children : undefined;
  return { children: held, pending: reads && held === undefined };
}
