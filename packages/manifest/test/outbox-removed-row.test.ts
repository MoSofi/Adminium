// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A MESSAGE ABOUT A ROW THAT IS REMOVED (`onDelete` on an outbox producer):
 * what the manifest check accepts and what it refuses, and the release an app
 * that says it asks for. The row is gone when the message is written, so the
 * producer takes nothing that reads the row again, and keeps of it only what
 * `was` may keep of any row.
 */
import { describe, expect, it } from 'vitest';

import { NOT_ON_REMOVAL, installFloorWords, removalTableOf, validateManifest, type OutboxProducer } from '../src/index.js';

const id = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength = 120, more: Record<string, unknown> = {}) => ({ ref, type: 'text', maxLength, nullable: true, ...more });
const link = (ref: string, references: string) => ({ ref, type: 'fk', references, nullable: true });
const template = (key: string) => ({ key, name: key, locales: { 'en-US': { subject: 'Your visit', blocks: [{ block: 'email.text', data: { text: 'The visit on {{was.starts_at.date}} is cancelled.' } }] } } });

function crm(floor = '0.3.28') {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'crm',
    name: 'CRM',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'AGPL-3.0-only',
    description: { key: 'd', fallback: 'A CRM.' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: floor },
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'settings', columns: [id, text('name', 80)] },
        { ref: 'contacts', columns: [id, text('email', 254), text('name', 80)] },
        {
          ref: 'visits',
          columns: [id, link('contact_id', 'contacts'), text('rep_id', 36, { rules: { staff: true } }), { ref: 'starts_at', type: 'timestamptz', nullable: true }, text('place', 120), text('email', 254), text('door_code', 16, { rules: { code: { length: 8 } } }), { ref: 'state', type: 'enum', enum: ['booked', 'done'], default: 'booked' }],
        },
        {
          ref: 'messages',
          columns: [
            id,
            { ref: 'kind', type: 'enum', enum: ['visit-cancelled'] },
            { ref: 'status', type: 'enum', enum: ['held', 'queued', 'sent', 'failed', 'skipped'], default: 'queued' },
            text('to_address', 254),
            link('contact_id', 'contacts'),
            link('visit_id', 'visits'),
            text('error', 200),
            text('skip_reason', 40) as Record<string, unknown>,
            { ref: 'sent_at', type: 'timestamptz', nullable: true },
            { ref: 'due_at', type: 'timestamptz', nullable: true },
            text('repeat_key', 43),
            text('was', 1000),
          ],
        },
      ],
    },
    pages: [{ ref: 'crm-visits', template: 'page-crud', title: { key: 't', fallback: 'Visits' }, nav: { group: 'library', icon: 'list', order: 1 }, bindings: { rows: 'visits' } }],
    outbox: {
      table: 'messages',
      columns: { kind: 'kind', status: 'status', to: 'to_address', error: 'error', skipReason: 'skip_reason', sentAt: 'sent_at', due: 'due_at', repeatKey: 'repeat_key', was: 'was' },
      links: { visit: 'visit_id', contact: 'contact_id' },
      recipient: { via: 'contact_id', table: 'contacts', email: 'email', name: 'name' },
      settings: { table: 'settings', name: 'name' },
      kinds: { 'visit-cancelled': 'crm-visit-cancelled' },
      producers: [{ kind: 'visit-cancelled', link: 'visit_id', was: ['starts_at', 'place'], onDelete: { table: 'visits' } } as Record<string, unknown>],
    },
    emailTemplates: [template('crm-visit-cancelled')],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
  };
}

const issuesOf = (doc: unknown): string => {
  const result = validateManifest(doc);
  return result.ok ? '' : result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n');
};
/** The app with its one producer changed. */
const withProducer = (change: Record<string, unknown>) => {
  const doc = crm();
  doc.outbox.producers[0] = { ...doc.outbox.producers[0]!, ...change };
  return doc;
};

