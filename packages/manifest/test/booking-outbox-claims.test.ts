// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The manifest fields a practice that books people needs: a booking rule
 * with hours, breaks and closures; stamps; a rollup that keeps a balance and
 * refuses to take it below zero; unique columns; claims that open a person's
 * own rows at two levels; a second, staff-bound browser key; the app's own
 * outbox and email templates; and the versions a release updates from.
 *
 * One manifest shaped like a clinic's uses every one of them and validates;
 * each test then breaks one reference and reads the sentence that names it.
 */
import { describe, expect, it } from 'vitest';

import { parseSemverRange, satisfiesSemverRange, validateManifest } from '../src/index.js';

const id = { ref: 'id', type: 'int', role: 'pk' };
const hhmm = (ref: string, nullable = false) => ({ ref, type: 'text', maxLength: 5, ...(nullable ? { nullable: true } : {}) });
const weekday = { ref: 'weekday', type: 'enum', enum: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] };
const STATUSES = ['booked', 'checked_in', 'roomed', 'with_clinician', 'ready', 'seen', 'no_show', 'cancelled'];

function tables() {
  return [
    {
      ref: 'settings',
      columns: [
        id,
        { ref: 'slot_minutes', type: 'int', default: 15 },
        { ref: 'booking_days', type: 'int', default: 10 },
        { ref: 'min_notice_minutes', type: 'int', default: 60 },
        { ref: 'cancel_hours', type: 'int', default: 24 },
        { ref: 'default_lead_hours', type: 'int', default: 24 },
        { ref: 'reminders_on', type: 'bool', default: true },
        { ref: 'kiosk_on', type: 'bool', default: false },
        { ref: 'online_booking_on', type: 'bool', default: true },
        { ref: 'new_patients_online', type: 'bool', default: true },
        { ref: 'practice_name', type: 'text', maxLength: 80, nullable: true },
        { ref: 'practice_phone', type: 'text', maxLength: 32, nullable: true },
      ],
    },
    { ref: 'opening_hours', columns: [id, { ...weekday, unique: true }, { ref: 'open', type: 'bool', default: true }, hhmm('opens'), hhmm('closes'), hhmm('break_start', true), hhmm('break_end', true)] },
    { ref: 'clinicians', columns: [id, { ref: 'name', type: 'text', maxLength: 80 }, { ref: 'position', type: 'int', default: 0 }, { ref: 'active', type: 'bool', default: true }, { ref: 'bookable_online', type: 'bool', default: true }] },
    { ref: 'visit_types', columns: [id, { ref: 'minutes', type: 'int', default: 15 }, { ref: 'fee', type: 'money', default: 0 }] },
    { ref: 'clinician_visit_types', columns: [id, { ref: 'clinician_id', type: 'fk', references: 'clinicians' }, { ref: 'visit_type_id', type: 'fk', references: 'visit_types' }] },
    { ref: 'clinician_hours', columns: [id, { ref: 'clinician_id', type: 'fk', references: 'clinicians' }, weekday, hhmm('opens'), hhmm('closes'), hhmm('break_start', true), hhmm('break_end', true)] },
    {
      ref: 'closures',
      columns: [id, { ref: 'clinician_id', type: 'fk', references: 'clinicians', nullable: true }, { ref: 'from_date', type: 'date' }, { ref: 'to_date', type: 'date' }, { ref: 'active', type: 'bool', default: true }],
    },
    {
      ref: 'patients',
      columns: [
        id,
        { ref: 'client_key', type: 'text', maxLength: 36, nullable: true, unique: true },
        { ref: 'name', type: 'text', maxLength: 120 },
        { ref: 'born_on', type: 'date' },
        { ref: 'mobile', type: 'text', maxLength: 32 },
        { ref: 'email', type: 'text', maxLength: 254, nullable: true },
        { ref: 'language', type: 'text', maxLength: 16, nullable: true },
        { ref: 'remind_email', type: 'bool', default: true },
        { ref: 'remind_lead_hours', type: 'int', default: 24 },
      ],
    },
    {
      ref: 'appointments',
      booking: {
        start: 'starts_at',
        minutes: 'minutes',
        resource: 'clinician_id',
        kind: 'visit_type_id',
        countWhere: { column: 'status', values: STATUSES.slice(0, 6) },
        eligible: {
          table: 'clinician_visit_types',
          resource: 'clinician_id',
          kind: 'visit_type_id',
          order: { table: 'clinicians', column: 'position', active: 'active', public: 'bookable_online' },
        },
        hours: {
          practice: { table: 'opening_hours', weekday: 'weekday', open: 'open', opens: 'opens', closes: 'closes', breakStart: 'break_start', breakEnd: 'break_end' },
          own: { table: 'clinician_hours', resource: 'clinician_id', weekday: 'weekday', opens: 'opens', closes: 'closes', breakStart: 'break_start', breakEnd: 'break_end' },
        },
        closures: { table: 'closures', from: 'from_date', to: 'to_date', resource: 'clinician_id', active: 'active' },
        grid: { table: 'settings', column: 'slot_minutes' },
        windowDays: { table: 'settings', column: 'booking_days' },
        noticeMinutes: { table: 'settings', column: 'min_notice_minutes' },
        cancel: { hours: { table: 'settings', column: 'cancel_hours' }, mode: 'flag', flag: 'late_cancel', when: { column: 'status', to: 'cancelled' } },
      },
      columns: [
        id,
        { ref: 'ref', type: 'text', maxLength: 12, nullable: true, rules: { code: { prefix: 'RH-', length: 4 } } },
        { ref: 'patient_id', type: 'fk', references: 'patients', nullable: true },
        { ref: 'new_name', type: 'text', maxLength: 80, nullable: true },
        { ref: 'new_email', type: 'text', maxLength: 254, nullable: true },
        { ref: 'clinician_id', type: 'fk', references: 'clinicians', nullable: true },
        { ref: 'visit_type_id', type: 'fk', references: 'visit_types' },
        { ref: 'starts_at', type: 'timestamptz', rules: { venueLocal: true } },
        { ref: 'minutes', type: 'int', default: 15, rules: { copy: { via: 'visit_type_id', from: 'minutes', mode: 'always' } } },
        { ref: 'fee', type: 'money', default: 0, rules: { copy: { via: 'visit_type_id', from: 'fee' } } },
        { ref: 'waived', type: 'money', default: 0, rules: { rollup: { from: 'write_offs', via: 'appointment_id', sum: 'amount', cap: true } } },
        {
          ref: 'paid',
          type: 'money',
          default: 0,
          rules: { rollup: { from: 'payments', via: 'appointment_id', sum: 'amount', where: { column: 'voided', eq: false }, balance: { column: 'balance', of: 'fee', minus: ['waived'] }, cap: true } },
        },
        { ref: 'balance', type: 'money', default: 0 },
        { ref: 'status', type: 'enum', enum: STATUSES, default: 'booked' },
        { ref: 'check_status', type: 'enum', enum: ['to_check', 'rang', 'accepted', 'linked', 'declined'], nullable: true },
        { ref: 'late_cancel', type: 'bool', default: false },
        { ref: 'checked_in_at', type: 'timestamptz', nullable: true, rules: { stamp: { set: 'now', on: { column: 'status', values: ['checked_in'] } } } },
        { ref: 'cancelled_by', type: 'enum', enum: ['patient', 'desk'], nullable: true, rules: { stamp: { set: { byOrigin: { public: 'patient', staff: 'desk' } }, on: { column: 'status', values: ['cancelled'] } } } },
        { ref: 'booked_by', type: 'text', maxLength: 120, nullable: true, rules: { stamp: { set: 'user-name', on: 'create' } } },
        { ref: 'client_key', type: 'text', maxLength: 36, nullable: true, unique: true },
      ],
    },
    {
      ref: 'payments',
      columns: [
        id,
        { ref: 'appointment_id', type: 'fk', references: 'appointments' },
        { ref: 'amount', type: 'money' },
        { ref: 'voided', type: 'bool', default: false },
        { ref: 'voided_by', type: 'text', maxLength: 120, nullable: true, rules: { stamp: { set: 'user-name', on: { column: 'voided', values: [true] } } } },
      ],
    },
    { ref: 'write_offs', columns: [id, { ref: 'appointment_id', type: 'fk', references: 'appointments' }, { ref: 'amount', type: 'money' }] },
    {
      ref: 'messages',
      columns: [
        id,
        { ref: 'kind', type: 'enum', enum: ['confirmation', 'reminder', 'missed'] },
        { ref: 'patient_id', type: 'fk', references: 'patients', nullable: true },
        { ref: 'appointment_id', type: 'fk', references: 'appointments', nullable: true },
        { ref: 'to_address', type: 'text', maxLength: 254, nullable: true },
        { ref: 'language', type: 'text', maxLength: 16, nullable: true },
        { ref: 'status', type: 'enum', enum: ['queued', 'sent', 'failed', 'skipped'], default: 'queued' },
        { ref: 'error', type: 'text', maxLength: 300, nullable: true },
        { ref: 'due_at', type: 'timestamptz', nullable: true },
        { ref: 'sent_at', type: 'timestamptz', nullable: true },
      ],
    },
  ];
}

