// SPDX-License-Identifier: AGPL-3.0-only
/**
 * FORM ANSWERS IN A PERSON'S DATA, and how long they are kept, on SQLite,
 * Postgres and MySQL, over a forms add-on installed by the real installer:
 *
 *  - a search by address finds their answers (a sign-up still waiting for its
 *    confirmation among them) and the invitations sent to them, in any case
 *    and with spaces around the address, and nobody else's;
 *  - the download writes the answers as JSON, and as CSV with each question a
 *    column under its label in the answer's language (a choice by its
 *    label); an invitation's token hash is never written;
 *  - "What goes" counts them; the erasure deletes their answers, empties the
 *    address and the name on their invitations and keeps the rows, leaves
 *    everybody else's, and keeps the address stopped as a code;
 *  - the "How long we keep things" row reads the add-on's own setting, and
 *    the engine's sweep deletes the answers older than it, and nothing while
 *    it is empty.
 */
import { settingsRepo } from '@adminium/meta';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { formsWithInvitations } from '../../../packages/manifest/test/forms-invitations-fixture.js';
import { createConsentService } from '../src/consent/index.js';
import { bindWriteValue } from '../src/crud/write-values.js';
import type { FileStore } from '../src/files/store.js';
import { monthsBefore, sweepFormAnswers } from '../src/forms/answers.js';
import { erasePerson, previewErasure } from '../src/privacy/erase.js';
import { personZip } from '../src/privacy/export.js';
import { formAnswersKeeping } from '../src/privacy/keeping.js';
import { findPerson } from '../src/privacy/sources.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { FIT_OUT, NAMED, published, SHOWROOM, SHOWROOM_SETTINGS } from './forms-door.helpers.js';
import { TEST_SECRET } from './helpers.js';
import { LEGS } from './invoicing-install.helpers.js';

const DAY = 86_400_000;
const NOW = Date.parse('2026-11-02T12:00:00Z');
const MARTA = 'marta@cobalt.example';
const NO_FILES = { remove: async () => undefined, driverFor: async () => ({ remove: async () => undefined }) } as unknown as FileStore;

