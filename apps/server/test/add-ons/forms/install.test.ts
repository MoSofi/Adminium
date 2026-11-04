// SPDX-License-Identifier: AGPL-3.0-only
/**
 * FORMS & SURVEYS, INSTALLED, with the add-on as it is built, beside a CRM,
 * on SQLite, Postgres and MySQL.
 *
 * Its six tables under its own name, the four Adminium speaks carrying the
 * columns of the forms block; one settings row keeping answers 24 months;
 * its two roles; its step offered to the rule page; its sample (two drafts
 * in eight languages that read as forms) added by the real loader and taken
 * out whole; and taken off again, the CRM's own rows stay.
 */
import { formDefinitionSchema, formSettingsSchema } from '@adminium/add-on-contracts/forms';
import { FORMS_COLUMNS } from '@adminium/manifest';
import { rolesRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createSampleDataService, findSampleOwner } from '../../../src/apps/sample-data.js';
import { LEGS } from '../../invoicing-install.helpers.js';
import { FORMS, formsWorld, type FormsWorld } from './world.js';

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- a reply read freely
const jsonOf = (value: unknown): unknown => (typeof value === 'string' ? JSON.parse(value) : value);

describe.skipIf(FORMS === null)('Forms, as it is built', () => {
  it('names its one page bundle and its sample, and both are built', () => {
    expect(Object.keys(FORMS?.files ?? {}).sort()).toEqual(['dist/pages/forms.js', 'seeds/forms.sample.json']);
  });
});

describe.each(LEGS)('Forms installed beside a CRM — %s', (dialect, available) => {
  const run = available && FORMS !== null;
  let w: FormsWorld;
  beforeAll(async () => {
    if (run) w = await formsWorld(dialect);
  }, 600_000);
  afterAll(async () => {
    if (run) await w?.close();
  });

  it.skipIf(!run)('makes its six tables, the four Adminium speaks with the columns of the forms block, and one settings row', async () => {
    const made = await w.h.tableNames();
    for (const ref of ['forms', 'answers', 'invitations', 'answer_files', 'invitation_mails', 'settings']) expect(made, ref).toContain(`forms_${ref}`);
    const tables = (FORMS!.manifest['requiredSchema'] as { tables: { ref: string; columns: { ref: string }[] }[] }).tables;
    for (const [part, ref] of [['forms', 'forms'], ['answers', 'answers'], ['invitations', 'invitations'], ['files', 'answer_files']] as const) {
      const declared = tables.find((table) => table.ref === ref)!.columns.map((column) => column.ref);
      for (const column of Object.keys(FORMS_COLUMNS[part])) expect(declared, `${ref}.${column}`).toContain(column);
    }
    const [settings, ...more] = await w.rows('settings');
    expect(more).toEqual([]);
    expect(Number(settings!['answers_months'])).toBe(24);
    for (const ref of ['forms', 'answers', 'invitations', 'answer_files', 'invitation_mails']) expect(await w.rows(ref), ref).toEqual([]);
  });

  it.skipIf(!run)('ships a manager and a reader, and offers its step to the rule page', async () => {
    const roles = rolesRepo(w.h.meta);
    for (const slug of ['forms-manager', 'forms-reader']) expect(await roles.findBySlug(slug), slug).not.toBeNull();
    const sources = await w.as('boss', 'GET', '/api/v1/automations/sources');
    expect(sources.statusCode, sources.body).toBe(200);
    const connection = (sources.json()['connections'] as Doc[]).find((one) => one['id'] === w.h.connectionId)!;
    const step = (connection['steps'] as Doc[]).find((one) => one['addOn'] === 'forms' && one['key'] === 'send-survey')!;
    expect(step['name']['en-US']).toBe('Send a survey');
    expect((step['inputs'] as Doc[]).map((input) => [input['key'], input['kind']])).toEqual([
      ['survey', 'record'],
      ['to', 'person'],
      ['class', 'choice'],
    ]);
    // The jobs reach a person through their main contact.
    const jobs = (connection['tables'] as Doc[]).find((one) => one['id'] === w.id('jobs'))!;
    expect(jobs['personLinks']).toEqual([{ column: 'contact_id', table: w.id('contacts') }]);
  });

  it.skipIf(!run)('adds its sample, two drafts in eight languages that read as forms, and takes it out whole', async () => {
    const service = createSampleDataService(w.h.sampleData);
    const owner = (await findSampleOwner(w.h.meta, 'forms', 'add-on'))!;
    const added = await service.add(owner, { locale: 'en-US', userId: w.h.owner.id, userLabel: 'owner@test' });
    expect(added.counts).toEqual({ forms: 2 });
    const forms = await w.rows('forms');
    expect(forms.map((row) => [row['kind'], row['state']]).sort()).toEqual([
      ['form', 'draft'],
      ['survey', 'draft'],
    ]);
    for (const row of forms) {
      expect(String(row['id']), 'a key of its own').toMatch(/\S/);
      const definition = formDefinitionSchema.safeParse(jsonOf(row['definition']));
      expect(definition.success, JSON.stringify(definition.error?.issues ?? [])).toBe(true);
      expect(formSettingsSchema.safeParse(jsonOf(row['settings'])).success).toBe(true);
      expect((jsonOf(row['definition']) as { languages: string[] }).languages).toHaveLength(8);
    }
    const removed = await service.remove(owner, { keepChanged: false, userId: w.h.owner.id, userLabel: 'owner@test' });
    expect(removed.removed).toBe(2);
    expect(await w.rows('forms')).toEqual([]);
  });

  it.skipIf(!run)('taken off with its tables, the CRM keeps its own rows', async () => {
    await w.h.rows(`INSERT INTO ${w.name('enquiries')} (id, person, state) VALUES (1, 'Marta', 'open')`);
    const gone = await w.h.inject({ method: 'DELETE', url: '/add-ons/forms', payload: { dropTables: true, confirmKey: 'forms' } });
    expect(gone.statusCode, gone.body).toBe(200);
    const made = await w.h.tableNames();
    expect(made.filter((name) => name.startsWith('forms_'))).toEqual([]);
    expect(await w.h.rows(`SELECT person FROM ${w.name('enquiries')}`)).toEqual([{ person: 'Marta' }]);
  });
});