const template = (key: string) => ({
  key,
  name: { 'en-US': 'Reminder', 'de-DE': 'Erinnerung' },
  vars: ['patient.name', 'appointment.starts_at'],
  locales: {
    'en-US': { subject: 'See you soon', blocks: [{ block: 'email.heading', data: { text: 'See you {{relative_day}}' } }] },
    'de-DE': { subject: 'Bis bald', blocks: [{ block: 'email.text', data: { text: 'Hallo {{patient.name}}' } }] },
  },
});

function clinic() {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'clinic',
    name: 'Clinic Desk',
    version: '0.2.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    description: { key: 'd', fallback: 'A practice desk' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.3.0', updatesFrom: '>=0.2.0' },
    requiredSchema: { prefixed: true, tables: tables() },
    pages: [{ ref: 'appointments', template: 'page-calendar', title: { key: 't', fallback: 'Appointments' }, nav: { group: 'records', icon: 'calendar', order: 1 } }],
    frontends: [
      { side: 'staff', kind: 'spa', placement: 'internal' },
      { side: 'customer', kind: 'spa' },
    ],
    roles: [
      { key: 'reception', name: 'Clinic reception' },
      { key: 'kiosk', name: 'Clinic kiosk', screensOnly: true, permissions: ['app:@:staff'] },
    ],
    publicKeys: { kiosk: { requiresStaff: { role: 'kiosk' }, enabledBy: { table: 'settings', column: 'kiosk_on' } } },
    publicAccess: [
      { table: 'appointments', kind: 'availability', methods: ['GET'] },
      { table: 'closures', methods: ['GET'], select: ['from_date', 'to_date'], filters: [{ column: 'to_date', op: 'from-today' }, { column: 'active', op: 'eq', value: true }] },
      {
        table: 'patients',
        methods: ['GET'],
        select: ['name'],
        claim: { match: ['mobile', 'born_on'], verify: 'email-code', email: 'email' },
        sensitive: true,
        humanCheck: true,
      },
      {
        table: 'patients',
        methods: ['GET', 'PATCH'],
        claimedBy: { table: 'patients', column: 'id' },
        level: 'verified',
        sensitive: true,
        select: ['name', 'email', 'mobile', 'remind_email', 'remind_lead_hours'],
        writable: ['remind_email', 'remind_lead_hours'],
      },
      {
        table: 'appointments',
        methods: ['POST'],
        claimedBy: { table: 'patients', column: 'patient_id', optional: true },
        sensitive: false,
        reason: 'the reply names the booking just made and nothing else',
        select: ['ref', 'starts_at', 'minutes', 'clinician_id', 'status'],
        writable: ['visit_type_id', 'clinician_id', 'starts_at', 'new_name', 'new_email'],
        defaults: { status: 'booked', check_status: 'to_check' },
        onClaim: { clear: ['new_name', 'new_email', 'check_status'] },
        humanCheck: true,
        maxOpen: { column: 'status', values: ['booked'], n: 2, upcoming: 'starts_at' },
        anonymous: { perValue: { columns: ['new_email'], n: 2 }, perKeyHour: 20, plainText: ['new_name'] },
        requireSetting: [
          { table: 'settings', column: 'online_booking_on' },
          { table: 'settings', column: 'new_patients_online', when: 'anonymous' },
        ],
      },
      {
        table: 'appointments',
        methods: ['GET', 'PATCH'],
        claimedBy: { table: 'patients', column: 'patient_id' },
        level: 'verified',
        sensitive: true,
        select: ['ref', 'starts_at', 'status', 'late_cancel', 'balance'],
        writable: ['starts_at', 'status'],
        writableValues: { status: ['cancelled'] },
        writableWhen: { status: ['booked'], starts_at: 'from-now' },
      },
      { table: 'patients', key: 'kiosk', methods: ['GET'], select: ['name'], claim: { match: ['mobile', 'born_on'] } },
      {
        table: 'appointments',
        key: 'kiosk',
        methods: ['GET', 'PATCH'],
        claimedBy: { table: 'patients', column: 'patient_id' },
        select: ['id', 'starts_at', 'clinician_id', 'status'],
        filters: [{ column: 'starts_at', op: 'today' }],
        writable: ['status'],
        writableValues: { status: ['checked_in'] },
        writableWhen: { status: ['booked'], starts_at: { within: 60 } },
      },
    ],
    outbox: {
      table: 'messages',
      columns: { kind: 'kind', status: 'status', to: 'to_address', language: 'language', due: 'due_at', sentAt: 'sent_at', error: 'error' },
      links: { patient: 'patient_id', appointment: 'appointment_id' },
      recipient: {
        via: 'patient_id',
        table: 'patients',
        email: 'email',
        name: 'name',
        language: 'language',
        optIn: 'remind_email',
        fallback: { via: 'appointment_id', email: 'new_email', name: 'new_name' },
      },
      settings: { table: 'settings', enabled: 'reminders_on', name: 'practice_name', phone: 'practice_phone' },
      pages: { manage: '/my-visits', booking: '/' },
      kinds: { confirmation: 'clinic-confirmation', reminder: 'clinic-reminder', missed: 'clinic-missed' },
      producers: [
        { kind: 'confirmation', link: 'appointment_id', onCreate: { table: 'appointments', where: { column: 'check_status', isNull: true } } },
        { kind: 'confirmation', link: 'appointment_id', onChange: { table: 'appointments', column: 'check_status', to: ['accepted', 'linked'] } },
        { kind: 'missed', link: 'appointment_id', gate: 'enabled', onChange: { table: 'appointments', column: 'status', to: 'no_show' } },
        {
          kind: 'reminder',
          link: 'appointment_id',
          gate: 'enabled',
          optIn: true,
          before: {
            table: 'appointments',
            at: 'starts_at',
            lead: { via: 'patient_id', table: 'patients', column: 'remind_lead_hours', fallback: { table: 'settings', column: 'default_lead_hours' }, max: 48 },
            where: { column: 'status', eq: 'booked' },
          },
        },
      ],
    },
    emailTemplates: [template('clinic-confirmation'), template('clinic-reminder'), template('clinic-missed')],
  };
}

