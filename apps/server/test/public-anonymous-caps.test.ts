// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The limits on a create nobody signed in for, below the route: one person's
 * number however it is spelled, a name that is only a name, and a charge
 * written before it is counted — so many requests at once cannot all pass.
 */
import { describe, expect, it } from 'vitest';

import { ANONYMOUS_PER_IP_HOUR, ANONYMOUS_PURPOSE, capKey, capValue, chargeAnonymous, linkFreeText, mailboxOf, notPlain, plainText, valueSubject, type AnonymousCaps } from '../src/public-api/anonymous-caps.js';

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
const input = (values: Record<string, unknown>, caps: AnonymousCaps = { perValue: { columns: ['mobile', 'email'], n: 1 }, perKeyHour: 10 }) => ({
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

  it('counts one mailbox however its address is dressed up, and never folds anything else', () => {
    expect(mailboxOf('ana+tickets@example.com')).toBe('ana@example.com');
    expect(mailboxOf('a.n.a+1@googlemail.com')).toBe('ana@gmail.com');
    expect(mailboxOf('A.na@gmail.com'.toLowerCase())).toBe('ana@gmail.com');
    // Dots are a real difference on any other domain.
    expect(mailboxOf('a.na@example.com')).toBe('a.na@example.com');
    expect(capValue(' Ana+2@Example.COM ')).toBe('ana@example.com');
  });

  it('stops the eleventh create of one mailbox, whatever tags it wears', async () => {
    const repo = memoryRepo();
    const caps = { perValue: { columns: ['email'], n: 10 } };
    const results: boolean[] = [];
    for (let i = 1; i <= 11; i += 1) results.push((await chargeAnonymous(repo, input({ email: `victim+${String(i)}@gmail.com` }, caps))).ok);
    expect(results.slice(0, 10).every(Boolean)).toBe(true);
    expect(results[10]).toBe(false);
    expect((await chargeAnonymous(repo, input({ email: 'v.i.c.t.i.m@googlemail.com' }, caps))).ok).toBe(false);
  });

  it('stops one visitor spending the whole hour, and counts another visitor apart', async () => {
    const repo = memoryRepo();
    const from = (ip: string, i: number) => ({ ...input({ email: `p${String(i)}@example.com` }, { perKeyHour: 1000 }), ip });
    for (let i = 0; i < ANONYMOUS_PER_IP_HOUR; i += 1) expect((await chargeAnonymous(repo, from('203.0.113.9', i))).ok).toBe(true);
    expect((await chargeAnonymous(repo, from('203.0.113.9', 999))).ok).toBe(false);
    // One IPv6 subscriber's /64 is one visitor.
    const v6 = memoryRepo();
    for (let i = 0; i < ANONYMOUS_PER_IP_HOUR; i += 1) expect((await chargeAnonymous(v6, from(`2001:db8:1:2::${i.toString(16)}`, i))).ok).toBe(true);
    expect((await chargeAnonymous(v6, from('2001:db8:1:2:ffff::1', 999))).ok).toBe(false);
    expect((await chargeAnonymous(repo, from('203.0.113.10', 1000))).ok).toBe(true);
    // Where it is kept, the address is a keyed hash.
    expect(JSON.stringify(repo.rows)).not.toContain('203.0.113');
  });

  it("holds one visitor to an entry's own lower hour, per /64, before the key's hour is counted", async () => {
    const repo = memoryRepo();
    const from = (ip: string, i: number, caps: AnonymousCaps = { perIpHour: 10, perKeyHour: 12 }) => ({ ...input({ email: `p${String(i)}@example.com` }, caps), ip });
    for (let i = 0; i < 10; i += 1) expect((await chargeAnonymous(repo, from('203.0.113.9', i))).ok).toBe(true);
    // The eleventh from one visitor is refused, and takes none of the key's hour with it.
    expect((await chargeAnonymous(repo, from('203.0.113.9', 10))).ok).toBe(false);
    expect((await chargeAnonymous(repo, from('2001:db8:1:2::1', 11))).ok).toBe(true);
    expect((await chargeAnonymous(repo, from('2001:db8:1:3::1', 12))).ok).toBe(true);
    // The key's hour (12) is spent by the twelve that passed: another visitor is now refused by the key's cap.
    expect((await chargeAnonymous(repo, from('198.51.100.7', 13))).ok).toBe(false);
    // One IPv6 subscriber's /64 is one visitor for the entry's cap too.
    const v6 = memoryRepo();
    for (let i = 0; i < 3; i += 1) expect((await chargeAnonymous(v6, from(`2001:db8:9:9::${String(i + 1)}`, i, { perIpHour: 3 }))).ok).toBe(true);
    expect((await chargeAnonymous(v6, from('2001:db8:9:9:ffff::1', 99, { perIpHour: 3 }))).ok).toBe(false);
    expect((await chargeAnonymous(v6, from('2001:db8:9:a::1', 100, { perIpHour: 3 }))).ok).toBe(true);
  });

  it("counts an entry's own hour per entry, and the 60 every visitor is held to across the key", async () => {
    const repo = memoryRepo();
    const at = (ref: string, i: number, caps: AnonymousCaps) => ({ ...input({ email: `q${String(i)}@example.com` }, caps), ref, ip: '203.0.113.50' });
    for (let i = 0; i < 2; i += 1) expect((await chargeAnonymous(repo, at('orders', i, { perIpHour: 2 }))).ok).toBe(true);
    expect((await chargeAnonymous(repo, at('orders', 2, { perIpHour: 2 }))).ok).toBe(false);
    // Another entry of the key has its own hour for this visitor.
    expect((await chargeAnonymous(repo, at('bookings', 3, { perIpHour: 2 }))).ok).toBe(true);
    // Everything this visitor made through the key still counts toward the 60.
    for (let i = 0; i < ANONYMOUS_PER_IP_HOUR - 3; i += 1) expect((await chargeAnonymous(repo, at('visits', 100 + i, {}))).ok).toBe(true);
    expect((await chargeAnonymous(repo, at('visits', 999, {}))).ok).toBe(false);
    // Where it is kept, the address is a keyed hash.
    expect(JSON.stringify(repo.rows)).not.toContain('203.0.113');
  });

  it('takes a name, and never a link, a number or a long story', () => {
    for (const name of ['Cara O’Neil', 'Zoë Brontë-Smith', 'Dr. J. (Jo) Park & co', 'محمد', null]) expect(plainText(name)).toBe(true);
    for (const name of ['see www.x.io', 'http://x', 'https://x.io', 'Call 0800', 'a'.repeat(81), '<b>hi</b>', 42]) expect(plainText(name)).toBe(false);
    expect(notPlain({ plainText: ['name', 'note'] }, { name: 'Cara', note: 'x://y' })).toBe('note');
  });

  it('holds a create nobody signed in for to the rule a child row\'s note is held to: a dotted name passes, a web address never', () => {
    const caps = { plainText: ['name'] };
    for (const name of ['Mary.Ann', 'J.R.R. Tolkien', 'St. John', "Anna-Marie O'Brien", 'Zoë (table)', 'x dot com', 'Cara O’Neil', 'W.Hu', 'K.Y.Ng', 'A.Page', 'M.De Vries', 'H.-J.Schmidt', null]) {
      expect(notPlain(caps, { name }), String(name)).toBeNull();
      expect(linkFreeText(name), String(name)).toBe(true);
    }
    for (const name of ['refund-desk.com Smith', 'Smith www.x.io', 'a@b.co', 'https://x', 'evil.com', 'EVIL.COM', 'Claim.Refund.net', 'пример.рф', 'shop.CO.UK', 'evil．com', 'evil․com', 'mail kai@friends.org', '@kai_tickets', 'evil.co.uk/x', 'X.Com', 'J.Co']) {
      expect(notPlain(caps, { name }), name).toBe('name');
      // One rule: whatever the root refuses, a child row's note refuses too.
      expect(linkFreeText(name), name).toBe(false);
    }
    // A bare domain is plain text by the shorter rule, which alone no column is judged by any more.
    for (const name of ['evil.com', 'refund-desk.com Smith', 'пример.рф']) expect(plainText(name), name).toBe(true);
  });

  it('never takes a web address, a path or a handle where no link may go, and still takes a name with dots in it', () => {
    for (const name of ['Claim refund at evil.com', 'evil.com', 'EVIL.COM', 'evil.co.uk/x', 'go to Claim.Refund.net now', 'пример.рф', 'kai at friends-org.io', 'mail kai@friends.org', '@handle', '@kai_tickets', 'Kai @ home', 'see www.x.io', 'Call 0800']) {
      expect(linkFreeText(name), name).toBe(false);
    }
    for (const name of ['Mary.Ann', 'J.R.R. Tolkien', 'St. John', 'J. R. R. Tolkien', 'Mrs. Kai Ng', 'Ana Lu.', 'Dr. J. (Jo) Park & co', 'Anne-Marie.Jo', null]) {
      expect(linkFreeText(name), String(name)).toBe(true);
    }
  });

  it('reads an ending as a reader sees it: a trailing hyphen, an invisible mark, fullwidth letters and a combined accent are no disguise', () => {
    for (const text of ['refund-desk.com- Smith', 'refund-desk.co\u034Fm Smith', 'refund-desk.com\uFE0F Smith', 'refund-desk.co\u200Bm', 'refund-desk.ｃｏｍ Smith', 'refund-desk.co\u1E3F Smith', '-refund-desk.-com Smith']) {
      expect(linkFreeText(text), JSON.stringify(text)).toBe(false);
    }
    // Only for finding an ending: a name's own marks are kept and pass.
    for (const text of ['Zoë Brontë', 'Nguyễn Văn An', 'Søren', 'José.María']) expect(linkFreeText(text), text).toBe(true);
  });

  it("knows the endings a venue or a shop is called by, and the common ones in other scripts", () => {
    for (const ending of ['cafe', 'restaurant', 'pub', 'hotel', 'clinic', 'dental', 'health', 'company', 'menu', 'pizza', 'food', 'kitchen', 'delivery', 'events', 'tickets', 'be', 'to', 'fm', 'ai', '中国', 'москва', 'рф']) {
      expect(linkFreeText(`refund-desk.${ending} Smith`), ending).toBe(false);
    }
  });

  it('takes one capital and a dot before a capitalised surname as initials, unless the ending is always an address', () => {
    for (const name of ['W.Hu', 'K.Y.Ng', 'A.Page', 'M.De Vries', 'T.Ly', 'L.Su']) expect(linkFreeText(name), name).toBe(true);
    for (const name of ['X.Com', 'J.Co', 'A.Io', 'B.Net', 'C.Org', 'D.Info', 'E.Biz', 'F.App', 'G.Dev', 'H.Shop', 'I.Online', 'K.Site', 'a.page', 'A.PAGE', 'Wong.Ng', 'x.com', 't.co']) {
      expect(linkFreeText(name), name).toBe(false);
    }
  });

  it('counts a Gmail address written with a dot after its domain as the same mailbox', () => {
    expect(mailboxOf('a.na+x@gmail.com.')).toBe('ana@gmail.com');
    expect(mailboxOf('ana@googlemail.com..')).toBe('ana@gmail.com');
    expect(capValue('Ana@Example.com.')).toBe('ana@example.com');
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
