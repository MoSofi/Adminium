// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The consent log's batched read (`latestAmong`) answers each subject exactly
 * as `latest` does one at a time: by row, by address under any key version,
 * or both; the newest by time then id; null when never asked.
 */
import { describe, expect, it } from 'vitest';

import { consentLogRepo, type ConsentEventInput, type ConsentPerson, type ConsentSubject } from '../src/index.js';
import { TEST_DIALECTS, migrateOnly, useMetaDb } from './helpers/db.js';

const person = (key: string, table = 'public.contacts'): ConsentPerson => ({ connectionId: 'conn_1', table, key });
const h = (hash: string, version = 1) => ({ hash: hash.padEnd(64, '0'), version });

const event = (over: Partial<ConsentEventInput>): ConsentEventInput => ({
  person: person('1'),
  address: null,
  purpose: 'newsletter',
  state: 'yes',
  source: 'form',
  at: 1_000,
  ...over,
});

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`consent log batched read [${dialect.name}]`, () => {
    const meta = useMetaDb(dialect, migrateOnly);

    it('answers every subject as latest does, in the order given', async () => {
      const log = consentLogRepo(meta());
      await log.append(event({ person: person('1'), address: h('a1'), at: 1_000, state: 'yes' }));
      // An unsubscribe that knew only the address: newer, so it wins for person 1.
      await log.append(event({ person: null, address: h('a1'), at: 2_000, state: 'no', source: 'unsubscribe' }));
      await log.append(event({ person: person('2'), at: 1_500, state: 'yes' }));
      // Another purpose, another table, a replied row: none of them count for person 2's newsletter.
      await log.append(event({ person: person('2'), at: 3_000, state: 'no', purpose: 'surveys' }));
      await log.append(event({ person: person('2', 'public.leads'), at: 3_000, state: 'no' }));
      await log.append(event({ person: person('2'), at: 4_000, state: 'replied', purpose: null }));
      // A key version change: the old version's row is found only under that version.
      await log.append(event({ person: null, address: h('b2', 2), at: 5_000, state: 'no', source: 'unsubscribe' }));
      // Same time: the higher id wins, as latest orders it.
      await log.append(event({ person: person('4'), at: 7_000, state: 'yes' }));
      await log.append(event({ person: person('4'), at: 7_000, state: 'no' }));

      const subjects: ConsentSubject[] = [
        { person: person('1'), hashes: [h('a1')] },
        { person: person('1') },
        { person: person('2') },
        { person: person('3'), hashes: [h('b2', 1)] },
        { person: person('3'), hashes: [h('b2', 1), h('b2', 2)] },
        { person: person('4') },
        { person: person('9'), hashes: [h('zz')] },
        {},
      ];
      const batched = await log.latestAmong(subjects, 'newsletter');
      const one = await Promise.all(subjects.map((subject) => log.latest(subject, 'newsletter')));
      expect(batched.map((row) => row?.id ?? null)).toEqual(one.map((row) => row?.id ?? null));
      expect(batched.map((row) => row?.state ?? null)).toEqual(['no', 'yes', 'yes', null, 'no', one[5]!.state, null, null]);
    });

    it('reads more than one chunk of people', async () => {
      const log = consentLogRepo(meta());
      for (let i = 0; i < 620; i += 1) await log.append(event({ person: person(String(i)), at: 1_000 + i, state: i % 2 === 0 ? 'yes' : 'no' }));
      const subjects = Array.from({ length: 620 }, (_, i) => ({ person: person(String(i)) }));
      const batched = await log.latestAmong(subjects, 'newsletter');
      expect(batched.filter((row) => row?.state === 'yes')).toHaveLength(310);
      expect(batched[619]?.state).toBe('no');
      expect(batched[600]?.state).toBe('yes');
    });
  });
}
