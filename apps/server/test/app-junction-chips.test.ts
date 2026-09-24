// SPDX-License-Identifier: AGPL-3.0-only
/**
 * CHIPS OVER A LINK TABLE WITH ITS OWN KEY, FROM THE INSTALL TO THE ROWS.
 *
 * An app declares `clinician_visit_types(id, clinician_id, visit_type_id)` and
 * a clinician form with "Visit types they do" as chips over it. Two things
 * lost the field on every engine: the prefixed table (`clinic_…`) with a
 * surrogate `id` was never recognised as a link table, so there was no
 * many-to-many relation to write through; and the form named the link table,
 * which the binder only looked for among child tables — it bound the chips to
 * the one-to-many and the form dropped them without a word.
 *
 * Here, on each engine: the install binds the field to the many-to-many
 * relation (and warns, naming it, about a chips field nothing links); the
 * data API reads the chips from the link table, and a save adds and removes
 * its rows.
 *
 * SQLite always runs; Postgres runs with TEST_POSTGRES_URL, MySQL with
 * TEST_MYSQL_URL (`./app-install-harness.ts`).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { pagesRepo } from '@adminium/meta';

import { ENGINES, installHarness, type Harness } from './app-install-harness.js';
import { asUser, buildDataTestApp, createConnectionViaApi, introspectViaApi, type DataTestContext } from './connections-helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };
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
      { ref: 'clinicians', columns: [id, { ref: 'name', type: 'text', maxLength: 80 }] },
      { ref: 'visit_types', columns: [id, { ref: 'name', type: 'text', maxLength: 80 }] },
      {
        ref: 'clinician_visit_types',
        columns: [id, { ref: 'clinician_id', type: 'fk', references: 'clinicians' }, { ref: 'visit_type_id', type: 'fk', references: 'visit_types' }],
      },
      {
        ref: 'clinician_hours',
        columns: [id, { ref: 'clinician_id', type: 'fk', references: 'clinicians' }, { ref: 'weekday', type: 'text', maxLength: 3 }],
      },
    ],
  },
  pages: [
    {
      ref: 'clinic-clinicians',
      template: 'page-crud',
      title: { key: 'c', fallback: 'Clinicians' },
      nav: { group: 'library', icon: 'users', order: 1 },
      bindings: { rows: 'clinicians' },
      config: {
        form: {
          v: 2,
          sections: [
            { id: 's1', fields: [{ column: 'name' }] },
            // Named by its link table, as the app declared it.
            { id: 's2', fields: [{ relation: 'clinician_visit_types', control: 'reference-chips', span: 2 }] },
            // The same kind of name, for rows edited in place.
            { id: 's3', fields: [{ relation: 'clinician_hours', control: 'child-rows', span: 2, columns: [{ column: 'weekday' }] }] },
          ],
        },
      },
    },
    {
      ref: 'clinic-visit-types',
      template: 'page-crud',
      title: { key: 'v', fallback: 'Visit types' },
      nav: { group: 'library', icon: 'list', order: 2 },
      bindings: { rows: 'visit_types' },
      // Chips over a table that is no link of this one: said at install.
      config: { form: { v: 2, sections: [{ id: 's1', fields: [{ column: 'name' }, { relation: 'clinician_hours', control: 'reference-chips' }] }] } },
    },
  ],
  frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
};

let open: Harness | null = null;
let data: DataTestContext | null = null;
afterEach(async () => {
  await data?.app.close();
  data = null;
  await open?.close();
  open = null;
});

/** The relation fields of a stored page's form, as the install bound them. */
async function relationFields(h: Harness, slug: string): Promise<{ relation: string; control?: string }[]> {
  const page = await pagesRepo(h.meta).findBySlug(h.connectionId, slug);
  const form = (page?.config as { config?: { form?: { sections: { fields: Record<string, unknown>[] }[] } } }).config?.form;
  return (form?.sections ?? []).flatMap((section) => section.fields.filter((field) => 'relation' in field)) as never;
}

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`chips over a link table with its own key on ${dialect}`, () => {
    it('binds the chips to the many-to-many, and the rows follow a save', async () => {
      const h = (open = await installHarness(dialect));
      const installed = await h.install(MANIFEST);
      expect(installed.statusCode, installed.body).toBe(200);

      // The clinician form keeps both fields: chips on the link, hours on the child rows.
      const [chips, hours] = await relationFields(h, 'clinic-clinicians');
      expect(chips?.control).toBe('reference-chips');
      expect(chips?.relation).toMatch(/^inferred-m2m:.*clinic_clinician_visit_types\(clinician_id\+visit_type_id\)$/);
      expect(hours?.control).toBe('child-rows');
      expect(hours?.relation).toMatch(/^fk:.*clinic_clinician_hours\(clinician_id\)->/);

      // A chips field nothing links is said, naming the page — never dropped in silence.
      const warnings = installed.json().pages.warnings;
      expect(warnings).toEqual([
        expect.objectContaining({ page: 'clinic-visit-types', reason: 'PAGE_FORM_INVALID', message: expect.stringContaining('clinic_clinician_hours') }),
      ]);
      expect(await relationFields(h, 'clinic-visit-types')).toEqual([]);

      // The data API, over the installed tables.
      await h.run(`INSERT INTO clinic_visit_types (name) VALUES ('Check-up')`);
      await h.run(`INSERT INTO clinic_visit_types (name) VALUES ('Vaccination')`);
      await h.run(`INSERT INTO clinic_visit_types (name) VALUES ('Smear test')`);
      data = await buildDataTestApp();
      const connId = await createConnectionViaApi(data, h.dsn, 'clinic', dialect);
      await introspectViaApi(data, connId);
      await data.grantTable(data.roles.admin, connId, '*', { read: true, create: true, update: true, delete: true });
      const clinicians = chips!.relation.slice('inferred-m2m:'.length).replace(/clinic_clinician_visit_types\(.*$/, 'clinic_clinicians');
      const url = `/api/v1/data/${connId}/${dialect === 'sqlite' ? 'clinic_clinicians' : clinicians}`;
      const headers = asUser(data.users.admin);

      const created = await data.app.inject({
        method: 'POST',
        url,
        headers,
        payload: { values: { name: 'Dr Tess Tester' }, links: { [chips!.relation]: [1, 2] } },
      });
      expect(created.statusCode, created.body).toBe(201);
      const clinicianId = created.json<{ data: { id: unknown } }>().data.id;
      const stored = async () =>
        (await h.rows(`SELECT visit_type_id FROM clinic_clinician_visit_types WHERE clinician_id = ${String(clinicianId)} ORDER BY visit_type_id`)).map((row) =>
          Number(row['visit_type_id']),
        );
      // Rows of the link table, each with an id the database gave it.
      expect(await stored()).toEqual([1, 2]);
      expect((await h.rows(`SELECT id FROM clinic_clinician_visit_types`)).every((row) => row['id'] !== null)).toBe(true);

      // The chips read back from the link table.
      const read = await data.app.inject({ method: 'GET', url: `${url}/${String(clinicianId)}/links/${encodeURIComponent(chips!.relation)}`, headers });
      expect(read.statusCode, read.body).toBe(200);
      expect(read.json<{ data: { key: unknown; name: string }[] }>().data.map((chip) => [Number(chip.key), chip.name])).toEqual([
        [1, 'Check-up'],
        [2, 'Vaccination'],
      ]);

      // A save that drops one and adds another removes and adds rows.
      const saved = await data.app.inject({
        method: 'PATCH',
        url: `${url}/${String(clinicianId)}`,
        headers,
        payload: { values: { name: 'Dr Tess Tester' }, links: { [chips!.relation]: [2, 3] } },
      });
      expect(saved.statusCode, saved.body).toBe(200);
      expect(await stored()).toEqual([2, 3]);
    }, 60_000);
  });
}
