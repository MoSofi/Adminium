// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A FORM BUILT, PUBLISHED AND ANSWERED, with the add-on as it is built, on
 * SQLite, Postgres and MySQL: every write made as the add-on's manager makes
 * it from the builder, every answer as a stranger.
 *
 * - A form with a question of every kind, written as a draft (the builder's
 *   autosave), is served to nobody; published (the state, the published copy
 *   and its time in one write, with its readable link name) it is served at
 *   `/x/forms/<slug>` exactly as published.
 * - A stranger's answer, a file among it, lands in the add-on's answers and
 *   becomes an enquiry with the form's fixed source in the entry's own
 *   column; the answer names the enquiry by its stored table and key.
 * - The draft saved after publishing changes nothing a stranger sees until
 *   "Publish changes" writes the published copy again.
 * - Adminium refuses: a move from draft once the form is live (two tabs),
 *   another form's link name, deleting a live form; the reader publishes
 *   nothing.
 * - A closed form says it is closed; a draft answers as a form nobody has.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LEGS } from '../../invoicing-install.helpers.js';
import { draftForm, en, FORMS, formsWorld, publishForm, type FormsWorld } from './world.js';

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- a reply read freely

/** One question of each of the eleven kinds a form may ask. */
const EVERY_KIND = {
  v: 1,
  kind: 'form',
  languages: ['en-US', 'ar-EG'],
  defaultLanguage: 'en-US',
  title: { 'en-US': 'Book a showroom visit', 'ar-EG': 'احجز زيارة' },
  questions: [
    { id: 'qname', kind: 'short', role: 'name', required: true, label: { 'en-US': 'Your name', 'ar-EG': 'اسمك' } },
    { id: 'qemail', kind: 'short', check: 'email', role: 'email', required: true, label: { 'en-US': 'Work e-mail', 'ar-EG': 'البريد' } },
    { id: 'qnote', kind: 'long', label: { 'en-US': 'Anything else?', 'ar-EG': 'شيء آخر؟' } },
    { id: 'qtopic', kind: 'one', label: { 'en-US': 'For', 'ar-EG': 'من أجل' }, choices: [{ id: 'office', label: { 'en-US': 'An office', 'ar-EG': 'مكتب' } }, { id: 'home', label: { 'en-US': 'A home', 'ar-EG': 'منزل' } }] },
    { id: 'qsee', kind: 'several', label: { 'en-US': 'To see', 'ar-EG': 'لرؤية' }, choices: [{ id: 'booths', label: { 'en-US': 'Booths', 'ar-EG': 'أكشاك' } }, { id: 'desks', label: { 'en-US': 'Desks', 'ar-EG': 'مكاتب' } }] },
    { id: 'qday', kind: 'date', label: { 'en-US': 'Which day?', 'ar-EG': 'أي يوم؟' } },
    { id: 'qcount', kind: 'number', min: 1, max: 20, whole: true, label: { 'en-US': 'How many?', 'ar-EG': 'كم عددكم؟' } },
    { id: 'qnps', kind: 'score', label: { 'en-US': 'How likely?', 'ar-EG': 'ما مدى الاحتمال؟' } },
    { id: 'qstars', kind: 'stars', label: { 'en-US': 'Our site?', 'ar-EG': 'موقعنا؟' } },
    { id: 'qplan', kind: 'file', kinds: ['pdf'], maxMb: 5, label: { 'en-US': 'A drawing', 'ar-EG': 'رسم' } },
    { id: 'qnews', kind: 'tick', purpose: 'newsletter', wordingVersion: 1, wordingChangedAt: '2026-11-01', label: { 'en-US': 'Send me the newsletter.', 'ar-EG': 'أرسل لي النشرة.' } },
    { id: 'qfrom', kind: 'hidden', param: 'from', label: { 'en-US': 'Source', 'ar-EG': 'المصدر' } },
  ],
  ending: { kind: 'words', words: { 'en-US': 'Thanks.', 'ar-EG': 'شكرًا.' } },
};

