import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { manifestsRepo, rolesRepo, usersRepo, type MetaDb } from '@adminium/meta';
import { LEGS, installInvoicing, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';

// The app this copy of the proofs came from (`npm run proofs` names it), not a fixed lane.
const manifest = () => JSON.parse(readFileSync(`${process.env.CRM_APP ?? `${process.env.HOME}/Work/lanes/p67-app`}/whole/manifest.json`, 'utf8')) as Record<string, unknown>;

/** The Invoices add-on the app's quotes are built on, there before the app: the engine's own fixture, at a version the app accepts. */
/** The install as an owner who ticks Invoices & Receipts and every part: quotes are a part that waits for the add-on. */
const WITH_EVERY_PART = { install: { addOns: [{ key: 'invoices', version: '1.1.0' }], modules: { quotes: true, inbox: true, showroom: true, jobs: true, aftercare: true, supply: true, fleet: true } } };

async function invoices(meta: MetaDb): Promise<void> {
  const document = JSON.parse(readFileSync(new URL('./fixtures/invoices-add-on.json', import.meta.url), 'utf8')) as Record<string, unknown>;
  document['version'] = '1.1.0';
  const addOn = document['addOn'] as { attaches?: { app: string }[] };
  addOn.attaches = [...(addOn.attaches ?? []).filter((one) => one.app !== 'crm'), { app: 'crm' }];
  await manifestsRepo(meta, { encrypt: (v) => v, decrypt: (v) => v }).install({ manifestKey: 'invoices', version: '1.1.0', kind: 'add-on', source: 'file', document: document as never });
}

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`the CRM's first tables install and work on ${dialect}`, () => {
    let h: InvoicingHarness;
    beforeAll(async () => { h = await installInvoicing(dialect, manifest(), invoices, {}, WITH_EVERY_PART); }, 240_000);

    it('installs every rule the manifest writes: none is skipped', () => {
      // An install does not fail on a rule its server refuses: it leaves the rule out and says so only here.
      // (Found with ruling F: three stamps were left out this way, and nothing else showed it.)
      expect((h as unknown as { reply: { rules?: { skipped: unknown[] } } }).reply.rules?.skipped ?? []).toEqual([]);
    });
    afterAll(async () => { await h?.close(); });

    it('a deal takes the total of its newest sent quote, each version a document of its own', async () => {
      const w = await writerFor(h);
      const dana = await usersRepo(h.meta).create({ email: `dana-q-${dialect}@crm.dev`, name: 'Dana' });
      // The settings row is the install's own (the app's one starting row): nobody makes it here.
      expect((h.reply as { seeds?: unknown }).seeds).toEqual({ written: { settings: 1 }, kept: [] });
      expect(Number((await h.rows(`SELECT COUNT(*) AS n FROM ${h.real('settings')}`))[0]!['n'])).toBe(1);
      const co = await w.create('companies', { name: 'Nordwind' });
      // Who the quotes go to: a quote with nobody to send it to cannot be sent.
      const to = await w.create('contacts', { company_id: co['id'], name: 'Petra Lindqvist', email: 'petra@nordwind.example', may_email: true });
      const stage = await w.create('stages', { label: 'Negotiation', odds: 0.75, position: 3 });
      const deal = await w.create('deals', { name: 'Desk rows', company_id: co['id'], owner_id: dana.id, stage_id: stage['id'], typed_amount: 48000 });
      const one = async (ref: string, cols: string, id: unknown) => (await h.rows(`SELECT ${cols} FROM ${h.real(ref)} WHERE id = ${String(id)}`))[0]!;
      const dealNow = async () => {
        const d = await one('deals', 'quoted_amount, quote_id, amount, weighted_value', deal['id']);
        return [d['quoted_amount'] === null ? null : Number(d['quoted_amount']), d['quote_id'] === null ? null : Number(d['quote_id']), Number(d['amount']), Number(d['weighted_value'])];
      };
      expect(await dealNow()).toEqual([null, null, 48000, 36000]);

      // The price list (ruling F): what each thing costs at list. A line's list price is copied from the row it names.
      const price: Record<string, unknown> = {};
      for (const [name, each] of [['desk', 880], ['station', 1340], ['tray', 145], ['install', 2970]] as const) price[name] = (await w.create('price_list', { name, list_rate: each }))['id'];
      // Version 1, at list: 46 desks at 880, install 2,970, and the rest.
      const v1 = await w.create('quotes', { sent_to_contact_id: to['id'], deal_id: deal['id'] });
      for (const [qty, rate, what] of [[46, 880, 'desk'], [2, 1340, 'station'], [46, 145, 'tray'], [1, 2970, 'install']] as const) await w.create('quote_lines', { document_id: v1['id'], qty, rate, price_id: price[what] });
      let q = await one('quotes', 'number, subtotal, total, list_value, under_list_pct, unlisted_lines, needs_approval, may_send, threshold_pct, share_code, version', v1['id']);
      expect([Number(q['subtotal']), Number(q['total']), Number(q['list_value']), Number(q['under_list_pct']), Number(q['unlisted_lines']), Number(q['needs_approval']), Number(q['may_send']), Number(q['threshold_pct']), Number(q['version'])]).toEqual([52800, 52800, 52800, 0, 0, 0, 1, 5, 1]);
      expect(String(q['number'])).toMatch(/\d{4}$/);
      expect(String(q['share_code'])).toHaveLength(16);
      // Written and not sent: the deal still shows what was typed.
      expect(await dealNow()).toEqual([null, null, 48000, 36000]);
      await w.update('quotes', v1['id'], { status: 'sent' });
      expect(await dealNow()).toEqual([52800, Number(v1['id']), 52800, 39600]);

      // Version 2, 9.1 % under list: needs the manager, and counts for nothing until it is sent.
      const v2 = await w.create('quotes', { sent_to_contact_id: to['id'], deal_id: deal['id'], version: 2, replaces_id: v1['id'] });
      const v2Lines: Record<string, unknown> = {};
      // A list price typed with the line is not the writer's to give: the price list's stands (880, not the 1 typed here).
      for (const [qty, rate, what] of [[46, 780, 'desk'], [2, 1340, 'station'], [46, 145, 'tray'], [1, 2770, 'install']] as const) v2Lines[what] = (await w.create('quote_lines', { document_id: v2['id'], qty, rate, price_id: price[what], ...(what === 'desk' ? { list_rate: 1 } : {}) }))['id'];
      expect(Number((await one('quote_lines', 'list_rate', v2Lines['desk']))['list_rate'])).toBe(880);
      q = await one('quotes', 'number, family_no, total, list_value, under_list_pct, needs_approval, may_send', v2['id']);
      expect([Number(q['total']), Number(q['list_value']), Number(q['needs_approval']), Number(q['may_send'])]).toEqual([48000, 52800, 1, 0]);
      expect(Number(q['under_list_pct'])).toBeCloseTo(9.09, 1);
      const first = await one('quotes', 'number, family_no', v1['id']);
      expect(q['number']).not.toBe(first['number']);
      // More than 5 % under list and not approved: the send is refused, on the write itself.
      await expect(w.update('quotes', v2['id'], { status: 'sent' })).rejects.toThrow();
      expect((await one('quotes', 'status', v2['id']))['status']).toBe('draft');
      await w.update('quotes', v2['id'], { approval: 'asked', ask_reason: 'Another supplier on the desks' });
      await expect(w.update('quotes', v2['id'], { status: 'sent' })).rejects.toThrow();
      await w.update('quotes', v2['id'], { approval: 'approved' });
      q = await one('quotes', 'may_send, asked_at, asked_by_id, approval_decided_at, decided_by_id, approved_pct, approved_unlisted_lines', v2['id']);
      expect([Number(q['may_send']), q['asked_at'] !== null, q['approval_decided_at'] !== null]).toEqual([1, true, true]);
      // The approval remembers what it covered: 9.09 % under list, and no line without a list price.
      expect([Number(q['approved_pct']), Number(q['approved_unlisted_lines'])]).toEqual([9.09, 0]);
      // Approved and not sent: the deal still holds what the customer holds (S1, strict).
      expect(await dealNow()).toEqual([52800, Number(v1['id']), 52800, 39600]);
      // Cut further after the approval (the desks to 440, half their list): the approval no longer covers it, and it does not go.
      await w.update('quote_lines', v2Lines['desk'], { rate: 440 });
      q = await one('quotes', 'approval, may_send, under_list_pct', v2['id']);
      expect([q['approval'], Number(q['may_send']), Number(q['under_list_pct']) > 30]).toEqual(['approved', 0, true]);
      await expect(w.update('quotes', v2['id'], { status: 'sent' })).rejects.toThrow();
      // Dearer than what was approved, or back to it: it goes again with no second asking.
      await w.update('quote_lines', v2Lines['desk'], { rate: 790 });
      expect(Number((await one('quotes', 'may_send', v2['id']))['may_send'])).toBe(1);
      await w.update('quote_lines', v2Lines['desk'], { rate: 780 });
      // A line with no list price, added after the approval: not covered either, until asked and approved again.
      await w.create('quote_lines', { document_id: v2['id'], qty: 1, rate: 0, description: 'Site survey, free' });
      q = await one('quotes', 'unlisted_lines, needs_approval, may_send', v2['id']);
      expect([Number(q['unlisted_lines']), Number(q['needs_approval']), Number(q['may_send'])]).toEqual([1, 1, 0]);
      await w.update('quotes', v2['id'], { approval: 'asked', ask_reason: 'A free survey line' });
      await w.update('quotes', v2['id'], { approval: 'approved' });
      q = await one('quotes', 'may_send, approved_unlisted_lines', v2['id']);
      expect([Number(q['may_send']), Number(q['approved_unlisted_lines'])]).toEqual([1, 1]);
      await new Promise((r) => setTimeout(r, 1100));
      await w.update('quotes', v2['id'], { status: 'sent' });
      expect(await dealNow()).toEqual([48000, Number(v2['id']), 48000, 36000]);
      // Sending version 2 withdrew the version it replaces, in the same write: the customer holds one quote, never two.
      expect([(await one('quotes', 'status', v1['id']))['status'], (await one('quotes', 'withdrawn_at', v1['id']))['withdrawn_at'] !== null]).toEqual(['withdrawn', true]);
      // A quote whose only line has no list price needs approval whatever it costs.
      const v3 = await w.create('quotes', { sent_to_contact_id: to['id'], deal_id: deal['id'], version: 3, replaces_id: v2['id'] });
      await w.create('quote_lines', { document_id: v3['id'], qty: 1, rate: 99000, description: 'Bespoke reception desk' });
      q = await one('quotes', 'under_list_pct, unlisted_lines, unlisted_value, needs_approval, may_send', v3['id']);
      expect([Number(q['under_list_pct']), Number(q['unlisted_lines']), Number(q['unlisted_value']), Number(q['needs_approval']), Number(q['may_send'])]).toEqual([0, 1, 99000, 1, 0]);
      await expect(w.update('quotes', v3['id'], { status: 'sent' })).rejects.toThrow();
      // Asked and refused: the same version is changed and asked again (no new version is made), and once approved it may go.
      await w.update('quotes', v3['id'], { approval: 'asked', ask_reason: 'A bespoke desk' });
      await w.update('quotes', v3['id'], { approval: 'refused' });
      q = await one('quotes', 'approval, may_send, status', v3['id']);
      expect([q['approval'], Number(q['may_send']), q['status']]).toEqual(['refused', 0, 'draft']);
      await expect(w.update('quotes', v3['id'], { status: 'sent' })).rejects.toThrow();
      await w.create('quote_lines', { document_id: v3['id'], qty: 1, rate: 2970, price_id: price['install'] });
      await w.update('quotes', v3['id'], { approval: 'asked', ask_reason: 'With fitting at list' });
      expect((await one('quotes', 'approval', v3['id']))['approval']).toBe('asked');
      await w.update('quotes', v3['id'], { approval: 'approved' });
      expect(Number((await one('quotes', 'may_send', v3['id']))['may_send'])).toBe(1);
      // Withdrawn: it stops counting. The version before it was withdrawn when this one went out, so the deal is back to what was typed.
      await w.update('quotes', v2['id'], { status: 'withdrawn' });
      expect((await one('quotes', 'withdrawn_at', v2['id']))['withdrawn_at']).not.toBeNull();
      expect(await dealNow()).toEqual([null, null, 48000, 36000]);

      // A version the customer accepted in the meantime cannot be withdrawn: its replacement does not go, and nothing is written.
      const a1 = await w.create('quotes', { sent_to_contact_id: to['id'], deal_id: deal['id'] });
      await w.create('quote_lines', { document_id: a1['id'], qty: 1, rate: 2970, price_id: price['install'] });
      await w.update('quotes', a1['id'], { status: 'sent' });
      const a2 = await w.create('quotes', { sent_to_contact_id: to['id'], deal_id: deal['id'], version: 2, replaces_id: a1['id'] });
      await w.create('quote_lines', { document_id: a2['id'], qty: 1, rate: 2970, price_id: price['install'] });
      await w.update('quotes', a1['id'], { status: 'accepted' });
      // Accepted at the desk, by staff: the server says through which door.
      expect((await one('quotes', 'accepted_via', a1['id']))['accepted_via']).toBe('staff');
      await expect(w.update('quotes', a2['id'], { status: 'sent' })).rejects.toThrow();
      expect([(await one('quotes', 'status', a1['id']))['status'], (await one('quotes', 'status', a2['id']))['status']]).toEqual(['accepted', 'draft']);
      const refused = await one('quotes', 'sent_at, sent_to_email, valid_until', a2['id']);
      expect([refused['sent_at'], refused['sent_to_email']]).toEqual([null, null]);
      expect(Number((await one('deals', 'quote_id', deal['id']))['quote_id'])).toBe(Number(a1['id']));

      // A version may replace only a quote of its own deal: one that names another deal's quote is not sent, and that quote is left alone.
      const other = await w.create('deals', { name: 'Another deal', company_id: co['id'], owner_id: dana.id, stage_id: stage['id'], typed_amount: 1000 });
      const theirs = await w.create('quotes', { sent_to_contact_id: to['id'], deal_id: other['id'] });
      await w.create('quote_lines', { document_id: theirs['id'], qty: 1, rate: 2970, price_id: price['install'] });
      await w.update('quotes', theirs['id'], { status: 'sent' });
      const aimed = await w.create('quotes', { sent_to_contact_id: to['id'], deal_id: deal['id'], version: 3, replaces_id: theirs['id'] });
      await w.create('quote_lines', { document_id: aimed['id'], qty: 1, rate: 2970, price_id: price['install'] });
      expect(Number((await one('quotes', 'replaces_ok', aimed['id']))['replaces_ok'])).toBe(0);
      await expect(w.update('quotes', aimed['id'], { status: 'sent' })).rejects.toThrow();
      expect((await one('quotes', 'status', theirs['id']))['status']).toBe('sent');

      // A version that replaced a quote of its own deal, and that quote then stands on another deal: the check follows it, and the version is not sent.
      // (No role moves a quote between deals; this is the write service with nothing held back, to prove the figure itself.)
      const moved = await w.create('quotes', { sent_to_contact_id: to['id'], deal_id: deal['id'] });
      await w.create('quote_lines', { document_id: moved['id'], qty: 1, rate: 2970, price_id: price['install'] });
      const after = await w.create('quotes', { sent_to_contact_id: to['id'], deal_id: deal['id'], version: 2, replaces_id: moved['id'] });
      await w.create('quote_lines', { document_id: after['id'], qty: 1, rate: 2970, price_id: price['install'] });
      expect(Number((await one('quotes', 'replaces_ok', after['id']))['replaces_ok'])).toBe(1);
      await w.update('quotes', moved['id'], { deal_id: other['id'] });
      expect(Number((await one('quotes', 'replaces_ok', after['id']))['replaces_ok'])).toBe(0);
      await w.update('quotes', moved['id'], { status: 'sent' });
      await expect(w.update('quotes', after['id'], { status: 'sent' })).rejects.toThrow();
      expect((await one('quotes', 'status', moved['id']))['status']).toBe('sent');

      // The customer said no to a version: the next one is a quote of its own and does not name it. One that does name it is not sent
      // (a declined quote cannot be withdrawn), which the screen never asks for.
      const no1 = await w.create('quotes', { sent_to_contact_id: to['id'], deal_id: other['id'], family_no: 'F-NO' });
      await w.create('quote_lines', { document_id: no1['id'], qty: 1, rate: 2970, price_id: price['install'] });
      await w.update('quotes', moved['id'], { status: 'withdrawn' });
      await w.update('quotes', no1['id'], { status: 'sent' });
      await w.update('quotes', no1['id'], { status: 'declined' });
      const naming = await w.create('quotes', { sent_to_contact_id: to['id'], deal_id: other['id'], version: 2, family_no: 'F-NO', replaces_id: no1['id'] });
      await w.create('quote_lines', { document_id: naming['id'], qty: 1, rate: 2970, price_id: price['install'] });
      await expect(w.update('quotes', naming['id'], { status: 'sent' })).rejects.toThrow();
      await w.update('quotes', naming['id'], { replaces_id: null });
      await w.update('quotes', naming['id'], { status: 'sent' });
      expect([(await one('quotes', 'status', no1['id']))['status'], (await one('quotes', 'status', naming['id']))['status']]).toEqual(['declined', 'sent']);

      // Nobody to send it to: not sent. With a contact who has an address: sent, and the address is stamped on it.
      const nobody = await w.create('quotes', { deal_id: other['id'], family_no: 'F-NOBODY' });
      await w.create('quote_lines', { document_id: nobody['id'], qty: 1, rate: 2970, price_id: price['install'] });
      await expect(w.update('quotes', nobody['id'], { status: 'sent' })).rejects.toThrow();
      await w.update('quotes', nobody['id'], { sent_to_contact_id: to['id'] });
      await w.update('quotes', nobody['id'], { status: 'sent' });
      expect((await one('quotes', 'sent_to_email', nobody['id']))['sent_to_email']).toBe('petra@nordwind.example');
      // Once sent, who it went to is not changed.
      await expect(w.update('quotes', nobody['id'], { sent_to_contact_id: null })).rejects.toThrow();

      // The deal's amount is the quote before tax: with tax on a quote, the deal does not grow by it.
      const taxed = await w.create('quotes', { sent_to_contact_id: to['id'], deal_id: other['id'], version: 2, replaces_id: theirs['id'], tax_rate: 20 });
      await w.create('quote_lines', { document_id: taxed['id'], qty: 1, rate: 2970, price_id: price['install'] });
      await new Promise((r) => setTimeout(r, 1100));
      await w.update('quotes', taxed['id'], { status: 'sent' });
      const t = await one('quotes', 'subtotal, tax, total', taxed['id']);
      expect([Number(t['subtotal']), Number(t['tax']), Number(t['total'])]).toEqual([2970, 594, 3564]);
      expect(Number((await one('deals', 'amount', other['id']))['amount'])).toBe(2970);
    });

    it('the team, the inbox and the showroom tables take their rows', async () => {
      const w = await writerFor(h);
      const users = usersRepo(h.meta);
      const ivy = await users.create({ email: `ivy-t-${dialect}@crm.dev`, name: 'Ivy' });
      const dana = await users.create({ email: `dana-t-${dialect}@crm.dev`, name: 'Dana' });
      const one = async (ref: string, cols: string, id: unknown) => (await h.rows(`SELECT ${cols} FROM ${h.real(ref)} WHERE id = ${String(id)}`))[0]!;
      // A one-to-one and its session: private, the pair in two staff columns each.
      const oo = await w.create('one_to_ones', { manager_id: ivy.id, rep_id: dana.id });
      const session = await w.create('one_to_one_sessions', { one_to_one_id: oo['id'], manager_id: ivy.id, rep_id: dana.id, held_on: '2026-07-16', notes: 'x'.repeat(3000) });
      expect(String((await one('one_to_one_sessions', 'notes', session['id']))['notes'])).toHaveLength(3000);
      await w.create('actions', { text: 'Clear the queue', owner_id: dana.id, source: 'one-to-one', one_to_one_id: oo['id'] });
      await w.create('targets', { rep_id: dana.id, year: 2026, amount: 140000 });
      await w.create('reps', { user_id: dana.id });
      // A thread, its two people, a message; the same person twice in one thread is refused.
      const thread = await w.create('threads', { kind: 'direct' });
      await w.create('thread_members', { thread_id: thread['id'], user_id: ivy.id });
      await w.create('thread_members', { thread_id: thread['id'], user_id: dana.id });
      await expect(w.create('thread_members', { thread_id: thread['id'], user_id: dana.id })).rejects.toThrow();
      await w.create('messages', { thread_id: thread['id'], text: 'Done.' });
      // Cover: a dated listing against the owner, with an open end.
      await w.create('covers', { owner_id: dana.id, cover_id: ivy.id, starts_on: '2026-08-10', ends_on: '2026-08-21' });
      await w.create('covers', { owner_id: dana.id, cover_id: ivy.id, starts_on: '2026-09-01' });
      // An enquiry claimed: the claimer is stamped, and it was received when it was made.
      const show = await w.create('shows', { name: 'The Leeds Workspace Show', starts_on: '2026-07-15' });
      const enquiry = await w.create('enquiries', { source: 'show', company_name: 'Pemberton Chambers', show_id: show['id'], warmth: 'hot' });
      const e = await one('enquiries', 'state, received_at, claimed_by_id', enquiry['id']);
      expect([e['state'], e['received_at'] !== null, e['claimed_by_id']]).toEqual(['open', true, null]);
      await w.update('enquiries', enquiry['id'], { state: 'claimed' });
      expect((await one('enquiries', 'claimed_by_id', enquiry['id']))['claimed_by_id']).not.toBeNull();
      // The showroom, a sample out on loan, a piece on the floor, and a mail in the app's outbox (a column named `to`).
      const space = await w.create('showroom_spaces', { name: 'Main floor' });
      const booking = await w.create('showroom_bookings', { space_id: space['id'], party: 1, starts_at: '2026-07-29T10:00:00Z', minutes: 60 });
      // The space is taken for that hour: a booking inside it is refused, one that starts as it ends is not.
      const inside = { space_id: space['id'], party: 2, starts_at: '2026-07-29T10:30:00Z', minutes: 30 };
      await expect(w.create('showroom_bookings', inside)).rejects.toMatchObject({ code: 'BOOKING_TAKEN' });
      await w.create('showroom_bookings', { ...inside, starts_at: '2026-07-29T11:00:00Z' });
      await expect(w.update('showroom_bookings', booking['id'], { state: 'cancelled' })).rejects.toThrow();
      await w.update('showroom_bookings', booking['id'], { state: 'cancelled', cancel_reason: 'They moved the day' });
      // Cancelled, it takes nothing: the half hour is free, and the cancelled one cannot come back over it.
      await w.create('showroom_bookings', inside);
      const sample = await w.create('samples', { name: 'Fabric book', held: 2 });
      const loan = await w.create('sample_loans', { sample_id: sample['id'], out_on: '2026-07-17', due_back: '2026-07-31' });
      await w.create('sample_chases', { loan_id: loan['id'], chased_on: '2026-07-25', by_id: ivy.id });
      await w.create('display_pieces', { name: 'Bench desk run', space_id: space['id'], out_since: '2026-02-10', spec: 'current' });
      const mail = await w.create('outbox', { kind: 'quote-sent', to: 'petra@nordwind.example' });
      expect((await one('outbox', 'status', mail['id']))['status']).toBe('queued');
    });

    it('a won deal becomes a job: its visits, its crew, a snag that stops sign-off, a time sheet', async () => {
      const w = await writerFor(h);
      const users = usersRepo(h.meta);
      const yusuf = await users.create({ email: `yusuf-j-${dialect}@crm.dev`, name: 'Yusuf' });
      const one = async (ref: string, cols: string, id: unknown) => (await h.rows(`SELECT ${cols} FROM ${h.real(ref)} WHERE id = ${String(id)}`))[0]!;
      // A snag reads its due days from the settings row: on an install with no sample that is the row the install wrote.
      expect(Number((await h.rows(`SELECT COUNT(*) AS n FROM ${h.real('settings')}`))[0]!['n'])).toBe(1);
      const co = await w.create('companies', { name: 'Tandem Robotics' });
      const stage = await w.create('stages', { label: 'Verbal', odds: 0.9, position: 5 });
      const deal = await w.create('deals', { name: 'Test-floor workbenches', company_id: co['id'], stage_id: stage['id'], owner_id: yusuf.id, typed_amount: 15600 });
      // A deal is somebody's: one with no owner is refused.
      await expect(w.create('deals', { name: 'Nobody\'s', company_id: co['id'], stage_id: stage['id'], typed_amount: 1 })).rejects.toThrow();
      const van = await w.create('vehicles', { name: 'Blue van', plate: 'YJ19 KPX' });
      const blue = await w.create('crews', { name: 'Blue crew', vehicle_id: van['id'] });
      const red = await w.create('crews', { name: 'Red crew' });
      await w.create('crew_members', { crew_id: blue['id'], user_id: yusuf.id, lead: true });
      // The blue crew works Monday to Friday; the red crew has no days written down, and is held to none.
      for (const weekday of ['mon', 'tue', 'wed', 'thu', 'fri']) await w.create('crew_days', { crew_id: blue['id'], weekday });
      // The job: numbered, with what the crew needs of its site, and its deal's name copied on.
      const job = await w.create('jobs', { deal_id: deal['id'], site_name: 'Tandem Robotics', town: 'Cambridge', access_note: 'Sign in at reception.', site_phone: '01223 47 1108' });
      const j = await one('jobs', 'code, title, company_id, state, blocking_snags', job['id']);
      expect([j['code'], j['title'], Number(j['company_id']), j['state'], Number(j['blocking_snags'])]).toEqual(['J-01', 'Test-floor workbenches', Number(co['id']), 'open', 0]);
      // A visit waits until it has a day and a crew, and takes the site's details with it.
      const visit = await w.create('job_visits', { job_id: job['id'], kind: 'install', what: 'Test-floor workbenches', stock_ready_on: '2026-08-05' });
      await expect(w.update('job_visits', visit['id'], { state: 'booked' })).rejects.toThrow();
      // Not before the stock is in.
      await expect(w.update('job_visits', visit['id'], { state: 'booked', day: '2026-08-04', crew_id: blue['id'] })).rejects.toThrow();
      // Not on a Saturday, which the blue crew does not work; waiting, the visit may hold that day.
      await expect(w.update('job_visits', visit['id'], { state: 'booked', day: '2026-08-08', crew_id: blue['id'] })).rejects.toMatchObject({ code: 'BOOKING_CLOSED' });
      await w.update('job_visits', visit['id'], { day: '2026-08-08', crew_id: blue['id'] });
      await expect(w.update('job_visits', visit['id'], { state: 'booked' })).rejects.toMatchObject({ code: 'BOOKING_CLOSED' });
      await w.update('job_visits', visit['id'], { day: '2026-08-05', crew_id: blue['id'] });
      await w.update('job_visits', visit['id'], { state: 'booked' });
      const v = await one('job_visits', 'state, site_name, site_town, site_phone, access_note', visit['id']);
      expect([v['state'], v['site_name'], v['site_town'], v['site_phone'], v['access_note']]).toEqual(['booked', 'Tandem Robotics', 'Cambridge', '01223 47 1108', 'Sign in at reception.']);
      // A snag that stops sign-off: due five days on, counted on the job, and carrying its visit's crew.
      const snag = await w.create('snags', { job_id: job['id'], visit_id: visit['id'], text: 'Cable trays short by two metres', stops_sign_off: true });
      const s = await one('snags', 'crew_id, raised_on, due_on, state', snag['id']);
      expect([Number(s['crew_id']), s['raised_on'] !== null, s['due_on'] !== null, s['state']]).toEqual([Number(blue['id']), true, true, 'open']);
      expect(Number((await one('jobs', 'blocking_snags', job['id']))['blocking_snags'])).toBe(1);
      // The crew changes: the snag follows its visit.
      await w.update('job_visits', visit['id'], { state: 'waiting' });
      await w.update('job_visits', visit['id'], { crew_id: red['id'] });
      expect(Number((await one('snags', 'crew_id', snag['id']))['crew_id'])).toBe(Number(red['id']));
      // Signing off: not without a sign-off, and not while the snag stands.
      await w.update('jobs', job['id'], { state: 'installed' });
      await expect(w.update('jobs', job['id'], { state: 'signed-off' })).rejects.toThrow();
      await w.create('sign_offs', { job_id: job['id'], visit_id: visit['id'], check_1: true, check_2: true, check_3: true, check_4: true, check_5: true, signer_name: 'Yusuf Demir', signature: 'file_x' });
      await expect(w.update('jobs', job['id'], { state: 'signed-off' })).rejects.toThrow();
      await expect(w.update('snags', snag['id'], { state: 'put-right' })).rejects.toThrow();
      await w.update('snags', snag['id'], { state: 'put-right', put_right_note: 'Two more metres fitted' });
      expect(Number((await one('jobs', 'blocking_snags', job['id']))['blocking_snags'])).toBe(0);
      await w.update('jobs', job['id'], { state: 'signed-off' });
      expect((await one('jobs', 'state', job['id']))['state']).toBe('signed-off');
      // A delivery note and a line three links from the job; a time sheet, sent, then locked.
      const note = await w.create('delivery_notes', { job_id: job['id'], visit_id: visit['id'], damage: false });
      const line = await w.create('delivery_note_lines', { note_id: note['id'], what: 'Workbench, 1800mm', ordered: 12, delivered: 12 });
      const l = await one('delivery_note_lines', 'job_id, visit_id, crew_id', line['id']);
      expect([Number(l['job_id']), Number(l['visit_id']), Number(l['crew_id'])]).toEqual([Number(job['id']), Number(visit['id']), Number(red['id'])]);
      const sheet = await w.create('time_sheets', { user_id: yusuf.id, week_of: '2026-07-20' });
      const hours = await w.create('time_sheet_lines', { sheet_id: sheet['id'], day: '2026-07-21', what: 'Tandem Robotics install', hours: 7, travel_hours: 3, job_id: job['id'] });
      await w.update('time_sheets', sheet['id'], { state: 'sent' });
      await expect(w.update('time_sheet_lines', hours['id'], { hours: 9 })).rejects.toThrow();
      // Sending a sheet back is kept for the Operations manager: anybody else is refused even with a note, and she without one.
      await expect(w.update('time_sheets', sheet['id'], { state: 'sent-back', sent_back_note: 'Tuesday looks short' })).rejects.toThrow(/Only some roles/);
      const ada = await users.create({ email: `ada-j-${dialect}@crm.dev`, name: 'Ada' });
      await rolesRepo(h.meta).assignToUser(ada.id, (await rolesRepo(h.meta).findBySlug('crm-ops-manager'))!.id);
      const asAda = { ...w.desk, actor: { kind: 'user' as const, id: ada.id, label: 'Ada Novak' } };
      await expect(w.update('time_sheets', sheet['id'], { state: 'sent-back' }, asAda)).rejects.toThrow();
      await w.update('time_sheets', sheet['id'], { state: 'sent-back', sent_back_note: 'Tuesday looks short' }, asAda);
      await w.update('time_sheet_lines', hours['id'], { hours: 9 });
      // The rest take a row each.
      await w.create('follow_ups', { job_id: job['id'], owner_id: yusuf.id, due_at: '2026-08-22T10:00:00Z', text: 'Aftercare call', kind: 'aftercare', call_no: 1 });
      await w.create('complaints', { company_id: co['id'], job_id: job['id'], cause: 'damaged', text: 'x'.repeat(1500) });
      await w.create('warranty_claims', { job_id: job['id'], what: 'Bench top scratched' });
      await w.create('feedback', { job_id: job['id'], score: 4, answered_on: '2026-07-24' });
      await w.create('waste_removals', { job_id: job['id'], day: '2026-06-05', what: 'Twelve benches', tonnes: 0.9, route: 'recycled' });
      // Stock is Inventory's. Without the add-on a need cannot name an item (the link is refused, by name); an empty one is taken.
      await expect(w.create('deal_stock_needs', { deal_id: deal['id'], item: 1, qty: 12 })).rejects.toMatchObject({ code: 'POSTING_REFUSED', details: { reason: 'add-on-unavailable', column: 'item' } });
      await w.create('deal_stock_needs', { deal_id: deal['id'], qty: 12 });
      await expect(w.create('warranty_claims', { job_id: job['id'], what: 'Castor split', supplier: 3 })).rejects.toMatchObject({ code: 'POSTING_REFUSED', details: { reason: 'add-on-unavailable', column: 'supplier' } });
      await w.create('vehicle_checks', { vehicle_id: van['id'], day: '2026-07-27', tyres: true, fluids: true, lights: true, straps: true, tail_lift: true });
      await w.create('vehicle_faults', { vehicle_id: van['id'], text: 'Reversing camera goes blank in the wet.' });
      await w.create('fuel_fills', { vehicle_id: van['id'], day: '2026-07-24', litres: 33.1, cost: 48.33, odometer: 118420 });
      await w.create('certificates', { user_id: yusuf.id, name: 'Manual handling', valid_until: '2027-03-14' });
      await w.create('subcontractors', { name: 'Halden Fit-Out', hands: 2, day_rate: 340 });
      await w.create('insurance_incidents', { day: '2026-07-24', what: 'Windscreen, stone on the road', kind: 'glass' });
    });

    it('installs its tables and keeps its figures, copies and stamps', async () => {
      const w = await writerFor(h);
      const dana = await usersRepo(h.meta).create({ email: `dana-${dialect}@crm.dev`, name: 'Dana' });
      const terr = await w.create('territories', { name: 'North', owner_id: dana.id });
      const co = await w.create('companies', { name: 'Nordwind', town: 'Hull', territory_id: terr['id'], account_owner_id: dana.id });
      const ct = await w.create('contacts', { company_id: co['id'], name: 'Petra', may_email: true });
      // the cycle: a company names one of its own contacts
      await w.update('companies', co['id'], { ask_for_contact_id: ct['id'] });
      const s1 = await w.create('stages', { label: 'Proposal', odds: 0.5, position: 2 });
      const s2 = await w.create('stages', { label: 'Negotiation', odds: 0.75, position: 3 });
      const deal = await w.create('deals', { name: 'Desk rows', company_id: co['id'], contact_id: ct['id'], owner_id: dana.id, stage_id: s1['id'], typed_amount: 48000 });
      const read = async (ref: string, cols: string, id: unknown) => (await h.rows(`SELECT ${cols} FROM ${h.real(ref)} WHERE id = ${String(id)}`))[0]!;
      let d = await read('deals', 'amount, stage_odds, weighted_value, state, opened_on, entered_stage_at, closed_at', deal['id']);
      expect([Number(d['amount']), Number(d['stage_odds']), Number(d['weighted_value']), d['state']]).toEqual([48000, 0.5, 24000, 'open']);
      expect(d['opened_on']).not.toBeNull();
      expect(d['closed_at']).toBeNull();
      expect([(await read('deals', 'closed_on, cycle_days', deal['id']))['closed_on'], (await read('deals', 'closed_on, cycle_days', deal['id']))['cycle_days']]).toEqual([null, null]);
      const entered = d['entered_stage_at'];
      await new Promise((r) => setTimeout(r, 1100));
      await w.update('deals', deal['id'], { stage_id: s2['id'] });
      d = await read('deals', 'amount, stage_odds, weighted_value, entered_stage_at', deal['id']);
      expect([Number(d['stage_odds']), Number(d['weighted_value'])]).toEqual([0.75, 36000]);
      expect(String(d['entered_stage_at'])).not.toBe(String(entered));
      // the stage's odds change: the deal follows
      await w.update('stages', s2['id'], { odds: 0.8 });
      d = await read('deals', 'stage_odds, weighted_value', deal['id']);
      expect([Number(d['stage_odds']), Number(d['weighted_value'])]).toEqual([0.8, 38400]);
      // What counts toward its owner's target (Targets, ledger 14): while it is open, its weighted value.
      expect(Number((await read('deals', 'target_value', deal['id']))['target_value'])).toBe(38400);
      // the mark
      const mark = await w.create('deal_marks', { deal_id: deal['id'] });
      let m = await read('deal_marks', 'company_id, stage_id, owner_id, state', mark['id']);
      expect([Number(m['company_id']), Number(m['stage_id']), m['owner_id'], m['state']]).toEqual([Number(co['id']), Number(s2['id']), dana.id, 'open']);
      await w.update('deals', deal['id'], { state: 'won' });
      m = await read('deal_marks', 'state', mark['id']);
      expect(m['state']).toBe('won');
      d = await read('deals', 'closed_at, closed_on, opened_on, cycle_days', deal['id']);
      expect(d['closed_at']).not.toBeNull();
      // The day it closed, and the whole days it was open: opened and closed today, so none.
      expect(String(d['closed_on']).slice(0, 10)).toBe(String(d['opened_on']).slice(0, 10));
      expect(Number(d['cycle_days'])).toBe(0);
      // Won, it counts toward the target at its whole amount; lost, at nothing.
      expect(Number((await read('deals', 'target_value', deal['id']))['target_value'])).toBe(48000);
      const other = await w.create('deals', { name: 'Desk rows, phase two', company_id: co['id'], contact_id: ct['id'], owner_id: dana.id, stage_id: s1['id'], typed_amount: 9000 });
      expect(Number((await read('deals', 'target_value', other['id']))['target_value'])).toBe(4500);
      const reason = await w.create('lost_reasons', { label: 'Budget pulled', position: 1 });
      await w.update('deals', other['id'], { state: 'lost', lost_reason_id: reason['id'] });
      expect(Number((await read('deals', 'target_value', other['id']))['target_value'])).toBe(0);
      // a visit, its note, an agreed line three links from the deal
      const visit = await w.create('site_visits', { deal_id: deal['id'], rep_id: dana.id, starts_at: '2026-07-29T10:30:00Z', minutes: 90, purpose: 'Walk the floor' });
      const note = await w.create('visit_notes', { visit_id: visit['id'], saw: 'x'.repeat(1500) });
      const agreed = await w.create('visit_agreed', { visit_note_id: note['id'], text: 'Layout by Friday', position: 0 });
      expect(Number((await read('visit_agreed', 'visit_id', agreed['id']))['visit_id'])).toBe(Number(visit['id']));
      // a follow-up done: stamped
      const fu = await w.create('follow_ups', { deal_id: deal['id'], owner_id: dana.id, due_at: '2026-07-30T11:00:00Z', text: 'Agree the window', kind: 'step' });
      await w.update('follow_ups', fu['id'], { done: true });
      const f = await read('follow_ups', 'done_at, done_by_id', fu['id']);
      expect(f['done_at']).not.toBeNull();
      // settings: one row with its defaults
      const st = (await h.rows(`SELECT id FROM ${h.real('settings')}`))[0]!;
      const s = await read('settings', 'approval_threshold_pct, quote_valid_days, certificate_warn_days, week_starts, distance_unit', st['id']);
      expect([Number(s['approval_threshold_pct']), Number(s['quote_valid_days']), Number(s['certificate_warn_days']), s['week_starts'], s['distance_unit']]).toEqual([5, 30, 42, 'mon', 'km']);
      const tables = await h.rows(dialect === 'sqlite' ? `SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name LIKE 'crm\\_%' ESCAPE '\\' AND name NOT LIKE '%sample_data'` : dialect === 'postgres' ? `SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = current_schema() AND table_name LIKE 'crm\\_%'` : `SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name LIKE 'crm\\_%'`);
      expect(Number(tables[0]!['n'])).toBe(75);
    });
  });
}
