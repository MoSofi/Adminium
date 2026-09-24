// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `table.booking` against the live snapshot: every column it names on its own
 * table, and every table it reads elsewhere — who does what, the hours, the
 * closures, the settings row — must be there. The installer maps an app's
 * short names to real ids; a name left unmapped, or a table dropped since,
 * must be refused here rather than queried on every booking.
 *
 * Then the operator's door: `PUT …/overrides` refuses the same rule by name,
 * and refuses a table given both a capacity and a booking rule.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parseDatabaseModel } from '@adminium/engine';

import { bookingRuleIssue } from '../src/connections/column-rules-validation.js';
import { asUser, buildDataTestApp, createConnectionViaApi, introspectViaApi, type DataTestContext } from './connections-helpers.js';
import { makeFakeRegistry, seedSqlite } from './crud-measures-fixture.js';

const int = (name: string) => ({ name, logicalType: 'integer', nullable: false });
const text = (name: string) => ({ name, logicalType: 'varchar', nullable: true });

const model = parseDatabaseModel({
  dialect: 'postgres',
  name: 'clinic',
  defaultSchema: 'public',
  schemas: ['public'],
  tables: [
    { schema: 'public', name: 'clinic_settings', primaryKey: ['id'], columns: [int('id'), int('slot_minutes'), int('cancel_hours')] },
    { schema: 'public', name: 'clinic_opening_hours', primaryKey: ['id'], columns: [int('id'), text('weekday'), text('opens'), text('closes')] },
    { schema: 'public', name: 'clinic_cvt', primaryKey: ['id'], columns: [int('id'), int('clinician_id'), int('visit_type_id')] },
    { schema: 'public', name: 'clinic_closures', primaryKey: ['id'], columns: [int('id'), text('from_date'), text('to_date')] },
    {
      schema: 'public',
      name: 'clinic_appointments',
      primaryKey: ['id'],
      columns: [
        int('id'),
        { name: 'starts_at', logicalType: 'timestamptz', nullable: false },
        int('minutes'),
        int('clinician_id'),
        int('visit_type_id'),
        text('status'),
        text('ref'),
        { name: 'late_cancel', logicalType: 'boolean', nullable: false },
      ],
    },
  ],
  relations: [],
});
const appointments = model.tables.find((t) => t.name === 'clinic_appointments')!;

const RULE = {
  start: 'starts_at',
  minutes: 'minutes',
  resource: 'clinician_id',
  kind: 'visit_type_id',
  countWhere: { column: 'status', values: ['booked'] },
  eligible: { table: 'public.clinic_cvt', resource: 'clinician_id', kind: 'visit_type_id' },
  hours: { practice: { table: 'public.clinic_opening_hours', weekday: 'weekday', opens: 'opens', closes: 'closes' } },
  closures: { table: 'public.clinic_closures', from: 'from_date', to: 'to_date' },
  grid: { table: 'public.clinic_settings', column: 'slot_minutes' },
  cancel: { hours: { table: 'public.clinic_settings', column: 'cancel_hours' }, mode: 'flag', flag: 'late_cancel', when: { column: 'status', to: 'cancelled' } },
};

