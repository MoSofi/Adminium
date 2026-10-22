// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The rest of "checked against another column": a number against a number
 * (warm below stale), a time of day kept as text against another (work starts
 * before it ends), an end at most so many days after a start (a cover lasts a
 * year at most), and a moment that is not in the past on a create (a visit
 * booked to start now or later). And a stamp that is always the server's
 * (`strict`). What each takes and what each refuses, by name.
 */
import { describe, expect, it } from 'vitest';

import { validateManifest } from '../src/index.js';
import { issuesText, valid, type Doc } from './invoicing-fixture.js';

const expectIssue = (m: Doc, fragment: string) => expect(issuesText(m)).toContain(fragment);

/** The fixture with one more table, whose columns carry the rules under test, on the release that reads them. */
function withTable(columns: Doc[], floor = '0.3.33'): Doc {
  const m = valid();
  ((m['requiredSchema'] as Doc)['tables'] as Doc[]).push({ ref: 'pairs', columns: [{ ref: 'id', type: 'int', role: 'pk' }, ...columns] });
  m['compatibility'] = { ...(m['compatibility'] as Doc), minAdminiumVersion: floor };
  return m;
}

describe('the release that reads them', () => {
  it('asks for 0.3.33 for a bound that is no date, a span of days, now and a strict stamp; a date against a date asks nothing', () => {
    const m = withTable(
      [
        { ref: 'stale', type: 'int' },
        { ref: 'warm', type: 'int', rules: { notAfter: { column: 'stale' } } },
        { ref: 'starts_on', type: 'date' },
        { ref: 'ends_on', type: 'date', nullable: true, rules: { notBefore: { column: 'starts_on' }, notAfter: { column: 'starts_on', days: 365 } } },
        { ref: 'at', type: 'timestamptz', rules: { notBefore: 'now' } },
        { ref: 'at_by', type: 'text', maxLength: 64, nullable: true, rules: { stamp: { set: 'user-id', on: { columns: ['warm'] }, strict: true } } },
      ],
      '0.3.32',
    );
    const text = issuesText(m);
    expect(text).toContain('columns.2.rules.notAfter: "bounds.other" is read by Adminium 0.3.33 and later');
    expect(text).toContain('columns.4.rules.notAfter: "bounds.other" is read by Adminium 0.3.33 and later');
    expect(text).not.toContain('columns.4.rules.notBefore');
    expect(text).toContain('columns.5.rules.notBefore: "bounds.now" is read by Adminium 0.3.33 and later');
    expect(text).toContain('columns.6.rules.stamp.strict: "stamp.strict" is read by Adminium 0.3.33 and later');
  });
});

