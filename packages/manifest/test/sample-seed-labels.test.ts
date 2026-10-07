// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A sample row may point at a row the manifest's own starting rows wrote
 * (`seeds`), by that row's label: the unit an install seeded is there before
 * the sample's first row. What tells such a row apart once it is in its table
 * is its one-of-a-kind columns, else its table's key field.
 */
import { describe, expect, it } from 'vitest';

import { sampleBundleIssues, sampleBundleSchema, seedLabelsOf, seedRowIdentity, type AddOnManifest } from '../src/index.js';
import { LEDGER_KIT } from './ledger-kit-fixture.js';

type Doc = Record<string, unknown>;
const pk = { ref: 'id', type: 'int', role: 'pk' };

/** The ledger kit's shape with two tables of starting rows and one that names them; read as parsed (the checks here read no more). */
const KIT = (() => {
  const doc = structuredClone(LEDGER_KIT) as Doc & { requiredSchema: { tables: Doc[] } };
  doc.requiredSchema.tables.push(
    { ref: 'units', columns: [pk, { ref: 'code', type: 'text', unique: true }, { ref: 'name', type: 'text' }] },
    { ref: 'causes', keyField: 'label', columns: [pk, { ref: 'label', type: 'text' }, { ref: 'note', type: 'text', nullable: true }] },
    { ref: 'plain', columns: [pk, { ref: 'body', type: 'text' }] },
    { ref: 'things', columns: [pk, { ref: 'unit_id', type: 'fk', references: 'units' }, { ref: 'name', type: 'text' }] },
  );
  doc['seeds'] = [
    { table: 'units', rows: [{ '@label': 'unit:each', code: 'each', name: { '@t': { 'en-US': 'Each', 'de-DE': 'Stück' } } }, { code: 'pair', name: 'Pair' }] },
    { table: 'causes', rows: [{ '@label': 'cause:broken', label: { '@t': { 'en-US': 'Broken', 'de-DE': 'Kaputt', 'fr-FR': 'Broken' } }, note: 'x' }] },
    { table: 'plain', rows: [{ '@label': 'plain:one', body: 'One' }] },
    { table: 'things', file: 'seeds/things.json' },
  ];
  return doc as unknown as AddOnManifest;
})();

const messages = (tables: Doc[]): string =>
  sampleBundleIssues(sampleBundleSchema.parse({ format: 'adminium.sample/1', app: 'ledger-kit', tables }), KIT)
    .map((issue) => `${issue.path}: ${issue.message}`)
    .join('\n');

describe('a sample row names a starting row', () => {
  it('by the label a starting row written in the manifest carries', () => {
    expect([...seedLabelsOf(KIT)].sort()).toEqual(['cause:broken', 'plain:one', 'unit:each']);
    expect(messages([{ ref: 'things', rows: [{ unit_id: { '@ref': 'unit:each' }, name: 'Mug' }] }])).toBe('');
  });

  it('and no other: a label nothing carries is still not an earlier row', () => {
    expect(messages([{ ref: 'things', rows: [{ unit_id: { '@ref': 'unit:pair' }, name: 'Gloves' }] }])).toContain('"unit:pair" is not an earlier row');
  });

  it('a sample row may not take a starting row\'s label for its own', () => {
    expect(messages([{ ref: 'units', rows: [{ '@label': 'unit:each', code: 'ea', name: 'Each' }] }])).toContain('The label "unit:each" is used twice.');
  });
});

describe('what tells a starting row apart', () => {
  const rowOf = (table: string, label: string): Doc => (KIT.seeds ?? []).find((seed) => seed.table === table)!.rows!.find((row) => row['@label'] === label) as Doc;

  it('is its one-of-a-kind column, and nothing else it gives', () => {
    expect(seedRowIdentity(KIT, 'units', rowOf('units', 'unit:each'))).toEqual([{ column: 'code', values: ['each'] }]);
  });

  it('else its table\'s key field, in any of the languages it was written in', () => {
    expect(seedRowIdentity(KIT, 'causes', rowOf('causes', 'cause:broken'))).toEqual([{ column: 'label', values: ['Broken', 'Kaputt'] }]);
  });

  it('and nothing when the table has neither: such a row cannot be found again', () => {
    expect(seedRowIdentity(KIT, 'plain', rowOf('plain', 'plain:one'))).toEqual([]);
    expect(seedRowIdentity(KIT, 'nowhere', { code: 'x' })).toEqual([]);
  });
});