describe.each(LEGS)('form answers in a person\'s data — %s', (dialect, available) => {
  let h: Harness;
  let views: ReturnType<typeof createPublicViews>;
  const names: Record<string, string> = {};
  const consent = () => createConsentService({ meta: h.meta, secret: TEST_SECRET });
  const deps = () => ({ meta: h.meta, manager: h.manager, consent: consent(), storage: NO_FILES, secret: TEST_SECRET, now: () => NOW });

  async function insert(ref: string, values: Record<string, unknown>): Promise<void> {
    const view = (await views.viewFor(h.connectionId))!;
    const table = view.table(names[ref]!);
    const { db } = await h.manager.data(h.connectionId);
    const bound = Object.fromEntries(Object.entries(values).map(([column, value]) => [column, value === null ? null : bindWriteValue(table.columns.get(column)!, value, dialect)]));
    await db.insertInto(table.id as never).values(bound as never).execute();
  }
  const answer = (id: string, values: { email: string | null; name?: string | null; form?: string; language?: string; given?: Record<string, unknown>; at?: number; confirm?: string }) =>
    insert('answers', {
      id,
      form_id: values.form ?? 'frm_showroom',
      submitted_at: new Date(values.at ?? NOW - DAY).toISOString(),
      language: values.language ?? 'en-US',
      values: JSON.stringify(values.given ?? {}),
      email: values.email,
      name: values.name ?? null,
      confirm: values.confirm ?? 'none',
      ...(values.confirm === 'pending' ? { consent_purpose: 'newsletter', consent_wording: "Send me Meridian's newsletter.", consent_version: 2, ip: '203.0.113.9', user_agent: 'Firefox' } : {}),
    });
  const ids = async (ref: string) => (await h.rows(`SELECT id FROM ${names[ref]!} ORDER BY id`)).map((row) => row['id']);

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageAddOn(formsWithInvitations(), { bundled: true });
    const added = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'forms', version: '1.0.0', attachTo: ['dashboard'] } });
    expect(added.statusCode, added.body).toBe(200);
    for (const record of await h.meta.db.selectFrom('adminium_app_tables').select(['ref', 'tableName']).where('appKey', '=', 'forms').execute()) names[record.ref] = record.tableName;
    await settingsRepo(h.meta).set('system.instanceId', 'install-1', { updatedBy: null });
    views = createPublicViews(h.meta);
    await insert('forms', { id: 'frm_showroom', title: 'Showroom', slug: 'showroom-visit', kind: 'form', state: 'live', definition: '{}', settings: '{}', published: published(SHOWROOM, SHOWROOM_SETTINGS) });
    await insert('forms', { id: 'frm_named', title: 'Aftercare', slug: 'aftercare', kind: 'survey', state: 'live', definition: '{}', settings: '{}', published: published(FIT_OUT, NAMED) });
    await answer('ans_1', { email: ' Marta@Cobalt.example ', name: 'Marta Ruiz', language: 'de-DE', given: { qname: 'Marta Ruiz', qemail: MARTA, qsee: ['booths', 'seating'], qtopic: 'office', qcount: 3 } });
    // A sign-up still waiting for its confirmation is hers too.
    await answer('ans_2', { email: MARTA, name: 'Marta Ruiz', confirm: 'pending', given: { qname: 'Marta Ruiz', qemail: MARTA, qnews: true } });
    await answer('ans_3', { email: 'bob@harbour.dev', name: 'Bob Harbour', given: { qname: 'Bob Harbour', qemail: 'bob@harbour.dev' } });
    // An anonymous answer: nobody's.
    await answer('ans_4', { email: null, form: 'frm_named', given: { qnps: 9 } });
    for (const [id, email, name] of [
      ['inv_m', MARTA, 'Marta Ruiz'],
      ['inv_b', 'bob@harbour.dev', 'Bob Harbour'],
    ] as const) {
      await insert('invitations', { id, form_id: 'frm_named', email, name, language: 'en-US', person_table: 'public.crm_contacts', person_key: id, class: 'service', token_hash: 'a'.repeat(64), invited_at: new Date(NOW - 2 * DAY).toISOString() });
    }
  }, 240_000);

  afterAll(async () => {
    if (available) await h?.close();
  });

  it.skipIf(!available)('a search by address finds their answers, a waiting sign-up among them, and the invitations sent to them; nobody else\'s', async () => {
    const found = await findPerson(deps(), 'MARTA@cobalt.example');
    const answers = found.sources.find((one) => one.kind === 'form-answers')!;
    const invitations = found.sources.find((one) => one.kind === 'form-invitations')!;
    expect(answers).toMatchObject({ id: 'form-answers-forms', group: 'gave', app: 'forms', ref: 'answers', count: 2 });
    expect(answers.keys.sort()).toEqual(['ans_1', 'ans_2']);
    expect(invitations).toMatchObject({ id: 'form-invitations-forms', group: 'held', count: 1, keys: ['inv_m'] });
    // No people table names her: the name her answer gave.
    expect(found.person).toEqual({ name: 'Marta Ruiz', company: null });
    expect(JSON.stringify(found.sources)).not.toContain('bob@harbour.dev');
  });

  it.skipIf(!available)('the download writes the answers as JSON and as CSV, each question under its label in the answer\'s language; never a token\'s hash', async () => {
    const files = unzipSync(personZip(await findPerson(deps(), MARTA), NOW));
    const json = JSON.parse(strFromU8(files['form-answers-forms.json']!)) as { id: string; values: Record<string, unknown> }[];
    expect(json.find((row) => row.id === 'ans_1')!.values).toEqual({ qname: 'Marta Ruiz', qemail: MARTA, qsee: ['booths', 'seating'], qtopic: 'office', qcount: 3 });
    const csv = strFromU8(files['form-answers-forms.csv']!);
    // German words for the German answer, English for the English one.
    expect(csv).toContain('What would you like to see? (DE)');
    expect(csv).toContain('Acoustic booths (DE); Seating (DE)');
    expect(csv).toContain('An office (DE)');
    expect(csv).toContain("Send me Meridian's newsletter.");
    expect(csv).toContain('showroom-visit');
    expect(csv).not.toContain('"values"');
    const invitations = strFromU8(files['form-invitations-forms.json']!) + strFromU8(files['form-invitations-forms.csv']!);
    expect(invitations).toContain('inv_m');
    expect(invitations).not.toContain('token_hash');
    expect(invitations).not.toContain('a'.repeat(64));
  });

  it.skipIf(!available)('"What goes" counts them, and the erasure deletes her answers, empties her invitation, leaves everybody else\'s, and keeps her stopped', async () => {
    const preview = await previewErasure(deps(), MARTA);
    expect(preview.found).toBe(true);
    expect(preview.goes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'form-answers', count: 2, app: 'forms' }),
        expect.objectContaining({ kind: 'form-invitations', count: 1, app: 'forms' }),
      ]),
    );
    const result = await erasePerson(deps(), MARTA);
    expect(result.counts).toMatchObject({ 'form-answers-forms': 2, 'form-invitations-forms': 1 });
    expect(await ids('answers')).toEqual(['ans_3', 'ans_4']);
    const invitations = await h.rows(`SELECT id, email, name FROM ${names['invitations']!} ORDER BY id`);
    expect(invitations).toEqual([
      { id: 'inv_b', email: 'bob@harbour.dev', name: 'Bob Harbour' },
      { id: 'inv_m', email: '', name: null },
    ]);
    // Still stopped, by the code alone.
    const stopped = await consent().stop.entryFor(MARTA);
    expect(stopped).not.toBeNull();
    expect(stopped!.address).toBeNull();
    // Nothing of hers is found any more.
    const again = await findPerson(deps(), MARTA);
    expect(again.sources.filter((one) => one.kind === 'form-answers' || one.kind === 'form-invitations')).toEqual([]);
  });

  it.skipIf(!available)('the keeping row reads the add-on\'s setting; the sweep deletes the answers older than it, and nothing while it is empty', async () => {
    await answer('ans_old', { email: 'cy@harbour.dev', at: monthsBefore(NOW, 7) });
    await answer('ans_new', { email: 'di@harbour.dev', at: monthsBefore(NOW, 5) });
    expect(await formAnswersKeeping({ meta: h.meta, manager: h.manager })).toEqual([{ key: 'form-answers', fixed: true, keptFor: 'until-removed', options: [], addOn: { key: 'forms', name: 'Forms & surveys' } }]);
    expect(await sweepFormAnswers({ meta: h.meta, manager: h.manager, now: () => NOW })).toEqual({});
    expect(await ids('answers')).toContain('ans_old');

    await h.rows(`UPDATE ${names['forms_settings']!} SET answers_months = 6`);
    expect((await formAnswersKeeping({ meta: h.meta, manager: h.manager }))[0]).toMatchObject({ keptFor: 6 });
    expect(await sweepFormAnswers({ meta: h.meta, manager: h.manager, now: () => NOW })).toEqual({ forms: 1 });
    // The seven-month-old answer went; the five-month-old one, Bob's and the anonymous one (a day old) stay.
    expect(await ids('answers')).toEqual(['ans_3', 'ans_4', 'ans_new']);
  });

  it('a month back is the same day, or the last day of a shorter month', () => {
    expect(new Date(monthsBefore(Date.parse('2026-03-31T09:00:00Z'), 1)).toISOString()).toBe('2026-02-28T09:00:00.000Z');
    expect(new Date(monthsBefore(Date.parse('2026-11-02T12:00:00Z'), 24)).toISOString()).toBe('2024-11-02T12:00:00.000Z');
  });
});
