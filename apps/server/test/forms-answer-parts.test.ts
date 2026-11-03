// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The answer door's own parts, each alone: the confirm token (made, read,
 * changed by a byte, another install's, another secret's, too old), the
 * first name a confirmation may carry, and an answer as staff read it (every
 * web address made plain). And the caps, on every engine: a form's hour
 * counts across strangers and says its real wait, an address counts by its
 * /64, an e-mail address by its mailbox.
 */
import { describe, expect, it } from 'vitest';

import { formsResource } from '../src/forms/scope.js';
import { createFormCaps, FORM_PER_ADDRESS_HOUR, FORM_PER_EMAIL_DAY } from '../src/forms/caps.js';
import { confirmAddressHash, confirmAddressMatches, confirmKey, confirmLinkLive, CONFIRM_LINK_MS, makeConfirmToken, readConfirmToken } from '../src/forms/confirm-token.js';
import { answerLines, firstNameOf, unlinked } from '../src/forms/mail.js';
import { capKey } from '../src/public-api/anonymous-caps.js';
import { TEST_SECRET } from './helpers.js';
import { META_ENGINES } from './meta-dialects.js';

const claim = { addOn: 'forms', form: 'frm_1', answer: 'ans_1', purpose: 'newsletter' as const, issuedAt: 1_700_000_000_000, addressHash: confirmAddressHash(confirmKey(TEST_SECRET), 'Ana@Example.test ') };

describe('the confirm token', () => {
  const key = confirmKey(TEST_SECRET);

  it('carries a keyed hash of the address, never the address, and matches only that address', () => {
    const token = makeConfirmToken(key, 'inst-a', claim);
    expect(Buffer.from(token.split('~')[0]!, 'base64url').toString('utf8')).not.toMatch(/ana@/i);
    const read = readConfirmToken(key, 'inst-a', token)!;
    expect(confirmAddressMatches(key, read, 'ana@example.test')).toBe(true);
    expect(confirmAddressMatches(key, read, 'eve@example.test')).toBe(false);
    // Under another secret the same address hashes otherwise.
    expect(confirmAddressHash(confirmKey(`${TEST_SECRET}x`), 'ana@example.test')).not.toBe(claim.addressHash);
  });

  it('reads back what it was made with, for this install only', () => {
    const token = makeConfirmToken(key, 'inst-a', claim);
    expect(readConfirmToken(key, 'inst-a', token)).toEqual(claim);
    expect(readConfirmToken(key, 'inst-b', token)).toBeNull();
    expect(readConfirmToken(confirmKey(`${TEST_SECRET}x`), 'inst-a', token)).toBeNull();
  });

  it('reads nothing from a token changed by one byte, anywhere', () => {
    const token = makeConfirmToken(key, 'inst-a', claim);
    for (let at = 0; at < token.length; at += 7) {
      const swapped = token[at] === 'A' ? 'B' : 'A';
      expect(readConfirmToken(key, 'inst-a', `${token.slice(0, at)}${swapped}${token.slice(at + 1)}`)).toBeNull();
    }
    expect(readConfirmToken(key, 'inst-a', `${token}A`)).toBeNull();
    // The last character too, whose spare bits base64url would read past.
    for (const last of ['A', 'B', 'C', 'D']) if (!token.endsWith(last)) expect(readConfirmToken(key, 'inst-a', `${token.slice(0, -1)}${last}`)).toBeNull();
    expect(readConfirmToken(key, 'inst-a', 42)).toBeNull();
  });

  it('works for thirty days and not a moment more', () => {
    expect(confirmLinkLive(claim.issuedAt, claim.issuedAt + CONFIRM_LINK_MS)).toBe(true);
    expect(confirmLinkLive(claim.issuedAt, claim.issuedAt + CONFIRM_LINK_MS + 1)).toBe(false);
  });
});

