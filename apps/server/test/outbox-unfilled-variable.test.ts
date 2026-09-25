// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN EMAIL NEVER GOES WITH `{{…}}` IN IT — a studio's handover, on every
 * engine this run can reach, through an app installed by the real installer.
 *
 * The handover email is `{{manage_url}}#{{project.share_token}}`. The code is
 * one Adminium made to be handed on, so the email carries it. A variable
 * nothing fills — a column the app keeps secret, a link the message does not
 * have, a name no row has — is not printed as written and sent: the message
 * is `failed`, with a sentence naming the variable.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { documentSequencesRepo, settingsRepo, type MetaDb } from '@adminium/meta';

import { encryptSecret, decryptSecret } from '../src/config/secrets.js';
import { createWriteService } from '../src/crud/write-service.js';
import { emailSecretKey } from '../src/email/config.js';
import { emailEnvelopeKey } from '../src/email/send.js';
import { createOutboxProducers } from '../src/outbox/producers.js';
import { createOutboxSender, unfilledSentence, type OutboxSender } from '../src/outbox/sender.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { TEST_SECRET } from './helpers.js';
import { LEGS, installInvoicing, invoicingManifest, type InvoicingHarness } from './invoicing-install.helpers.js';

const TOKEN = 'KILNSTREETDONE26';
const id = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength = 120, rules?: Record<string, unknown>) => ({ ref, type: 'text', maxLength, nullable: true, ...(rules === undefined ? {} : { rules }) });
const fk = (ref: string, references: string) => ({ ref, type: 'fk', references, nullable: true });
const KINDS = ['handover', 'note', 'typo'];

function manifest(): Record<string, unknown> {
  const template = (kind: string, ...paras: string[]) => ({
    key: `studio-${kind}`,
    name: kind,
    locales: { 'en-US': { subject: `About ${kind}`, blocks: paras.map((p) => ({ block: 'email.text', data: { text: p } })) } },
  });
  return {
    ...invoicingManifest([
      { ref: 'clients', columns: [id, { ref: 'email', type: 'text', maxLength: 254, unique: true }, text('name')] },
      {
        ref: 'projects',
        columns: [id, text('name'), text('share_token', 16, { code: { length: 16 } }), text('studio_note', 200, { secret: true })],
      },
      {
        ref: 'messages',
        columns: [
          id,
          { ref: 'kind', type: 'enum', enum: KINDS },
          { ref: 'status', type: 'enum', enum: ['queued', 'sent', 'failed', 'skipped'], default: 'queued' },
          text('to_address', 254),
          fk('client_id', 'clients'),
          fk('project_id', 'projects'),
          text('error', 200),
          { ref: 'sent_at', type: 'timestamptz', nullable: true },
        ],
      },
    ]),
    outbox: {
      table: 'messages',
      columns: { kind: 'kind', status: 'status', to: 'to_address', error: 'error', sentAt: 'sent_at' },
      links: { client: 'client_id', project: 'project_id' },
      recipient: { via: 'client_id', table: 'clients', email: 'email', name: 'name' },
      pages: { manage: '/h' },
      kinds: Object.fromEntries(KINDS.map((kind) => [kind, `studio-${kind}`])),
    },
    emailTemplates: [
      template('handover', 'Hi {{recipient.first_name}}, {{project.name}} is done.', 'Open the handover: {{manage_url}}#{{project.share_token}}'),
      template('note', 'A note on {{project.name}}: {{project.studio_note}}'),
      template('typo', 'Hi {{recipient.first_name}}, {{project.nmae}} is done.'),
    ],
  };
}

