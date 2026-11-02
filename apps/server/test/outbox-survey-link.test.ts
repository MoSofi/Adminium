// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A SURVEY'S INVITATIONS, MAILED BY THE FORMS ADD-ON'S OUTBOX, on SQLite,
 * Postgres and MySQL, through the real installer and the real sender:
 *
 *  - a named survey's invitation carries a link with a one-use token, made
 *    when it goes; the invitation keeps the token's hash and when it stops
 *    (`invited_at` + the survey's days); the token is in clear nowhere but
 *    the sealed mail (not the outbox row, not the job's payload);
 *  - sent again, the invitation gets a new token, and the old one's hash is
 *    gone;
 *  - an anonymous survey's mail carries the open link, and nothing is kept;
 *  - an invitation already answered, one past its days, one for a survey
 *    that is not live, and any while the server has no public address: not
 *    sent, the row saying why;
 *  - sent as service mail, it still skips a person who said no to surveys
 *    (by their address, or by their row), and still reaches an address on
 *    the do-not-email list; a "no" given after it was queued stops it at the
 *    hand-over;
 *  - sent as marketing mail, it is judged for surveys, not the newsletter.
 */
import { documentSequencesRepo, settingsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { formsWithInvitations } from '../../../packages/manifest/test/forms-invitations-fixture.js';
import { decryptSecret, encryptSecret } from '../src/config/secrets.js';
import { createConsentService } from '../src/consent/index.js';
import { createWriteService } from '../src/crud/write-service.js';
import { bindWriteValue } from '../src/crud/write-values.js';
import { emailSecretKey } from '../src/email/config.js';
import { emailEnvelopeKey } from '../src/email/send.js';
import type { EmailTransport, OutboundEmail } from '../src/email/types.js';
import { surveyTokenHash } from '../src/forms/survey-token.js';
import { registerEmailSendHandler } from '../src/jobs/email-send.js';
import { createJobRegistry } from '../src/jobs/registry.js';
import { JobWorker } from '../src/jobs/worker.js';
import { createOutboxProducers } from '../src/outbox/producers.js';
import { createOutboxSender, type OutboxSender } from '../src/outbox/sender.js';
import { instantOf } from '../src/outbox/survey-link.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { RealtimeHub } from '../src/realtime/hub.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { ANONYMOUS, FIT_OUT, NAMED, published } from './forms-door.helpers.js';
import { TEST_SECRET } from './helpers.js';
import { LEGS } from './invoicing-install.helpers.js';

const ORIGIN = 'https://forms.meridian.example';
const DAY = 86_400_000;
const NOW = Date.parse('2026-11-02T12:00:00Z');
const LINK = /https:\/\/forms\.meridian\.example\/x\/forms\/aftercare\?t=([A-Za-z0-9_-]{32})/;

describe.each(LEGS)('a survey invitation, mailed — %s', (dialect, available) => {
  let h: Harness;
  let sender: OutboxSender;
  let views: ReturnType<typeof createPublicViews>;
  const names: Record<string, string> = {};
  let nextMail = 1;

  /** One row, each value spelled for the database as a save would (a moment, a json). */
  async function insert(ref: string, values: Record<string, unknown>): Promise<void> {
    const view = (await views.viewFor(h.connectionId))!;
    const table = view.table(names[ref]!);
    const { db } = await h.manager.data(h.connectionId);
    const bound = Object.fromEntries(Object.entries(values).map(([column, value]) => [column, value === null ? null : bindWriteValue(table.columns.get(column)!, value, dialect)]));
    await db.insertInto(table.id as never).values(bound as never).execute();
  }
  const invitation = async (id: string, values: { email: string; form?: string; klass?: 'marketing' | 'service'; invitedAt?: number; answeredAt?: number | null; person?: string }) =>
    insert('invitations', {
      id,
      form_id: values.form ?? 'frm_named',
      email: values.email,
      name: 'Ana Agreed',
      language: 'en-US',
      person_table: 'public.crm_contacts',
      person_key: values.person ?? id,
      class: values.klass ?? 'service',
      invited_at: new Date(values.invitedAt ?? NOW - DAY).toISOString(),
      answered_at: values.answeredAt === undefined || values.answeredAt === null ? null : new Date(values.answeredAt).toISOString(),
    });
  /** Queues one mail for an invitation and sends; answers the mail row as left. */
  async function mail(invitationId: string, kind: 'invite-service' | 'invite-marketing' = 'invite-service', at = NOW): Promise<{ id: number; status: unknown; error: unknown }> {
    const id = nextMail++;
    await insert('invitation_mails', { id: String(id), kind, status: 'queued', invitation_id: invitationId });
    await sender.sendApp('forms', at);
    const [row] = await h.rows(`SELECT status, error FROM ${names['invitation_mails']!} WHERE id = '${String(id)}'`);
    return { id, status: row!['status'], error: row!['error'] };
  }
  /** Every mail queued so far, opened. */
  const queued = async () =>
    (await h.meta.db.selectFrom('adminium_jobs').selectAll().where('kind', '=', 'email.send').orderBy('createdAt').orderBy('id').execute()).map((job) => {
      const raw = typeof job.payload === 'string' ? job.payload : JSON.stringify(job.payload);
      const payload = JSON.parse(raw) as { envelope: string };
      return { raw, id: job.id, envelope: JSON.parse(decryptSecret(payload.envelope, emailEnvelopeKey(TEST_SECRET))) as { to: string; text: string; html: string; mailClass?: string; objection?: unknown } };
    });
  const invitationRow = async (id: string) => (await h.rows(`SELECT token_hash, expires_at, answered_at FROM ${names['invitations']!} WHERE id = '${id}'`))[0]!;
  const consent = () => createConsentService({ meta: h.meta, secret: TEST_SECRET });

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageAddOn(formsWithInvitations(), { bundled: true });
    const added = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'forms', version: '1.0.0', attachTo: ['dashboard'] } });
    expect(added.statusCode, added.body).toBe(200);
    for (const record of await h.meta.db.selectFrom('adminium_app_tables').select(['ref', 'tableName']).where('appKey', '=', 'forms').execute()) names[record.ref] = record.tableName;
    await settingsRepo(h.meta).set('email.smtp', { host: 'localhost', port: 587, user: 'postmaster', passEncrypted: encryptSecret('hunter2', emailSecretKey(TEST_SECRET)), from: 'Meridian <hello@meridian.example>', secure: false } as never);
    await settingsRepo(h.meta).set('system.publicOrigin', ORIGIN, { updatedBy: null });
    views = createPublicViews(h.meta);
    const writes = createWriteService({ sequences: documentSequencesRepo(h.meta) });
    const producers = createOutboxProducers({ meta: h.meta, manager: h.manager, viewFor: views.viewFor, writes });
    sender = createOutboxSender({ meta: h.meta, manager: h.manager, viewFor: views.viewFor, writes, live: () => producers.live(), secret: TEST_SECRET });
    const form = (id: string, slug: string, state: string, settings: unknown) => insert('forms', { id, title: slug, slug, kind: 'survey', state, definition: '{}', settings: '{}', published: published(FIT_OUT, settings) });
    await form('frm_named', 'aftercare', 'live', NAMED);
    await form('frm_open', 'fit-out', 'live', ANONYMOUS);
    await form('frm_draft', 'next-spring', 'draft', NAMED);
  }, 240_000);

  afterAll(async () => {
    if (available) await h?.close();
  });

  it.skipIf(!available)('a named survey: a link with a one-use token, its hash and its end kept on the invitation, the token in clear nowhere else', async () => {
    await invitation('inv_1', { email: 'ana@harbour.dev', invitedAt: NOW - DAY });
    expect(await mail('inv_1')).toMatchObject({ status: 'sent', error: null });
    const [sent] = (await queued()).slice(-1);
    expect(sent!.envelope.to).toBe('ana@harbour.dev');
    const token = LINK.exec(sent!.envelope.text)?.[1];
    expect(token, sent!.envelope.text).toBeDefined();
    const kept = await invitationRow('inv_1');
    expect(kept['token_hash']).toBe(surveyTokenHash(token!));
    // Thirty days after the invitation was made (the survey's default).
    expect(instantOf(kept['expires_at'])).toBe(NOW - DAY + 30 * DAY);
    // Nowhere in clear: not the job's payload, not the outbox row, not the invitation.
    expect(sent!.raw).not.toContain(token);
    const rows = JSON.stringify(await h.rows(`SELECT * FROM ${names['invitation_mails']!}`)) + JSON.stringify(await h.rows(`SELECT * FROM ${names['invitations']!}`));
    expect(rows).not.toContain(token);
    // Sealed as service mail for surveys: the hand-over asks the purpose again.
    expect(sent!.envelope).toMatchObject({ mailClass: 'service', objection: { purpose: 'surveys', person: { table: 'public.crm_contacts', key: 'inv_1' } } });
  });

  it.skipIf(!available)('sent again, a new token: the first link no longer matches what the invitation keeps', async () => {
    const first = LINK.exec((await queued()).slice(-1)[0]!.envelope.text)![1]!;
    expect(await mail('inv_1')).toMatchObject({ status: 'sent' });
    const second = LINK.exec((await queued()).slice(-1)[0]!.envelope.text)![1]!;
    expect(second).not.toBe(first);
    expect((await invitationRow('inv_1'))['token_hash']).toBe(surveyTokenHash(second));
  });

  it.skipIf(!available)('an anonymous survey: the open link, and nothing kept', async () => {
    await invitation('inv_open', { email: 'bo@harbour.dev', form: 'frm_open' });
    expect(await mail('inv_open')).toMatchObject({ status: 'sent' });
    const text = (await queued()).slice(-1)[0]!.envelope.text;
    expect(text).toContain(`${ORIGIN}/x/forms/fit-out`);
    expect(text).not.toContain('?t=');
    expect(await invitationRow('inv_open')).toMatchObject({ token_hash: null, expires_at: null });
  });

  it.skipIf(!available)('answered, past its days, or for a survey not live: not sent, and the row says why', async () => {
    const before = (await queued()).length;
    await invitation('inv_done', { email: 'cy@harbour.dev', answeredAt: NOW - 3_600_000 });
    expect(await mail('inv_done')).toEqual(expect.objectContaining({ status: 'skipped', error: 'Not sent: the survey was answered already' }));
    await invitation('inv_late', { email: 'di@harbour.dev', invitedAt: NOW - 31 * DAY });
    expect(await mail('inv_late')).toEqual(expect.objectContaining({ status: 'skipped', error: 'Not sent: the survey stopped taking answers for this invitation' }));
    await invitation('inv_draft', { email: 'ed@harbour.dev', form: 'frm_draft' });
    expect(await mail('inv_draft')).toEqual(expect.objectContaining({ status: 'skipped', error: 'Not sent: the survey is not live' }));
    expect((await queued()).length).toBe(before);
    expect(await invitationRow('inv_done')).toMatchObject({ token_hash: null });
    expect(await invitationRow('inv_late')).toMatchObject({ token_hash: null });
  });

  it.skipIf(!available)('with no public address, nothing is sent and the row says why', async () => {
    await settingsRepo(h.meta).set('system.publicOrigin', null as never, { updatedBy: null });
    await invitation('inv_noorigin', { email: 'fi@harbour.dev' });
    const left = await mail('inv_noorigin');
    await settingsRepo(h.meta).set('system.publicOrigin', ORIGIN, { updatedBy: null });
    expect(left).toEqual(expect.objectContaining({ status: 'skipped', error: 'Not sent: this server has no public address for the survey link (set it in Settings)' }));
    expect(await invitationRow('inv_noorigin')).toMatchObject({ token_hash: null });
  });

  it.skipIf(!available)('as service mail: skips a "no" to surveys, by the address or by their row, and still reaches the do-not-email list', async () => {
    await consent().record({ address: 'gil@harbour.dev', purpose: 'surveys', source: 'import', state: 'no' });
    await invitation('inv_no_address', { email: 'gil@harbour.dev' });
    expect(await mail('inv_no_address')).toEqual(expect.objectContaining({ status: 'skipped', error: 'Not sent: they said no to surveys' }));
    await consent().record({ person: { connectionId: h.connectionId, table: 'public.crm_contacts', key: 'c_hal' }, purpose: 'surveys', source: 'import', state: 'no' });
    await invitation('inv_no_row', { email: 'hal@harbour.dev', person: 'c_hal' });
    expect(await mail('inv_no_row')).toEqual(expect.objectContaining({ status: 'skipped', error: 'Not sent: they said no to surveys' }));
    // A "no" to the newsletter is not a "no" to surveys, and the list never stops service mail.
    await consent().record({ address: 'ivy@harbour.dev', purpose: 'newsletter', source: 'import', state: 'no' });
    await consent().stop.add({ address: 'ivy@harbour.dev', reason: 'link' });
    await invitation('inv_stopped', { email: 'ivy@harbour.dev' });
    expect(await mail('inv_stopped')).toMatchObject({ status: 'sent' });
  });

  it.skipIf(!available)('a "no" to surveys given after it was queued stops it at the hand-over', async () => {
    await invitation('inv_late_no', { email: 'jo@harbour.dev' });
    const left = await mail('inv_late_no');
    expect(left.status).toBe('sent');
    await consent().record({ address: 'jo@harbour.dev', purpose: 'surveys', source: 'import', state: 'no' });
    const sent: OutboundEmail[] = [];
    const told: string[] = [];
    const transport: EmailTransport = { send: async (message) => void sent.push(message) };
    const registry = createJobRegistry();
    const hub = new RealtimeHub();
    registerEmailSendHandler(registry, { meta: h.meta, secret: TEST_SECRET, createTransport: () => transport, onGiveUp: async (_report, error) => void told.push((error as Error).message) });
    const worker = new JobWorker({ meta: h.meta, registry, hub, workerId: 'survey-test', backoffBaseMs: 1, concurrency: 1 });
    try {
      for (let pass = 0; pass < 50 && (await worker.runOnce()) > 0; pass += 1);
    } finally {
      await worker.stop({ drainTimeoutMs: 50 });
      hub.close();
    }
    expect(sent.map((one) => one.to)).not.toContain('jo@harbour.dev');
    expect(told).toContain('Not sent: they said no to surveys');
    expect(sent.length).toBeGreaterThan(0);
  });

  it.skipIf(!available)('as marketing mail, judged for surveys: a yes to the newsletter alone does not carry it', async () => {
    await consent().record({ address: 'kim@harbour.dev', purpose: 'newsletter', source: 'import', state: 'yes' });
    await invitation('inv_marketing', { email: 'kim@harbour.dev', klass: 'marketing' });
    expect(await mail('inv_marketing', 'invite-marketing')).toEqual(expect.objectContaining({ status: 'skipped', error: 'Not sent: has not agreed to marketing mail' }));
  });
});
