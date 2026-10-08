// SPDX-License-Identifier: AGPL-3.0-only
/**
 * OFFERS' MAIL.
 *
 * A gift card's own mail goes when the card becomes active: at once, or on
 * the morning of the day it is dated for; a credit gets a mail of its own
 * with no code in it; a voucher made for somebody is sent to them. "Send
 * again" writes again, each time. A card with nobody to write to logs one
 * skipped row. More value on a card sends no second "your gift card". And
 * the log of what was sent never holds a code.
 *
 * A card becomes active by a row the ledger plans, not by a person's save;
 * here that change is told to the outbox as the server's own listener tells
 * it — the row as it was, and as it is.
 */
import { documentSequencesRepo, settingsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { decryptSecret, encryptSecret } from '../../../src/config/secrets.js';
import { createWriteService } from '../../../src/crud/write-service.js';
import { emailSecretKey } from '../../../src/email/config.js';
import { emailEnvelopeKey } from '../../../src/email/send.js';
import { createOutboxProducers } from '../../../src/outbox/producers.js';
import { createOutboxSender, type OutboxSender } from '../../../src/outbox/sender.js';
import { createPublicViews } from '../../../src/public-api/runtime.js';
import { TEST_SECRET } from '../../helpers.js';
import { LEGS } from '../../invoicing-install.helpers.js';
import { installCustomerKey } from '../../../src/public-api/customer-key.js';
import { builtAddOn, installBuilt, writing, type Writing } from '../harness.js';

const offers = builtAddOn('offers');
type Mail = { to: string; subject: string; text: string; html?: string };
type Row = Record<string, unknown>;

describe.each(LEGS)("Offers' mail — %s", (dialect, available) => {
  const run = available && offers !== null;
  let w: Writing;
  let producers: ReturnType<typeof createOutboxProducers>;
  let sender: OutboxSender;
  let clock = Date.now();

  const t = (ref: string) => w.real(ref);
  const mail = async (): Promise<Mail[]> =>
    (await w.h.meta.db.selectFrom('adminium_jobs').selectAll().where('kind', '=', 'email.send').orderBy('createdAt').orderBy('id').execute()).map((job) => {
      const payload = (typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload) as { envelope: string };
      return JSON.parse(decryptSecret(payload.envelope, emailEnvelopeKey(TEST_SECRET))) as Mail;
    });
  const logOf = async (column: 'card_id' | 'voucher_id', id: unknown) =>
    (await w.h.rows(`select kind, status, skip_reason, error from ${t('messages')} where ${column} = ${String(id)} order by id`)).map((row) => `${String(row['kind'])} ${String(row['status'])}${row['skip_reason'] === null || row['skip_reason'] === undefined ? '' : ` (${String(row['skip_reason'])})`}${row['error'] === null || row['error'] === undefined ? '' : ` [${String(row['error'])}]`}`);
  /** Tells the outbox a row of a table changed (or was made), then sends everything that is due by `at`. */
  const told = async (ref: string, id: unknown, before: Row | null, at?: number) => {
    const views = createPublicViews(w.h.meta);
    const table = (await views.viewFor(w.h.connectionId))!.table(t(ref));
    const after = await w.one(ref, id);
    await producers.onRecordEvent({ connectionId: w.h.connectionId, table, action: before === null ? 'create' : 'update', entity: { connectionId: w.h.connectionId, table: table.id, pk: { id }, label: '' }, before, after } as never);
    clock = Math.max(clock, Date.now()) + 60_000;
    await sender.sendApp('offers', at ?? clock);
  };
  /** A card made, then loaded by a manager's hand — which makes it active — with the outbox told of that change. */
  const card = async (values: Row, amount = '50.00') => {
    const made = (await w.create('gift_cards', values)).row;
    const before = await w.one('gift_cards', made['id']);
    await w.create('card_actions', { card_id: made['id'], action: 'issue', amount, reason: 'Sold at the desk', paid_by: 'cash' });
    await told('gift_cards', made['id'], before);
    return { id: made['id'], row: await w.one('gift_cards', made['id']) };
  };
  const grouped = (code: unknown): string => {
    const bare = String(code).replace(/^GC-?/, '').replace(/-/g, '');
    return `GC-${bare.slice(0, 4)}-${bare.slice(4, 8)}-${bare.slice(8, 12)}`;
  };

  beforeAll(async () => {
    // The server says its secret as it starts; a key that stands for an address is made under it.
    installCustomerKey('a secret only this test server knows, long enough');
    if (!run) return;
    w = await writing(await installBuilt(dialect, offers));
    await settingsRepo(w.h.meta).set('email.smtp', { host: 'localhost', port: 587, user: 'postmaster', passEncrypted: encryptSecret('hunter2', emailSecretKey(TEST_SECRET)), from: 'Daybreak Coffee <no-reply@daybreak.dev>', secure: false } as never);
    const views = createPublicViews(w.h.meta);
    const writes = createWriteService({ sequences: documentSequencesRepo(w.h.meta) });
    producers = createOutboxProducers({ meta: w.h.meta, manager: w.h.manager, viewFor: views.viewFor, writes });
    sender = createOutboxSender({ meta: w.h.meta, manager: w.h.manager, viewFor: views.viewFor, writes, live: () => producers.live(), secret: TEST_SECRET, hostFor: async () => 'daybreak.dev', documents: () => w.h.pipeline! });
  }, 600_000);
  afterAll(async () => {
    if (run) await w.h.close();
  });

  it.skipIf(!run)('a card issued now is queued at once, to its recipient, with its code in groups of four and what is on it', async () => {
    const before = (await mail()).length;
    const made = await card({ recipient_name: 'Ana', recipient_email: 'ana@calla.dev', sender_name: 'Maya', message: 'Happy birthday' });
    expect(made.row['status']).toBe('active');
    expect(made.row['notify']).toBe('card');
    expect(await logOf('card_id', made.id)).toEqual(['gift_card sent']);
    const sent = (await mail()).slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toContain('ana@calla.dev');
    expect(sent[0]!.subject).toMatch(/^Your gift card from /);
    expect(sent[0]!.text).toContain('Maya sent you a gift card');
    expect(sent[0]!.text).not.toContain('You have a gift card');
    expect(sent[0]!.text).toContain('Happy birthday');
    // The mail prints the code as a person reads it out, word and all.
    expect(sent[0]!.text).toContain(grouped(made.row['code']));
    expect(sent[0]!.text).toMatch(/50\.00/);
    // With no app that serves a balance page there is no button, and the mail says where to ask.
    expect(sent[0]!.text).toContain('Ask at the counter for your balance.');
    expect(sent[0]!.text).not.toContain('See your balance');
    expect(sent[0]!.text).not.toContain('{{');
  });

  it.skipIf(!run)('a card from nobody in particular says "You have a gift card", and one with a last day says which', async () => {
    await w.update('settings', (await w.rowsOf('settings'))[0]!['id'], { card_expiry_months: 12 });
    const before = (await mail()).length;
    const made = await card({ recipient_name: 'Ben', recipient_email: 'ben@calla.dev' });
    const [sent] = (await mail()).slice(before);
    expect(sent!.text).toContain('You have a gift card');
    expect(sent!.text).not.toContain('sent you a gift card');
    expect(made.row['expires_on']).not.toBeNull();
    expect(sent!.text).toContain('Use it by');
    await w.update('settings', (await w.rowsOf('settings'))[0]!['id'], { card_expiry_months: null });
  });

  it.skipIf(!run)('a card with no address logs one skipped row and writes to nobody', async () => {
    const before = (await mail()).length;
    const made = await card({ recipient_name: 'Walk-in' });
    expect(await mail()).toHaveLength(before);
    const log = await logOf('card_id', made.id);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatch(/^gift_card skipped/);
  });

  it.skipIf(!run)('a credit gets the credit mail and no card mail: what it holds, how to use it, no code and no link', async () => {
    const before = (await mail()).length;
    const made = await card({ kind: 'credit', owner_email: 'cleo@calla.dev' }, '42.00');
    expect(made.row['notify']).toBe('credit');
    expect(await logOf('card_id', made.id)).toEqual(['credit sent']);
    const sent = (await mail()).slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toContain('cleo@calla.dev');
    expect(sent[0]!.subject).toMatch(/^You have credit at /);
    expect(sent[0]!.text).toMatch(/42\.00/);
    expect(sent[0]!.text).toContain('Tell our staff your email address to use it.');
    expect(sent[0]!.text).not.toMatch(/GC-|Your code|http/);
  });

  it.skipIf(!run)('a top-up sends no second card mail', async () => {
    const made = await card({ recipient_name: 'Dee', recipient_email: 'dee@calla.dev' });
    const before = (await mail()).length;
    const was = await w.one('gift_cards', made.id);
    await w.create('card_actions', { card_id: made.id, action: 'top_up', amount: '25.00', reason: 'Asked for more', paid_by: 'cash' });
    await told('gift_cards', made.id, was);
    expect(await mail()).toHaveLength(before);
    expect(await logOf('card_id', made.id)).toEqual(['gift_card sent']);
    expect(Number((await w.one('gift_cards', made.id))['balance'])).toBe(75);
  });

  it.skipIf(!run)('send again goes to the address on the card and carries its code, and twice is two mails', async () => {
    const made = await card({ recipient_name: 'Eli', recipient_email: 'eli@calla.dev' });
    const before = (await mail()).length;
    for (const minute of [1, 2]) {
      const was = await w.one('gift_cards', made.id);
      await w.update('gift_cards', made.id, { resent_at: new Date(clock + minute * 60_000).toISOString() });
      await told('gift_cards', made.id, was);
    }
    expect(await logOf('card_id', made.id)).toEqual(['gift_card sent', 'gift_card_again sent', 'gift_card_again sent']);
    const sent = (await mail()).slice(before);
    expect(sent).toHaveLength(2);
    for (const one of sent) {
      expect(one.to).toContain('eli@calla.dev');
      expect(one.text).toContain(grouped(made.row['code']));
    }
  });

  it.skipIf(!run)('a card dated for a later day waits until 09:00 that day, and one cancelled meanwhile is never sent', async () => {
    const day = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const before = (await mail()).length;
    const made = await card({ recipient_name: 'Fay', recipient_email: 'fay@calla.dev', send_on: day });
    expect(made.row['notify']).toBe('card_dated');
    // Told now, and nothing is due yet.
    expect(await logOf('card_id', made.id)).toEqual(['gift_card_dated queued']);
    expect((await mail()).slice(before).map((one) => `${one.to} ${one.subject}`)).toEqual([]);
    expect(await logOf('card_id', made.id)).toEqual(['gift_card_dated queued']);
    // It is due at nine that morning on the venue's clock: a moment of that day, at 09:00 somewhere on earth.
    const due = new Date(String((await w.h.rows(`select due from ${t('messages')} where card_id = ${String(made.id)}`))[0]!['due'])).getTime();
    expect(Math.abs(due - Date.parse(`${day}T09:00:00.000Z`))).toBeLessThanOrEqual(14 * 3_600_000);
    expect(new Date(due).getUTCMinutes() % 15).toBe(0);
    // A minute before: still nothing. A minute after: it goes.
    await sender.sendApp('offers', due - 60_000);
    expect(await mail()).toHaveLength(before);
    await sender.sendApp('offers', due + 60_000);
    expect(await logOf('card_id', made.id)).toEqual(['gift_card_dated sent']);
    expect((await mail()).slice(before).map((one) => one.to.includes('fay@calla.dev'))).toEqual([true]);

    const other = await card({ recipient_name: 'Gus', recipient_email: 'gus@calla.dev', send_on: day });
    const count = (await mail()).length;
    const was = await w.one('gift_cards', other.id);
    await w.update('gift_cards', other.id, { status: 'void', void_reason: 'Sold by mistake' });
    await told('gift_cards', other.id, was, due + 60_000);
    expect(await mail()).toHaveLength(count);
    expect((await logOf('card_id', other.id))[0]).toMatch(/^gift_card_dated skipped/);
  });

  it.skipIf(!run)('a voucher made for a named person is mailed to them, and one for whoever holds it is nobody\'s mail', async () => {
    const before = (await mail()).length;
    const named = (await w.create('vouchers', { worth: 'amount', value: '15', public_name: '$15.00 off', holder_name: 'Hana', holder_email: 'hana@calla.dev' })).row;
    await told('vouchers', named['id'], null);
    expect(await logOf('voucher_id', named['id'])).toEqual(['voucher sent']);
    const [sent] = (await mail()).slice(before);
    expect(sent!.to).toContain('hana@calla.dev');
    expect(sent!.subject).toMatch(/^Your voucher from /);
    expect(sent!.text).toContain('$15.00 off');
    expect(sent!.text).toContain('Only for you, signed in or named by our staff.');
    const code = String((await w.one('vouchers', named['id']))['code']);
    expect(sent!.text).toContain(`${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}`);
    const bearer = (await w.create('vouchers', { worth: 'amount', value: '5', public_name: '$5.00 off' })).row;
    const count = (await mail()).length;
    await told('vouchers', bearer['id'], null);
    expect(await mail()).toHaveLength(count);
    expect(await logOf('voucher_id', bearer['id'])).toEqual([]);
  });

  it.skipIf(!run)('the messages table holds no code, whatever was sent', async () => {
    const codes = [...(await w.rowsOf('gift_cards')), ...(await w.rowsOf('vouchers'))].map((row) => String(row['code'] ?? '')).filter((code) => code.length >= 12);
    expect(codes.length).toBeGreaterThan(3);
    const log = JSON.stringify(await w.rowsOf('messages'));
    for (const code of codes) {
      expect(log).not.toContain(code);
      expect(log).not.toContain(code.replace(/^GC-/, ''));
    }
  });
});
