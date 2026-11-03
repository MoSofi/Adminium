// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "SEND A SURVEY", THE ADD-ON'S OWN STEP, on SQLite, Postgres and MySQL, the
 * way an owner meets it: a rule on the CRM's jobs, saved by a Super Admin
 * with the add-on's step, run when a job changes, on the real server.
 *
 * - It writes one invitation: the job's main contact's address, name,
 *   language and company, the contacts' table (by its id) and the contact's
 *   key, the job as other rows name it (`crm:jobs`) and its key.
 * - The add-on's outbox mails it with a link that carries a one-use token;
 *   the answer sent with that token fills the CRM's feedback (the job from
 *   the invitation, the score from the stars, the text from the long text)
 *   and spends the token: a second answer with it is refused.
 * - A "no" to surveys in the consent log skips the mail, also as service
 *   mail. As marketing mail, it is judged on the person the invitation
 *   names: a yes to surveys kept on the contact's own row sends it.
 * - The add-on's "Survey" tab shows on the jobs for a reader of the
 *   invitations, and not for a clerk who reads none.
 */
import { pagesRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createConsentService } from '../../../src/consent/index.js';
import { TEST_SECRET } from '../../helpers.js';
import { LEGS } from '../../invoicing-install.helpers.js';
import { draftForm, en, FORMS, formsWorld, publishForm, type FormsWorld } from './world.js';

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- a reply read freely

const SURVEY = {
  v: 1,
  kind: 'survey',
  languages: ['en-US'],
  defaultLanguage: 'en-US',
  title: en('How did your job go?'),
  questions: [
    { id: 'qnps', kind: 'score', recommend: true, required: true, label: en('How likely are you to recommend us?') },
    { id: 'qstars', kind: 'stars', label: en('How was the work?') },
    { id: 'qlong', kind: 'long', label: en('Anything we should do differently?') },
  ],
  ending: { kind: 'words', words: en('Thank you.') },
};