type Doc = ReturnType<typeof clinic>;

const issuesOf = (doc: unknown): string => {
  const result = validateManifest(doc);
  return result.ok ? '' : result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n');
};

/** The clinic with one change made to a fresh copy. */
function changed(edit: (doc: Doc) => void): Doc {
  const doc = structuredClone(clinic());
  edit(doc);
  return doc;
}
const table = (doc: Doc, ref: string) => doc.requiredSchema.tables.find((t) => t.ref === ref)!;
const column = (doc: Doc, tableRef: string, ref: string) =>
  (table(doc, tableRef).columns as Record<string, unknown>[]).find((c) => c['ref'] === ref)!;
const booking = (doc: Doc) => (table(doc, 'appointments') as unknown as { booking: Record<string, unknown> }).booking;
const entry = (doc: Doc, i: number) => doc.publicAccess[i] as Record<string, unknown>;

describe('a clinic using every new field', () => {
  it('validates', () => {
    expect(issuesOf(clinic())).toBe('');
  });
});

describe('the booking rule', () => {
  it('names columns of the right kind on its own table', () => {
    expect(issuesOf(changed((d) => (booking(d)['start'] = 'minutes')))).toContain('"appointments.minutes" must be a timestamptz');
    expect(issuesOf(changed((d) => (booking(d)['resource'] = 'patient_name')))).toContain('"appointments" has no column "patient_name"');
    expect(issuesOf(changed((d) => (booking(d)['kind'] = 'minutes')))).toContain('"appointments.minutes" must be a foreign key');
  });

  it('maps the eligible link table to the resource and the kind', () => {
    expect(
      issuesOf(changed((d) => ((booking(d)['eligible'] as Record<string, unknown>)['kind'] = 'clinician_id'))),
    ).toContain('"clinician_visit_types.clinician_id" does not point at "visit_types"');
    expect(
      issuesOf(changed((d) => (((booking(d)['eligible'] as Record<string, Record<string, unknown>>)['order']!)['table'] = 'visit_types'))),
    ).toContain('the order is kept on "clinicians"');
  });

  it('reads nested tables by ref, and each must exist', () => {
    const doc = changed((d) => ((booking(d)['closures'] as Record<string, unknown>)['table'] = 'holidays'));
    expect(issuesOf(doc)).toContain('"holidays" is not a table of this app');
  });

  it('keeps hours in a weekday table of HH:MM text, with whole breaks', () => {
    expect(
      issuesOf(changed((d) => (column(d, 'opening_hours', 'weekday')['enum'] = ['mon', 'tue', 'wed', 'thu', 'fri']))),
    ).toContain('must be an enum of mon, tue, wed, thu, fri, sat, sun');
    expect(
      issuesOf(changed((d) => delete ((booking(d)['hours'] as Record<string, Record<string, unknown>>)['practice']!)['breakEnd'])),
    ).toContain('a break names both its start and its end');
    expect(issuesOf(changed((d) => (column(d, 'clinician_hours', 'opens')['type'] = 'int')))).toContain(
      '"clinician_hours.opens" must be a text column holding HH:MM',
    );
  });

  it('closes for everyone only through a nullable resource', () => {
    expect(issuesOf(changed((d) => delete column(d, 'closures', 'clinician_id')['nullable']))).toContain('must be nullable');
  });

  it('reads its numbers from the settings row', () => {
    expect(issuesOf(changed((d) => (booking(d)['grid'] = { table: 'settings', column: 'grid' })))).toContain('"settings" has no column "grid"');
    expect(issuesOf(changed((d) => (booking(d)['grid'] = 0)))).toContain('the grid is at least one minute');
  });

  it('flags a late cancellation into a bool, on the column that decides what counts', () => {
    expect(
      issuesOf(changed((d) => ((booking(d)['cancel'] as Record<string, unknown>)['when'] = { column: 'status', to: 'booked' }))),
    ).toContain('"booked" still counts, so it frees no time');
    expect(
      issuesOf(changed((d) => ((booking(d)['cancel'] as Record<string, unknown>)['when'] = { column: 'check_status', to: 'declined' }))),
    ).toContain('a cancellation is a change of "status"');
    expect(issuesOf(changed((d) => delete (booking(d)['cancel'] as Record<string, unknown>)['flag']))).toContain(
      'only mode "flag" has one',
    );
  });

  it('is never beside a capacity rule', () => {
    const doc = changed((d) => {
      (table(d, 'appointments') as Record<string, unknown>)['capacity'] = { slot: 'starts_at', amount: 'minutes', perSlot: 1, slotMinutes: 15 };
    });
    expect(issuesOf(doc)).toContain('a capacity or a booking rule, not both');
  });

  it('answers availability for a booking table', () => {
    expect(issuesOf(changed((d) => (entry(d, 0)['table'] = 'patients')))).toContain('declares no capacity or booking to answer from');
  });
});

