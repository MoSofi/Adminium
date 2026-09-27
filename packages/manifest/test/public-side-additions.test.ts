// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The public side's later vocabulary, each rule broken once on a manifest
 * that otherwise validates and read back as the sentence it gives.
 */
import { describe, expect, it } from 'vitest';

import { validateManifest } from '../src/index.js';
import { entryOf, issuesText, kitchen, messages, type Doc } from './orders-stays-fixture.js';

const create = (m: Doc) => entryOf(m, 'orders', 'POST');

describe("an entry's own hour per visitor", () => {
  it('validates at or below the 60 every visitor is held to, and is kept', () => {
    const m = kitchen();
    (create(m)['anonymous'] as Doc)['perIpHour'] = 10;
    expect(messages(m)).toEqual([]);
    const result = validateManifest(m);
    if (!result.ok || result.manifest.kind !== 'app') throw new Error('invalid');
    expect(result.manifest.publicAccess!.find((e) => e.methods.includes('POST') && e.table === 'orders')!.anonymous?.perIpHour).toBe(10);
  });

  it('is never more than 60, nor less than one', () => {
    for (const n of [61, 0, 2.5]) {
      const m = kitchen();
      (create(m)['anonymous'] as Doc)['perIpHour'] = n;
      expect(issuesText(m), String(n)).toContain('perIpHour');
    }
  });
});

describe('personal data on an entry anyone may call', () => {
  const withMenuColumn = (column: Doc, select: string) => {
    const m = kitchen();
    const menu = (m['requiredSchema'] as { tables: Doc[] }).tables.find((t) => t['ref'] === 'menu_items')!;
    (menu['columns'] as Doc[]).push(column);
    const read = entryOf(m, 'menu_items', 'GET');
    read['select'] = [...(read['select'] as string[]), select];
    return m;
  };

  it('is refused on a create anyone may make, whether marked or guessed from its name', () => {
    const m = kitchen();
    create(m)['select'] = [...(create(m)['select'] as string[]), 'phone', 'email'];
    const text = issuesText(m);
    expect(text).toContain('"orders.phone" is read as personal data by its name, and anyone may call this entry, so it is not selected');
    expect(text).toContain('"orders.email" is read as personal data by its name');
  });

  it('is refused on a read anyone may make: an address, a birth date, a column marked personal', () => {
    for (const [column, select] of [
      [{ ref: 'photo_street', type: 'text', maxLength: 80, nullable: true }, 'photo_street'],
      [{ ref: 'chef_dob', type: 'date', nullable: true }, 'chef_dob'],
      [{ ref: 'chef_notes', type: 'text', maxLength: 80, nullable: true, rules: { personal: true } }, 'chef_notes'],
    ] as const) {
      expect(issuesText(withMenuColumn(column, select)), select).toContain(`"menu_items.${select}" is`);
    }
  });

  it('passes a column marked not personal, and a name no guess reads as personal', () => {
    expect(messages(withMenuColumn({ ref: 'venue_phone', type: 'text', maxLength: 32, nullable: true, rules: { personal: false } }, 'venue_phone'))).toEqual([]);
    expect(messages(withMenuColumn({ ref: 'avatar_url', type: 'text', maxLength: 200, nullable: true }, 'avatar_url'))).toEqual([]);
    expect(messages(withMenuColumn({ ref: 'company_name', type: 'text', maxLength: 80, nullable: true }, 'company_name'))).toEqual([]);
    // A number named like a phone is no text: never guessed.
    expect(messages(withMenuColumn({ ref: 'phone_count', type: 'int', default: 0 }, 'phone_count'))).toEqual([]);
  });

  it('passes an entry a person signs in for, or one only a session reads', () => {
    const m = kitchen();
    const mine = entryOf(m, 'orders', 'GET');
    mine['select'] = [...(mine['select'] as string[]), 'phone', 'email'];
    expect(messages(m)).toEqual([]);
  });
});
