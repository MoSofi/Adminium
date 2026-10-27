// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE RECORD PAGE'S "E-MAIL CONSENT" PANEL, against the whole server on
 * SQLite, Postgres and MySQL, through a CRM-shaped app installed by the real
 * installer: contacts declared as people (address, name, a "may be e-mailed"
 * column), and a notes table that holds an address but is no people table.
 *
 *  - As a marketer who may change contacts but is shown their addresses
 *    masked: the panel shows, says the table is declared and which columns
 *    hold the address and the name, and never sends the address back.
 *  - "Record consent", "Replied" and "They said no" each write one row (a
 *    log row, a log row, a do-not-email entry) and the panel, which the CRM's
 *    own line reads too, says so at once.
 *  - A table no app declares answers `declared: false`: the page shows no
 *    panel for it.
 *  - An erased person's row: the panel says so calmly (nothing known, nothing
 *    to change) and refuses anything more about them, with no row written.
 */
import { consentLogRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { LEGS, said, wholeServer, type WholeServer } from './whole-server.helpers.js';

// The people word is read from the release to come.
vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.37' }));

const id = { ref: 'id', type: 'int', role: 'pk' };
const strict = (set: string, on: unknown) => ({ stamp: { set, on, strict: true } });

function crm(): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'crm',
    name: 'CRM',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'AGPL-3.0-only',
    description: { key: 'd', fallback: 'A small CRM.' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: '0.3.37', engines: ['postgres', 'mysql', 'sqlite'] },
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'contacts',
          keyField: 'name',
          columns: [
            id,
            { ref: 'name', type: 'text', maxLength: 80 },
            // Unique and never empty: the erasure writes it onto its reserved domain.
            { ref: 'email', type: 'text', maxLength: 254, unique: true, rules: { personal: true } },
            { ref: 'may_email', type: 'bool', default: false },
            { ref: 'may_email_by_id', type: 'text', maxLength: 36, nullable: true, rules: { staff: true, ...strict('user-id', { columns: ['may_email'] }) } },
            { ref: 'may_email_at', type: 'timestamptz', nullable: true, rules: strict('now', { columns: ['may_email'] }) },
          ],
        },
        { ref: 'notes', columns: [id, { ref: 'email', type: 'text', maxLength: 254, nullable: true }, { ref: 'body', type: 'text', maxLength: 400, nullable: true }] },
      ],
    },
    people: [{ table: 'contacts', kind: 'people', email: 'email', name: 'name', consent: { column: 'may_email', purpose: 'newsletter' } }],
    roles: [
      // Changes contacts, sees their addresses masked, holds no setting: a marketer, not an Admin.
      { key: 'marketer', name: 'Marketer', permissions: ['table:@contacts:read', 'table:@contacts:update', 'table:@notes:read'] },
      { key: 'reader', name: 'Reader', permissions: ['table:@contacts:read'] },
    ],
    pages: [{ ref: 'crm-contacts', template: 'page-crud', title: { key: 't', fallback: 'Contacts' }, nav: { group: 'crm', icon: 'home', order: 1 }, bindings: { rows: 'contacts' } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
  };
}

