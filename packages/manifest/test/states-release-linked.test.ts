// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A void invoice's line letting go of what it billed (`release`), and the
 * time a line bills kept as billed (`lockLinked`): what the manifest takes,
 * what it refuses, and what an app may add to the invoice shape.
 */
import { describe, expect, it } from 'vitest';

import { shapeConformanceIssues, shapeKey, type ShapeDefinitionView } from '../src/index.js';
import { addOnManifest, issuesText, tableOf, valid, type Doc } from './invoicing-fixture.js';

const shapeList = (m: Doc) => (m['addOn'] as Doc)['shapes'] as Doc[];
const shapes = (mutate?: (shape: Doc) => void): Map<string, ShapeDefinitionView> => {
  const shape = structuredClone(shapeList(addOnManifest())[0]!);
  mutate?.(shape);
  return new Map([[shapeKey('invoices', shape as unknown as ShapeDefinitionView), shape as unknown as ShapeDefinitionView]]);
};
const conformance = (m: Doc, map = shapes()) => shapeConformanceIssues(m as never, map).map((i) => i.message).join('\n');
const lineRule = (m: Doc) => ((tableOf(m, 'invoices')['states'] as Doc)['children'] as Doc)['invoice_lines'] as Doc;

/** The app with time that is billed on invoice lines. */
function billed(): Doc {
  const m = valid();
  const tables = (m['requiredSchema'] as Doc)['tables'] as Doc[];
  tables.push({
    ref: 'time_entries',
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      { ref: 'project_id', type: 'fk', references: 'projects' },
      { ref: 'hours', type: 'decimal', scale: 2 },
      { ref: 'note', type: 'text', maxLength: 200, nullable: true },
    ],
  });
  (tableOf(m, 'invoice_lines')['columns'] as Doc[]).push({ ref: 'time_entry_id', type: 'fk', references: 'time_entries', nullable: true, unique: true });
  Object.assign(lineRule(m), { release: { when: ['void'], columns: ['time_entry_id'] }, lockLinked: { time_entry_id: ['hours', 'project_id'] } });
  return m;
}

describe('release and lockLinked in the manifest', () => {
  it('takes a release of a line\'s own link in a locked state, and a lock on the linked row', () => {
    expect(issuesText(billed())).toBe('');
    expect(conformance(billed())).toBe('');
  });

  it('refuses a release outside the lock, of a column that cannot be emptied, or without a lock', () => {
    let m = billed();
    (lineRule(m)['release'] as Doc)['when'] = ['draft'];
    expect(issuesText(m)).toContain('"draft" is not a state the lock holds, so there is nothing to release');
    m = billed();
    (lineRule(m)['release'] as Doc)['columns'] = ['qty'];
    expect(issuesText(m)).toContain('"invoice_lines.qty" is not nullable, so it cannot be emptied');
    m = billed();
    (lineRule(m)['release'] as Doc)['columns'] = ['document_id'];
    expect(issuesText(m)).toContain('ties the row to this one, and is never released');
    m = billed();
    (lineRule(m)['release'] as Doc)['columns'] = ['nope'];
    expect(issuesText(m)).toContain('"invoice_lines" has no column "nope"');
    m = billed();
    ((tableOf(m, 'invoices')['states'] as Doc)['moves'] as Doc)['void'] = ['draft'];
    expect(issuesText(m)).toContain('"void" has moves out of it, so a line released there could come back billing a changed row');
    m = billed();
    delete lineRule(m)['lock'];
    expect(issuesText(m)).toContain("a child is released only from its parent's lock");
  });

  it('refuses a linked lock through a column that links nowhere, or on a column the linked row lacks', () => {
    let m = billed();
    lineRule(m)['lockLinked'] = { qty: ['hours'] };
    expect(issuesText(m)).toContain('"invoice_lines.qty" does not point at a table of this manifest');
    m = billed();
    lineRule(m)['lockLinked'] = { time_entry_id: ['minutes'] };
    expect(issuesText(m)).toContain('"time_entries" has no column "minutes"');
    m = billed();
    lineRule(m)['lockLinked'] = { time_entry_id: ['id'] };
    expect(issuesText(m)).toContain('"time_entries.id" is the key, which never changes');
    m = billed();
    lineRule(m)['lockLinked'] = { document_id: ['total'] };
    expect(issuesText(m)).toContain('points at this row, whose own lock says what stays open');
    m = billed();
    lineRule(m)['lockLinked'] = {};
    expect(issuesText(m)).toContain('lockLinked names 1 to 8 link columns');
  });

  it('lets an app add both on its own columns of a shape\'s child, and never on the part\'s', () => {
    let m = billed();
    (lineRule(m)['release'] as Doc)['columns'] = ['time_entry_id', 'description'];
    expect(conformance(m)).toContain('a "invoice_lines" row is released only for columns the app added, never description');
    m = billed();
    lineRule(m)['lockLinked'] = { time_entry_id: ['hours'], document_id: ['total'] };
    expect(conformance(m)).toContain('"invoice_lines.document_id" is the shape\'s, and locks nothing the shape does not');
    // A release the shape keeps is the app's to keep as it is.
    const kept = shapes((shape) => {
      const children = (((shape['parts'] as Record<string, Doc>)['document']!['states'] as Doc)['children'] as Doc)['lines'] as Doc;
      children['release'] = { when: ['void'], columns: ['description'] };
    });
    m = billed();
    expect(conformance(m, kept)).toContain('"invoice_lines" is released as the shape releases it');
  });
});
