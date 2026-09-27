// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The change a sent message makes (`onSent`) is a move like anyone's: the row
 * its move moves too (`states.effects`) is told as a change of its own — its
 * rule event carries the outbox's hop, and its audit row names the outbox —
 * as every other door tells an effect. On every engine.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditRepo, documentSequencesRepo, settingsRepo } from '@adminium/meta';

import { encryptSecret } from '../src/config/secrets.js';
import type { RecordWriteEvent } from '../src/crud/after-record-write.js';
import { createWriteService } from '../src/crud/write-service.js';
import { emailSecretKey } from '../src/email/config.js';
import { createOutboxProducers } from '../src/outbox/producers.js';
import { createOutboxSender, type OutboxSender } from '../src/outbox/sender.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { announceEffects } from '../src/states/effects.js';
import { TEST_SECRET } from './helpers.js';
import { LEGS, installInvoicing, invoicingManifest, type InvoicingHarness } from './invoicing-install.helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };

/** A studio whose "work paused" notice, once sent, pauses the project — and a paused project puts its client on watch. */
function studio(): Record<string, unknown> {
  return {
    ...invoicingManifest([
      {
        ref: 'clients',
        columns: [id, { ref: 'email', type: 'text', maxLength: 254 }, { ref: 'name', type: 'text', maxLength: 80, nullable: true }, { ref: 'status', type: 'enum', enum: ['active', 'watched'], default: 'active' }],
        states: { column: 'status', initial: 'active', moves: { active: ['watched'] } },
      },
      {
        ref: 'projects',
        columns: [
          id,
          { ref: 'client_id', type: 'fk', references: 'clients' },
          { ref: 'name', type: 'text', maxLength: 80 },
          { ref: 'overdue', type: 'bool', default: false },
          { ref: 'status', type: 'enum', enum: ['active', 'paused'], default: 'active' },
        ],
        states: { column: 'status', initial: 'active', moves: { active: ['paused'] }, effects: [{ on: { to: 'paused' }, via: 'client_id', set: { status: 'watched' } }] },
      },
      {
        ref: 'messages',
        columns: [
          id,
          { ref: 'kind', type: 'enum', enum: ['paused'] },
          { ref: 'status', type: 'enum', enum: ['queued', 'sent', 'failed', 'skipped'], default: 'queued' },
          { ref: 'to_address', type: 'text', maxLength: 254, nullable: true },
          { ref: 'client_id', type: 'fk', references: 'clients', nullable: true },
          { ref: 'project_id', type: 'fk', references: 'projects', nullable: true },
          { ref: 'error', type: 'text', maxLength: 200, nullable: true },
          { ref: 'sent_at', type: 'timestamptz', nullable: true },
        ],
      },
    ]),
    outbox: {
      table: 'messages',
      columns: { kind: 'kind', status: 'status', to: 'to_address', error: 'error', sentAt: 'sent_at' },
      links: { client: 'client_id', project: 'project_id' },
      recipient: { via: 'client_id', table: 'clients', email: 'email', name: 'name' },
      kinds: { paused: 'studio-paused' },
      producers: [{ kind: 'paused', link: 'project_id', onChange: { table: 'projects', column: 'overdue', to: true }, onSent: { table: 'projects', set: { status: 'paused' } } }],
    },
    emailTemplates: [{ key: 'studio-paused', name: 'paused', locales: { 'en-US': { subject: 'Work paused', blocks: [{ block: 'email.text', data: { text: '{{project.name}} is paused.' } }] } } }],
  };
}

describe.each(LEGS)('the rows an outbox change moved too, told — %s', (dialect, available) => {
  let h: InvoicingHarness;
  let sender: OutboxSender;
  const events: RecordWriteEvent[] = [];

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, studio());
    await settingsRepo(h.meta).set('email.smtp', {
      host: 'localhost',
      port: 587,
      user: 'postmaster',
      passEncrypted: encryptSecret('hunter2', emailSecretKey(TEST_SECRET)),
      from: 'Studio <no-reply@north-studio.dev>',
      secure: false,
    } as never);
    const views = createPublicViews(h.meta);
    const writes = createWriteService({ sequences: documentSequencesRepo(h.meta) });
    const producers = createOutboxProducers({ meta: h.meta, manager: h.manager, viewFor: views.viewFor, writes });
    // What the fan-out reaches with no server around it: the audit store and the rules' ear.
    const app = {
      hasDecorator: (name: string) => name === 'automations',
      automations: { onRecordEvent: async (event: RecordWriteEvent) => void events.push(event) },
      rbac: { meta: h.meta },
    } as unknown as FastifyInstance;
    sender = createOutboxSender({
      meta: h.meta,
      manager: h.manager,
      viewFor: views.viewFor,
      writes,
      live: () => producers.live(),
      secret: TEST_SECRET,
      announceEffects: (input) => announceEffects(app, input),
    });
    await h.rows(`INSERT INTO ${h.real('clients')} (email, name, status) VALUES ('ann@client.studio.dev', 'Ann Lee', 'active')`);
    await h.rows(`INSERT INTO ${h.real('projects')} (client_id, name, overdue, status) VALUES (1, 'Studio identity', false, 'active')`);
  }, 180_000);
  afterAll(async () => {
    if (available) await h.close();
  });

  it.runIf(available)('tells the client a paused project put on watch, as the outbox’s change', async () => {
    await h.rows(`INSERT INTO ${h.real('messages')} (kind, status, client_id, project_id) VALUES ('paused', 'queued', 1, 1)`);
    expect(await sender.sendApp('studio', Date.parse('2026-10-02T12:00:00Z'))).toBe(1);
    expect((await h.rows(`select status from ${h.real('projects')} where id = 1`))[0]!['status']).toBe('paused');
    expect((await h.rows(`select status from ${h.real('clients')} where id = 1`))[0]!['status']).toBe('watched');
    const clients = events.filter((event) => event.table.name === h.real('clients'));
    expect(clients).toHaveLength(1);
    expect(clients[0]).toMatchObject({ action: 'update', origin: 'automation', hops: 1, after: { status: 'watched' } });
    const audit = await auditRepo(h.meta).list({ limit: 50 });
    const entry = audit.find((row) => row.action === 'record.update' && row.entity?.table === clients[0]!.table.id);
    expect(entry).toMatchObject({ actorKind: 'system' });
    expect(entry?.actorLabel).toContain('outbox');
  });
});
