// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The form designer's edits, without a pointer.
 *
 * A drag is a `moveField`, an arrow key is a `nudgeField`, and both mean the
 * same thing to the document — which is why they are tested here and the drag
 * itself is proven once, in a browser, with a negative control. What this file
 * is really guarding are the two invariants the editor must not break: a column
 * placed twice makes a form whose last input silently wins (and whose document
 * the parser refuses), and a tidy-up that deletes a section must not take its
 * fields with it.
 */
import { describe, expect, it } from 'vitest';
import { deriveFormDocument, type CrudFormConfig, type FormColumnFact } from '@adminium/engine/config';

import {
  addColumnField,
  addRelationField,
  addSection,
  fieldCount,
  fieldsOf,
  isDerived,
  missingFields,
  moveField,
  nudgeField,
  patchDialog,
  patchField,
  patchSection,
  removeField,
  removeSection,
  setPreset,
} from './model.js';

const fact = (name: string, over: Partial<FormColumnFact> = {}): FormColumnFact => ({
  spec: { name, logicalType: 'varchar' },
  ordinal: 1,
  writable: true,
  filledBy: null,
  required: false,
  ...over,
});

const FACTS = {
  columns: [fact('name'), fact('email'), fact('notes', { spec: { name: 'notes', logicalType: 'text' } })],
  relations: [
    { relationId: 'm2m:tags', label: 'Tags', targetTable: 'public.tags', targetKey: 'id' },
  ],
};

const doc = (): CrudFormConfig => deriveFormDocument(FACTS);

describe('moving a field', () => {
  it('moves within a section, reading the target index AFTER the removal', () => {
    const before = doc();
    const names = (config: CrudFormConfig): string[] =>
      fieldsOf(config).map((entry) =>
        'column' in entry.field
          ? entry.field.column
          : 'relation' in entry.field
            ? entry.field.relation
            : 'recap',
      );
    expect(names(before)).toEqual(['name', 'email', 'notes', 'm2m:tags']);
    // "Down one" has to mean down one: taking the field out shifts everything
    // after it up, so a naive splice at the same index would leave it put.
    expect(names(nudgeField(before, { section: 0, index: 0 }, 1))).toEqual([
      'email',
      'name',
      'notes',
      'm2m:tags',
    ]);
    expect(names(moveField(before, { section: 0, index: 3 }, { section: 0, index: 0 }))).toEqual([
      'm2m:tags',
      'name',
      'email',
      'notes',
    ]);
  });

  it('crosses into the next section when there is nowhere left to go', () => {
    const two = addSection(doc());
    const moved = nudgeField(two, { section: 0, index: 3 }, 1);
    expect(moved.sections[0]?.fields).toHaveLength(3);
    expect(moved.sections[1]?.fields).toHaveLength(1);
    // …and stops at the document's own ends rather than dropping the field.
    const stuck = nudgeField(moved, { section: 1, index: 0 }, 1);
    expect(fieldCount(stuck)).toBe(4);
    expect(stuck.sections[1]?.fields).toHaveLength(1);
  });
});

describe('adding and removing', () => {
  it('offers what the document does not name yet, and never the same column twice', () => {
    const one = removeField(doc(), { section: 0, index: 1 });
    const missing = missingFields(one, FACTS);
    expect(missing.columns.map((column) => column.spec.name)).toEqual(['email']);
    expect(missing.relations).toEqual([]);

    const back = addColumnField(one, missing.columns[0] as FormColumnFact);
    expect(fieldCount(back)).toBe(4);
    // A second add is a no-op: two fields writing one value is a document the
    // leaf refuses, and a page that stored one would silently fall back.
    expect(fieldCount(addColumnField(back, missing.columns[0] as FormColumnFact))).toBe(4);
  });

  it('adds a relation as a full-width chips field', () => {
    const without = removeField(doc(), { section: 0, index: 3 });
    const added = addRelationField(without, FACTS.relations[0]!);
    expect(added.sections[0]?.fields.at(-1)).toEqual({
      relation: 'm2m:tags',
      control: 'reference-chips',
      label: 'Tags',
      span: 2,
    });
  });

  it('keeps a removed section’s fields, and refuses to remove the last one', () => {
    const two = addSection(doc());
    const moved = nudgeField(two, { section: 0, index: 3 }, 1);
    const merged = removeSection(moved, 1);
    expect(merged.sections).toHaveLength(1);
    // The four fields are all still there: a tidy-up that deleted six fields
    // would be the worst kind of undo-less mistake.
    expect(fieldCount(merged)).toBe(4);
    expect(removeSection(merged, 0)).toBe(merged);
  });
});

describe('editing a field, a section and the dialog', () => {
  it('drops an emptied optional rather than storing a blank', () => {
    const labelled = patchField(doc(), { section: 0, index: 0 }, { label: 'Full name' });
    expect(labelled.sections[0]?.fields[0]).toMatchObject({ label: 'Full name' });
    // The leaf refuses a blank label, and a stored one would render a nameless
    // field with no way back short of hand-editing JSON.
    const cleared = patchField(labelled, { section: 0, index: 0 }, { label: '' });
    expect(cleared.sections[0]?.fields[0]).not.toHaveProperty('label');
  });

  it('names a section, and empties the name again', () => {
    const named = patchSection(doc(), 0, { label: 'Contact' });
    expect(named.sections[0]?.label).toBe('Contact');
    expect(patchSection(named, 0, { label: '' }).sections[0]).not.toHaveProperty('label');
  });

  it('removes the dialog block once its last override is cleared', () => {
    const titled = patchDialog(doc(), { title: 'New client' });
    expect(titled.dialog).toEqual({ title: 'New client' });
    // Absence is what a page that never overrode anything carries, and the
    // generated words are what absence means.
    expect(patchDialog(titled, { title: '' })).not.toHaveProperty('dialog');
  });
});

describe('is this still the generated form?', () => {
  it('says yes for an untouched draft, and for one dragged there and back', () => {
    const untouched = doc();
    expect(isDerived(untouched, FACTS)).toBe(true);
    const there = nudgeField(untouched, { section: 0, index: 0 }, 1);
    expect(isDerived(there, FACTS)).toBe(false);
    /*
     * …and back. This is what decides whether a save STORES a document: a form
     * nobody really changed must not be frozen into the page, or it stops
     * following the table the day a column is added.
     */
    expect(isDerived(nudgeField(there, { section: 0, index: 1 }, -1), FACTS)).toBe(true);
  });

  it('notices a preset change', () => {
    expect(isDerived(setPreset(doc(), 'wizard'), FACTS)).toBe(false);
  });
});
