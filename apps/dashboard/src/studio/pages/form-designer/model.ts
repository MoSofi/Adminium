// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE FORM DOCUMENT'S EDITS, AS PURE FUNCTIONS.
 *
 * Every change the designer makes — move a field, group fields into a section,
 * change a control, add the column somebody forgot — is one function from a
 * document to a document. Nothing here touches React, the network or the
 * clock, which is what lets the reorder rules be tested without a pointer and
 * the "what would this save?" question be answered without a save.
 *
 * ─── Two invariants the editor cannot be allowed to break ──────────────────
 *
 * 1. **A column appears at most once.** Two fields writing one value is a form
 *    whose last input silently wins, and the leaf's parser REFUSES such a
 *    document — a page that stored one would fall back to the derived form
 *    with no explanation. So `addColumnField` is a no-op for a column already
 *    placed, and the "missing" list below is what offers the rest.
 * 2. **There is always a section, and a field is never dropped.** Removing the
 *    last section is refused; removing any other moves its fields into the one
 *    before it. A designer that could lose work by tidying up is a designer
 *    nobody will tidy up in.
 */

import {
  MAX_FORM_FIELDS,
  MAX_FORM_SECTIONS,
  controlFor,
  deriveFormDocument,
  type CrudFormColumnField,
  type CrudFormConfig,
  type CrudFormRecapField,
  type CrudFormRelationField,
  type CrudFormSection,
  type FormColumnFact,
  type FormPreset,
  type FormRelationFact,
} from '@adminium/engine/config';

/** Where a field sits: which section, and where in it. */
export interface FieldAddress {
  section: number;
  index: number;
}

/**
 * A recap is in here because the designer must not LOSE one.
 *
 * It writes the draft back on save, so a field kind the list filtered out would
 * be deleted by opening the designer and pressing Save — which is the quietest
 * possible data loss. It can be moved and removed like any other row; editing
 * its sentence is not offered yet and is JSON until it is.
 */
export type DesignerField = CrudFormColumnField | CrudFormRelationField | CrudFormRecapField;

/** The key a field is identified by — a column's name, or a relation's id. */
export function fieldKey(field: DesignerField): string {
  if ('column' in field) return `c:${field.column}`;
  if ('relation' in field) return `r:${field.relation}`;
  // A recap names nothing, so its key is its own sentence: two of them are two
  // rows, and the same one twice is a document the parser already refuses.
  return `x:${field.recap.sentence}`;
}

function sectionsWith(document: CrudFormConfig, sections: CrudFormSection[]): CrudFormConfig {
  return { ...document, sections };
}

function replaceSection(
  document: CrudFormConfig,
  index: number,
  change: (section: CrudFormSection) => CrudFormSection,
): CrudFormConfig {
  const section = document.sections[index];
  if (section === undefined) return document;
  return sectionsWith(
    document,
    document.sections.map((candidate, i) => (i === index ? change(section) : candidate)),
  );
}

/** Every field of the document, in reading order, with its address. */
export function fieldsOf(document: CrudFormConfig): { field: DesignerField; at: FieldAddress }[] {
  return document.sections.flatMap((section, sectionIndex) =>
    section.fields.map((field, index) => ({ field, at: { section: sectionIndex, index } })),
  );
}

export function fieldAt(document: CrudFormConfig, at: FieldAddress): DesignerField | undefined {
  return document.sections[at.section]?.fields[at.index];
}

export function fieldCount(document: CrudFormConfig): number {
  return document.sections.reduce((total, section) => total + section.fields.length, 0);
}

/**
 * Move a field, within its section or into another.
 *
 * The target index is read AFTER the field has been taken out, which is what
 * makes "down one" mean down one rather than staying put: removing an earlier
 * field shifts everything after it up by one.
 */
export function moveField(document: CrudFormConfig, from: FieldAddress, to: FieldAddress): CrudFormConfig {
  const field = fieldAt(document, from);
  if (field === undefined) return document;
  const sections = document.sections.map((section, index) =>
    index === from.section ? { ...section, fields: section.fields.filter((_, i) => i !== from.index) } : section,
  );
  const target = sections[to.section];
  if (target === undefined) return document;
  const fields = [...target.fields];
  fields.splice(Math.max(0, Math.min(to.index, fields.length)), 0, field);
  sections[to.section] = { ...target, fields };
  return sectionsWith(document, sections);
}