interface Panel {
  declared: boolean;
  erased: boolean;
  columns: { address: string | null; name: string | null };
  addressKnown: boolean;
  purposes: { purpose: string; state: string }[];
  stopped: { reason: string } | null;
  lastReplied: number | null;
  history: { state: string; source: string; how: string | null; staff: { label: string } | null }[];
  mayChange: boolean;
}

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`the record page's consent panel [${dialect}]`, () => {
    let s: WholeServer;
    const ref = (table: string, key: number) => ({ connectionId: s.connectionId, table: s.t(table), recordId: String(key) });
    const panel = async (who: string, table: string, key: number) => {
      const res = await s.send(who, 'POST', '/api/v1/consent/panel', ref(table, key));
      expect(res.statusCode, res.body).toBe(200);
      return { data: (res.json() as { data: Panel }).data, body: res.body };
    };
    const logRows = async () => (await s.meta.db.selectFrom('adminium_consent_log').select((eb) => eb.fn.countAll().as('n')).executeTakeFirstOrThrow()).n;
    const stopRows = async () => Number((await s.meta.db.selectFrom('adminium_stop_list').select((eb) => eb.fn.countAll().as('n')).executeTakeFirstOrThrow()).n);
    const counts = async () => ({ log: Number(await logRows()), stop: await stopRows() });

    beforeAll(async () => {
      s = await wholeServer(dialect, crm(), { people: { mia: ['marketer'], rex: ['reader'] } });
      await s.rows(`INSERT INTO crm_contacts (id, name, email) VALUES (1, 'Marta Kovac', 'marta.kovac@cobaltlegal.example'), (2, 'Ben Okafor', 'ben@okafor.example')`);
      await s.rows(`INSERT INTO crm_notes (id, email, body) VALUES (1, 'note@notes.example', 'A note')`);
    }, 180_000);
    afterAll(async () => {
      await s?.close();
    });

    it('shows a masked marketer the panel of a declared table, and never the address', async () => {
      const { data, body } = await panel('mia', 'contacts', 1);
      expect(data).toMatchObject({ declared: true, erased: false, columns: { address: 'email', name: 'name' }, addressKnown: true, stopped: null, history: [], mayChange: true });
      expect(data.purposes.map((one) => [one.purpose, one.state])).toEqual([
        ['newsletter', 'not-asked'],
        ['surveys', 'not-asked'],
      ]);
      expect(body).not.toContain('cobaltlegal');
      // The record page holds the same row masked for them: the panel adds nothing they are not shown.
      const row = await s.get('mia', `/api/v1/data/${s.connectionId}/${s.t('contacts')}/1`);
      expect(row.body).not.toContain('cobaltlegal');
      // A reader sees it too, and may change nothing.
      expect((await panel('rex', 'contacts', 1)).data.mayChange).toBe(false);
    });

    it('answers a table no app declares as such: no panel for it', async () => {
      const { data, body } = await panel('mia', 'notes', 1);
      expect(data).toMatchObject({ declared: false, erased: false, columns: { address: 'email', name: null } });
      expect(body).not.toContain('notes.example');
    });

    it('"Record consent", "Replied" and "They said no" each write one row, and the panel says so at once', async () => {
      let before = await counts();
      const recorded = await s.send('mia', 'POST', '/api/v1/consent/record-consent', { ...ref('contacts', 1), purpose: 'newsletter', how: 'phone', note: 'Rang the office' });
      expect(said(recorded)).toBe('ok');
      expect(await counts()).toEqual({ log: before.log + 1, stop: before.stop });
      let now = (await panel('mia', 'contacts', 1)).data;
      expect(now.purposes[0]).toMatchObject({ purpose: 'newsletter', state: 'yes' });
      expect(now.history.map((one) => [one.state, one.source, one.how, one.staff?.label])).toEqual([['yes', 'staff', 'phone', expect.any(String)]]);
      // The column the CRM's switch shows follows the log (mirrored by the server, never by the page).
      const mirrored = (await s.rows(`select may_email from crm_contacts where id = 1`))[0]!['may_email'];
      expect([true, 1, '1']).toContain(mirrored);

      before = await counts();
      expect(said(await s.send('mia', 'POST', '/api/v1/consent/replied', ref('contacts', 1)))).toBe('ok');
      expect(await counts()).toEqual({ log: before.log + 1, stop: before.stop });
      now = (await panel('mia', 'contacts', 1)).data;
      expect(now.lastReplied).toEqual(expect.any(Number));
      expect(now.history[0]).toMatchObject({ state: 'replied', source: 'staff' });

      before = await counts();
      const saidNo = await s.send('mia', 'POST', '/api/v1/consent/said-no', ref('contacts', 1));
      expect(said(saidNo)).toBe('ok');
      expect(saidNo.body).not.toContain('cobaltlegal');
      expect(await counts()).toEqual({ log: before.log, stop: before.stop + 1 });
      now = (await panel('mia', 'contacts', 1)).data;
      expect(now.stopped).toMatchObject({ reason: 'hand' });
      // Said twice, still one entry.
      expect(said(await s.send('mia', 'POST', '/api/v1/consent/said-no', ref('contacts', 1)))).toBe('ok');
      expect((await counts()).stop).toBe(before.stop + 1);
    });

    it('shows an erased person calmly and records nothing more about them', async () => {
      expect(said(await s.send('mia', 'POST', '/api/v1/consent/record-consent', { ...ref('contacts', 2), purpose: 'newsletter', how: 'in-person', note: null }))).toBe('ok');
      const erased = await s.send('owner', 'POST', '/api/v1/privacy/erase', { address: 'ben@okafor.example', confirm: 'ben@okafor.example' });
      expect(said(erased)).toBe('ok');
      const stored = (await s.rows(`select email from crm_contacts where id = 2`))[0]!['email'];
      expect(String(stored)).toMatch(/@erased\.invalid$/);

      const { data, body } = await panel('mia', 'contacts', 2);
      expect(data).toMatchObject({ declared: true, erased: true, addressKnown: false, stopped: null, lastReplied: null, history: [], mayChange: false });
      expect(data.purposes.every((one) => one.state === 'not-asked')).toBe(true);
      expect(body).not.toContain('erased.invalid');
      expect(body).not.toContain('okafor');

      const before = await counts();
      for (const path of ['record-consent', 'replied', 'said-no']) {
        const res = await s.send('mia', 'POST', `/api/v1/consent/${path}`, { ...ref('contacts', 2), ...(path === 'record-consent' ? { purpose: 'newsletter', how: 'phone', note: null } : {}) });
        expect(res.statusCode, res.body).toBe(422);
        expect((res.json() as { error: { details: { reason: string } } }).error.details.reason).toBe('ERASED');
      }
      expect(await counts()).toEqual(before);
      expect(await consentLogRepo(s.meta).history({ person: { connectionId: s.connectionId, table: s.t('contacts'), key: '2' }, hashes: [] }, { limit: 10 })).toEqual([]);
    });
  });
}