describe('stamps, balances and unique columns', () => {
  it('stamps a time into a timestamptz and a person into text', () => {
    expect(issuesOf(changed((d) => (column(d, 'appointments', 'checked_in_at')['type'] = 'date')))).toContain('a "now" stamp needs a timestamptz column');
    expect(issuesOf(changed((d) => (column(d, 'appointments', 'booked_by')['type'] = 'int')))).toContain('a "user-name" stamp needs a text column');
  });

  it('stamps on a value the watched column can hold', () => {
    expect(
      issuesOf(changed((d) => (column(d, 'appointments', 'checked_in_at')['rules'] = { stamp: { set: 'now', on: { column: 'status', values: ['arrived'] } } }))),
    ).toContain('"arrived" is not a value of "appointments.status"');
    expect(
      issuesOf(changed((d) => (column(d, 'appointments', 'cancelled_by')['rules'] = { stamp: { set: { byOrigin: { public: 'guest', staff: 'desk' } }, on: 'create' } }))),
    ).toContain('"guest" is not a value of "appointments.cancelled_by"');
  });

  it('keeps stamped columns out of public writes', () => {
    const doc = changed((d) => (entry(d, 3)['writable'] = ['remind_email']));
    expect(issuesOf(doc)).toBe('');
    const stamped = changed((d) => ((entry(d, 4)['writable'] as string[]).push('booked_by')));
    expect(issuesOf(stamped)).toContain('"booked_by" is decided by Adminium');
    const balance = changed((d) => ((entry(d, 4)['writable'] as string[]).push('balance')));
    expect(issuesOf(balance)).toContain('"balance" is decided by Adminium');
    const flag = changed((d) => ((entry(d, 4)['writable'] as string[]).push('late_cancel')));
    expect(issuesOf(flag)).toContain('"late_cancel" is decided by Adminium');
  });

  it('adds up only the rows it filters to, into a numeric balance of its own', () => {
    const rules = (d: Doc) => (column(d, 'appointments', 'paid')['rules'] as { rollup: Record<string, unknown> }).rollup;
    expect(issuesOf(changed((d) => (rules(d)['where'] = { column: 'voided', eq: 'no' })))).toContain('"no" is not a value of "payments.voided"');
    expect(issuesOf(changed((d) => (rules(d)['balance'] = { column: 'status', of: 'fee' })))).toContain('"appointments.status" is not a number');
    expect(issuesOf(changed((d) => (rules(d)['balance'] = { column: 'fee', of: 'fee' })))).toContain('the balance is a column of its own');
    // A filter on a column that may be empty would drop an empty row out of the total unseen.
    const nullable = changed((d) => (column(d, 'payments', 'voided')['nullable'] = true));
    expect(issuesOf(nullable)).toContain('"payments.voided" may be empty, so a row could drop out of the total; make it not nullable');
  });

  it('caps only against a balance', () => {
    const doc = changed((d) => {
      delete (column(d, 'appointments', 'paid')['rules'] as { rollup: Record<string, unknown> }).rollup['balance'];
    });
    const text = issuesOf(doc);
    expect(text).toContain('a cap needs a balance');
  });

  it('makes a column unique only where every engine can index it', () => {
    expect(issuesOf(changed((d) => delete column(d, 'patients', 'client_key')['maxLength']))).toContain('unique needs a column that can be indexed');
    expect(issuesOf(changed((d) => (column(d, 'patients', 'id')['unique'] = true)))).toContain('unique needs a column that can be indexed');
  });
});