/** One step up or down, across the section boundary when it has to. */
export function nudgeField(document: CrudFormConfig, at: FieldAddress, by: -1 | 1): CrudFormConfig {
  const section = document.sections[at.section];
  if (section === undefined) return document;
  const next = at.index + by;
  if (next >= 0 && next <= section.fields.length - 1) {
    return moveField(document, at, { section: at.section, index: next });
  }
  // Past the end of a section: the field joins the neighbouring one, which is
  // what a person pressing the arrow again means. At the document's own ends
  // nothing happens.
  const neighbour = at.section + by;
  const into = document.sections[neighbour];
  if (into === undefined) return document;
  return moveField(document, at, { section: neighbour, index: by === 1 ? 0 : into.fields.length });
}

export function removeField(document: CrudFormConfig, at: FieldAddress): CrudFormConfig {
  return replaceSection(document, at.section, (section) => ({
    ...section,
    fields: section.fields.filter((_, index) => index !== at.index),
  }));
}

export function patchField(
  document: CrudFormConfig,
  at: FieldAddress,
  patch: Partial<DesignerField>,
): CrudFormConfig {
  return replaceSection(document, at.section, (section) => ({
    ...section,
    fields: section.fields.map((field, index) => {
      if (index !== at.index) return field;
      const next = { ...field, ...patch } as DesignerField;
      // An emptied optional is an ABSENT key, never `''`: the leaf refuses a
      // blank label, and a stored blank would render a nameless field.
      for (const [key, value] of Object.entries(next)) {
        if (value === '' || value === undefined) delete (next as Record<string, unknown>)[key];
      }
      return next;
    }),
  }));
}

/** The columns and relations the document does not name yet (F17). */
export function missingFields(
  document: CrudFormConfig,
  facts: { columns: readonly FormColumnFact[]; relations?: readonly FormRelationFact[] | undefined },
): { columns: FormColumnFact[]; relations: FormRelationFact[] } {
  const placed = new Set(fieldsOf(document).map((entry) => fieldKey(entry.field)));
  return {
    columns: facts.columns.filter((fact) => {
      if (!fact.writable || placed.has(`c:${fact.spec.name}`)) return false;
      // A projection has nothing on this table to write.
      if (fact.spec.lookup !== undefined || fact.spec.reverse !== undefined || fact.spec.derived !== undefined) {
        return false;
      }
      /*
       * A key or a timestamp something REALLY fills is nobody's business — the
       * derivation drops it for the same reason, and offering it here would put
       * `id` on the notice of every page in the product. A `created_at` that
       * nothing fills is still the person's business and stays offered.
       */
      const serverManaged =
        fact.spec.primaryKey === true ||
        fact.spec.semantic === 'created-at' ||
        fact.spec.semantic === 'updated-at';
      return !(serverManaged && fact.filledBy !== null);
    }),
    relations: (facts.relations ?? []).filter((relation) => !placed.has(`r:${relation.relationId}`)),
  };
}

export function addColumnField(
  document: CrudFormConfig,
  fact: FormColumnFact,
  section = document.sections.length - 1,
): CrudFormConfig {
  if (fieldCount(document) >= MAX_FORM_FIELDS) return document;
  const placed = new Set(fieldsOf(document).map((entry) => fieldKey(entry.field)));
  if (placed.has(`c:${fact.spec.name}`)) return document;
  const field: CrudFormColumnField = {
    column: fact.spec.name,
    control: controlFor(fact.options === undefined ? fact.spec : { ...fact.spec, options: fact.options }),
    ...(fact.required ? { required: true as const } : {}),
  };
  return replaceSection(document, section, (target) => ({ ...target, fields: [...target.fields, field] }));
}

export function addRelationField(
  document: CrudFormConfig,
  relation: FormRelationFact,
  section = document.sections.length - 1,
): CrudFormConfig {
  if (fieldCount(document) >= MAX_FORM_FIELDS) return document;
  const placed = new Set(fieldsOf(document).map((entry) => fieldKey(entry.field)));
  if (placed.has(`r:${relation.relationId}`)) return document;
  const field: CrudFormRelationField = {
    relation: relation.relationId,
    control: 'reference-chips',
    label: relation.label,
    span: 2,
  };
  return replaceSection(document, section, (target) => ({ ...target, fields: [...target.fields, field] }));
}

/**
 * A LINE-ITEMS field over a one-to-many relation.
 *
 * It arrives configured rather than empty: the child's first writable text
 * column, its numbers, and — when there are two of them — a computed total and
 * the comp's three-row block. A repeater added blank would draw an empty table
 * with no columns, which reads as broken rather than as unconfigured, and
 * every designer would have to rebuild the same obvious thing.
 */