describe.each(LEGS)('an email with a variable nothing fills — %s', (dialect, available) => {
  let h: InvoicingHarness;
  let meta: MetaDb;
  let sender: OutboxSender;
  const now = Date.parse('2026-10-02T12:00:00Z');

  const mail = async () =>
    (await meta.db.selectFrom('adminium_jobs').selectAll().where('kind', '=', 'email.send').orderBy('createdAt').orderBy('id').execute()).map((job) => {
      const payload = (typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload) as { envelope: string };
      return JSON.parse(decryptSecret(payload.envelope, emailEnvelopeKey(TEST_SECRET))) as { to: string; subject: string; text: string; html: string };
    });
  const queue = async (kind: string, project: number | null) => {
    await h.rows(
      `INSERT INTO ${h.real('messages')} (kind, status, to_address, client_id, project_id) VALUES ('${kind}', 'queued', 'ann@client.studio.dev', 1, ${project === null ? 'NULL' : String(project)})`,
    );
    return Number((await h.rows(`SELECT max(id) AS id FROM ${h.real('messages')}`))[0]!['id']);
  };
  const message = async (mid: number) => {
    const [row] = await h.rows(`SELECT status, error FROM ${h.real('messages')} WHERE id = ${String(mid)}`);
    return { status: row!['status'], error: row!['error'] ?? null };
  };

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, manifest());
    meta = h.meta;
    await settingsRepo(meta).set('email.smtp', {
      host: 'localhost',
      port: 587,
      user: 'postmaster',
      passEncrypted: encryptSecret('hunter2', emailSecretKey(TEST_SECRET)),
      from: 'Studio <no-reply@north-studio.dev>',
      secure: false,
    } as never);
    const views = createPublicViews(meta);
    const writes = createWriteService({ sequences: documentSequencesRepo(meta) });
    const producers = createOutboxProducers({ meta, manager: h.manager, viewFor: views.viewFor, writes });
    sender = createOutboxSender({
      meta,
      manager: h.manager,
      viewFor: views.viewFor,
      writes,
      live: () => producers.live(),
      secret: TEST_SECRET,
      hostFor: async () => 'portal.north-studio.dev',
    });
    await h.rows(`INSERT INTO ${h.real('clients')} (email, name) VALUES ('ann@client.studio.dev', 'Ann Lee')`);
    await h.rows(`INSERT INTO ${h.real('projects')} (name, share_token, studio_note) VALUES ('Studio identity', '${TOKEN}', 'owes us lunch')`);
  }, 120_000);

  afterAll(async () => {
    if (!available) return;
    await h.close();
  });

  it.skipIf(!available)('carries the handover link’s code, which Adminium made to be handed on', async () => {
    const mid = await queue('handover', 1);
    expect(await sender.sendApp('studio', now)).toBe(1);
    expect(await message(mid)).toEqual({ status: 'sent', error: null });
    const [sent] = (await mail()).filter((m) => m.subject === 'About handover');
    expect(sent!.text).toContain(`Open the handover: https://portal.north-studio.dev/h#${TOKEN}`);
    expect(sent!.text).not.toContain('{{');
  });

  it.skipIf(!available)('is failed, naming the variable, rather than sent with `{{…}}` in it', async () => {
    const before = (await mail()).length;
    const secret = await queue('note', 1);
    const noLink = await queue('handover', null);
    const typo = await queue('typo', 1);
    await sender.sendApp('studio', now);
    expect(await message(secret)).toEqual({ status: 'failed', error: 'Not sent: nothing fills {{project.studio_note}}' });
    expect(await message(noLink)).toEqual({ status: 'failed', error: 'Not sent: nothing fills {{project.name}}, {{project.share_token}}' });
    expect(await message(typo)).toEqual({ status: 'failed', error: 'Not sent: nothing fills {{project.nmae}}' });
    expect((await mail()).slice(before)).toEqual([]);
  });
});

describe('the sentence of an email nothing fills', () => {
  it('names the first three variables and counts the rest, within the error column', () => {
    expect(unfilledSentence(['a.b'])).toBe('Not sent: nothing fills {{a.b}}');
    expect(unfilledSentence(['a', 'b', 'c', 'd', 'e'])).toBe('Not sent: nothing fills {{a}}, {{b}}, {{c}} and 2 more');
    expect(unfilledSentence(['x'.repeat(300)]).length).toBeLessThanOrEqual(120);
  });
});
