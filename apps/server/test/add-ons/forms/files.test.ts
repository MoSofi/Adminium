// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A FORM'S ANSWERS AS STAFF READ THEM, with the add-on as it is built, on
 * SQLite, Postgres and MySQL, each person signed in as themselves:
 *
 * - a stranger's file opens for the manager and the reader as an attachment
 *   that is never sniffed; the clerk, a reader limited to another form, and
 *   the stranger are refused it;
 * - the Answers tab's search (a name, or an address) finds its answers on
 *   every engine, and a reader limited to one form lists that form's only
 *   and is told no counts;
 * - the CSV holds who answered and what they wrote, for the manager; the
 *   reader may not export;
 * - deleting an answer through the data routes takes its files: the add-on's
 *   rows and the bytes.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LEGS } from '../../invoicing-install.helpers.js';
import { draftForm, en, FORMS, formsWorld, PDF, publishForm, type FormsWorld } from './world.js';

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- a reply read freely

const DEFINITION = {
  v: 1,
  kind: 'form',
  languages: ['en-US'],
  defaultLanguage: 'en-US',
  title: en('Send us your plans'),
  questions: [
    { id: 'qname', kind: 'short', role: 'name', required: true, label: en('Your name') },
    { id: 'qemail', kind: 'short', check: 'email', role: 'email', required: true, label: en('E-mail') },
    { id: 'qplan', kind: 'file', kinds: ['pdf'], maxMb: 5, many: true, label: en('Plans') },
  ],
  ending: { kind: 'words', words: en('Thanks.') },
};
const SETTINGS = { becomes: null, tell: [], limits: { perHour: 200, harder: false } };

