// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A PERSON'S FORM ANSWERS, AND HOW LONG ANY ARE KEPT, on the add-on's own
 * tables as it is built, on SQLite, Postgres and MySQL, through the real
 * routes and the real sweep:
 *
 * - "Find a person" by address finds their answers and the invitations sent
 *   to them; the erasure takes their answers with their files, and blanks
 *   their invitations, leaving everybody else's;
 * - with "Keep answers" at three months (set by the manager on the add-on's
 *   settings page), the sweep deletes an answer older than that with its
 *   files, and keeps a newer one.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sweepFormAnswers } from '../../../src/forms/answers.js';
import { LEGS } from '../../invoicing-install.helpers.js';
import { draftForm, en, FORMS, formsWorld, publishForm, type FormsWorld } from './world.js';

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- a reply read freely

const DAY = 86_400_000;
const MARTA = 'marta@cobalt.dev';
const DEFINITION = {
  v: 1,
  kind: 'form',
  languages: ['en-US'],
  defaultLanguage: 'en-US',
  title: en('Send us your plans'),
  questions: [
    { id: 'qname', kind: 'short', role: 'name', required: true, label: en('Your name') },
    { id: 'qemail', kind: 'short', check: 'email', role: 'email', required: true, label: en('E-mail') },
    { id: 'qplan', kind: 'file', kinds: ['pdf'], maxMb: 5, label: en('Plans') },
  ],
  ending: { kind: 'words', words: en('Thanks.') },
};
const SETTINGS = { becomes: null, tell: [], limits: { perHour: 200, harder: false } };

describe.each(LEGS)("a person's form answers, and how long any are kept — %s", (dialect, available) => {
  const run = available && FORMS !== null;
  let w: FormsWorld;
  let formId = '';
  let ips = 0;
  const answer = async (name: string, email: string): Promise<string> => {
    ips += 1;
    const ip = `203.0.113.${String(40 + ips)}`;
    const file = await w.upload('plans', 'qplan', `${name}.pdf`, ip);
    const sent = await w.send('plans', { qname: name, qemail: email, qplan: [file] }, { ip });
    expect(sent.statusCode, sent.body).toBe(200);
    return file;
  };
  const opens = async (file: string) => (await w.as('mia', 'GET', `/api/v1/forms/files/${file}`)).statusCode;

  beforeAll(async () => {
    if (!run) return;
    w = await formsWorld(dialect);
    const made = await draftForm(w, 'mia', { name: 'plans', slug: 'plans', kind: 'form', definition: DEFINITION, settings: SETTINGS });
    formId = String((made.json()['data'] as Doc)['id']);
    expect((await publishForm(w, 'mia', formId, DEFINITION, SETTINGS)).statusCode).toBe(200);
  }, 600_000);
  afterAll(async () => {
    if (run) await w?.close();
  });

  it.skipIf(!run)('finds a person\'s answers and invitations by address, and erases them with their files', async () => {
    const hers = await answer('Marta Kovac', MARTA);
    const his = await answer('Bob Harbour', 'bob@harbour.dev');
    const at = new Date(Date.now() - DAY).toISOString();
    await w.h.rows(`INSERT INTO ${w.name('invitations')} (id, form_id, email, name, language, person_table, person_key, class, invited_at) VALUES ('inv_m', '${formId}', '${MARTA}', 'Marta Kovac', 'en-US', '${w.id('contacts')}', '7', 'service', '${dialect === 'mysql' ? at.slice(0, 19).replace('T', ' ') : at}')`);

    const found = await w.as('boss', 'POST', '/api/v1/privacy/find', { address: ' Marta@Cobalt.dev ' });
    expect(found.statusCode, found.body).toBe(200);
    const sources = found.json()['data']['sources'] as Doc[];
    expect(sources.find((one) => one['kind'] === 'form-answers')).toMatchObject({ app: 'forms', count: 1 });
    expect(sources.find((one) => one['kind'] === 'form-invitations')).toMatchObject({ app: 'forms', count: 1 });
    expect(JSON.stringify(sources)).not.toContain('bob@harbour.dev');
    // The manager, who holds no privacy action, finds nobody.
    expect((await w.as('mia', 'POST', '/api/v1/privacy/find', { address: MARTA })).statusCode).toBe(403);

    const erased = await w.as('boss', 'POST', '/api/v1/privacy/erase', { address: MARTA, confirm: MARTA });
    expect(erased.statusCode, erased.body).toBe(200);
    expect((await w.rows('answers')).map((row) => row['email'])).toEqual(['bob@harbour.dev']);
    expect(await w.rows('answer_files')).toEqual([expect.objectContaining({ file_id: his })]);
    expect(await opens(hers)).toBe(404);
    expect(await opens(his)).toBe(200);
    expect((await w.rows('invitations', "id = 'inv_m'"))[0]).toMatchObject({ email: '', name: null });
  });

  it.skipIf(!run)('with answers kept three months, the sweep deletes an older answer and its files, and keeps a newer one', async () => {
    const settings = (await w.rows('settings'))[0]!;
    const set = await w.as('mia', 'PATCH', w.data('settings', String(settings['id'])), { values: { answers_months: 3 } });
    expect(set.statusCode, set.body).toBe(200);
    const old = await answer('Old Answer', 'old@harbour.dev');
    const fresh = await answer('New Answer', 'new@harbour.dev');
    const back = new Date(Date.now() - 100 * DAY).toISOString();
    await w.h.rows(`UPDATE ${w.name('answers')} SET submitted_at = '${dialect === 'mysql' ? back.slice(0, 19).replace('T', ' ') : back}' WHERE email = 'old@harbour.dev'`);
    const swept = await sweepFormAnswers({ meta: w.h.meta, manager: w.h.manager, answerFiles: (w.composed.app as unknown as { formsFiles: { removeAnswerFiles: never } }).formsFiles.removeAnswerFiles });
    expect(swept).toEqual({ forms: 1 });
    expect((await w.rows('answers')).map((row) => row['email']).sort()).toEqual(['bob@harbour.dev', 'new@harbour.dev']);
    expect(await opens(old)).toBe(404);
    expect(await opens(fresh)).toBe(200);
    expect((await w.rows('answer_files')).map((row) => row['file_id'])).not.toContain(old);
  });
});
