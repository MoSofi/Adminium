// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A REPLY THAT GOES TO THE REP (`replyTo: {staff}` on an outbox producer and
 * on a rule's email step): what the manifest check accepts and what it
 * refuses, and the release an app that says it asks for. Only a staff
 * column names where a reply goes: never a column that holds an address,
 * never an address somebody typed.
 */
import { describe, expect, it } from 'vitest';

import { installFloorWords, validateManifest } from '../src/index.js';

const id = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength = 120, more: Record<string, unknown> = {}) => ({ ref, type: 'text', maxLength, nullable: true, ...more });
const staff = (ref: string) => text(ref, 36, { rules: { staff: true } });
const template = (key: string) => ({ key, name: key, locales: { 'en-US': { subject: 'Your quote', blocks: [{ block: 'email.text', data: { text: 'About your quote.' } }] } } });

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
        { ref: 'contacts', columns: [id, text('email', 254), text('name', 80)] },
        { ref: 'deals', columns: [id, text('name', 80), staff('owner_id')] },
        {
          ref: 'quotes',
          columns: [id, { ref: 'contact_id', type: 'fk', references: 'contacts', nullable: true }, { ref: 'deal_id', type: 'fk', references: 'deals', nullable: true }, staff('owner_id'), { ref: 'stage', type: 'enum', enum: ['draft', 'sent'], default: 'draft' }, text('sent_to_email', 254), text('note', 200)],
        },
        {
          ref: 'messages',
          columns: [id, { ref: 'kind', type: 'enum', enum: ['quote-sent'] }, { ref: 'status', type: 'enum', enum: ['queued', 'sent', 'failed', 'skipped'], default: 'queued' }, text('to_address', 254), { ref: 'contact_id', type: 'fk', references: 'contacts', nullable: true }, { ref: 'quote_id', type: 'fk', references: 'quotes', nullable: true }, text('error', 200), { ref: 'sent_at', type: 'timestamptz', nullable: true }],
        },
      ],
    },
    pages: [{ ref: 'crm-quotes', template: 'page-crud', title: { key: 't', fallback: 'Quotes' }, nav: { group: 'library', icon: 'list', order: 1 }, bindings: { rows: 'quotes' } }],
    outbox: {
      table: 'messages',
      columns: { kind: 'kind', status: 'status', to: 'to_address', error: 'error', sentAt: 'sent_at' },
      links: { quote: 'quote_id' },
      recipient: { via: 'contact_id', table: 'contacts', email: 'email', name: 'name' },
      kinds: { 'quote-sent': 'crm-quote-sent' },
      producers: [{ kind: 'quote-sent', link: 'quote_id', recipient: { column: 'sent_to_email' }, replyTo: { staff: 'owner_id' } as unknown, onChange: { table: 'quotes', column: 'stage', to: 'sent' } }],
    },
    emailTemplates: [template('crm-quote-sent'), template('crm-note')],
    automations: [
      {
        key: 'note-mail',
        name: { 'en-US': 'A note on a quote: write to the customer' },
        enabled: true,
        trigger: { kind: 'record', event: 'updated', table: 'quotes', changedColumn: 'note' },
        graph: { version: 1, nodes: [{ id: 't', kind: 'trigger', title: 'When' }, { id: 'mail', kind: 'action', title: 'Mail', action: { kind: 'email', templateKey: 'crm-note', to: { kind: 'field', column: 'sent_to_email' }, replyTo: { staff: 'deal_id.owner_id' } as unknown } }] },
      },
    ],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
  };
}

type Doc = ReturnType<typeof crm>;
const issuesOf = (doc: unknown): string => {
  const result = validateManifest(doc);
  return result.ok ? '' : result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n');
};
const producer = (replyTo: unknown): Doc => {
  const doc = crm();
  doc.outbox.producers[0]!.replyTo = replyTo;
  return doc;
};
const step = (replyTo: unknown): Doc => {
  const doc = crm();
  doc.automations[0]!.graph.nodes[1]!.action!.replyTo = replyTo;
  return doc;
};

describe('a reply that goes to the rep', () => {
  it('validates on a producer and on a rule\'s email, by a staff column of the row or of a linked row', () => {
    expect(issuesOf(crm())).toBe('');
    expect(issuesOf(step({ staff: 'owner_id' }))).toBe('');
    const words = installFloorWords(crm());
    expect(words.find((found) => found.word === 'outbox.replyTo')?.path).toBe('outbox.producers.0.replyTo');
    expect(words.find((found) => found.word === 'automations.replyTo')?.path).toBe('automations.0.graph.nodes.1.action.replyTo');
  });

  it('asks for the release that reads it', () => {
    const said = issuesOf(crm('0.3.27'));
    expect(said).toContain('0.3.28');
    expect(said).toContain('outbox.producers.0.replyTo');
    expect(said).toContain('automations.0.graph.nodes.1.action.replyTo');
  });

  it('refuses, on a producer, a column that is not a staff column of the row the message is about', () => {
    // A text column that holds an address, one that is not there, a staff column of another table.
    expect(issuesOf(producer({ staff: 'sent_to_email' }))).toContain('"quotes.sent_to_email" is not a staff column');
    expect(issuesOf(producer({ staff: 'note' }))).toContain('"quotes.note" is not a staff column');
    expect(issuesOf(producer({ staff: 'nope' }))).toContain('"quotes" has no column "nope"');
    // One link further: a staff column of the row a link of that row names, and nothing else there.
    expect(issuesOf(producer({ staff: 'deal_id.owner_id' }))).toBe('');
    expect(issuesOf(producer({ staff: 'contact_id.email' }))).toContain('"contacts.email" is not a staff column');
    expect(issuesOf(producer({ staff: 'deal_id.nope' }))).toContain('"deals" has no column "nope"');
    expect(issuesOf(producer({ staff: 'note.owner_id' }))).toContain('"quotes.note" must be a link to another table');
    // Never two links away.
    expect(issuesOf(producer({ staff: 'deal_id.owner_id.email' }))).not.toBe('');
  });

  it('refuses, on a rule, a column that is not a staff column of the record or of the row a link names', () => {
    expect(issuesOf(step({ staff: 'sent_to_email' }))).toContain('"quotes.sent_to_email" is not a staff column');
    expect(issuesOf(step({ staff: 'contact_id.email' }))).toContain('"contacts.email" is not a staff column');
    expect(issuesOf(step({ staff: 'note.owner_id' }))).toContain('"quotes.note" is not a link to another table');
    expect(issuesOf(step({ staff: 'deal_id.nope' }))).toContain('"deals" has no column "nope"');
  });

  it('takes no address: not a typed one, not beside the column, not under another name', () => {
    for (const wrong of ['rep@harbour.dev', { address: 'rep@harbour.dev' }, { staff: 'owner_id', address: 'rep@harbour.dev' }, { staff: 'rep@harbour.dev' }, { column: 'sent_to_email' }, { staff: '' }, null]) {
      expect(issuesOf(producer(wrong)), JSON.stringify(wrong)).not.toBe('');
      expect(issuesOf(step(wrong)), JSON.stringify(wrong)).not.toBe('');
    }
  });
});