describe.each(LEGS)("a form's answers as staff read them — %s", (dialect, available) => {
  const run = available && FORMS !== null;
  let w: FormsWorld;
  let formId = '';
  let otherId = '';
  const answerOf = async (email: string) => (await w.rows('answers', `email = '${email}'`))[0]!;
  const where = (filter: unknown) => `?where=${encodeURIComponent(JSON.stringify(filter))}`;

  beforeAll(async () => {
    if (!run) return;
    w = await formsWorld(dialect);
    for (const slug of ['plans', 'other-plans']) {
      const made = await draftForm(w, 'mia', { name: slug, slug, kind: 'form', definition: DEFINITION, settings: SETTINGS });
      expect(made.statusCode, made.body).toBe(201);
      const id = String((made.json()['data'] as Doc)['id']);
      expect((await publishForm(w, 'mia', id, DEFINITION, SETTINGS)).statusCode).toBe(200);
      if (slug === 'plans') formId = id;
      else otherId = id;
    }
    const answer = async (slug: string, name: string, email: string, ip: string, files: number) => {
      const ids: string[] = [];
      for (let n = 0; n < files; n += 1) ids.push(await w.upload(slug, 'qplan', `plan-${String(n + 1)}.pdf`, ip));
      const sent = await w.send(slug, { qname: name, qemail: email, ...(ids.length === 0 ? {} : { qplan: ids }) }, { ip });
      expect(sent.statusCode, sent.body).toBe(200);
    };
    await answer('plans', 'Marta Kovac', 'marta@cobalt.dev', '203.0.113.31', 2);
    await answer('plans', 'Bob Harbour', 'bob@harbour.dev', '203.0.113.32', 0);
    await answer('other-plans', 'Cy Lund', 'cy@lund.dev', '203.0.113.33', 1);
    await w.limit([formId]);
  }, 600_000);
  afterAll(async () => {
    if (run) await w?.close();
  });

  it.skipIf(!run)("a stranger's file opens for the manager and the reader as an attachment never sniffed; nobody else's", async () => {
    const marta = await answerOf('marta@cobalt.dev');
    const files = await w.rows('answer_files', `answer_id = '${String(marta['id'])}'`);
    expect(files.map((file) => file['name']).sort()).toEqual(['plan-1.pdf', 'plan-2.pdf']);
    const url = `/api/v1/forms/files/${String(files[0]!['file_id'])}`;
    for (const who of ['mia', 'rex', 'lim']) {
      const res = await w.as(who, 'GET', url);
      expect(res.statusCode, `${who} ${res.body}`).toBe(200);
      expect(String(res.headers['content-disposition'])).toMatch(/^attachment;/);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.body).toBe(PDF.toString('latin1'));
    }
    expect((await w.as('cal', 'GET', url)).statusCode).toBe(403);
    expect((await w.stranger('GET', url)).statusCode).toBe(401);
    // A reader limited to the plans form opens none of the other form's files.
    const cy = await answerOf('cy@lund.dev');
    const other = (await w.rows('answer_files', `answer_id = '${String(cy['id'])}'`))[0]!;
    expect([403, 404]).toContain((await w.as('lim', 'GET', `/api/v1/forms/files/${String(other['file_id'])}`)).statusCode);
    expect((await w.as('rex', 'GET', `/api/v1/forms/files/${String(other['file_id'])}`)).statusCode).toBe(200);
  });

  it.skipIf(!run)('the search finds a name or an address, in any case; a limited reader lists one form only', async () => {
    const names = async (who: string, filter: unknown) => {
      const res = await w.as(who, 'GET', `${w.data('answers')}${where(filter)}`);
      expect(res.statusCode, `${who} ${res.body}`).toBe(200);
      return (res.json()['data'] as Doc[]).map((row) => row['name']).sort();
    };
    const of = (form: string, more: unknown[] = []) => ({ and: [{ column: 'form_id', op: 'eq', value: form }, ...more] });
    expect(await names('mia', of(formId, [{ column: 'name', op: 'ilike', value: '%kova%' }]))).toEqual(['Marta Kovac']);
    expect(await names('rex', of(formId, [{ column: 'email', op: 'ilike', value: '%HARBOUR%' }]))).toEqual(['Bob Harbour']);
    expect(await names('mia', of(formId))).toEqual(['Bob Harbour', 'Marta Kovac']);
    expect(await names('lim', { column: 'form_id', op: 'in', value: [formId, otherId] })).toEqual(['Bob Harbour', 'Marta Kovac']);
    // Counts are of every answer: a reader held to some of them is told none, on either form.
    for (const id of [formId, otherId]) {
      const refused = await w.as('lim', 'GET', `/api/v1/add-ons/forms/forms/${id}/summary`);
      expect(refused.statusCode).toBe(403);
      expect(refused.json()['error']['details']['reason']).toBe('row-limit');
    }
  });

  it.skipIf(!run)('the CSV holds who answered and what they wrote, for the manager; the reader may not export', async () => {
    const body = { connectionId: w.h.connectionId, source: { kind: 'table', table: w.id('answers'), filters: [{ column: 'form_id', op: 'eq', value: formId }], columns: ['submitted_at', 'name', 'email', 'values'].map((name) => ({ name, label: name })) }, format: 'csv' };
    expect((await w.as('rex', 'POST', '/api/v1/exports', body)).statusCode).toBe(403);
    const started = await w.as('mia', 'POST', '/api/v1/exports', body);
    expect(started.statusCode, started.body).toBeLessThan(300);
    const id = String(started.json()['data']['id']);
    await w.runJobs();
    const csv = await w.as('mia', 'GET', `/api/v1/exports/${id}/download`);
    expect(csv.statusCode, csv.body).toBe(200);
    expect(csv.body).toContain('Marta Kovac');
    expect(csv.body).toContain('marta@cobalt.dev');
    expect(csv.body).toContain('Bob Harbour');
    expect(csv.body).not.toContain('Cy Lund');
  });

  it.skipIf(!run)("deleting an answer takes its files: the add-on's rows and the bytes", async () => {
    const marta = await answerOf('marta@cobalt.dev');
    const files = await w.rows('answer_files', `answer_id = '${String(marta['id'])}'`);
    expect(files).toHaveLength(2);
    const gone = await w.as('mia', 'DELETE', `${w.data('answers', String(marta['id']))}?confirm=true`);
    expect(gone.statusCode, gone.body).toBe(200);
    expect(await w.rows('answers', `id = '${String(marta['id'])}'`)).toEqual([]);
    expect(await w.rows('answer_files', `answer_id = '${String(marta['id'])}'`)).toEqual([]);
    for (const file of files) expect((await w.as('mia', 'GET', `/api/v1/forms/files/${String(file['file_id'])}`)).statusCode).toBe(404);
    // Everybody else's stays.
    expect(await w.rows('answer_files')).toHaveLength(1);
  });
});
