// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The words plan 78's T06 adds: a booking's calendar entry, a mail's calendar
 * part and review link, a public box that says no, the refund of a studio's
 * cancel, and the fifth reason a review is hidden for.
 */
import { describe, expect, it } from 'vitest';

import { bookingCalendarIssues, bookingCalendarSchema, type BookingCalendar } from '../src/booking-calendar.js';
import { contractColumnIssues } from '../src/forms.js';
import { REVIEW_COLUMNS, REVIEW_HIDE_REASONS } from '../src/review.js';
import { publicConsentIssues, publicConsentSchema } from '../src/people.js';
import { outboxSchema, emailTemplateSchema } from '../src/outbox.js';
import { savedPayableSchema } from '../src/saved-parts.js';
import { installFloorWords, WORD_FLOORS } from '../src/words.js';

const calendar: BookingCalendar = {
  revision: 'revision',
  title: ['service_id', 'name'],
  code: 'code',
  person: ['team_id', 'first_name'],
  studio: { name: { table: 'settings', column: 'name' }, address: { table: 'settings', column: 'address' } },
  notice: { 'en-US': 'Declining in your calendar does not cancel.' },
  feed: { own: 'email', active: 'active', detail: { table: 'settings', column: 'detail' }, customer: ['customer_id', 'name'] },
};

type Column = { ref: string; type: string; nullable?: boolean; references?: string };
const TABLES: Record<string, Column[]> = {
  visits: [
    { ref: 'revision', type: 'int' },
    { ref: 'code', type: 'text' },
    { ref: 'service_id', type: 'fk', references: 'services' },
    { ref: 'team_id', type: 'fk', references: 'team' },
    { ref: 'customer_id', type: 'fk', references: 'customers' },
    { ref: 'note', type: 'json' },
  ],
  services: [{ ref: 'name', type: 'text' }],
  team: [{ ref: 'first_name', type: 'text' }, { ref: 'email', type: 'text' }, { ref: 'active', type: 'bool' }],
  customers: [{ ref: 'name', type: 'text' }],
  settings: [{ ref: 'name', type: 'text' }, { ref: 'address', type: 'text' }, { ref: 'detail', type: 'text' }, { ref: 'count', type: 'int' }],
};
const index = {
  table: (ref: string) => (TABLES[ref] === undefined ? undefined : { ref, columns: TABLES[ref]! }),
  column: (table: string, column: string) => TABLES[table]?.find((one) => one.ref === column),
} as never;
const issues = (word: BookingCalendar) => bookingCalendarIssues({ ref: 'visits', columns: TABLES['visits']! } as never, word, 'team', index, (...rest) => ['booking', ...rest]).map((one) => one.message);

describe('table.booking.calendar', () => {
  it('takes a whole word, and finds nothing wrong with it', () => {
    expect(bookingCalendarSchema.safeParse(calendar).success).toBe(true);
    expect(issues(calendar)).toEqual([]);
  });

  it('has no word for what an entry may never carry', () => {
    for (const extra of ['note', 'phone', 'price', 'link', 'manageLink', 'guestName']) {
      expect(bookingCalendarSchema.safeParse({ ...calendar, [extra]: 'note' }).success, extra).toBe(false);
    }
  });

  it('cannot leave the notice out, or give it without US English', () => {
    const { notice: _gone, ...none } = calendar;
    expect(bookingCalendarSchema.safeParse(none).success).toBe(false);
    expect(bookingCalendarSchema.safeParse({ ...calendar, notice: { 'de-DE': 'x' } }).success).toBe(false);
  });

  it('a feed that may show a name says which setting allows it, and where the name is', () => {
    expect(bookingCalendarSchema.safeParse({ ...calendar, feed: { own: 'email', detail: { table: 'settings', column: 'detail' } } }).success).toBe(false);
    expect(bookingCalendarSchema.safeParse({ ...calendar, feed: { own: 'email' } }).success).toBe(true);
  });

  it('names what is wrong with its columns', () => {
    expect(issues({ ...calendar, revision: 'code' })[0]).toContain('whole number');
    expect(issues({ ...calendar, title: ['service_id', 'nope'] })[0]).toContain('no column');
    expect(issues({ ...calendar, title: ['code', 'name'] })[0]).toContain('not a link');
    expect(issues({ ...calendar, studio: { name: { table: 'settings', column: 'count' } } })[0]).toContain('text');
    expect(issues({ ...calendar, feed: { own: 'active' } })[0]).toContain('sign-in address');
    const nullable = bookingCalendarIssues({ ref: 'visits', columns: TABLES['visits']! } as never, calendar, 'team', {
      ...(index as object),
      column: (table: string, column: string) => (table === 'visits' && column === 'revision' ? { ref: 'revision', type: 'int', nullable: true } : (index as { column: (a: string, b: string) => unknown }).column(table, column)),
    } as never, (...rest) => rest);
    expect(nullable[0]?.message).toContain('not nullable');
  });
});

describe('the words a mail takes', () => {
  const box = { table: 'messages', columns: { kind: 'kind', status: 'status', to: 'to' }, recipient: { via: 'customer_id', table: 'customers', email: 'email' }, kinds: { ask: 'studio-ask' } };
  it('a review link names its kinds, its link and a plain path', () => {
    expect(outboxSchema.safeParse({ ...box, reviewLinks: { kinds: ['ask'], link: 'visit', page: '/review' } }).success).toBe(true);
    for (const page of ['https://evil.example/', '/review?x=1', '/review#t', 'review']) {
      expect(outboxSchema.safeParse({ ...box, reviewLinks: { kinds: ['ask'], link: 'visit', page } }).success, page).toBe(false);
    }
  });
  it('a template may carry a calendar entry', () => {
    const template = { key: 'studio-ask', name: 'Ask', calendar: { link: 'visit' }, locales: { 'en-US': { subject: 'x', blocks: [{ block: 'email.text', data: { text: 'x' } }] } } };
    expect(emailTemplateSchema.safeParse(template).success).toBe(true);
    expect(emailTemplateSchema.safeParse({ ...template, calendar: { link: 'visit', extra: 1 } }).success).toBe(false);
  });
});