describe('a number, a time of day and a span against another column', () => {
  it('takes warm below stale, opening before closing, a cover of a year at most and a visit not in the past', () => {
    const m = withTable([
      { ref: 'stale_days', type: 'int', default: 14 },
      { ref: 'warm_days', type: 'int', default: 7, rules: { notAfter: { column: 'stale_days', strict: true } } },
      { ref: 'valid_until', type: 'decimal', scale: 2, nullable: true },
      { ref: 'warn_at', type: 'decimal', scale: 2, nullable: true, rules: { notAfter: { column: 'valid_until', strict: true } } },
      { ref: 'work_to', type: 'text', maxLength: 5, default: '17:00' },
      { ref: 'work_from', type: 'text', maxLength: 5, default: '09:00', rules: { notAfter: { column: 'work_to', strict: true } } },
      { ref: 'starts_on', type: 'date' },
      { ref: 'ends_on', type: 'date', nullable: true, rules: { notBefore: { column: 'starts_on' }, notAfter: { column: 'starts_on', days: 365 } } },
      { ref: 'starts_at', type: 'timestamptz', rules: { notBefore: 'now' } },
    ]);
    expect(issuesText(m)).toBe('');
    expect(validateManifest(m).ok).toBe(true);
  });

  it('refuses a number against a date, a time against a number, and a date against a time', () => {
    expectIssue(withTable([{ ref: 'starts_on', type: 'date' }, { ref: 'warm', type: 'int', rules: { notAfter: { column: 'starts_on' } } }]), '"pairs.starts_on" is not a number');
    expectIssue(withTable([{ ref: 'stale', type: 'int' }, { ref: 'opens', type: 'text', maxLength: 5, rules: { notAfter: { column: 'stale' } } }]), '"pairs.stale" is not a time of day kept as text');
    expectIssue(withTable([{ ref: 'opens', type: 'text', maxLength: 5 }, { ref: 'day', type: 'date', rules: { notBefore: { column: 'opens' } } }]), '"pairs.opens" is not a date');
  });

  it('refuses a bound on a column no bound holds, and one on itself', () => {
    expectIssue(withTable([{ ref: 'on', type: 'bool' }, { ref: 'also', type: 'bool', rules: { notAfter: { column: 'on' } } }]), 'only a date, a number or a time of day is kept on one side of another');
    expectIssue(withTable([{ ref: 'warm', type: 'int', rules: { notAfter: { column: 'warm' } } }]), 'a value is bounded by another column');
  });

  it('refuses a time of day kept in fewer than five characters', () => {
    expectIssue(withTable([{ ref: 'to', type: 'text', maxLength: 5 }, { ref: 'from', type: 'text', maxLength: 4, rules: { notAfter: { column: 'to' } } }]), 'a time of day is kept as the 5 characters of HH:MM');
  });

  it('counts days between dates only', () => {
    expectIssue(withTable([{ ref: 'stale', type: 'int' }, { ref: 'warm', type: 'int', rules: { notAfter: { column: 'stale', days: 3 } } }]), 'days are counted between dates only');
    expect(validateManifest(withTable([{ ref: 'starts_on', type: 'date' }, { ref: 'ends_on', type: 'date', rules: { notAfter: { column: 'starts_on', days: 0 } } }])).ok).toBe(false);
  });

  it('keeps only a moment not before now, and only a date not later than today', () => {
    expectIssue(withTable([{ ref: 'day', type: 'date', rules: { notBefore: 'now' } }]), 'only a moment (timestamptz) is kept not before now');
    expectIssue(withTable([{ ref: 'warm', type: 'int', rules: { notAfter: 'today' } }]), 'only a date is kept not later than today');
    // `now` is a word of `notBefore` only: a moment not after now is not a word.
    expect(validateManifest(withTable([{ ref: 'at', type: 'timestamptz', rules: { notAfter: 'now' } }])).ok).toBe(false);
  });
});

describe('a strict stamp', () => {
  it('takes a stamp marked strict', () => {
    const m = withTable([
      { ref: 'may_email', type: 'bool', default: false },
      { ref: 'may_email_at', type: 'timestamptz', nullable: true, rules: { stamp: { set: 'now', on: { columns: ['may_email'] }, strict: true } } },
      { ref: 'may_email_by', type: 'text', maxLength: 64, nullable: true, rules: { stamp: { set: 'user-id', on: { columns: ['may_email'] }, strict: true } } },
    ]);
    expect(issuesText(m)).toBe('');
  });

  it('refuses a strict stamp that leaves staff their own word', () => {
    const m = withTable([
      { ref: 'status', type: 'enum', enum: ['new', 'approved'], default: 'new' },
      { ref: 'approved_via', type: 'text', maxLength: 20, nullable: true, rules: { stamp: { set: { byOrigin: { public: 'portal' } }, on: { column: 'status', values: ['approved'] }, strict: true } } },
    ]);
    expectIssue(m, 'a strict stamp is always the server\'s, so a staff write says its value too');
  });
});

describe('a column a stamp fills and requiredWhen asks for', () => {
  it('takes requiredWhen beside a stamp: a person\'s write is stamped, a write that brings history is asked', () => {
    const m = withTable([
      { ref: 'state', type: 'enum', enum: ['open', 'won', 'lost'], default: 'open' },
      { ref: 'closed_at', type: 'timestamptz', nullable: true, rules: { stamp: { set: 'now', on: { column: 'state', values: ['won', 'lost'] } }, requiredWhen: { column: 'state', in: ['won', 'lost'] } } },
    ]);
    expect(issuesText(m)).toBe('');
  });

  it('still refuses it beside any other rule that fills the column', () => {
    const m = withTable([
      { ref: 'state', type: 'enum', enum: ['open', 'won'], default: 'open' },
      { ref: 'code', type: 'text', maxLength: 20, nullable: true, rules: { code: { length: 8 }, requiredWhen: { column: 'state', in: ['won'] } } },
    ]);
    expectIssue(m, 'Adminium fills this column, so nobody is asked for it');
  });
});
