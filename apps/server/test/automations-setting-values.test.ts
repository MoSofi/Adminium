// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A RULE'S NEW ROW, FILLED FROM THE SETTINGS ROW AND DATED SO MANY DAYS ON,
 * against the whole server on SQLite, Postgres and MySQL, through an app
 * installed by the real installer: an aftercare call made when a job is
 * signed off, owned by the person the settings row names, due the number of
 * days the settings row holds after the sign-off.
 *
 *  - The days are counted on the business's calendar (the connection's zone):
 *    a moment keeps its wall time, or the step's `at`, across a change of the
 *    clocks; a date is a date. The setting's number is read when the step
 *    runs; while it holds none from 1 to 3650 (empty, 0), the step's own `days`.
 *  - A staff column filled from the settings row names somebody who signs in,
 *    or is left empty and the run's log says so. A date that is empty leaves
 *    the value empty, said too.
 *  - A setting is read as a rule reads the connection: a value is no way to
 *    read a table. Its author must read that table; a secret or personal
 *    column and a private table are refused at the save; a rule stored by
 *    hand that names one reads nothing.
 */
import { automationsRepo, permissionsRepo, rolesRepo, type AutomationTriggerEvent } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { walkRule } from '../src/automations/runner.js';
import { slotInstant } from '../src/crud/capacity-guard.js';
import { matrixRowsFromGrants } from '../src/rbac/permissions.js';
import { TEST_SECRET } from './helpers.js';
import { LEGS, said, wholeServer, type WholeServer } from './whole-server.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.28' }));

const id = { ref: 'id', type: 'int', role: 'pk' };
const en = (text: string) => ({ 'en-US': text });
const flow = (...nodes: Record<string, unknown>[]) => ({ version: 1, nodes: [{ id: 't', kind: 'trigger', title: 'When' }, ...nodes] });
const action = (key: string, body: Record<string, unknown>) => ({ id: key, kind: 'action', title: key, action: body });
const setting = (column: string) => ({ table: 'settings', column });

