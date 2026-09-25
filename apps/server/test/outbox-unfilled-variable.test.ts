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
const KINDS = ['handover', 'note', 'typo', 'receipt'];
/** A project's reference: a code Adminium makes, which no link opens anything with. */
const REF = 'K7Q2M9XA';

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
        columns: [
          id,
          fk('client_id', 'clients'),
          // Who sent the client our way: a second link to a client, never the one the project is for.
          fk('referrer_id', 'clients'),
          text('name'),
          text('share_token', 16, { code: { length: 16 }, secret: false }),
          text('ref', 8, { code: { length: 8 } }),
          text('studio_note', 200, { secret: true }),
        ],
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
      template('receipt', 'Thank you. Your reference is {{project.ref}}.'),
    ],
    // `share_token` is the code a shared link opens a project with; `ref` opens nothing.
    publicKeys: { handover: {} },
    publicAccess: [{ table: 'projects', methods: ['GET'], select: ['name'], claim: { by: 'token', column: 'share_token' }, key: 'handover' }],
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
    await h.rows(`INSERT INTO ${h.real('projects')} (client_id, name, share_token, ref, studio_note) VALUES (1, 'Studio identity', '${TOKEN}', '${REF}', 'owes us lunch')`);
    await h.rows(`INSERT INTO ${h.real('projects')} (client_id, name, share_token) VALUES (2, 'Bo’s launch', '${BOS}')`);
    await h.rows(`INSERT INTO ${h.real('projects')} (client_id, name, share_token) VALUES (3, 'Cy’s menu', 'CYSMENUHANDOVER1')`);
    // Bo's project, which Ann sent Bo to.
    await h.rows(`INSERT INTO ${h.real('projects')} (client_id, referrer_id, name, share_token) VALUES (2, 1, 'Bo’s rebrand', 'BOSREBRANDLINK26')`);
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

  it.skipIf(!available)('prints a reference no link opens anything with, wherever the desk sends it', async () => {
    const before = (await mail()).length;
    // A receipt the desk typed an address for, and one linking another client's project.
    const typed = await queue('receipt', 1, 'front-desk@north-studio.dev');
    const another = await queue('receipt', 1, null, 2);
    await sender.sendApp('studio', now);
    expect(await message(typed)).toEqual({ status: 'sent', error: null });
    expect(await message(another)).toEqual({ status: 'sent', error: null });
    const sent = (await mail()).slice(before);
    expect(sent.map((m) => m.to).sort()).toEqual(['bo@other.studio.dev', 'front-desk@north-studio.dev']);
    for (const m of sent) expect(m.text).toContain(`Your reference is ${REF}.`);
  });

  it.skipIf(!available)('carries a shared link’s code only by the link that names the client, not another link to them', async () => {
    const before = (await mail()).length;
    // To Ann, at her own address, about Bo's project — which links Ann only as who referred Bo.
    const referred = await queue('handover', 4, null, 1);
    await sender.sendApp('studio', now);
    expect(await message(referred)).toEqual({ status: 'failed', error: codeWithheldSentence(['project.share_token']) });
    expect((await mail()).slice(before)).toEqual([]);
    // To Bo, whose project it is, it goes.
    const owner = await queue('handover', 4, null, 2);
    await sender.sendApp('studio', now);
    expect(await message(owner)).toEqual({ status: 'sent', error: null });
    expect((await mail()).slice(before).map((m) => m.text).join('\n')).toContain('#BOSREBRANDLINK26');
  });

  it.skipIf(!available)('marks a message failed under a rule kept from before that watches its status', async () => {
    const messages = (await writerFor(h)).targetOf('messages').table.id;
    // Written around every check, as a rule from before them would be.
    const made = await overridesRepo(meta).create({ connectionId: h.connectionId, op: 'column.requiredWhen', tableName: messages, columnName: 'project_id', value: { column: 'status', in: ['failed'] }, origin: 'user' });
    try {
      const views = createPublicViews(meta);
      const writes = createWriteService({ sequences: documentSequencesRepo(meta) });
      const producers = createOutboxProducers({ meta, manager: h.manager, viewFor: views.viewFor, writes });
      const fresh = createOutboxSender({ meta, manager: h.manager, viewFor: views.viewFor, writes, live: () => producers.live(), secret: TEST_SECRET, hostFor: async () => 'portal.north-studio.dev' });
      const mid = await queue('handover', null);
      await fresh.sendApp('studio', now);
      expect(await message(mid)).toEqual({ status: 'failed', error: 'Not sent: nothing fills {{project.name}}, {{project.share_token}}' });
    } finally {
      await overridesRepo(meta).delete(made.id);
    }
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

    // An import runs with no request: the person who started it is asked.
    const clerk = await usersRepo(meta).create({ email: 'clerk@north-studio.dev', name: 'Clerk' });
    const lead = await usersRepo(meta).create({ email: 'lead@north-studio.dev', name: 'Lead' });
    await rolesRepo(meta).assignToUser(lead.id, (await rolesRepo(meta).findBySlug('super-admin'))!.id);
    const imported = (userId: string) => ({
      action: 'create' as const,
      target,
      values: { kind: 'handover', status: 'queued', client_id: 1, project_id: 2 },
      record: null,
      context: { origin: 'import' as const, hops: 0, actor: { kind: 'user' as const, id: userId, label: userId }, request: null },
    });
    const byClerk = await judgeMove(box!, imported(clerk.id), { meta }).catch((error: unknown) => error);
    expect(byClerk).toBeInstanceOf(ForbiddenError);
    await expect(judgeMove(box!, imported(lead.id), { meta })).resolves.toBeUndefined();

    // Queueing a failed or held message to go asks the same of whoever queues it.
    for (const from of ['failed', 'held']) {
      const again = (reads: (permission: string) => boolean) => ({
        ...event(reads),
        action: 'update' as const,
        values: { status: 'queued' },
        record: { id: 9, kind: 'handover', status: from, client_id: 1, project_id: 2, to_address: 'ann@client.studio.dev' },
      });
      const requeued = await judgeMove(box!, again((permission) => !permission.includes(projectsId)), { meta }).catch((error: unknown) => error);
      expect(requeued, from).toBeInstanceOf(ForbiddenError);
      await expect(judgeMove(box!, again(() => true), { meta })).resolves.toBeUndefined();
    }
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
      // Nor a rule of another column that reads one: a link required once the message went.
      const watching = await put([...current, { op: 'column.requiredWhen', tableName: messages, columnName: 'project_id', value: { column: 'status', in: ['sent'] } }]);
      expect(watching.statusCode, watching.body).toBe(422);
      expect(watching.body).toContain('has a requiredWhen rule that reads \\"status\\", the outbox\'s status');
      // Watching a column only people write is theirs to add.
      const byKind = await put([...current, { op: 'column.requiredWhen', tableName: messages, columnName: 'project_id', value: { column: 'kind', in: ['handover'] } }]);
      expect(byKind.statusCode, byKind.body).toBe(200);
      expect((await put(current)).statusCode).toBe(200);

      // A rule never lands a column kept from readers in one that is not.
      const projects = (await writerFor(h)).targetOf('projects').table.id;
      for (const [op, value, said] of [
        ['column.copy', { via: 'client_id', from: 'email' }, 'is personal data, so no column copies it'],
        ['column.stamp', { set: { copy: 'studio_note' }, on: 'create' }, 'is a secret, so no column copies it'],
        ['column.stamp', { set: { copy: 'share_token' }, on: 'create' }, 'is the code a shared link opens its row with, so no column copies it'],
      ] as const) {
        const refused = await put([...current, { op, tableName: projects, columnName: 'name', value }]);
        expect(refused.statusCode, `${op} ${refused.body}`).toBe(422);
        expect(refused.body).toContain(said);
      }
      // Into a column kept the same way, it is.
      const intoSecret = await put([
        ...current,
        { op: 'column.secret', tableName: projects, columnName: 'name', value: { secret: true } },
        { op: 'column.stamp', tableName: projects, columnName: 'name', value: { set: { copy: 'studio_note' }, on: 'create' } },
      ]);
      expect(intoSecret.statusCode, intoSecret.body).toBe(200);
      expect((await put(current)).statusCode).toBe(200);
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