describe('bookingRuleIssue', () => {
  it('keeps a rule whose every table and column is there', () => {
    expect(bookingRuleIssue(RULE, appointments, model)).toBeNull();
  });

  it('names a missing column of the booking table', () => {
    expect(bookingRuleIssue({ ...RULE, start: 'starts' }, appointments, model)).toBe('clinic_appointments has no column "starts".');
    expect(bookingRuleIssue({ ...RULE, cancel: { ...RULE.cancel, flag: 'late' } }, appointments, model)).toMatch(/no column "late"/);
    expect(bookingRuleIssue({ ...RULE, minutes: 'ref' }, appointments, model)).toMatch(/ref is not a number/);
  });

  it('refuses a nested table left under its short name, or gone', () => {
    // What an install would write if the deep mapping missed one.
    expect(bookingRuleIssue({ ...RULE, eligible: { ...RULE.eligible, table: 'cvt' } }, appointments, model)).toBe(
      'There is no table "cvt" for the list of who does what to read.',
    );
    expect(
      bookingRuleIssue({ ...RULE, hours: { practice: { ...RULE.hours.practice, table: '' } } }, appointments, model),
    ).toMatch(/no table "" for the opening hours/);
    expect(bookingRuleIssue({ ...RULE, closures: { ...RULE.closures, table: 'public.closures' } }, appointments, model)).toMatch(
      /for the closures/,
    );
    expect(
      bookingRuleIssue({ ...RULE, hours: { ...RULE.hours, own: { table: 'public.clinic_hours', resource: 'clinician_id', weekday: 'weekday', opens: 'opens', closes: 'closes' } } }, appointments, model),
    ).toMatch(/for the own hours/);
  });

  it('names a missing column of a table it reads', () => {
    expect(bookingRuleIssue({ ...RULE, eligible: { ...RULE.eligible, kind: 'type_id' } }, appointments, model)).toBe(
      'clinic_cvt has no column "type_id" for the list of who does what.',
    );
    expect(bookingRuleIssue({ ...RULE, grid: { table: 'public.clinic_settings', column: 'grid' } }, appointments, model)).toMatch(
      /no column "grid" in "public.clinic_settings"/,
    );
    expect(
      bookingRuleIssue({ ...RULE, cancel: { ...RULE.cancel, hours: { table: 'public.settings', column: 'cancel_hours' } } }, appointments, model),
    ).toMatch(/"public.settings" to read/);
  });

  it('needs who does what and the opening hours', () => {
    const { eligible: _eligible, ...noEligible } = RULE;
    expect(bookingRuleIssue(noEligible, appointments, model)).toMatch(/names who does what and the opening hours/);
  });
});

describe('PUT …/overrides with a booking rule', () => {
  let t: DataTestContext;
  let connId: string;

  beforeAll(async () => {
    t = await buildDataTestApp({ registry: makeFakeRegistry(seedSqlite()) });
    connId = await createConnectionViaApi(t, 'postgres://fake@fake-host:5432/invdb');
    await introspectViaApi(t, connId);
  });
  afterAll(async () => {
    await t.app.close();
  });

  // The fixture's invoices stand in for the tables a booking reads: only
  // their existence is checked here.
  const rule = (eligibleTable: string) => ({
    start: 'line_total',
    minutes: 'qty',
    resource: 'invoice_id',
    kind: 'legacy_ref',
    countWhere: { column: 'rate', values: ['1'] },
    eligible: { table: eligibleTable, resource: 'invoice_id', kind: 'number' },
    hours: { practice: { table: 'main.invoices', weekday: 'number', opens: 'number', closes: 'number' } },
    grid: 15,
  });
  const put = (overrides: unknown[]) =>
    t.app.inject({
      method: 'PUT',
      url: `/api/v1/connections/${connId}/overrides`,
      headers: asUser(t.users.admin),
      payload: { overrides },
    });

  it('keeps a rule that reads real tables, and refuses one that names a table that is not there', async () => {
    const kept = await put([{ op: 'table.booking', tableName: 'main.invoice_items', value: rule('main.invoices') }]);
    expect(kept.statusCode, kept.body).toBe(200);

    const refused = await put([{ op: 'table.booking', tableName: 'main.invoice_items', value: rule('invoices') }]);
    expect(refused.statusCode).toBe(422);
    expect(refused.json<{ error: { message: string } }>().error.message).toBe(
      'There is no table "invoices" for the list of who does what to read.',
    );
  });

  it('refuses a table given both a capacity and a booking rule', async () => {
    const res = await put([
      { op: 'table.booking', tableName: 'main.invoice_items', value: rule('main.invoices') },
      { op: 'table.capacity', tableName: 'main.invoice_items', value: { slot: 'line_total', amount: 'qty', perSlot: 4, slotMinutes: 15 } },
    ]);
    expect(res.statusCode).toBe(422);
    expect(res.json<{ error: { message: string } }>().error.message).toBe('A table has a capacity or a booking rule, not both.');
  });
});