describe('claims, levels and keys', () => {
  it('gives each key one identity', () => {
    const doc = changed((d) => d.publicAccess.push({ table: 'patients', methods: ['GET'], select: ['name'], claim: { match: ['email'] } } as never));
    expect(issuesOf(doc)).toContain('a key has one identity');
  });

  it('claims children through a column that points at the identity', () => {
    expect(issuesOf(changed((d) => ((entry(d, 5)['claimedBy'] as Record<string, unknown>)['column'] = 'clinician_id')))).toContain(
      '"appointments.clinician_id" does not point at "patients"',
    );
    expect(issuesOf(changed((d) => ((entry(d, 3)['claimedBy'] as Record<string, unknown>)['column'] = 'name')))).toContain(
      '"name" is not the key of "patients"',
    );
    const orphan = changed((d) => {
      d.publicAccess.splice(6, 2);
      delete d.publicKeys;
      d.publicAccess.push({ table: 'appointments', key: 'kiosk', methods: ['GET'], select: ['id'], claimedBy: { table: 'patients', column: 'patient_id' } } as never);
      d.publicKeys = { kiosk: { requiresStaff: { role: 'kiosk' } } } as never;
    });
    expect(issuesOf(orphan)).toContain('the "kiosk" key has no identity entry to be claimed by');
  });

  it('never lets a browser write the claim column, or leave out select', () => {
    expect(issuesOf(changed((d) => ((entry(d, 4)['writable'] as string[]).push('patient_id'))))).toContain('is filled from the claim');
    expect(issuesOf(changed((d) => delete entry(d, 5)['select']))).toContain('without select it would show every column');
  });

  it('lets only a create go without a session, and clears only nullable columns', () => {
    expect(issuesOf(changed((d) => ((entry(d, 5)['claimedBy'] as Record<string, unknown>)['optional'] = true)))).toContain(
      'only a create can go through without a session',
    );
    expect(issuesOf(changed((d) => (entry(d, 4)['onClaim'] = { clear: ['starts_at'] })))).toContain('is not nullable, so it cannot be emptied');
  });

  it('asks for a verified session only where a code is ever sent', () => {
    const doc = changed((d) => delete (entry(d, 2)['claim'] as Record<string, unknown>)['verify']);
    expect(issuesOf(doc)).toContain('only it does');
    const noCode = changed((d) => {
      entry(d, 2)['claim'] = { match: ['mobile', 'born_on'] };
    });
    expect(issuesOf(noCode)).toContain('sends no code, so no session is ever verified');
  });

  it('makes each child of a sensitive identity answer for itself', () => {
    expect(issuesOf(changed((d) => delete entry(d, 5)['sensitive']))).toContain('"patients" is sensitive, so this entry says whether it is too');
    expect(issuesOf(changed((d) => delete entry(d, 5)['level']))).toContain('a sensitive entry needs a verified session');
    expect(issuesOf(changed((d) => delete entry(d, 4)['reason']))).toContain('an entry marked not sensitive says why');
  });

  it('limits what a claimed PATCH may set, and from which state', () => {
    expect(issuesOf(changed((d) => delete entry(d, 5)['writableValues']))).toContain('"status" is an enum a browser changes');
    expect(issuesOf(changed((d) => (entry(d, 5)['writableValues'] = { status: ['gone'] })))).toContain('"gone" is not a value of "appointments.status"');
    expect(issuesOf(changed((d) => (entry(d, 5)['writableWhen'] = { status: ['booked'], minutes: 'from-now' })))).toContain(
      '"from-now" needs a timestamptz',
    );
    expect(issuesOf(changed((d) => (entry(d, 4)['writableWhen'] = { status: ['booked'] })))).toContain('this entry changes nothing');
  });

  it('takes a time window on a timestamptz only, in whole minutes up to a day, once per entry', () => {
    const window = (when: Record<string, unknown>) => changed((d) => (entry(d, 7)['writableWhen'] = { status: ['booked'], ...when }));
    // The kiosk's: an arrival up to an hour early, or late.
    expect(issuesOf(window({ starts_at: { within: 60 } }))).toBe('');
    expect(issuesOf(window({ starts_at: { within: 1440 } }))).toBe('');
    expect(issuesOf(window({ minutes: { within: 60 } }))).toContain('"within" needs a timestamptz, and "minutes" is not one');
    for (const within of [0, 1441, 7.5, -60, '60']) {
      expect(issuesOf(window({ starts_at: { within } })), String(within)).toContain('publicAccess.7.writableWhen.starts_at');
    }
    expect(issuesOf(window({ starts_at: { within: 60, after: 10 } }))).toContain('publicAccess.7.writableWhen.starts_at');
    expect(issuesOf(window({ starts_at: { within: 60 }, checked_in_at: { within: 60 } }))).toContain(
      'one time window per entry: a change refused as too early names one time',
    );
    // A window beside `from-now` on another column is still one window.
    expect(issuesOf(window({ starts_at: { within: 60 }, checked_in_at: 'from-now' }))).toBe('');
  });

  it('refuses a filter on a column the entry writes, unless both ends of the change are pinned', () => {
    const filtered = (d: Doc) => (entry(d, 7)['filters'] = [{ column: 'starts_at', op: 'today' }, { column: 'status', op: 'in', value: ['booked', 'checked_in'] }]);
    // The kiosk: reads booked and checked in, and moves booked to checked in only.
    expect(issuesOf(changed(filtered))).not.toContain('is filtered and writable');
    const unpinned = changed((d) => {
      filtered(d);
      delete entry(d, 7)['writableWhen'];
    });
    expect(issuesOf(unpinned)).toContain(
      '"status" is filtered and writable; pin the state it changes from (writableWhen) and the values it may take (writableValues)',
    );
  });

  it('filters by today only on a date or a time', () => {
    expect(issuesOf(changed((d) => (entry(d, 7)['filters'] = [{ column: 'clinician_id', op: 'today' }])))).toContain(
      '"clinician_id" is not a date or a timestamptz',
    );
  });

  it('serves a second key only to a declared, staff-bound role', () => {
    expect(issuesOf(changed((d) => (entry(d, 6)['key'] = 'tablet')))).toContain('"tablet" is not one of the app\'s publicKeys');
    expect(issuesOf(changed((d) => (d.publicKeys.kiosk.requiresStaff.role = 'porter')))).toContain('"porter" is not one of the app\'s roles');
    // The screen stands where anyone can walk up to it: its role opens the app's screens and nothing else.
    const kioskRole = (d: Doc) => (d.roles as Record<string, unknown>[]).find((role) => role['key'] === 'kiosk')!;
    expect(issuesOf(changed((d) => delete kioskRole(d)['screensOnly']))).toContain('opens only the app\'s screens');
    expect(issuesOf(changed((d) => (kioskRole(d)['permissions'] = ['app:@:staff', 'table:@patients:read'])))).toContain('opens only the app\'s screens');
    expect(issuesOf(changed((d) => (d.publicKeys.kiosk.enabledBy = { table: 'settings', column: 'slot_minutes' })))).toContain('is not a bool');
    expect(issuesOf(changed((d) => ((d.publicKeys as Record<string, unknown>)['customer'] = { requiresStaff: { role: 'kiosk' } })))).toContain(
      '"customer" is the app\'s own key',
    );
    expect(issuesOf(changed((d) => d.publicAccess.splice(6, 2)))).toContain('no entry is served through "kiosk"');
  });

  it('checks caps, settings switches and ranks against the table', () => {
    expect(issuesOf(changed((d) => (entry(d, 4)['maxOpen'] = { column: 'status', values: ['booked'], n: 2, upcoming: 'minutes' })))).toContain(
      'is not a timestamptz',
    );
    expect(issuesOf(changed((d) => (entry(d, 4)['requireSetting'] = [{ table: 'settings', column: 'slot_minutes' }])))).toContain(
      '"settings.slot_minutes" is not a bool',
    );
    expect(issuesOf(changed((d) => (entry(d, 5)['rank'] = { orderBy: 'starts_at' })))).toContain('a rank is the answer to a create');
    // A stranger's caps limit a create, over text the stranger typed.
    expect(issuesOf(changed((d) => (entry(d, 5)['anonymous'] = { perKeyHour: 20 })))).toContain('anonymous limits a create');
    expect(issuesOf(changed((d) => (entry(d, 4)['anonymous'] = { plainText: ['starts_at'] })))).toContain('"appointments.starts_at" is not a text column');
    expect(issuesOf(changed((d) => (entry(d, 4)['anonymous'] = { perValue: { columns: ['phone'], n: 2 } })))).toContain('"appointments" has no column "phone"');
    expect(issuesOf(changed((d) => (entry(d, 1)['humanCheck'] = true)))).toContain('a human check guards a create or a claim');
    // A proved first visit behind an identity that proves nothing could be reached by claiming first.
    const identity = (d: Doc) => (d.publicAccess as Record<string, unknown>[]).find((e) => e['claim'] !== undefined && e['key'] === undefined)!;
    expect(issuesOf(changed((d) => delete identity(d)['humanCheck']))).toContain('asks no proof, so this entry');
  });
});

