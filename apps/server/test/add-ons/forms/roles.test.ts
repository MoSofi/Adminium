// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHO MAY DO WHAT WITH FORMS, with the add-on as it is built, on SQLite,
 * Postgres and MySQL, each person signed in as themselves.
 *
 * The add-on ships two roles. Its manager is shown the Forms page and the
 * off-rail Forms settings page, and the first page they land on is never
 * that settings page; its reader is shown Forms only, and the server refuses
 * them a deleted answer. Somebody who holds neither (the CRM's clerk) is
 * shown no Forms page and is refused a form's summary, a stranger's file and
 * the status read. The manager is a marketer: they read the status (the
 * address, the websites, the roles a form may tell) without the privacy or
 * the roles action, and the kit says they may not send campaigns; a Super
 * Admin may.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LEGS } from '../../invoicing-install.helpers.js';
import { draftForm, en, FORMS, formsWorld, publishForm, type FormsWorld } from './world.js';

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- a reply read freely

const DEFINITION = { v: 1, kind: 'form', languages: ['en-US'], defaultLanguage: 'en-US', title: en('Call me back'), questions: [{ id: 'qname', kind: 'short', role: 'name', required: true, label: en('Your name') }, { id: 'qfile', kind: 'file', kinds: ['pdf'], maxMb: 5, label: en('A drawing') }], ending: { kind: 'words', words: en('Thanks.') } };
const SETTINGS = { becomes: null, tell: [], limits: { perHour: 200, harder: false } };

describe.each(LEGS)("Forms' two roles — %s", (dialect, available) => {
  const run = available && FORMS !== null;
  let w: FormsWorld;
  let formId = '';
  let answerId = '';
  let fileId = '';

  beforeAll(async () => {
    if (!run) return;
    w = await formsWorld(dialect);
    const made = await draftForm(w, 'mia', { name: 'Call me back', slug: 'call-me-back', kind: 'form', definition: DEFINITION, settings: SETTINGS });
    expect(made.statusCode, made.body).toBe(201);
    formId = String((made.json()['data'] as Doc)['id']);
    const live = await publishForm(w, 'mia', formId, DEFINITION, SETTINGS);
    expect(live.statusCode, live.body).toBe(200);
    fileId = await w.upload('call-me-back', 'qfile', 'plan.pdf', '203.0.113.5');
    const sent = await w.send('call-me-back', { qname: 'Marta', qfile: [fileId] }, { ip: '203.0.113.5' });
    expect(sent.statusCode, sent.body).toBe(200);
    answerId = String((await w.rows('answers'))[0]!['id']);
  }, 600_000);
  afterAll(async () => {
    if (run) await w?.close();
  });

  it.skipIf(!run)('the manager is shown Forms and its settings, the reader Forms alone, the clerk neither; nobody lands on the off-rail settings', async () => {
    const shown = async (who: string) => {
      const res = await w.as(who, 'GET', '/api/v1/bootstrap');
      expect(res.statusCode, res.body).toBe(200);
      const data = res.json()['data'] as Doc;
      const code = (data['addOnNav']?.pages ?? []).filter((page: Doc) => page['addOnKey'] === 'forms').map((page: Doc) => page['ref']);
      const listed = JSON.stringify({ ...data, addOnNav: undefined });
      // What the dashboard opens on `/`: the first page of the rail, never one kept off it.
      const items: Doc[] = [...(data['nav']?.groups ?? []).flatMap((group: Doc) => group['items']), ...(data['appSections'] ?? []).flatMap((section: Doc) => section['groups'].flatMap((group: Doc) => group['items']))];
      const settings = items.find((item) => item['slug'] === 'forms-settings');
      return { code, settings: listed.includes('"forms-settings"'), offRail: settings?.['offRail'] === true || settings === undefined };
    };
    expect(await shown('mia')).toEqual({ code: ['forms'], settings: true, offRail: true });
    expect(await shown('rex')).toEqual({ code: ['forms'], settings: false, offRail: true });
    expect(await shown('cal')).toEqual({ code: [], settings: false, offRail: true });
  });

  it.skipIf(!run)("the reader reads the answers and is refused deleting one; the manager deletes", async () => {
    expect((await w.as('rex', 'GET', w.data('answers'))).statusCode).toBe(200);
    const refused = await w.as('rex', 'DELETE', w.data('answers', answerId));
    expect(refused.statusCode, refused.body).toBe(403);
    expect(await w.rows('answers')).toHaveLength(1);
    // The reader neither writes a form nor moves one.
    expect((await w.as('rex', 'PATCH', w.data('forms', formId), { values: { state: 'closed' }, from: 'live' })).statusCode).toBe(403);
  });

  it.skipIf(!run)('the clerk, who holds no role of Forms, is refused the summary, the file and the status read', async () => {
    expect((await w.as('cal', 'GET', `/api/v1/add-ons/forms/forms/${formId}/summary`)).statusCode).toBe(403);
    expect((await w.as('cal', 'GET', `/api/v1/forms/files/${fileId}`)).statusCode).toBe(403);
    expect((await w.as('cal', 'GET', '/api/v1/forms/status')).statusCode).toBe(403);
    expect((await w.as('cal', 'GET', w.data('answers'))).statusCode).toBe(403);
    // The reader and the manager are served all three.
    for (const who of ['rex', 'mia']) {
      expect((await w.as(who, 'GET', `/api/v1/add-ons/forms/forms/${formId}/summary`)).statusCode, who).toBe(200);
      expect((await w.as(who, 'GET', `/api/v1/forms/files/${fileId}`)).statusCode, who).toBe(200);
      expect((await w.as(who, 'GET', '/api/v1/forms/status')).statusCode, who).toBe(200);
    }
  });

  it.skipIf(!run)('the manager, a marketer, reads the status without the privacy or roles action; only a Super Admin may send campaigns', async () => {
    const status = (await w.as('mia', 'GET', '/api/v1/forms/status')).json()['data'] as Doc;
    expect(status).toMatchObject({ notice: true, publicOrigin: 'https://forms.meridian.example', websites: [] });
    expect(status['reach']['state']).toEqual(expect.any(String));
    expect((status['roles'] as Doc[]).map((role) => role['name'])).toEqual(expect.arrayContaining(['Forms manager', 'Forms reader']));
    expect((await w.as('mia', 'GET', '/api/v1/privacy/reach')).statusCode).toBe(403);
    const kit = async (who: string) => (await w.as(who, 'GET', '/api/v1/add-ons/forms/kit')).json() as { has: Record<string, boolean> };
    expect((await kit('mia')).has['system:settings:manage']).toBe(false);
    expect((await kit('boss')).has['system:settings:manage']).toBe(true);
  });
});