describe('what a stranger’s words become in a mail', () => {
  it('a first name only when it passes the name rule', () => {
    expect(firstNameOf('Marta Kovac')).toBe('Marta');
    expect(firstNameOf('  Zoë  ')).toBe('Zoë');
    expect(firstNameOf('www.evil.example Bob')).toBeNull();
    expect(firstNameOf('<b>Bob</b>')).toBeNull();
    expect(firstNameOf(null)).toBeNull();
  });

  it('no web address stays one, and nothing else changes', () => {
    expect(unlinked('see https://evil.example/pay now')).toBe('see https:​//evil.​example/pay now');
    expect(unlinked('www.evil.example')).toBe('www.​evil.​example');
    expect(unlinked('evil.com/login')).toBe('evil.​com/login');
    expect(unlinked('Two booths. Thanks!')).toBe('Two booths. Thanks!');
  });

  it('an answer as staff read it: labels and answers, choices by their words, files left out', () => {
    const words = (en: string) => ({ 'en-US': en });
    const lines = answerLines(
      [
        { id: 'qname', kind: 'short', label: words('Name'), required: true },
        { id: 'qsee', kind: 'several', label: words('See'), required: false, choices: [{ id: 'booths', label: words('Booths') }, { id: 'seating', label: words('Seating') }] },
        { id: 'qfile', kind: 'file', label: words('Drawings'), required: false, maxMb: 5, kinds: ['pdf'] },
        { id: 'qnote', kind: 'long', label: words('Note'), required: false, maxLength: 2000 },
      ] as never,
      { qname: 'Ann', qsee: ['booths', 'seating'], qfile: ['upload_aaaaaaaaaaaaaaaa'], qnote: 'go to http://x.example' },
      'en-US',
    );
    expect(lines).toBe('Name: Ann\nSee: Booths, Seating\nNote: go to http:​//x.​example');
  });
});

describe('a forms entry compiled', () => {
  it('opens a create alone, with the entry’s columns, defaults and limits', () => {
    const resource = formsResource(
      { table: 'enquiries', writable: ['person', 'email'], writableValues: {}, defaults: { state: 'open' }, requires: ['person'], decided: [], plainText: [{ column: 'person', max: 80 }], anonymous: { perIpHour: 5 }, requireSetting: [] },
      'public.crm_enquiries',
      'forms:crm:enquiries',
    );
    expect([...resource.actions]).toEqual(['create']);
    expect([...resource.writable]).toEqual(['person', 'email']);
    expect(resource.defaults).toEqual({ state: 'open' });
    expect(resource.anonymous).toEqual({ perIpHour: 5, plainText: [{ column: 'person', max: 80 }] });
    expect(resource.expose).toEqual([]);
  });
});

for (const dialect of META_ENGINES) {
  describe.skipIf(!dialect.available)(`a form’s caps [${dialect.name}]`, () => {
    it('a form’s hour counts every stranger, refuses at N+1 with its real wait, and gives back a refused answer', async () => {
      const handle = await dialect.make();
      const meta = handle.meta;
      try {
        const caps = createFormCaps(meta, capKey(TEST_SECRET));
        const form = { addOn: 'forms', id: 'frm_1', perHour: 2 };
        const at = 10_000_000;
        const first = await caps.chargeAnswer(form, '198.51.100.1', at);
        expect(first.ok).toBe(true);
        expect((await caps.chargeAnswer(form, '198.51.100.2', at + 60_000)).ok).toBe(true);
        const third = await caps.chargeAnswer(form, '198.51.100.3', at + 120_000);
        // The oldest answer of the hour leaves it 58 minutes from now.
        expect(third).toEqual({ ok: false, cap: 'form', retryAfter: 3480, window: 'hour' });
        // An answer refused gives its place back.
        if (first.ok) await first.release();
        expect((await caps.chargeAnswer(form, '198.51.100.4', at + 180_000)).ok).toBe(true);
      } finally {
        await handle.destroy();
      }
    });

    it('an address counts by its /64 across every form; an e-mail address by its mailbox, a day', async () => {
      const handle = await dialect.make();
      const meta = handle.meta;
      try {
        const caps = createFormCaps(meta, capKey(TEST_SECRET));
        const at = 20_000_000;
        for (let i = 0; i < FORM_PER_ADDRESS_HOUR; i += 1) expect((await caps.chargeAnswer({ addOn: 'forms', id: `frm_${String(i)}`, perHour: 1000 }, `2001:db8::${(i + 1).toString(16)}`, at)).ok).toBe(true);
        expect(await caps.chargeAnswer({ addOn: 'forms', id: 'frm_x', perHour: 1000 }, '2001:db8::ffff', at)).toMatchObject({ ok: false, cap: 'address' });
        const form = { addOn: 'forms', id: 'frm_mail', perHour: 1000 };
        for (let i = 0; i < FORM_PER_EMAIL_DAY; i += 1) expect((await caps.chargeEmail(form, `nina+${String(i)}@gmail.com`, at)).ok).toBe(true);
        expect(await caps.chargeEmail(form, 'n.i.n.a@gmail.com', at + 1000)).toMatchObject({ ok: false, cap: 'email', window: 'day' });
        // Another form is another count.
        expect((await caps.chargeEmail({ ...form, id: 'frm_other' }, 'nina@gmail.com', at)).ok).toBe(true);
      } finally {
        await handle.destroy();
      }
    });
  });
}
