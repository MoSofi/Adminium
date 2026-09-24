// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The limits on a create nobody signed in for, below the route: one person's
 * number however it is spelled, a name that is only a name, and a charge
 * written before it is counted — so many requests at once cannot all pass.
 */
import { describe, expect, it } from 'vitest';

import { ANONYMOUS_PURPOSE, capKey, capValue, chargeAnonymous, notPlain, plainText, valueSubject } from '../src/public-api/anonymous-caps.js';

/** The markers as the repo keeps them, each call a turn of the event loop — as a database round trip is. */
function memoryRepo() {
  const rows: { id: string; subject: string; purpose: string; createdAt: number }[] = [];
  let next = 0;
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  return {
    rows,
    async mark(input: { subject: string; purpose: string }, at = Date.now()) {
      await tick();
      const id = `m${String((next += 1))}`;
      rows.push({ id, subject: input.subject, purpose: input.purpose, createdAt: at });
      return id;
    },
    async sentSince(subject: string, since: number, purpose?: string) {
      await tick();
      return rows.filter((row) => row.subject === subject && row.createdAt >= since && (purpose === undefined || row.purpose === purpose)).length;
    },
    async unmark(ids: readonly string[]) {
      await tick();
      for (const id of ids) rows.splice(rows.findIndex((row) => row.id === id), 1);
    },
  };
}

const key = capKey('a-test-secret-that-is-long-enough-for-hkdf');
const now = Date.UTC(2026, 6, 28, 9, 0);
const input = (values: Record<string, unknown>, caps = { perValue: { columns: ['mobile', 'email'], n: 1 }, perKeyHour: 10 }) => ({
  caps,
  key,
  keyId: 'pbk_1',
  connectionId: 'c1',
  table: 'public.visits',
  ref: 'visits',
  values,
  now,
});

describe('anonymous caps', () => {
  it('counts one number or address however it is spelled', () => {
    expect(capValue('+44 7700 900123')).toBe(capValue('07700 900123'));
    expect(capValue('(0)7700-900.123')).toBe('700900123');
    expect(capValue(' Cara@Example.COM ')).toBe('cara@example.com');
    expect(capValue('')).toBeNull();
    expect(capValue(null)).toBeNull();
    // Hashed where it is kept: the same value is one subject, another row's column another.
    expect(valueSubject(key, 'c1', 't', 'mobile', '700900123')).toBe(valueSubject(key, 'c1', 't', 'mobile', '700900123'));
    expect(valueSubject(key, 'c1', 't', 'mobile', '700900123')).not.toBe(valueSubject(key, 'c1', 't', 'email', '700900123'));
    expect(valueSubject(key, 'c1', 't', 'mobile', '700900123')).not.toContain('700900123');
  });

  it('takes a name, and never a link, a number or a long story', () => {
    for (const name of ['Cara O’Neil', 'Zoë Brontë-Smith', 'Dr. J. (Jo) Park & co', 'محمد', null]) expect(plainText(name)).toBe(true);
    for (const name of ['see www.x.io', 'http://x', 'https://x.io', 'Call 0800', 'a'.repeat(81), '<b>hi</b>', 42]) expect(plainText(name)).toBe(false);
    expect(notPlain({ plainText: ['name', 'note'] }, { name: 'Cara', note: 'x://y' })).toBe('note');
  });

  it('charges before it counts, so requests at once cannot all pass', async () => {
    const repo = memoryRepo();
    const tries = await Promise.all([0, 1, 2, 3].map(() => chargeAnonymous(repo, input({ mobile: '07700 900123' }))));
    // Each request counted the others' markers: at most one goes through.
    expect(tries.filter((t) => t.ok).length).toBeLessThanOrEqual(1);
    // Refused charges are taken back.
    expect(repo.rows.filter((row) => row.subject.startsWith('anon:')).length).toBe(tries.filter((t) => t.ok).length);
  });

  it('refuses the next one once a value or the key is used up, and a released charge frees it', async () => {
    const repo = memoryRepo();
    const first = await chargeAnonymous(repo, input({ mobile: '07700 900123', email: 'a@example.com' }));
    expect(first.ok).toBe(true);
    expect((await chargeAnonymous(repo, input({ mobile: '+44 7700 900123' }))).ok).toBe(false);
    expect((await chargeAnonymous(repo, input({ email: 'A@example.com' }))).ok).toBe(false);
    // The create failed after all: the person is not counted.
    if (first.ok) await first.release();
    expect((await chargeAnonymous(repo, input({ mobile: '07700 900123' }))).ok).toBe(true);
    // The key's hour is everyone's.
    const busy = memoryRepo();
    for (let i = 0; i < 10; i += 1) expect((await chargeAnonymous(busy, input({ mobile: `0770090${String(1000 + i)}` }))).ok).toBe(true);
    expect((await chargeAnonymous(busy, input({ mobile: '07700 902000' }))).ok).toBe(false);
    expect(busy.rows.every((row) => row.purpose === ANONYMOUS_PURPOSE)).toBe(true);
  });
});
