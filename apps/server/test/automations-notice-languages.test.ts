// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A RULE'S NOTICE IN THE READER'S LANGUAGE, against the whole server on
 * SQLite, Postgres and MySQL, through an app installed by the real installer.
 *
 * An app's rule gives a notice's title and message in several languages. The
 * install keeps them all beside the instance's own, and each person is told
 * in theirs as the notice is written: their own tag, or another of the same
 * language, or else the rule's own text (the instance's language). Each
 * reader's bell then shows what they were told.
 */
import { automationsRepo, userPrefsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { wordsFor } from '../src/automations/actions/notification.js';
import { LEGS, said, wholeServer, type WholeServer } from './whole-server.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.28' }));

const id = { ref: 'id', type: 'int', role: 'pk' };
const en = (text: string) => ({ 'en-US': text });

function desk(): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'desk',
    name: 'Desk',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: 'mft.desk.desc', fallback: 'A desk.' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: '0.3.28', engines: ['postgres', 'mysql', 'sqlite'] },
    navGroups: [{ key: 'sales', label: en('Sales'), order: 1 }],
    requiredSchema: {
      prefixed: true,
      tables: [{ ref: 'deals', columns: [id, { ref: 'name', type: 'text', maxLength: 80 }, { ref: 'stage', type: 'enum', enum: ['lead', 'won'], default: 'lead' }] }],
    },
    roles: [{ key: 'reader', name: 'Reader', permissions: ['table:@deals:read', 'page:@desk-deals:view'] }],
    pages: [{ ref: 'desk-deals', template: 'page-crud', title: { key: 't.deals', fallback: 'Deals' }, nav: { group: 'sales', icon: 'list', order: 1 }, bindings: { rows: 'deals' } }],
    automations: [
      {
        key: 'won',
        name: en('A deal is won: tell the readers'),
        enabled: true,
        trigger: { kind: 'record', event: 'updated', table: 'deals', changedColumn: 'stage' },
        graph: {
          version: 1,
          nodes: [
            { id: 't', kind: 'trigger', title: 'When' },
            {
              id: 'tell',
              kind: 'action',
              title: 'Tell',
              action: {
                kind: 'notification',
                to: { roles: ['reader'] },
                title: { 'en-US': 'Won: {{record.name}}', 'de-DE': 'Gewonnen: {{record.name}}', 'ar-EG': 'تم الفوز: {{record.name}}' },
                body: { 'en-US': 'Send the thank-you card.', 'de-DE': 'Die Dankeskarte schicken.', 'ar-EG': 'أرسل بطاقة الشكر.' },
              },
            },
          ],
        },
      },
    ],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
  };
}

describe('the words a reader is told in', () => {
  const step = { title: 'Won: {{record.name}}', body: 'Card.', locales: { 'en-US': { title: 'Won', body: 'Card.' }, 'de-DE': { title: 'Gewonnen', body: 'Karte.' } } };
  it('are their own tag, else another of the same language, else the step’s own', () => {
    expect(wordsFor(step, 'de_DE')).toEqual({ title: 'Gewonnen', body: 'Karte.' });
    expect(wordsFor(step, 'de_AT')).toEqual({ title: 'Gewonnen', body: 'Karte.' });
    expect(wordsFor(step, 'cs_CZ')).toEqual({ title: 'Won: {{record.name}}', body: 'Card.' });
    // A step written on the rules page has one text for everybody.
    expect(wordsFor({ title: 'Hello', body: null }, 'de_DE')).toEqual({ title: 'Hello', body: null });
  });
});

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`a rule's notice in the reader's language, on ${dialect}`, () => {
    let s: WholeServer;
    const bell = async (who: string): Promise<{ title: string; body: string | null }[]> =>
      ((await s.get(who, '/api/v1/me/notifications?limit=100')).json() as { data: { items: { kind: string; title: string; body: string | null }[] } }).data.items
        .filter((item) => item.kind === 'automation.notice')
        .map((item) => ({ title: item.title, body: item.body }));

    beforeAll(async () => {
      s = await wholeServer(dialect, desk(), { people: { anke: ['reader'], amal: ['reader'], cora: ['reader'], reed: ['reader'] } });
      const prefs = userPrefsRepo(s.meta);
      await prefs.set(s.ids['anke']!, { locale: 'de_DE' });
      await prefs.set(s.ids['amal']!, { locale: 'ar_EG' });
      // Czech: a language the rule does not give.
      await prefs.set(s.ids['cora']!, { locale: 'cs_CZ' });
      await s.rows("INSERT INTO desk_deals (id, name, stage) VALUES (1, 'Atrium', 'lead')");
    }, 180_000);
    afterAll(async () => {
      await s?.close();
    });

    it('keeps every language the manifest gives on the installed rule, beside the instance’s own', async () => {
      const [rule] = await automationsRepo(s.meta).listManagedBy('desk', s.connectionId);
      const action = (rule!.graph.nodes[1] as { action: { title: string; body: string | null; locales?: Record<string, unknown> } }).action;
      expect(action.title).toBe('Won: {{record.name}}');
      expect(action.body).toBe('Send the thank-you card.');
      expect(Object.keys(action.locales ?? {})).toEqual(['ar-EG', 'de-DE', 'en-US']);
    });

    it('tells each reader in their own language, and one whose language it lacks in the rule’s own words', async () => {
      expect(said(await s.change('owner', 'deals', 1, { stage: 'won' }))).toBe('ok');
      await s.jobs();
      expect(await bell('anke')).toEqual([{ title: 'Gewonnen: Atrium', body: 'Die Dankeskarte schicken.' }]);
      expect(await bell('amal')).toEqual([{ title: 'تم الفوز: Atrium', body: 'أرسل بطاقة الشكر.' }]);
      expect(await bell('cora')).toEqual([{ title: 'Won: Atrium', body: 'Send the thank-you card.' }]);
      expect(await bell('reed')).toEqual([{ title: 'Won: Atrium', body: 'Send the thank-you card.' }]);
    });
  });
}