describe('a public box that says no', () => {
  const wording = { version: 1, text: { 'en-US': "Don't send me a review request" } };
  const columns: Record<string, Column[]> = { orders: [{ ref: 'no_ask', type: 'bool' }], customers: [{ ref: 'asks', type: 'bool' }] };
  const lookup = { table: (ref: string) => (columns[ref] === undefined ? undefined : { ref, columns: columns[ref]! }), column: (t: string, c: string) => columns[t]?.find((one) => one.ref === c) } as never;

  it('is a word of the tick', () => {
    expect(publicConsentSchema.safeParse({ column: 'no_ask', purpose: 'surveys', means: 'no', wording }).success).toBe(true);
    expect(publicConsentSchema.safeParse({ column: 'no_ask', purpose: 'surveys', means: 'maybe', wording }).success).toBe(false);
  });

  it('may not be the yes column that mirrors the purpose', () => {
    const on = (table: string, column: string) => publicConsentIssues({ people: [{ table: 'customers', kind: 'people', email: 'email', consent: { column: 'asks', purpose: 'surveys' } }] as never, publicAccess: [{ table, methods: ['POST'], writable: [column], consent: { column, purpose: 'surveys', means: 'no', wording } }] }, lookup);
    expect(on('customers', 'asks').map((issue) => issue.message).join()).toContain('cannot also be a box that says no');
  });
});

describe('a studio cancel\'s refund', () => {
  const payable = {
    table: 'visits',
    amount: { column: 'total' },
    currency: { fixed: 'USD' },
    due: { column: 'balance' },
    payments: { kind: 'table', table: 'pays', link: 'visit_id', amount: 'amount', date: 'on', method: { column: 'how', values: { '*': 'online' } }, reference: 'ref' },
  };
  it('takes staff, and a window that binds the customer alone', () => {
    const parsed = savedPayableSchema.safeParse({ ...payable, refundOn: { moves: [{ to: 'cancelled', by: ['customer', 'staff'] }], before: { column: 'starts_at', hours: { table: 'settings', column: 'hours' }, binds: ['customer'] } } });
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });
});

describe('the fifth reason a review is hidden for', () => {
  const contract = { hide_reason: REVIEW_COLUMNS['hide_reason']! };
  const table = (values: readonly string[]) => ({ ref: 'reviews', columns: [{ ref: 'hide_reason', type: 'enum', enum: [...values], nullable: true }] });
  const check = (values: readonly string[]) => contractColumnIssues(table(values) as never, 0, 'the reviews', contract as never, () => undefined);

  it('is one of the reasons', () => {
    expect(REVIEW_HIDE_REASONS).toContain('author-asked');
    expect(REVIEW_HIDE_REASONS).toHaveLength(5);
  });
  it('an add-on released before it still fits, and one that has it fits', () => {
    expect(check(['abusive', 'names-someone', 'not-about-us', 'looks-fake'])).toEqual([]);
    expect(check(REVIEW_HIDE_REASONS)).toEqual([]);
  });
  it('a reason of the add-on\'s own, or one left out, does not', () => {
    expect(check([...REVIEW_HIDE_REASONS, 'other'])).toHaveLength(1);
    expect(check(['abusive', 'names-someone', 'not-about-us'])).toHaveLength(1);
  });
});

describe('the floor', () => {
  const words = (document: unknown) => installFloorWords(document).map((word) => word.word);
  it('each word asks for the release that reads it', () => {
    for (const word of ['outbox.reviewLinks', 'table.booking.calendar', 'emailTemplate.calendar', 'publicAccess.consent.no', 'payments.refundOnStaff'] as const) expect(WORD_FLOORS[word]).toBe('0.3.71');
  });
  it('is found where a document writes it', () => {
    expect(words({ kind: 'app', outbox: { reviewLinks: { kinds: ['a'], link: 'b', page: '/r' } } })).toContain('outbox.reviewLinks');
    expect(words({ kind: 'app', requiredSchema: { tables: [{ ref: 'v', booking: { calendar: {} } }] } })).toContain('table.booking.calendar');
    expect(words({ kind: 'app', emailTemplates: [{ key: 'a', calendar: { link: 'v' } }] })).toContain('emailTemplate.calendar');
    expect(words({ kind: 'app', publicAccess: [{ table: 'o', consent: { means: 'no' } }] })).toContain('publicAccess.consent.no');
    expect(words({ kind: 'app', payments: { payables: [{ refundOn: { moves: [{ to: 'c', by: ['staff'] }] } }] } })).toContain('payments.refundOnStaff');
    expect(words({ kind: 'app', payments: { payables: [{ refundOn: { moves: [{ to: 'c', by: ['customer'] }], before: { binds: ['customer'] } } }] } })).toContain('payments.refundOnStaff');
  });
  it('a document with none of them asks for none', () => {
    const none = words({ kind: 'app', publicAccess: [{ table: 'o', consent: { column: 'x' } }], payments: { payables: [{ refundOn: { moves: [{ to: 'c', by: ['customer'] }] } }] } });
    for (const word of ['publicAccess.consent.no', 'payments.refundOnStaff']) expect(none).not.toContain(word);
  });
});