describe.each(LEGS)('the add-on\'s "Send a survey" step — %s', (dialect, available) => {
  const run = available && FORMS !== null;
  let w: FormsWorld;
  let surveyId = '';
  let ruleId = '';
  const graphOf = (kind: 'service' | 'marketing') => ({
    version: 1,
    nodes: [
      { id: 'n1', kind: 'trigger', title: 'A job changes' },
      { id: 'n2', kind: 'action', title: 'Send a survey', sub: '', onError: false, action: { kind: 'add-on.step', addOn: 'forms', step: 'send-survey', addOnName: 'Forms & surveys', inputs: { survey: 'job-feedback', to: '@link:contact_id', class: kind } } },
    ],
  });
  const consent = () => createConsentService({ meta: w.h.meta, secret: TEST_SECRET });
  const touch = async (job: number, title: string) => {
    const res = await w.as('boss', 'PATCH', w.data('jobs', String(job)), { values: { title } });
    expect(res.statusCode, res.body).toBe(200);
    await w.runJobs();
  };
  const invitations = async () => (await w.rows('invitations')).sort((a, b) => String(a['record_key']).localeCompare(String(b['record_key'])));

  beforeAll(async () => {
    if (!run) return;
    w = await formsWorld(dialect);
    await w.h.rows(`INSERT INTO ${w.name('companies')} (id, name) VALUES (1, 'Linden Studio'), (2, 'Harbour & Co')`);
    await w.h.rows(`INSERT INTO ${w.name('contacts')} (id, name, email, company_id) VALUES (1, 'Ann Lee', 'ann@linden.dev', 1), (2, 'Gil Moor', 'gil@harbour.dev', 2), (3, 'Cy Lund', 'cy@lund.dev', 1), (4, 'Dee Park', 'dee@park.dev', 2)`);
    await w.h.rows(`INSERT INTO ${w.name('jobs')} (id, title, contact_id, status) VALUES (10, 'Kitchen fit-out', 1, 'open'), (11, 'Shop front', 2, 'open'), (12, 'Loft', 3, 'open'), (13, 'Porch', 4, 'open')`);
    const settings = { becomes: { table: w.id('feedback'), map: { qstars: 'score', qlong: 'text' } }, tell: [], limits: { perHour: 200, harder: false }, survey: { mode: 'named', linkNames: true, stopAfterDays: 30 } };
    const made = await draftForm(w, 'mia', { name: 'How did your job go?', slug: 'job-feedback', kind: 'survey', definition: SURVEY, settings });
    expect(made.statusCode, made.body).toBe(201);
    surveyId = String((made.json()['data'] as Doc)['id']);
    const live = await publishForm(w, 'mia', surveyId, SURVEY, settings);
    expect(live.statusCode, live.body).toBe(200);
    // The rule, saved as the rule page saves it: a job changes → send the survey to its main contact, as service mail.
    const graph = graphOf('service');
    const trigger = { kind: 'record', connectionId: w.h.connectionId, table: w.id('jobs'), event: 'updated', watch: false, when: [] };
    const saved = await w.as('boss', 'POST', '/api/v1/automations', { name: 'Survey after a job', connectionId: w.h.connectionId, trigger, graph, enabled: true });
    expect(saved.statusCode, saved.body).toBe(201);
    ruleId = String(saved.json()['id'] ?? saved.json()['data']?.['id']);
  }, 600_000);
  afterAll(async () => {
    if (run) await w?.close();
  });

  it.skipIf(!run)('writes one invitation for the job\'s main contact: their address, name, language, company and row; the job by its stored name and key', async () => {
    expect(ruleId).not.toBe('');
    await touch(10, 'Kitchen fit-out, signed off');
    const [invited, ...more] = await invitations();
    expect(more).toEqual([]);
    expect(invited).toMatchObject({
      form_id: surveyId,
      email: 'ann@linden.dev',
      name: 'Ann Lee',
      language: 'en-US',
      company: 'Linden Studio',
      person_table: w.id('contacts'),
      person_key: '1',
      record_table: 'crm:jobs',
      record_key: '10',
      class: 'service',
      rule_name: 'Survey after a job',
    });
    expect(invited!['answered_at']).toBeNull();
  });

  it.skipIf(!run)('mails it with a one-use link; the answer with it fills the job\'s feedback and spends it; a second is refused', async () => {
    const mails = (await w.mails()).filter((mail) => mail.to.includes('ann@linden.dev'));
    expect(mails).toHaveLength(1);
    const link = /https:\/\/forms\.meridian\.example\/x\/forms\/job-feedback\?t=([A-Za-z0-9_-]+)/.exec(mails[0]!.html + mails[0]!.text);
    expect(link, mails[0]!.text).not.toBeNull();
    const token = link![1]!;
    // The token is in clear in the mail alone.
    expect(JSON.stringify(await w.rows('invitations'))).not.toContain(token);
    const sent = await w.send('job-feedback', { qnps: 9, qstars: 4, qlong: 'Tidy work, on time.' }, { t: token });
    expect(sent.statusCode, sent.body).toBe(200);
    expect(await w.rows('feedback')).toEqual([{ id: expect.anything(), job_id: 10, score: 4, text: 'Tidy work, on time.' }]);
    const [invited] = await invitations();
    expect(invited!['answered_at']).not.toBeNull();
    const [answer] = await w.rows('answers');
    expect(answer).toMatchObject({ form_id: surveyId, invitation_id: invited!['id'], email: 'ann@linden.dev', became_table: 'crm:feedback' });
    const again = await w.send('job-feedback', { qnps: 2, qstars: 1, qlong: 'Changed my mind.' }, { t: token });
    expect(again.statusCode).not.toBe(200);
    expect(await w.rows('feedback')).toHaveLength(1);
    expect(await w.rows('answers')).toHaveLength(1);
  });

  it.skipIf(!run)('a "no" to surveys in the consent log skips the mail, also as service mail', async () => {
    await consent().record({ person: { connectionId: w.h.connectionId, table: w.id('contacts'), key: '2' }, purpose: 'surveys', source: 'import', state: 'no' });
    await touch(11, 'Shop front, signed off');
    const invited = (await invitations()).find((row) => row['record_key'] === '11')!;
    expect(invited).toMatchObject({ email: 'gil@harbour.dev', class: 'service' });
    const mail = (await w.rows('invitation_mails', `invitation_id = '${String(invited['id'])}'`))[0]!;
    expect(mail).toMatchObject({ status: 'skipped', error: 'Not sent: they said no to surveys' });
    expect((await w.mails()).filter((one) => one.to.includes('gil@harbour.dev'))).toEqual([]);
  });

  it.skipIf(!run)('as marketing mail, it is judged on the person it names: a yes to surveys kept on the contact counts; none skips it', async () => {
    expect((await w.as('boss', 'PATCH', `/api/v1/automations/${ruleId}`, { graph: graphOf('marketing') })).statusCode).toBe(200);
    await consent().record({ person: { connectionId: w.h.connectionId, table: w.id('contacts'), key: '3' }, purpose: 'surveys', source: 'import', state: 'yes' });
    await w.mails();
    await touch(12, 'Loft, signed off');
    await touch(13, 'Porch, signed off');
    const mailOf = async (job: string) => {
      const invited = (await invitations()).find((row) => row['record_key'] === job)!;
      expect(invited['class']).toBe('marketing');
      return (await w.rows('invitation_mails', `invitation_id = '${String(invited['id'])}'`))[0]!;
    };
    // The verdict is the person's: Cy agreed on his own row, so the mail is held only by this server's sender, which is
    // not set up for marketing here (no postal address); Dee agreed nowhere, so hers is not sent for want of a yes.
    const cy = await mailOf('12');
    const dee = await mailOf('13');
    expect(dee).toMatchObject({ status: 'skipped', error: 'Not sent: has not agreed to marketing mail' });
    expect(String(cy['error']), 'a yes on the contact').not.toContain('has not agreed');
    expect(String(cy['error'])).toContain('postal address');
  });

  it.skipIf(!run)('its "Survey" tab shows on the jobs for a reader of the invitations, and not for a clerk who reads none', async () => {
    const page = (await pagesRepo(w.h.meta).listForConnection(w.h.connectionId)).find((one) => (one.config as { source?: { table?: string } }).source?.table === w.id('jobs'))!;
    const tabs = async (who: string) => {
      const res = await w.as(who, 'GET', `/api/v1/pages/${page.id}`);
      expect(res.statusCode, res.body).toBe(200);
      const find = (value: unknown): Doc[] | null => {
        if (Array.isArray(value)) return value.map(find).find((one) => one !== null) ?? null;
        if (typeof value !== 'object' || value === null) return null;
        if (Array.isArray((value as Doc)['recordTabs'])) return (value as Doc)['recordTabs'] as Doc[];
        return Object.values(value).map(find).find((one) => one !== null) ?? null;
      };
      return (find(res.json()) ?? []).map((tab) => `${String(tab['addOn'])}:${String(tab['id'])}`);
    };
    expect(await tabs('rox')).toEqual(['forms:survey']);
    expect(await tabs('cal')).toEqual([]);
  });
});
