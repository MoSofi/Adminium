// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A CALENDAR PAGE PLOTS BY THE COLUMNS ITS APP NAMES — OR BY ITS BOOKINGS.
 *
 * An appointments table that keeps a first visit's date of birth before the
 * visit's own start was installed as a calendar plotted by the birthday and
 * titled with the name typed for a first visit: the calendar rule takes the
 * first date and the display column. Here, on each engine:
 *
 *  - a page whose manifest names `config.calendar` is stored reading exactly
 *    those columns — its title through the patient's key (`patient_id.name`),
 *    its colour by visit type, an end where one is named;
 *  - a page that names none over a table with a booking rule is plotted by the
 *    booking's `start`.
 *
 * SQLite always runs; Postgres runs with TEST_POSTGRES_URL, MySQL with
 * TEST_MYSQL_URL (`./app-install-harness.ts`).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { pagesRepo, rolesRepo, snapshotsRepo, usersRepo } from '@adminium/meta';
import { parseDatabaseModel } from '@adminium/engine';
import { buildServer } from '../src/app.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { pagesRoutes } from '../src/routes/pages/index.js';
import { makeEnv } from './helpers.js';

import { ENGINES, installHarness, type Harness } from './app-install-harness.js';

const id = { ref: 'id', type: 'int', role: 'pk' };
const hhmm = (ref: string) => ({ ref, type: 'text', maxLength: 5 });
const weekday = { ref: 'weekday', type: 'enum', enum: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] };
const page = (ref: string, rows: string, calendar?: Record<string, string>) => ({
  ref,
  template: 'page-calendar',
  title: { key: ref, fallback: ref },
  nav: { group: 'records', icon: 'calendar', order: 1 },
  bindings: { rows },
  ...(calendar === undefined ? {} : { config: { calendar } }),
});

const MANIFEST = {
  kind: 'app',
  manifestVersion: 1,
  key: 'clinic',
  name: 'Clinic',
  version: '1.0.0',
  publisher: { id: 'adminium', name: 'Adminium' },
  license: 'AGPL-3.0-only',
  description: { key: 'd', fallback: 'A clinic.' },
  categories: ['operations'],
  compatibility: { minAdminiumVersion: '0.1.0' },
  requiredSchema: {
    prefixed: true,
    tables: [
      { ref: 'settings', columns: [id, { ref: 'slot_minutes', type: 'int', default: 15 }] },
      { ref: 'opening_hours', columns: [id, weekday, hhmm('opens'), hhmm('closes')] },
      { ref: 'clinicians', columns: [id, { ref: 'name', type: 'text', maxLength: 80 }] },
      { ref: 'visit_types', columns: [id, { ref: 'name', type: 'text', maxLength: 80 }, { ref: 'minutes', type: 'int', default: 15 }] },
      { ref: 'clinician_visit_types', columns: [id, { ref: 'clinician_id', type: 'fk', references: 'clinicians' }, { ref: 'visit_type_id', type: 'fk', references: 'visit_types' }] },
      { ref: 'patients', columns: [id, { ref: 'name', type: 'text', maxLength: 80 }, { ref: 'born_on', type: 'date', nullable: true }] },
      {
        ref: 'appointments',
        booking: {
          start: 'starts_at',
          minutes: 'minutes',
          resource: 'clinician_id',
          kind: 'visit_type_id',
          countWhere: { column: 'status', values: ['booked'] },
          eligible: { table: 'clinician_visit_types', resource: 'clinician_id', kind: 'visit_type_id' },
          hours: { practice: { table: 'opening_hours', weekday: 'weekday', opens: 'opens', closes: 'closes' } },
          grid: { table: 'settings', column: 'slot_minutes' },
        },
        // A first visit's details come BEFORE the visit's own time: the order that misled the calendar.
        columns: [
          id,
          { ref: 'patient_id', type: 'fk', references: 'patients', nullable: true },
          { ref: 'new_name', type: 'text', maxLength: 120, nullable: true },
          { ref: 'new_born_on', type: 'date', nullable: true },
          { ref: 'visit_type_id', type: 'fk', references: 'visit_types' },
          { ref: 'clinician_id', type: 'fk', references: 'clinicians', nullable: true },
          { ref: 'starts_at', type: 'timestamptz' },
          { ref: 'minutes', type: 'int', default: 15 },
          { ref: 'status', type: 'enum', enum: ['booked', 'cancelled'], default: 'booked' },
        ],
      },
      {
        ref: 'closures',
        columns: [id, { ref: 'from_date', type: 'date' }, { ref: 'to_date', type: 'date' }, { ref: 'label', type: 'text', maxLength: 80 }],
      },
    ],
  },
  pages: [
    page('clinic-appointments', 'appointments', { start: 'starts_at', title: 'patient_id.name', category: 'visit_type_id' }),
    page('clinic-diary', 'appointments'),
    page('clinic-closures', 'closures', { start: 'from_date', end: 'to_date', title: 'label' }),
  ],
  frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
};

