// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN EMAIL NEVER GOES WITH `{{…}}` IN IT — a studio's handover, on every
 * engine this run can reach, through an app installed by the real installer.
 *
 * The handover email is `{{manage_url}}#{{project.share_token}}`. The code is
 * one Adminium made to be handed on, so the email carries it — to the client
 * whose project it is, at the address on file, and to nobody else: a message
 * addressed by hand elsewhere, or linking another client's project, fails
 * with a sentence. A variable nothing fills — a column the app keeps secret,
 * a link the message does not have, a name no row has — is not printed as
 * written and sent: the message is `failed`, with a sentence naming the
 * variable. What every message may read (the recipient's name) is always
 * filled, empty when there is none. A desk links a message only to rows it
 * may read, and a Studio save gives the outbox's own columns no rule that
 * would decide or refuse what Adminium writes there.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { documentSequencesRepo, overridesRepo, rolesRepo, settingsRepo, usersRepo, type MetaDb } from '@adminium/meta';

import { encryptSecret, decryptSecret } from '../src/config/secrets.js';
import { createWriteService } from '../src/crud/write-service.js';
import { emailSecretKey } from '../src/email/config.js';
import { emailEnvelopeKey, enqueueEmail } from '../src/email/send.js';
import { ForbiddenError } from '../src/errors.js';
import { judgeMove } from '../src/outbox/moves.js';
import { createOutboxProducers } from '../src/outbox/producers.js';
import { codeWithheldSentence, createOutboxSender, unfilledSentence, type OutboxSender } from '../src/outbox/sender.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { TEST_SECRET } from './helpers.js';
import { LEGS, installInvoicing, invoicingManifest, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';
import { servePublic } from './public-lane.helpers.js';

const TOKEN = 'KILNSTREETDONE26';
const BOS = 'BOSPROJECTLINK26';
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
        columns: [id, fk('client_id', 'clients'), text('name'), text('share_token', 16, { code: { length: 16 }, secret: false }), text('studio_note', 200, { secret: true })],
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
  const queue = async (kind: string, project: number | null, to: string | null = 'ann@client.studio.dev', client = 1) => {
    await h.rows(
      `INSERT INTO ${h.real('messages')} (kind, status, to_address, client_id, project_id) VALUES ('${kind}', 'queued', ${to === null ? 'NULL' : `'${to}'`}, ${String(client)}, ${project === null ? 'NULL' : String(project)})`,
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
    await h.rows(`INSERT INTO ${h.real('clients')} (email, name) VALUES ('bo@other.studio.dev', 'Bo Chen')`);
    // A client with no name on file.
    await h.rows(`INSERT INTO ${h.real('clients')} (email) VALUES ('cy@client.studio.dev')`);
    await h.rows(`INSERT INTO ${h.real('projects')} (client_id, name, share_token, studio_note) VALUES (1, 'Studio identity', '${TOKEN}', 'owes us lunch')`);
    await h.rows(`INSERT INTO ${h.real('projects')} (client_id, name, share_token) VALUES (2, 'Bo’s launch', '${BOS}')`);
    await h.rows(`INSERT INTO ${h.real('projects')} (client_id, name, share_token) VALUES (3, 'Cy’s menu', 'CYSMENUHANDOVER1')`);
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

  it.skipIf(!available)('carries a code only to the client whose project it is, at the address on file', async () => {
    const before = (await mail()).length;
    // A desk typed its own address; linked one client and another client's project.
    const typed = await queue('handover', 1, 'desk@north-studio.dev');
    const theirs = await queue('handover', 2);
    await sender.sendApp('studio', now);
    const withheld = codeWithheldSentence(['project.share_token']);
    expect(withheld).toBe('Not sent: {{project.share_token}} is a code, and goes only to the address on file of the person it belongs to');
    expect(await message(typed)).toEqual({ status: 'failed', error: withheld });
    expect(await message(theirs)).toEqual({ status: 'failed', error: withheld });
    expect((await mail()).slice(before)).toEqual([]);
    // Addressed as the client is on file — looked up, or typed as it is stored — it goes.
    const lookedUp = await queue('handover', 2, null, 2);
    const same = await queue('handover', 1, 'Ann@client.studio.dev');
    await sender.sendApp('studio', now);
    expect(await message(lookedUp)).toEqual({ status: 'sent', error: null });
    expect(await message(same)).toEqual({ status: 'sent', error: null });
    const sent = (await mail()).slice(before);
    expect(sent.find((m) => m.to === 'bo@other.studio.dev')!.text).toContain(`#${BOS}`);
    expect(sent.find((m) => m.to === 'Ann@client.studio.dev')!.text).toContain(`#${TOKEN}`);
  });

  it.skipIf(!available)('greets a client with no name on file rather than failing', async () => {
    const mid = await queue('handover', 3, 'cy@client.studio.dev', 3);
    await sender.sendApp('studio', now);
    expect(await message(mid)).toEqual({ status: 'sent', error: null });
    const [sent] = (await mail()).filter((m) => m.to === 'cy@client.studio.dev');
    expect(sent!.text).toContain('Hi , Cy’s menu is done.');
  });

  it.skipIf(!available)('sends the template it checked, not one looked up again', async () => {
    const job = await enqueueEmail(
      { meta, secret: TEST_SECRET },
      {
        to: 'ann@client.studio.dev',
        templateKey: 'studio-no-such-template',
        vars: {},
        template: { subject: 'As checked', preheader: '', blocks: [{ block: 'email.text', data: { text: 'Checked.' } }], footer: '', brand: null, attachments: [] },
      },
    );
    expect(job).not.toBeNull();
    expect((await mail()).some((m) => m.subject === 'As checked')).toBe(true);
  });

  it.skipIf(!available)('is linked by a desk only to rows it may read', async () => {
    const w = await writerFor(h);
    const target = w.targetOf('messages');
    const projectsId = w.targetOf('projects').table.id;
    const [box] = (await createOutboxProducers({ meta, manager: h.manager, viewFor: createPublicViews(meta).viewFor, writes: createWriteService({}) }).live()).filter((b) => b.appKey === 'studio');
    const event = (reads: (permission: string) => boolean) => ({
      action: 'create' as const,
      target,
      values: { kind: 'handover', status: 'queued', client_id: 1, project_id: 2 },
      record: null,
      context: { origin: 'dashboard' as const, hops: 0, actor: { kind: 'user' as const, id: 'usr_desk', label: 'Desk' }, request: { can: async (permission: string) => reads(permission) } as never },
    });
    const refused = await judgeMove(box!, event((permission) => !permission.includes(projectsId)), { meta }).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(ForbiddenError);
    expect((refused as ForbiddenError).message).toBe('"project_id" links a row you may not read, so a message about it is not yours to make.');
    await expect(judgeMove(box!, event(() => true), { meta })).resolves.toBeUndefined();
  });

  it.skipIf(!available)('takes no Studio rule on a column Adminium writes as it sends', async () => {
    const served = await servePublic(h, null);
    try {
      const admin = await usersRepo(meta).create({ email: 'owner@north-studio.dev', name: 'Owner', passwordHash: await adminPasswordHash() });
      await rolesRepo(meta).assignToUser(admin.id, (await rolesRepo(meta).findBySlug('super-admin'))!.id);
      const cookie = sessionCookie(
        (await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'owner@north-studio.dev', password: ADMIN_PASSWORD } })).headers['set-cookie'],
      );
      const current = (await overridesRepo(meta).listForConnection(h.connectionId)).map((o) => ({
        op: o.op,
        tableName: o.tableName,
        ...(o.columnName === null ? {} : { columnName: o.columnName }),
        value: o.value,
        status: o.status,
      }));
      const messages = (await writerFor(h)).targetOf('messages').table.id;
      const put = (overrides: unknown[]) =>
        served.composed.app.inject({ method: 'PUT', url: `/api/v1/connections/${h.connectionId}/overrides`, headers: { cookie }, payload: { overrides } });
      expect((await put(current)).statusCode).toBe(200);
      for (const [columnName, op, value] of [
        ['status', 'column.required', { required: true }],
        ['error', 'column.validation', { maxLength: 10 }],
        ['to_address', 'column.required', { required: true }],
      ] as const) {
        const refused = await put([...current, { op, tableName: messages, columnName, value }]);
        expect(refused.statusCode, `${columnName} ${refused.body}`).toBe(422);
        expect(refused.body).toContain(`is the outbox's`);
      }
      // A check of the address a person types stays theirs to add.
      expect((await put([...current, { op: 'column.validation', tableName: messages, columnName: 'to_address', value: { format: 'email' } }])).statusCode).toBe(200);
    } finally {
      await served.close();
    }
  });
});

describe('the sentence of an email nothing fills', () => {
  it('names the first three variables and counts the rest, within the error column', () => {
    expect(unfilledSentence(['a.b'])).toBe('Not sent: nothing fills {{a.b}}');
    expect(unfilledSentence(['a', 'b', 'c', 'd', 'e'])).toBe('Not sent: nothing fills {{a}}, {{b}}, {{c}} and 2 more');
    expect(unfilledSentence(['x'.repeat(300)]).length).toBeLessThanOrEqual(120);
  });
});