export function addChildRowsField(
  document: CrudFormConfig,
  child: { relationId: string; label: string; columns: readonly { spec: Record<string, unknown>; writable: boolean; filledBy: string | null }[] },
  section = document.sections.length - 1,
): CrudFormConfig {
  if (fieldCount(document) >= MAX_FORM_FIELDS) return document;
  const placed = new Set(fieldsOf(document).map((entry) => fieldKey(entry.field)));
  if (placed.has(`r:${child.relationId}`)) return document;

  const offered = child.columns.filter(
    (column) =>
      column.writable &&
      column.filledBy === null &&
      column.spec['primaryKey'] !== true &&
      column.spec['fk'] === undefined,
  );
  const numeric = offered.filter((column) =>
    ['integer', 'bigint', 'decimal', 'float'].includes(String(column.spec['logicalType'])),
  );
  const columns = offered.slice(0, 4).map((column, index) => ({
    column: String(column.spec['name']),
    width: index === 0 ? '1fr' : '96px',
  }));

  const field: CrudFormRelationField = {
    relation: child.relationId,
    control: 'child-rows',
    label: child.label,
    span: 3,
    columns,
    ...(numeric.length >= 2
      ? {
          totals: {
            row: {
              expr: {
                op: 'mul',
                args: [
                  { col: String(numeric[0]?.spec['name']) },
                  { col: String(numeric[1]?.spec['name']) },
                ],
              },
            },
            rows: [{ label: 'Subtotal', of: 'sum' as const }, { label: 'Total', of: 'total' as const }],
          },
        }
      : {}),
  };
  return replaceSection(document, section, (target) => ({ ...target, fields: [...target.fields, field] }));
}

/** A new, empty section at the end. Ids are stable and never re-used. */
export function addSection(document: CrudFormConfig): CrudFormConfig {
  if (document.sections.length >= MAX_FORM_SECTIONS) return document;
  const used = new Set(document.sections.map((section) => section.id));
  let n = document.sections.length + 1;
  while (used.has(`s${String(n)}`)) n += 1;
  return sectionsWith(document, [
    ...document.sections,
    { id: `s${String(n)}`, columns: 2, fields: [] },
  ]);
}

export function patchSection(
  document: CrudFormConfig,
  index: number,
  patch: Partial<CrudFormSection>,
): CrudFormConfig {
  return replaceSection(document, index, (section) => {
    const next = { ...section, ...patch };
    for (const [key, value] of Object.entries(next)) {
      if (value === '' || value === undefined) delete (next as Record<string, unknown>)[key];
    }
    return next;
  });
}

/**
 * Remove a section. Its fields join the section before it (or after it, for the
 * first), because a tidy-up that silently deleted six fields would be the worst
 * kind of undo-less mistake. The last section cannot go.
 */
export function removeSection(document: CrudFormConfig, index: number): CrudFormConfig {
  if (document.sections.length <= 1) return document;
  const section = document.sections[index];
  if (section === undefined) return document;
  const into = index === 0 ? 1 : index - 1;
  const sections = document.sections.map((candidate, i) =>
    i === into ? { ...candidate, fields: [...candidate.fields, ...section.fields] } : candidate,
  );
  return sectionsWith(
    document,
    sections.filter((_, i) => i !== index),
  );
}

export function setPreset(document: CrudFormConfig, preset: FormPreset): CrudFormConfig {
  return { ...document, preset };
}

export function patchDialog(
  document: CrudFormConfig,
  patch: Partial<NonNullable<CrudFormConfig['dialog']>>,
): CrudFormConfig {
  const dialog: Record<string, unknown> = { ...(document.dialog ?? {}), ...patch };
  for (const [key, value] of Object.entries(dialog)) {
    if (value === '' || value === undefined) delete dialog[key];
  }
  if (Object.keys(dialog).length === 0) {
    const { dialog: _dropped, ...rest } = document;
    return rest as CrudFormConfig;
  }
  return { ...document, dialog: dialog as CrudFormConfig['dialog'] };
}

/**
 * Whether this draft says exactly what the DERIVED form says.
 *
 * The answer decides whether a save stores a document at all: a form nobody
 * has really changed must not be frozen into the page, or it stops following
 * the table the day a column is added. Compared as documents rather than by
 * remembering "did they touch anything", because dragging a field down and back
 * up again is not a change.
 */
export function isDerived(document: CrudFormConfig, facts: Parameters<typeof deriveFormDocument>[0]): boolean {
  return JSON.stringify(document) === JSON.stringify(deriveFormDocument(facts));
}