type Item = { i: string; widget: string; config: Record<string, unknown> };

/** The stored layout's calendar items, by widget. */
async function calendarItems(h: Harness, slug: string): Promise<Record<string, Record<string, unknown>>> {
  const stored = await pagesRepo(h.meta).findBySlug(h.connectionId, slug);
  const items = (stored?.config as { config?: { layout?: { items?: Item[] } } }).config?.layout?.items ?? [];
  return Object.fromEntries(items.filter((item) => ['calendar-month', 'day-agenda'].includes(item.widget)).map((item) => [item.widget, item.config]));
}

let open: Harness | null = null;
afterEach(async () => {
  await open?.close();
  open = null;
});

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`a calendar's columns on ${dialect}`, () => {
    it('plots by the columns the app names, else by the booking start', async () => {
      const h = (open = await installHarness(dialect));
      const installed = await h.install(MANIFEST);
      expect(installed.statusCode, installed.body).toBe(200);
      expect(installed.json().pages.warnings).toEqual([]);

      // Named: the visit's time, the patient's name through the key, coloured by visit type.
      const named = await calendarItems(h, 'clinic-appointments');
      expect(Object.keys(named).sort()).toEqual(['calendar-month', 'day-agenda']);
      for (const config of Object.values(named)) {
        expect(config).toMatchObject({ startColumn: 'starts_at', titleColumn: 'patient_id__display', categoryColumn: 'visit_type_id' });
        expect(config).not.toHaveProperty('endColumn');
        const binding = config['binding'] as { orderBy: unknown; lookups?: string[]; select?: string[] };
        expect(binding.orderBy).toEqual([{ column: 'starts_at', dir: 'asc' }]);
        expect(binding.lookups).toEqual(['patient_id__display:patient_id.name']);
        expect(binding.select).toEqual(expect.arrayContaining(['starts_at', 'visit_type_id']));
        expect(binding.select).not.toContain('patient_id__display');
      }
      expect(named['calendar-month']!['titleLookup']).toMatchObject({ column: 'patient_id', keyColumn: 'id', labelColumn: 'name' });
      expect(String((named['calendar-month']!['titleLookup'] as { table: string }).table)).toMatch(/(^|\.)clinic_patients$/);

      // Named nothing: the booking's start, never the date of birth before it.
      const diary = await calendarItems(h, 'clinic-diary');
      expect(diary['calendar-month']).toMatchObject({ startColumn: 'starts_at' });
      expect((diary['calendar-month']!['binding'] as { orderBy: unknown }).orderBy).toEqual([{ column: 'starts_at', dir: 'asc' }]);

      // A span: from, to, and its own label.
      const closures = await calendarItems(h, 'clinic-closures');
      expect(closures['calendar-month']).toMatchObject({ startColumn: 'from_date', endColumn: 'to_date', titleColumn: 'label' });
    }, 60_000);

    it('a calendar made in Studio over the same table plots by the booking start too', async () => {
      const h = (open = await installHarness(dialect));
      expect((await h.install(MANIFEST)).statusCode).toBe(200);
      const role = (await rolesRepo(h.meta).findBySlug('super-admin'))!;
      const ava = await usersRepo(h.meta).create({ email: 'ava@adminium.test', name: 'ava', passwordHash: 'h', status: 'active' });
      await rolesRepo(h.meta).assignToUser(ava.id, role.id);
      const snapshot = (await snapshotsRepo(h.meta).latest(h.connectionId))!;
      const table = parseDatabaseModel(snapshot.schema).tables.find((t) => t.name === 'clinic_appointments')!.id;

      const app = await buildServer({ env: makeEnv(), logger: false, metaDb: h.meta });
      app.addHook('onRequest', async (request) => {
        const req = request as unknown as { user: unknown; session: unknown };
        req.user = ava;
        req.session = { id: 'test-session', userId: ava.id };
      });
      await app.register(rbacPlugin, { meta: h.meta });
      await app.register(async (api) => api.register(pagesRoutes({ meta: h.meta })), { prefix: '/api/v1' });
      await app.ready();
      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/pages',
          payload: { slug: 'studio-visits', title: 'Visits', template: 'page-calendar', navGroup: 'planning', connectionId: h.connectionId, table },
        });
        expect(res.statusCode, res.body).toBe(200);
        const made = await calendarItems(h, 'studio-visits');
        expect(made['calendar-month']).toMatchObject({ startColumn: 'starts_at' });
      } finally {
        await app.close();
      }
    }, 60_000);
  });
}