function firm(): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'firm',
    name: 'Firm',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: 'mft.firm.desc', fallback: 'A firm.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.3.28', engines: ['postgres', 'mysql', 'sqlite'] },
    navGroups: [{ key: 'work', label: en('Work'), order: 1 }],
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'settings',
          columns: [
            id,
            { ref: 'aftercare_days', type: 'int', nullable: true },
            { ref: 'aftercare_owner_id', type: 'text', maxLength: 36, nullable: true, rules: { staff: true } },
            { ref: 'greeting', type: 'text', maxLength: 80, nullable: true },
            { ref: 'pin', type: 'text', maxLength: 12, nullable: true, rules: { secret: true } },
            { ref: 'phone', type: 'text', maxLength: 40, nullable: true, rules: { personal: true } },
          ],
        },
        { ref: 'diary', private: true, belongs: [{ column: 'owner_id', set: 'anyone' }], columns: [id, { ref: 'owner_id', type: 'text', maxLength: 36, nullable: true, rules: { staff: true } }, { ref: 'note', type: 'text', maxLength: 80, nullable: true }] },
        {
          ref: 'jobs',
          columns: [
            id,
            { ref: 'name', type: 'text', maxLength: 80 },
            { ref: 'state', type: 'enum', enum: ['open', 'signed-off'], default: 'open' },
            { ref: 'signed_on', type: 'date', nullable: true },
            { ref: 'signed_at', type: 'timestamptz', nullable: true },
            { ref: 'born_on', type: 'date', nullable: true, rules: { personal: true } },
          ],
        },
        {
          ref: 'follow_ups',
          columns: [
            id,
            { ref: 'job_id', type: 'fk', references: 'jobs' },
            { ref: 'owner_id', type: 'text', maxLength: 36, nullable: true, rules: { staff: true } },
            { ref: 'due_at', type: 'timestamptz', nullable: true },
            { ref: 'call_at', type: 'timestamptz', nullable: true },
            { ref: 'due_on', type: 'date', nullable: true },
            { ref: 'next_at', type: 'timestamptz', nullable: true },
            { ref: 'text', type: 'text', maxLength: 200, nullable: true },
          ],
        },
      ],
    },
    roles: [
      // Writes rules about jobs and follow-ups, and does not read the settings.
      { key: 'office', name: 'Office', permissions: ['table:@jobs:read', 'table:@follow_ups:read', 'table:@follow_ups:create', 'page:@firm-jobs:view'] },
    ],
    pages: [{ ref: 'firm-jobs', template: 'page-crud', title: { key: 't.jobs', fallback: 'Jobs' }, nav: { group: 'work', icon: 'list', order: 1 }, bindings: { rows: 'jobs' } }],
    automations: [
      {
        key: 'aftercare',
        name: en('A job signed off: an aftercare call'),
        enabled: true,
        trigger: { kind: 'record', event: 'updated', table: 'jobs', changedColumn: 'state', when: [{ left: { field: 'state' }, op: 'is', right: 'signed-off' }] },
        graph: flow(
          action('call', {
            kind: 'record.create',
            table: 'follow_ups',
            values: {
              job_id: '{{record.id}}',
              owner_id: { setting: setting('aftercare_owner_id') },
              due_at: { daysAfter: { column: 'signed_at', days: 28, setting: setting('aftercare_days'), at: '09:00' } },
              call_at: { daysAfter: { column: 'signed_at', days: 28, setting: setting('aftercare_days') } },
              due_on: { daysAfter: { column: 'signed_on', days: 28, setting: setting('aftercare_days') } },
              next_at: { daysAfter: { now: true, days: 1 } },
              text: { setting: setting('greeting') },
            },
          }),
        ),
      },
    ],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
  };
}

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`a rule's new row from the settings row, so many days on, on ${dialect}`, () => {
    let s: WholeServer;
    let job = 0;
    /** A job signed off at this moment (and on this day), the rule run; the follow-up it made. */
    const signOff = async (signedAt: string | null, signedOn: string | null): Promise<Record<string, unknown>> => {
      job += 1;
      expect(said(await s.make('owner', 'jobs', { id: job, name: `Job ${String(job)}`, signed_at: signedAt, signed_on: signedOn }))).toBe('ok');
      expect(said(await s.change('owner', 'jobs', job, { state: 'signed-off' }))).toBe('ok');
      await s.jobs();
      const [made] = await s.rows(`SELECT owner_id, due_at, call_at, due_on, next_at, text FROM firm_follow_ups WHERE job_id = ${String(job)}`);
      expect(made, `job ${String(job)} made no follow-up`).toBeDefined();
      return made!;
    };
    const instant = (value: unknown): string | null => slotInstant(value)?.toISOString() ?? null;
    const day = (value: unknown): string | null => (value === null || value === undefined ? null : value instanceof Date ? `${String(value.getFullYear())}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}` : String(value).slice(0, 10));
    const logOf = async (): Promise<string> => {
      const rule = (await automationsRepo(s.meta).listManagedBy('firm', s.connectionId)).find((one) => one.templateKey === 'aftercare')!;
      return JSON.stringify(await s.meta.db.selectFrom('adminium_automation_runs').select(['trace']).where('automationId', '=', rule.id).execute());
    };
    const recordTrigger = () => ({ kind: 'record', connectionId: s.connectionId, table: s.t('jobs'), event: 'updated', watch: false, when: [] });
    const saveCreate = (who: string, values: Record<string, unknown>) =>
      s.send(who, 'POST', '/api/v1/automations', { name: `probe ${who}`, connectionId: s.connectionId, trigger: recordTrigger(), graph: { version: 1, nodes: [{ id: 't', kind: 'trigger', title: 'T' }, { id: 'c', kind: 'action', title: 'Make', action: { kind: 'record.create', table: s.t('follow_ups'), values: { job_id: '{{record.id}}', ...values } } }] }, enabled: false });

    beforeAll(async () => {
      s = await wholeServer(dialect, firm(), { people: { fay: [], oli: ['office'] } });
      // The business is in New York: the clocks go back on 1 November 2026.
      await s.meta.db.updateTable('adminium_connections').set({ timezone: 'America/New_York' } as never).where('id', '=', s.connectionId).execute();
      await s.rows(`INSERT INTO firm_settings (id, aftercare_days, aftercare_owner_id, greeting, pin, phone) VALUES (1, NULL, '${s.ids['fay']!}', 'Ring them', '4321', '+1 212 555 0100')`);
      const own = await rolesRepo(s.meta).findBySlug('firm-office');
      for (const row of matrixRowsFromGrants(['system:automations:manage']).rows) await permissionsRepo(s.meta).grant(own!.id, row.resourceKind, row.resourceRef, row.actions as never);
    }, 180_000);
    afterAll(async () => {
      await s?.close();
    });

    it('counts 28 days on the business’s calendar, a moment keeping its wall time or the step’s, across the change of the clocks', async () => {
      // 09:30 in New York on 20 October (summer time, UTC-4). 28 days on is 17 November, winter time (UTC-5).
      const made = await signOff('2026-10-20T13:30:00Z', '2026-10-20');
      expect(instant(made['due_at'])).toBe('2026-11-17T14:00:00.000Z');
      expect(instant(made['call_at'])).toBe('2026-11-17T14:30:00.000Z');
      expect(day(made['due_on'])).toBe('2026-11-17');
      const next = slotInstant(made['next_at'])!.getTime() - Date.now();
      expect(next).toBeGreaterThan(22 * 3_600_000);
      expect(next).toBeLessThan(26 * 3_600_000);
      expect(made['owner_id']).toBe(s.ids['fay']);
      expect(made['text']).toBe('Ring them');
    });

    it('reads the number of days from the settings row when it holds one, and the step’s own while it holds none it can count', async () => {
      await s.rows('UPDATE firm_settings SET aftercare_days = 10 WHERE id = 1');
      const ten = await signOff('2026-10-20T13:30:00Z', '2026-10-20');
      expect(instant(ten['due_at'])).toBe('2026-10-30T13:00:00.000Z');
      expect(day(ten['due_on'])).toBe('2026-10-30');
      await s.rows('UPDATE firm_settings SET aftercare_days = 5000 WHERE id = 1');
      expect(day((await signOff('2026-10-20T13:30:00Z', '2026-10-20'))['due_on'])).toBe('2026-11-17');
      await s.rows('UPDATE firm_settings SET aftercare_days = 0 WHERE id = 1');
      expect(day((await signOff('2026-10-20T13:30:00Z', '2026-10-20'))['due_on'])).toBe('2026-11-17');
      await s.rows('UPDATE firm_settings SET aftercare_days = NULL WHERE id = 1');
    });

    it('leaves a date counted from an empty one empty, and says so', async () => {
      const made = await signOff(null, null);
      expect([made['due_at'], made['call_at'], made['due_on']]).toEqual([null, null, null]);
      expect(await logOf()).toContain('due_on was left empty: signed_on is empty on this record.');
    });

    it('hands the row only to somebody who signs in: a suspended person, or nobody named, leaves it empty and the log says so', async () => {
      await s.meta.db.updateTable('adminium_users').set({ status: 'suspended' } as never).where('id', '=', s.ids['fay']!).execute();
      try {
        expect((await signOff('2026-10-20T13:30:00Z', '2026-10-20'))['owner_id']).toBeNull();
        expect(await logOf()).toContain("owner_id was left empty: the settings row's aftercare_owner_id names nobody who can sign in.");
      } finally {
        await s.meta.db.updateTable('adminium_users').set({ status: 'active' } as never).where('id', '=', s.ids['fay']!).execute();
      }
      await s.rows(`UPDATE firm_settings SET aftercare_owner_id = 'nobody-at-all' WHERE id = 1`);
      expect((await signOff('2026-10-20T13:30:00Z', '2026-10-20'))['owner_id']).toBeNull();
      await s.rows(`UPDATE firm_settings SET aftercare_owner_id = '${s.ids['fay']!}' WHERE id = 1`);
    });

    it('asks its author to read the settings, and refuses a secret or personal column, a private table, and a day into a column that holds none', async () => {
      // Oli writes rules about jobs and follow-ups, and does not read the settings.
      expect((await s.get('oli', `/api/v1/data/${s.connectionId}/${s.t('settings')}`)).statusCode).toBe(403);
      expect(said(await saveCreate('oli', { text: { setting: { table: s.t('settings'), column: 'greeting' } } }))).toMatch(/^403/);
      expect(said(await saveCreate('oli', { due_on: { daysAfter: { column: 'signed_on', days: 1, setting: { table: s.t('settings'), column: 'aftercare_days' } } } }))).toMatch(/^403/);
      expect(said(await saveCreate('oli', { due_on: { daysAfter: { column: 'signed_on', days: 1 } } }))).toBe('ok');
      // Even the owner.
      expect(said(await saveCreate('owner', { text: { setting: { table: s.t('settings'), column: 'pin' } } }))).toMatch(/^422/);
      expect(said(await saveCreate('owner', { text: { setting: { table: s.t('settings'), column: 'phone' } } }))).toMatch(/^422/);
      expect(said(await saveCreate('owner', { text: { setting: { table: s.t('diary'), column: 'note' } } }))).toMatch(/^403/);
      expect(said(await saveCreate('owner', { owner_id: { setting: { table: s.t('settings'), column: 'greeting' } } }))).toMatch(/^422/);
      expect(said(await saveCreate('owner', { text: { daysAfter: { now: true, days: 1 } } }))).toMatch(/^422/);
      expect(said(await saveCreate('owner', { due_on: { daysAfter: { column: 'name', days: 1 } } }))).toMatch(/^422/);
      expect(said(await saveCreate('owner', { due_on: { daysAfter: { column: 'born_on', days: 1 } } }))).toMatch(/^422/);
      expect(said(await saveCreate('owner', { due_on: { daysAfter: { now: true, days: 1, setting: { table: s.t('settings'), column: 'greeting' } } } }))).toMatch(/^422/);
      expect(said(await saveCreate('owner', { text: { setting: { table: s.t('settings'), column: 'greeting' } } }))).toBe('ok');
    });

    it('reads a setting as a rule reads the connection: a secret column holds nothing, whatever a rule stored by hand says', async () => {
      const rule = await automationsRepo(s.meta).create({
        connectionId: s.connectionId,
        name: 'stored by hand',
        enabled: true,
        trigger: recordTrigger() as never,
        graph: { version: 1, nodes: [{ id: 't', kind: 'trigger', title: 'T' }, { id: 'c', kind: 'action', title: 'Make', action: { kind: 'record.create', table: s.t('follow_ups'), values: { job_id: '{{record.id}}', text: { setting: { table: s.t('settings'), column: 'pin' } }, due_on: { daysAfter: { now: true, days: 0 } } } } }] } as never,
      });
      job += 1;
      expect(said(await s.make('owner', 'jobs', { id: job, name: 'By hand' }))).toBe('ok');
      const event = { event: 'record.updated', origin: 'dashboard', ruleId: null, hops: 0, record: { connectionId: s.connectionId, table: s.t('jobs'), pk: { id: job }, label: 'By hand' }, snapshot: { id: job }, occurredAt: Date.now() } as AutomationTriggerEvent;
      const ran = await walkRule({ meta: s.meta, manager: s.manager, app: s.app as never, secret: TEST_SECRET, now: () => Date.now() }, { rule, runId: 'arun_by_hand', event });
      expect(ran.kind === 'finished' ? ran.status : ran.kind, JSON.stringify(ran)).toBe('succeeded');
      const [made] = await s.rows(`SELECT text, due_on FROM firm_follow_ups WHERE job_id = ${String(job)}`);
      expect(made?.['text']).toBeNull();
      expect(day(made?.['due_on'])).not.toBeNull();
      expect(JSON.stringify(await s.rows('SELECT text FROM firm_follow_ups'))).not.toContain('4321');
    });
  });
}
