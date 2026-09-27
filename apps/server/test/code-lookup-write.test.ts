// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A CODE A PERSON TYPES FINDS THE ONE CODE IT MEANS — on every engine this run
 * can reach, through an app installed by the real installer.
 *
 * Case, spaces, dashes and a letter O typed for a nought do not matter; two
 * codes that read alike are told apart by the exact spelling; a code switched
 * off, past its day or another show's is `unknown`, as a code nobody made is.
 * What the order copies through the link it fills (the discount's kind and
 * amount) is written in the same write, and taking the code off takes them
 * with it. History keeps its own link; a desk that picks the code row keeps it.
 */
import { validateManifest } from '@adminium/manifest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ConflictError, ValidationFailedError } from '../src/errors.js';
import { boxOffice, boxOfficeManifest } from './code-lookup-fixture.js';
import { LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';

it('is a manifest the validator takes', () => {
  const parsed = validateManifest(boxOfficeManifest());
  expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
});

describe.each(LEGS)('a code a person types — %s', (dialect, available) => {
  let h: InvoicingHarness;
  let w: Awaited<ReturnType<typeof writerFor>>;
  const order = async (values: Record<string, unknown>, context = w?.desk) => w.create('orders', { event_id: 1, email: 'mia@example.com', name: 'Mia', ...values }, context);
  const refusal = async (write: Promise<unknown>) => {
    const error = await write.then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ValidationFailedError);
    return (error as ValidationFailedError).details as { fields: Record<string, { code: string }> };
  };
  const stored = async (key: unknown) => (await h.rows(`select * from ${h.real('orders')} where id = ${String(key)}`))[0]!;

  beforeAll(async () => {
    if (!available) return;
    h = await boxOffice(dialect);
    w = await writerFor(h);
  }, 180_000);
  afterAll(async () => {
    if (available) await h.close();
  });

  it.skipIf(!available)('finds the code however it is typed, and copies what it gives in the same write', async () => {
    for (const typed of ['student10', ' Student-10 ', 'STUDENT1O', 'student 1o']) {
      const made = await order({ code_text: typed });
      expect(Number(made['code_id']), typed).toBe(1);
      const row = await stored(made['id']);
      expect(row['code_kind']).toBe('percent');
      expect(Number(row['code_value'])).toBe(10);
      // The typed text is kept as typed: the link says which code it was.
      expect(row['code_text']).toBe(typed);
    }
    // A kept code read with noughts for its letters O, and ones for its L.
    const unlocked = await order({ code_text: 'BL00MEAR1Y' });
    expect(Number(unlocked['code_id'])).toBe(3);
  });

  it.skipIf(!available)('tells two codes that read alike apart by their exact spelling, and a third spelling finds neither', async () => {
    expect(Number((await order({ code_text: 'booko' }))['code_id'])).toBe(4);
    expect(Number((await order({ code_text: 'BOOK0' }))['code_id'])).toBe(5);
    expect((await refusal(order({ code_text: 'B00K0' }))).fields).toEqual({ code_text: { code: 'unknown' } });
  });

  it.skipIf(!available)('answers one word for a code switched off, past its day, another show\'s, made by nobody, or no code at all', async () => {
    for (const typed of ['SWITCHEDOFF', 'lastyear', 'HOMEONLY', 'NOSUCHCODE', '!!!', 'x'.repeat(33)]) {
      expect((await refusal(order({ code_text: typed }))).fields, typed).toEqual({ code_text: { code: 'unknown' } });
    }
    // The show's own code there: HOMEONLY is the other show's.
    expect(Number((await order({ event_id: 2, code_text: 'homeonly' }))['code_id'])).toBe(8);
    // A code the whole venue takes, on either show.
    expect(Number((await order({ event_id: 1, code_text: 'venue15' }))['code_id'])).toBe(9);
    expect(Number((await order({ event_id: 2, code_text: 'venue15' }))['code_id'])).toBe(9);
    // Text no engine keeps alike is refused before anything is looked up.
    expect((await refusal(order({ code_text: 'STU\u0000DENT10' }))).fields).toEqual({ code_text: { code: 'invalid-character' } });
  });

  it.skipIf(!available)('takes the discount off with the code, and finds a code again only when one is typed again', async () => {
    const made = await order({ code_text: 'STUDENT10' });
    const key = made['id'];
    // A change that does not type the code leaves it and its copies be.
    await w.update('orders', key, { name: 'Mia Okada' });
    expect(Number((await stored(key))['code_id'])).toBe(1);
    // Typed again, the stored show decides which codes it may be.
    await w.update('orders', key, { code_text: 'crew5' });
    let row = await stored(key);
    expect([Number(row['code_id']), row['code_kind'], Number(row['code_value']), Number(row['code_type_no'])]).toEqual([2, 'amount', 5, 1]);
    expect((await refusal(w.update('orders', key, { code_text: 'HOMEONLY' }))).fields).toEqual({ code_text: { code: 'unknown' } });
    // Taken off: the link and every copy through it.
    await w.update('orders', key, { code_text: '' });
    row = await stored(key);
    expect([row['code_id'], row['code_kind'], row['code_value'], row['code_type_no']]).toEqual([null, null, null, null]);
  });

  it.skipIf(!available)('keeps a link history brings, and one the desk picked itself', async () => {
    const imported = await order({ code_text: 'anything at all', code_id: 2 }, { ...w.desk, origin: 'import' });
    expect(Number(imported['code_id'])).toBe(2);
    const picked = await order({ code_id: 1 });
    expect(Number(picked['code_id'])).toBe(1);
    expect((await stored(picked['id']))['code_kind']).toBe('percent');
  });

  it.skipIf(!available)('stores a code the venue types as a code: upper case, no spaces or dashes', async () => {
    const made = await w.create('codes', { code: ' spring-sale 24 ', kind: 'percent', value: 5, event_id: 1 });
    expect(made['code']).toBe('SPRINGSALE24');
    expect(Number((await order({ code_text: 'Spring Sale-24' }))['code_id'])).toBe(Number(made['id']));
  });

  it.skipIf(!available)('refuses a code whose uses are all taken, on the column it was typed into', async () => {
    const first = await order({ code_text: 'two', status: 'paid' });
    const second = await order({ code_text: 'TWO', status: 'paid' });
    expect([Number(first['code_id']), Number(second['code_id'])]).toEqual([12, 12]);
    const error = await order({ code_text: 'TWO' }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ConflictError);
    expect(error).toMatchObject({ code: 'CAPACITY_FULL', details: { column: 'code_id', kind: 'parent', fields: { code_text: { code: 'used-up' } } } });
    // A cancelled order gives its use back.
    await w.update('orders', first['id'], { status: 'cancelled' });
    expect(Number((await order({ code_text: 'TWO' }))['code_id'])).toBe(12);
  });
});