describe.each(LEGS)('a form built, published and answered — %s', (dialect, available) => {
  const run = available && FORMS !== null;
  let w: FormsWorld;
  let formId = '';
  let settings: Doc;
  // A lookup is kept five seconds: what staff change reaches strangers after that.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 5_100));
  const shown = (slug: string, language = 'en-US') => w.stranger('GET', `/x/forms/api/${slug}?lang=${language}`);

  beforeAll(async () => {
    if (!run) return;
    w = await formsWorld(dialect);
    settings = { becomes: { table: w.id('enquiries'), map: { qname: 'person', qemail: 'email', qnote: 'message' }, source: { column: 'source', value: 'Showroom page' } }, tell: [], limits: { perHour: 200, harder: false } };
    // The builder's "New form": a draft with a random link name and nothing asked yet.
    const made = await draftForm(w, 'mia', { name: 'Untitled form', slug: 'form-k3x9qz', kind: 'form', definition: { ...EVERY_KIND, questions: [] }, settings: { becomes: null, tell: [], limits: { perHour: 200, harder: false } } });
    expect(made.statusCode, made.body).toBe(201);
    formId = String((made.json()['data'] as Doc)['id']);
  }, 600_000);
  afterAll(async () => {
    if (run) await w?.close();
  });

  it.skipIf(!run)('a draft saved with every kind of question is served to nobody', async () => {
    // The autosave: the definition and the settings, nothing published.
    const saved = await w.as('mia', 'PATCH', w.data('forms', formId), { values: { definition: EVERY_KIND, settings, name: 'Book a showroom visit' } });
    expect(saved.statusCode, saved.body).toBe(200);
    const draft = await shown('form-k3x9qz');
    const nobody = await shown('no-such-form');
    expect([draft.statusCode, draft.body]).toEqual([nobody.statusCode, nobody.body]);
  });

  it.skipIf(!run)('published with its readable link name in one write, it is served as published, in each of its languages', async () => {
    // The reader may not publish it.
    expect((await w.as('rex', 'PATCH', w.data('forms', formId), { values: { state: 'live' }, from: 'draft' })).statusCode).toBe(403);
    const values = { definition: EVERY_KIND, settings, published: { definition: EVERY_KIND, settings }, published_at: new Date().toISOString(), slug: 'book-a-showroom-visit', state: 'live' };
    const live = await w.as('mia', 'PATCH', w.data('forms', formId), { values, from: 'draft' });
    expect(live.statusCode, live.body).toBe(200);
    expect((await shown('form-k3x9qz')).statusCode).toBe(404);
    const form = await shown('book-a-showroom-visit');
    expect(form.statusCode, form.body).toBe(200);
    const body = form.json() as Doc;
    expect(JSON.stringify(body)).toContain('Book a showroom visit');
    expect(body['form']['languages']).toEqual(['en-US', 'ar-EG']);
    expect(body['form']['definition']['questions'].map((question: Doc) => question['kind'])).toEqual(['short', 'short', 'long', 'one', 'several', 'date', 'number', 'score', 'stars', 'file', 'tick', 'hidden']);
    // Never what it becomes, nor its limits.
    expect(JSON.stringify(body)).not.toContain('Showroom page');
    expect(JSON.stringify(body)).not.toContain('perHour');
    expect(JSON.stringify((await shown('book-a-showroom-visit', 'ar-EG')).json())).toContain('احجز زيارة');
  });

  it.skipIf(!run)("a stranger's answer with a file lands in the answers and becomes an enquiry with the form's fixed source", async () => {
    const ip = '203.0.113.20';
    const file = await w.upload('book-a-showroom-visit', 'qplan', 'plan.pdf', ip);
    const sent = await w.send('book-a-showroom-visit', { qname: 'Marta Kovac', qemail: 'marta@cobalt.dev', qnote: 'Two booths.', qtopic: 'office', qsee: ['booths', 'desks'], qday: '2026-12-01', qcount: 3, qnps: 9, qstars: 5, qplan: [file], qnews: true }, { ip });
    expect(sent.statusCode, sent.body).toBe(200);
    const [enquiry, ...more] = await w.rows('enquiries');
    expect(more).toEqual([]);
    expect(enquiry).toMatchObject({ person: 'Marta Kovac', email: 'marta@cobalt.dev', message: 'Two booths.', state: 'open', source: 'Showroom page' });
    const [answer] = await w.rows('answers');
    expect(answer).toMatchObject({ form_id: formId, email: 'marta@cobalt.dev', name: 'Marta Kovac', became_table: 'crm:enquiries', became_key: String(enquiry!['id']), language: 'en-US' });
    // The newsletter's yes waits for the address to confirm it.
    expect(answer!['confirm']).toBe('pending');
    const values = (typeof answer!['values'] === 'string' ? JSON.parse(answer!['values']) : answer!['values']) as Doc;
    expect(values).toMatchObject({ qtopic: 'office', qsee: ['booths', 'desks'], qcount: 3, qnps: 9, qstars: 5 });
    expect(await w.rows('answer_files')).toEqual([expect.objectContaining({ answer_id: answer!['id'], file_id: file, question: 'qplan', name: 'plan.pdf' })]);
  });

  it.skipIf(!run)('a draft saved after publishing shows nobody anything until "Publish changes"', async () => {
    await settle();
    const changed = { ...EVERY_KIND, title: { 'en-US': 'Visit our showroom', 'ar-EG': 'زوروا صالة العرض' } };
    // The autosave on a live form: the draft only.
    expect((await w.as('mia', 'PATCH', w.data('forms', formId), { values: { definition: changed } })).statusCode).toBe(200);
    expect(JSON.stringify((await shown('book-a-showroom-visit')).json())).toContain('Book a showroom visit');
    const again = await publishForm(w, 'mia', formId, changed, settings, 'live');
    expect(again.statusCode, again.body).toBe(200);
    await settle();
    expect(JSON.stringify((await shown('book-a-showroom-visit')).json())).toContain('Visit our showroom');
  });

  it.skipIf(!run)('refuses a second move from draft, another form\'s link name, and deleting a live form', async () => {
    // A second tab still holding the draft publishes again.
    const twice = await w.as('mia', 'PATCH', w.data('forms', formId), { values: { state: 'live' }, from: 'draft' });
    expect(twice.statusCode).toBe(409);
    expect(twice.json()['error']['code']).toBe('STATE_MOVE_REFUSED');
    const other = await draftForm(w, 'mia', { name: 'Untitled form', slug: 'form-abc234', kind: 'form', definition: { ...EVERY_KIND, questions: [] }, settings: { becomes: null, tell: [], limits: { perHour: 200, harder: false } } });
    const otherId = String((other.json()['data'] as Doc)['id']);
    const taken = await w.as('mia', 'PATCH', w.data('forms', otherId), { values: { slug: 'book-a-showroom-visit' } });
    expect(taken.json()['error']['code']).toBe('UNIQUE_VIOLATION');
    const deleted = await w.as('mia', 'DELETE', w.data('forms', formId));
    expect(deleted.json()['error']['code']).toBe('DELETE_REFUSED');
    // A draft is deleted.
    expect((await w.as('mia', 'DELETE', w.data('forms', otherId))).statusCode).toBe(200);
  });

  it.skipIf(!run)('a form whose answers become a row of a table named by its stored name, as a sample names it, makes that row', async () => {
    const definition = { ...EVERY_KIND, questions: EVERY_KIND.questions.slice(0, 2) };
    const byRef = { becomes: { table: 'crm:enquiries', map: { qname: 'person', qemail: 'email' }, source: { column: 'source', value: 'Sample form' } }, tell: [], limits: { perHour: 200, harder: false } };
    const made = await draftForm(w, 'mia', { name: 'From a sample', slug: 'from-a-sample', kind: 'form', definition, settings: byRef });
    const id = String((made.json()['data'] as Doc)['id']);
    expect((await publishForm(w, 'mia', id, definition, byRef)).statusCode).toBe(200);
    const sent = await w.send('from-a-sample', { qname: 'Sam Ple', qemail: 'sam@sample.dev' });
    expect(sent.statusCode, sent.body).toBe(200);
    expect(await w.rows('enquiries', "email = 'sam@sample.dev'")).toEqual([expect.objectContaining({ person: 'Sam Ple', source: 'Sample form', state: 'open' })]);
    expect((await w.rows('answers', "email = 'sam@sample.dev'"))[0]).toMatchObject({ became_table: 'crm:enquiries' });
  });

  it.skipIf(!run)('closed, the form says it is closed; opened again, it is served', async () => {
    const closed = await w.as('mia', 'PATCH', w.data('forms', formId), { values: { state: 'closed' }, from: 'live' });
    expect(closed.statusCode, closed.body).toBe(200);
    expect((await w.rows('forms', `id = '${formId}'`))[0]!['closed_at']).not.toBeNull();
    await settle();
    const shut = await shown('book-a-showroom-visit');
    expect(JSON.stringify(shut.json())).toContain('closed');
    const late = await w.send('book-a-showroom-visit', { qname: 'Late', qemail: 'late@cobalt.dev' });
    expect(late.json()['state'], late.body).toBe('closed');
    expect(await w.rows('answers', "email = 'late@cobalt.dev'")).toHaveLength(0);
    expect((await publishForm(w, 'mia', formId, EVERY_KIND, settings, 'closed')).statusCode).toBe(200);
    await settle();
    expect((await shown('book-a-showroom-visit')).statusCode).toBe(200);
  });
});
