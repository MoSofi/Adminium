// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A STAFF COLUMN IS NO LINK, against the whole server on SQLite, Postgres and
 * MySQL, through an app installed by the real installer.
 *
 * A site visit names its rep in `rep_id`: a text column holding a person's
 * id. The app also has a `reps` table with a whole-number key, so the
 * engine's guesser reads `rep_id` as a link to it by its name. A staff column
 * names a person, never a row of another table: nothing may follow that
 * guess. A message about the visit used to follow it "one hop further" and
 * Postgres refused the comparison (text against integer), so the visit's
 * confirmation could not be prepared; SQLite and MySQL let a person's id be
 * compared with a rep profile's number in silence.
 */
import { parseDatabaseModel } from '@adminium/engine';
import { snapshotsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { loadSnapshotView } from '../src/data-io/snapshot-view.js';
import { LEGS, said, wholeServer, type WholeServer } from './whole-server.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.28' }));

const id = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength = 120, more: Record<string, unknown> = {}) => ({ ref, type: 'text', maxLength, nullable: true, ...more });
const staff = (ref: string) => text(ref, 36, { rules: { staff: true } });

function crm(): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'crm',
    name: 'CRM',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: 'mft.crm.desc', fallback: 'A CRM.' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: '0.3.28', engines: ['postgres', 'mysql', 'sqlite'] },
    navGroups: [{ key: 'sales', label: { 'en-US': 'Sales' }, order: 1 }],
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'contacts', columns: [id, text('email', 254), text('name', 80)] },
        // A rep's profile: a whole-number key, and the person it is about in a staff column of its own.
        { ref: 'reps', columns: [id, staff('user_id'), text('tint', 20)] },
        {
          ref: 'site_visits',
          columns: [id, { ref: 'contact_id', type: 'fk', references: 'contacts', nullable: true }, staff('rep_id'), text('purpose', 80)],
        },
        {
          ref: 'messages',
          columns: [
            id,
            { ref: 'kind', type: 'enum', enum: ['visit-confirmed'] },
            { ref: 'status', type: 'enum', enum: ['queued', 'sent', 'failed', 'skipped'], default: 'queued' },
            text('to_address', 254),
            { ref: 'contact_id', type: 'fk', references: 'contacts', nullable: true },
            { ref: 'visit_id', type: 'fk', references: 'site_visits', nullable: true },
            text('error', 200),
            { ref: 'sent_at', type: 'timestamptz', nullable: true },
          ],
        },
      ],
    },
    roles: [{ key: 'rep', name: 'Rep', permissions: ['table:@site_visits:read', 'table:@site_visits:create', 'page:@crm-visits:view'] }],
    pages: [{ ref: 'crm-visits', template: 'page-crud', title: { key: 't.visits', fallback: 'Visits' }, nav: { group: 'sales', icon: 'list', order: 1 }, bindings: { rows: 'site_visits' } }],
    outbox: {
      table: 'messages',
      columns: { kind: 'kind', status: 'status', to: 'to_address', error: 'error', sentAt: 'sent_at' },
      links: { visit: 'visit_id' },
      recipient: { via: 'contact_id', table: 'contacts', email: 'email', name: 'name' },
      kinds: { 'visit-confirmed': 'crm-visit-confirmed' },
      producers: [{ kind: 'visit-confirmed', link: 'visit_id', onCreate: { table: 'site_visits' } }],
    },
    emailTemplates: [
      {
        key: 'crm-visit-confirmed',
        name: 'Visit confirmed',
        locales: {
          'en-US': {
            subject: 'Your visit: {{visit.purpose}}',
            blocks: [
              { block: 'email.text', data: { text: 'Hello {{recipient.name}}, we will see you about {{visit.purpose}}.' } },
              // Filled only if somebody followed the rep's id into the profiles table.
              { block: 'email.text', data: { text: 'Profile colour {{visit.rep.tint}} {{rep.tint}}', onlyWith: 'visit.rep.tint' } },
            ],
          },
        },
      },
    ],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
  };
}

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`a staff column is no link, on ${dialect}`, () => {
    let s: WholeServer;

    beforeAll(async () => {
      s = await wholeServer(dialect, crm(), { people: { dana: ['rep'] }, smtp: true });
      await s.rows(`INSERT INTO crm_contacts (id, email, name) VALUES (1, 'bo@harbour.dev', 'Bo Buyer')`);
      // Profile 1 is Dana's; its number is nothing like her id.
      await s.rows(`INSERT INTO crm_reps (id, user_id, tint) VALUES (1, '${s.ids['dana']!}', 'teal')`);
    }, 180_000);
    afterAll(async () => {
      await s?.close();
    });

    it('the guesser reads rep_id as a link to the profiles, and the connection as Adminium reads it has no such link', async () => {
      const raw = parseDatabaseModel((await snapshotsRepo(s.meta).latest(s.connectionId))!.schema);
      const fromRep = (relations: readonly { from: { tableId: string; columns: string[] } }[]) => relations.filter((relation) => relation.from.tableId === s.t('site_visits') && relation.from.columns.includes('rep_id'));
      // The ground of this test: the guess is there to be followed.
      expect(fromRep(raw.relations).map((relation) => (relation as unknown as { kind: string }).kind)).toEqual(['inferred-name']);
      const view = await loadSnapshotView(s.meta, s.connectionId);
      expect(fromRep(view.model.relations)).toEqual([]);
      // A declared key the app wrote is kept.
      expect(view.model.relations.some((relation) => relation.from.tableId === s.t('site_visits') && relation.from.columns[0] === 'contact_id')).toBe(true);
    });

    it('a visit booked by a rep is confirmed to the customer, and nothing is read through the rep’s id', async () => {
      await s.emails();
      const made = await s.make('dana', 'site_visits', { contact_id: 1, rep_id: s.ids['dana'], purpose: 'Kitchen measure' });
      expect(said(made), made.body).toBe('ok');
      await s.app.outboxSender.sendApp('crm', Date.now());
      const [row] = await s.rows(`SELECT status, error FROM crm_messages`);
      expect(row, JSON.stringify(row)).toMatchObject({ status: 'sent', error: null });
      const mail = (await s.emails()).filter((one) => one.templateKey === 'crm-visit-confirmed');
      expect(mail).toHaveLength(1);
      expect(mail[0]!.to).toBe('bo@harbour.dev');
      expect(mail[0]!.subject).toBe('Your visit: Kitchen measure');
      expect(`${mail[0]!.html} ${mail[0]!.text}`).not.toContain('Profile colour');
      expect(`${mail[0]!.html} ${mail[0]!.text}`).not.toContain('teal');
    });
  });
}