describe('the outbox and its templates', () => {
  it('sends through a status column that can say what happened', () => {
    const doc = changed((d) => (column(d, 'messages', 'status')['enum'] = ['queued', 'sent']));
    expect(issuesOf(doc)).toContain('lacks failed, skipped');
  });

  it('maps each kind to a template the app ships, and names only its own', () => {
    expect(issuesOf(changed((d) => (d.outbox.kinds.missed = 'clinic-late')))).toContain('"clinic-late" is not one of the app\'s emailTemplates');
    expect(issuesOf(changed((d) => (d.emailTemplates[0]!.key = 'password-reset')))).toContain('starts with "clinic-"');
    expect(issuesOf(changed((d) => ((d.outbox.kinds as Record<string, string>)['recall'] = 'clinic-reminder')))).toContain(
      '"recall" is not a value of "messages.kind"',
    );
  });

  it('lists every variable the sender fills, and nothing it cannot', () => {
    // The sender's own name, an add-on's public setting, and a column with a digit in it.
    const listed = ['appName', 'manage_url', 'recipient.first_name', 'addOn.barcode-labels.shopName', 'patient.address_line2', 'practice.practice_phone'];
    expect(validateManifest(changed((d) => (d.emailTemplates[0]!.vars = listed))).ok).toBe(true);
    for (const wrong of ['AppName', 'app name', 'patient.', '.name', 'addOn.Invoices.x', '2fa.code']) {
      expect(issuesOf(changed((d) => (d.emailTemplates[0]!.vars = [wrong]))), wrong).toContain('a variable such as patient.name');
    }
  });

  it('never sends an unescaped html block, and always has US English', () => {
    expect(issuesOf(changed((d) => (d.emailTemplates[0]!.locales['en-US'].blocks[0]!.block = 'email.html')))).toContain('may not use the html block');
    expect(issuesOf(changed((d) => delete (d.emailTemplates[0]!.locales as Record<string, unknown>)['en-US']))).toContain('a template includes en-US');
  });

  it('links producers through the outbox\'s own foreign keys', () => {
    expect(issuesOf(changed((d) => (d.outbox.producers[2]!.link = 'patient_id')))).toContain('"messages.patient_id" does not point at "appointments"');
    expect(issuesOf(changed((d) => (d.outbox.producers[2]!.link = 'to_address')))).toContain('"to_address" is not one of the outbox\'s links');
  });

  it('reads a lead through one link, and records the moment it leads', () => {
    const lead = (d: Doc) => (d.outbox.producers[3] as { before: { lead: Record<string, unknown> } }).before.lead;
    expect(issuesOf(changed((d) => (lead(d)['via'] = 'clinician_id')))).toContain('"appointments.clinician_id" does not point at "patients"');
    expect(issuesOf(changed((d) => delete (d.outbox.columns as Record<string, unknown>)['due']))).toContain('records the moment it leads');
  });

  it('signs with a text column of the settings row, and links only to a path', () => {
    expect(issuesOf(changed((d) => ((d.outbox.settings as Record<string, unknown>)['name'] = 'cancel_hours')))).toContain('"settings.cancel_hours" must be a text column');
    expect(issuesOf(changed((d) => ((d.outbox as Record<string, unknown>)['pages'] = { manage: 'https://elsewhere.example/x' })))).toContain('a path on the guest side');
  });

  it('gives a number to ring only from a text column the settings row has', () => {
    expect(issuesOf(changed((d) => delete (d.outbox.settings as Record<string, unknown>)['phone']))).toBe('');
    expect(issuesOf(changed((d) => ((d.outbox.settings as Record<string, unknown>)['phone'] = 'fax')))).toContain('"settings" has no column "fax"');
    expect(issuesOf(changed((d) => ((d.outbox.settings as Record<string, unknown>)['phone'] = 'cancel_hours')))).toContain('"settings.cancel_hours" must be a text column');
  });

  it('gates only on switches that exist', () => {
    expect(issuesOf(changed((d) => delete (d.outbox.recipient as Record<string, unknown>)['optIn']))).toContain('the recipient names no opt-in column');
    expect(issuesOf(changed((d) => delete (d.outbox.settings as Record<string, unknown>)['enabled']))).toContain('no settings column to be gated by');
  });

  it('conditions say one thing about a column the table has', () => {
    expect(
      issuesOf(changed((d) => ((d.outbox.producers[0] as { onCreate: Record<string, unknown> }).onCreate['where'] = { column: 'check_status', isNull: true, eq: 'rang' }))),
    ).toContain('a condition says one of eq, in or isNull');
    expect(
      issuesOf(changed((d) => ((d.outbox.producers[1] as { onChange: Record<string, unknown> }).onChange['to'] = ['approved']))),
    ).toContain('"approved" is not a value of "appointments.check_status"');
  });

  it('refuses templates with no outbox to send them', () => {
    expect(issuesOf(changed((d) => delete (d as Record<string, unknown>)['outbox']))).toContain('this app declares none');
  });
});

