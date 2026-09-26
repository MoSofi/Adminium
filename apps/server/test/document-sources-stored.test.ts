// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A document slot fed by several sources — a price's nights and child rows —
 * and a column listing names one level below a line, as the install stores
 * them: real tables, links, and every key the manifest gave, kept. Drawing
 * them is a later build's; here they must survive the store.
 */
import { validateManifest, type AppManifest } from '@adminium/manifest';
import { describe, expect, it } from 'vitest';

import { planAppProfiles, storedProfile } from '../src/documents/app-profiles.js';
import { mappedTables } from '../src/documents/subject.js';
import { lodgeManifest } from './tree-person-night-fixture.js';

function withFolio(items: Record<string, unknown>): AppManifest {
  const manifest = lodgeManifest();
  manifest['addOns'] = { requires: [{ key: 'invoices', range: '>=1.0.6', reason: { 'en-US': 'Folios.' } }] };
  manifest['documents'] = [{ kind: 'invoice', addOn: 'invoices', table: 'stays', name: { 'en-US': 'Folio' }, mapping: { reference: { column: 'reference' }, items } }];
  const result = validateManifest(manifest);
  expect(result.ok ? [] : result.issues).toEqual([]);
  return (result.ok ? result.manifest : manifest) as AppManifest;
}

const real = (ref: string) => `main.lodge_${ref}`;

describe('a slot fed by several sources', () => {
  it('is stored with each source in order: the nights by column, child rows by real table, names one level down', () => {
    const manifest = withFolio({
      collections: [
        { nightly: 'room_total', columns: { date: 'date', desc: 'room_type_id.name', qty: 'qty', rate: 'rate', amount: 'rate' } },
        {
          table: 'stay_extras',
          via: 'stay_id',
          orderBy: 'position',
          unless: 'removed',
          columns: { qty: 'nights', rate: 'each', amount: 'amount', options: { list: { table: 'stay_extra_notes', via: 'stay_extra_id', column: 'text', orderBy: 'id' } } },
        },
      ],
    });
    const { planned } = planAppProfiles(manifest, { byKey: new Map(), addOns: new Set(['invoices']) });
    const stored = storedProfile(planned[0]!, manifest, real);
    if ('reason' in stored) throw new Error(stored.reason);
    expect(stored.mapping['items']).toEqual({
      sources: [
        { nightly: { column: 'room_total', columns: { date: 'date', desc: 'room_type_id.name', qty: 'qty', rate: 'rate', amount: 'rate' } } },
        {
          collection: {
            table: real('stay_extras'),
            fkColumn: 'stay_id',
            columns: { qty: 'nights', rate: 'each', amount: 'amount' },
            orderBy: 'position',
            unless: 'removed',
            lists: { options: { table: real('stay_extra_notes'), fkColumn: 'stay_extra_id', column: 'text', orderBy: 'id' } },
          },
        },
      ],
    });
    expect(stored.orderBy).toBe('position');
    // A reader of the folio is granted what it reads: the child rows and the names below them.
    expect(mappedTables(stored.mapping, real('stays'))).toEqual([real('stays'), real('stay_extras'), real('stay_extra_notes')]);
  });

  it('stores one nightly source given as a collection the same way', () => {
    const manifest = withFolio({ collection: { nightly: 'room_total', columns: { date: 'date', amount: 'rate' } } });
    const { planned } = planAppProfiles(manifest, { byKey: new Map(), addOns: new Set(['invoices']) });
    const stored = storedProfile(planned[0]!, manifest, real);
    if ('reason' in stored) throw new Error(stored.reason);
    expect(stored.mapping['items']).toEqual({ sources: [{ nightly: { column: 'room_total', columns: { date: 'date', amount: 'rate' } } }] });
  });

  it('keeps today\'s single list as it was stored', () => {
    const manifest = withFolio({ collection: { table: 'stay_extras', via: 'stay_id', columns: { amount: 'amount' } } });
    const { planned } = planAppProfiles(manifest, { byKey: new Map(), addOns: new Set(['invoices']) });
    const stored = storedProfile(planned[0]!, manifest, real);
    if ('reason' in stored) throw new Error(stored.reason);
    expect(stored.mapping['items']).toEqual({ collection: { table: real('stay_extras'), fkColumn: 'stay_id', columns: { amount: 'amount' } } });
  });
});