describe('a message about a row that is removed', () => {
  it('validates with the removed row’s values kept, a condition on the row as it was, and an address the row held', () => {
    expect(issuesOf(crm())).toBe('');
    expect(issuesOf(withProducer({ onDelete: { table: 'visits', where: { column: 'state', eq: 'booked' } } }))).toBe('');
    expect(issuesOf(withProducer({ recipient: { column: 'email' } }))).toBe('');
    expect(issuesOf(withProducer({ recipient: { setting: { table: 'settings', column: 'name' } } }))).toBe('');
    // Without `was`: a mail that says only that something was called off.
    const bare = withProducer({});
    delete (bare.outbox.producers[0] as { was?: unknown }).was;
    expect(issuesOf(bare)).toBe('');
    expect(installFloorWords(crm()).find((found) => found.word === 'outbox.onDelete')?.path).toBe('outbox.producers.0.onDelete');
  });

  it('asks for the release that reads it', () => {
    const said = issuesOf(crm('0.3.27'));
    expect(said).toContain('0.3.28');
    expect(said).toContain('outbox.producers.0.onDelete');
  });

  it('refuses every word that would read the row again', () => {
    const tried: Record<(typeof NOT_ON_REMOVAL)[number], unknown> = {
      hold: true,
      due: { date: 'starts_at', days: 1 },
      batchMinutes: 10,
      holdSeconds: 30,
      dropWhen: [{ column: 'state', eq: 'done', reason: 'no-longer-needed' }],
      supersede: 'visit',
      repeatBy: 'place',
      onSent: { table: 'visits', set: { place: 'gone' } },
      replyTo: { staff: 'rep_id' },
    };
    for (const word of NOT_ON_REMOVAL) {
      const said = issuesOf(withProducer({ [word]: tried[word] }));
      expect(said, word).toContain(`outbox.producers.0.${word}: a message about a removed row takes no ${word}`);
    }
    // One message for each removal already: `repeat` is a change's.
    expect(issuesOf(withProducer({ repeat: true }))).toContain('outbox.producers.0.repeat');
    // No child source: the schema knows no `via` here.
    expect(issuesOf(withProducer({ onDelete: { table: 'visits', via: 'contact_id' } }))).not.toBe('');
  });

  it('keeps of the removed row only what a message may keep of any row', () => {
    // Personal by its name, and a code: never kept.
    expect(issuesOf(withProducer({ was: ['email'] }))).toMatch(/outbox\.producers\.0\.was\.0: "visits\.email" is .*which a message never keeps/);
    expect(issuesOf(withProducer({ was: ['door_code'] }))).toMatch(/outbox\.producers\.0\.was\.0: "visits\.door_code" is .*which a message never keeps/);
    expect(issuesOf(withProducer({ was: ['nowhere'] }))).toContain('"visits" has no column "nowhere"');
    expect(issuesOf(withProducer({ was: ['place', 'place'] }))).toContain('"place" is listed twice');
    expect(issuesOf(withProducer({ was: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] }))).not.toBe('');
    // The outbox names where it is kept.
    const nowhere = crm();
    delete (nowhere.outbox.columns as { was?: unknown }).was;
    expect(issuesOf(nowhere)).toContain('a message keeps what a row was in the outbox\'s was column, and none is named');
  });

  it('refuses a table that is not the app’s, a link to another table, and a message about a message', () => {
    expect(issuesOf(withProducer({ onDelete: { table: 'orders' } }))).toContain('"orders" is not a table of this app');
    expect(issuesOf(withProducer({ link: 'contact_id' }))).toContain('"messages.contact_id" does not point at "visits"');
    expect(issuesOf(withProducer({ onDelete: { table: 'messages' }, link: 'visit_id', was: undefined }))).toContain('the outbox does not write a message about one of its own messages being removed');
    expect(issuesOf(withProducer({ onDelete: { table: 'visits', where: { column: 'state', eq: 'cancelled' } } }))).toContain('"cancelled" is not a value of "visits.state"');
  });

  it('asks a reason column that is a choice to offer the reason a waiting message is skipped for', () => {
    const doc = crm();
    const messages = doc.requiredSchema.tables.find((table) => table.ref === 'messages')!;
    const at = messages.columns.findIndex((column) => (column as { ref: string }).ref === 'skip_reason');
    messages.columns[at] = { ref: 'skip_reason', type: 'enum', enum: ['overtaken', 'by-hand'], nullable: true };
    expect(issuesOf(doc)).toContain('outbox.columns.skipReason: a message still waiting when its row is removed is skipped as "no-longer-needed"');
    messages.columns[at] = { ref: 'skip_reason', type: 'enum', enum: ['overtaken', 'by-hand', 'no-longer-needed'], nullable: true };
    expect(issuesOf(doc)).toBe('');
  });

  it('says which table a producer announces the removals of', () => {
    expect(removalTableOf({ kind: 'k', link: 'visit_id', onDelete: { table: 'visits' } } as OutboxProducer)).toBe('visits');
    expect(removalTableOf({ kind: 'k', link: 'visit_id', onCreate: { table: 'visits' } } as OutboxProducer)).toBeUndefined();
  });
});