describe('updatesFrom', () => {
  it('is a semver range the validator can read', () => {
    expect(issuesOf(changed((d) => (d.compatibility.updatesFrom = 'after 0.2')))).toContain('a semver range');
  });

  it('matches the ranges a release writes', () => {
    expect(parseSemverRange('nonsense')).toBeNull();
    expect(satisfiesSemverRange('0.1.4', '>=0.2.0')).toBe(false);
    expect(satisfiesSemverRange('0.2.0', '>=0.2.0')).toBe(true);
    expect(satisfiesSemverRange('0.2.7', '^0.2.0')).toBe(true);
    expect(satisfiesSemverRange('0.3.0', '^0.2.0')).toBe(false);
    expect(satisfiesSemverRange('1.4.0', '^1.2.0')).toBe(true);
    expect(satisfiesSemverRange('2.0.0', '^1.2.0')).toBe(false);
    expect(satisfiesSemverRange('0.2.9', '~0.2.1')).toBe(true);
    expect(satisfiesSemverRange('0.3.0', '~0.2.1')).toBe(false);
    expect(satisfiesSemverRange('0.5.0', '>=0.2.0 <1.0.0')).toBe(true);
    expect(satisfiesSemverRange('1.0.0', '>=0.2.0 <1.0.0')).toBe(false);
    expect(satisfiesSemverRange('0.1.4', '0.1.4 || >=0.3.0')).toBe(true);
    expect(satisfiesSemverRange('0.2.0', '0.1.4 || >=0.3.0')).toBe(false);
    expect(satisfiesSemverRange('9.9.9', '*')).toBe(true);
    expect(satisfiesSemverRange('0.2.0-rc.1', '>=0.2.0')).toBe(true);
  });
});
