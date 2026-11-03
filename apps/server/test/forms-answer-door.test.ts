// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE ANSWER DOOR ON THE REAL SERVER, as a stranger sends answers: a forms
 * add-on attached to a CRM-like app whose enquiries are opened to forms, on a
 * real database per engine.
 *
 * - A form mapped to the enquiries makes one enquiry, with its source fixed
 *   and its state from the entry's defaults; nothing else of the app changes
 *   (a contact with the same address is left alone); the app's "a new
 *   enquiry" rule fires for it.
 * - A posted `state`, `claimed_by_id` or a link column cannot be written: the
 *   map cannot name them, and a form whose map names them serves nothing.
 *   A table not opened to forms cannot be named.
 * - A hidden "show if" answer is refused; a trap filled answers "sent" and
 *   writes nothing; a proof made for another form is refused.
 * - 50 sign-ups for one address in a day send one confirmation; the form's
 *   hourly cap trips at N+1, tells its owner once, and says its real wait;
 *   an address's day says tomorrow.
 * - A forged Host changes no link in the mail; with no public address no
 *   mail goes, and the answer is kept.
 * - The confirm page: a scanner's GET changes nothing; the POST confirms
 *   once; a stop-listed address is lifted and the log holds both rows; a link
 *   31 days old is too old; one changed by a byte does not work.
 * - A staff notice shows a typed `<a href>` and a web address as plain text.
 * - A hand-uploaded package that declares forms serves nothing.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { FormDefinitionInput, FormSettingsInput } from '@adminium/add-on-contracts/forms';
import { paymentSettingsRepo, permissionsRepo, rolesRepo, settingsRepo, usersRepo } from '@adminium/meta';

import { formsAddOn } from '../../../packages/manifest/test/forms-fixture.js';
import { recordDeciderTrust } from '../src/add-ons/decider-trust.js';
import { composeServer, type ComposedServer } from '../src/compose.js';
import { encryptSecret, decryptSecret } from '../src/config/secrets.js';
import { createConsentService } from '../src/consent/service.js';
import { emailSecretKey } from '../src/email/config.js';
import { emailEnvelopeKey } from '../src/email/send.js';
import { confirmKey, makeConfirmToken, readConfirmToken } from '../src/forms/confirm-token.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import { solveProof } from '../src/public-api/proof.js';
import { PAY_PAGE_DOC, payPageSchema } from '../src/routes/payments/ways.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { published } from './forms-door.helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';
import { LEGS } from './invoicing-install.helpers.js';

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- a reply read freely

const HOST = 'forms.meridian.example';
const ORIGIN = `https://${HOST}`;
const pk = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength: number, more: Record<string, unknown> = {}) => ({ ref, type: 'text', maxLength, ...more });
const en = (value: string) => ({ 'en-US': value });

/** A CRM-like app: its enquiries opened to forms, with a rule on each new one. */
function crm(): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'crm',
    name: 'CRM',
    version: '1.0.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'AGPL-3.0-only',
    description: { key: 'd', fallback: 'A small CRM.' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: '0.3.40', engines: ['postgres', 'mysql', 'sqlite'] },
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'staff', columns: [pk, text('name', 80)] },
        { ref: 'contacts', columns: [pk, text('name', 80), text('email', 254, { nullable: true })] },
        {
          ref: 'enquiries',
          columns: [
            pk,
            text('person', 80),
            text('email', 254, { nullable: true }),
            text('message', 1000, { nullable: true }),
            { ref: 'state', type: 'enum', enum: ['open', 'claimed', 'closed'], default: 'open' },
            { ref: 'source', type: 'enum', enum: ['form', 'phone', 'show', 'chat'], nullable: true },
            text('form_name', 200, { nullable: true }),
            { ref: 'claimed_by_id', type: 'fk', references: 'staff', nullable: true },
            { ref: 'contact_id', type: 'fk', references: 'contacts', nullable: true },
          ],
        },
        { ref: 'secrets', columns: [pk, text('note', 200)] },
        { ref: 'notes', columns: [pk, text('body', 200)] },
      ],
    },
    people: [
      { table: 'contacts', kind: 'people', email: 'email', name: 'name' },
      { table: 'enquiries', kind: 'people', email: 'email', name: 'person' },
    ],
    publicAccess: [
      {
        table: 'enquiries',
        methods: ['POST'],
        key: 'forms',
        // A link column the entry opens (an invitation fills it): the door never fills it from a question.
        writable: ['person', 'email', 'message', 'form_name', 'contact_id'],
        defaults: { state: 'open', source: 'form' },
        anonymous: { plainText: ['person'] },
      },
    ],
    roles: [{ key: 'rep', name: 'Rep', permissions: ['table:@enquiries:read', 'table:@enquiries:read_pii', 'table:@contacts:read'] }],
    automations: [
      {
        key: 'enquiry-note',
        name: en('A new enquiry: a note'),
        enabled: true,
        trigger: { kind: 'record', event: 'created', table: 'enquiries' },
        graph: {
          version: 1,
          nodes: [
            { id: 't', kind: 'trigger', title: 'When' },
            { id: 'note', kind: 'action', title: 'note', action: { kind: 'record.create', table: 'notes', values: { body: 'Rule saw {{record.person}}' } } },
          ],
        },
      },
    ],
    pages: [{ ref: 'crm-enquiries', template: 'page-crud', title: { key: 't', fallback: 'Enquiries' }, nav: { group: 'crm', icon: 'home', order: 1 }, bindings: { rows: 'enquiries' } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
  };
}

/** A showroom form: a name, an address, a note, a "show if", a hidden source, and the newsletter tick. */
const SHOWROOM: FormDefinitionInput = {
  v: 1,
  kind: 'form',
  languages: ['en-US'],
  defaultLanguage: 'en-US',
  title: en('Book a showroom visit'),
  questions: [
    { id: 'qname', kind: 'short', role: 'name', required: true, label: en('Your name') },
    { id: 'qemail', kind: 'short', check: 'email', role: 'email', required: true, label: en('Work e-mail') },
    { id: 'qnote', kind: 'long', label: en('Anything else?') },
    { id: 'qsee', kind: 'several', label: en('What would you like to see?'), choices: [{ id: 'booths', label: en('Booths') }, { id: 'seating', label: en('Seating') }] },
    { id: 'qseats', kind: 'number', label: en('How many seats?'), showIf: { question: 'qsee', includes: 'seating' } },
    { id: 'qfrom', kind: 'hidden', param: 'from', label: en('Source') },
    { id: 'qnews', kind: 'tick', purpose: 'newsletter', wordingVersion: 3, wordingChangedAt: '2026-10-01', label: en("Send me Meridian's newsletter.") },
  ],
  ending: { kind: 'words', words: en("We'll be in touch.") },
};

/** The showroom form with the newsletter's yes taken at once, no confirmation asked. */
const QUICK: FormDefinitionInput = {
  ...SHOWROOM,
  questions: SHOWROOM.questions.map((question) => (question.kind === 'tick' ? { ...question, confirm: false } : question)),
};

/** The showroom form with its e-mail question optional: a confirmation asked may find no address to go to. */
const BLANK_EMAIL: FormDefinitionInput = {
  ...SHOWROOM,
  questions: SHOWROOM.questions.map((question) => (question.id === 'qemail' ? { ...question, required: false } : question)),
};

/** A form that asks for an address as plain words (no e-mail check), with the yes taken at once. */
const TYPED_ADDRESS: FormDefinitionInput = {
  ...SHOWROOM,
  questions: [
    { id: 'qname', kind: 'short', role: 'name', required: true, label: en('Your name') },
    { id: 'qaddr', kind: 'short', label: en('Where can we write to you?') },
    { id: 'qnews', kind: 'tick', purpose: 'newsletter', wordingVersion: 3, wordingChangedAt: '2026-10-01', confirm: false, label: en("Send me Meridian's newsletter.") },
  ],
};

describe.each(LEGS)('the answer door — %s', (dialect, available) => {
  let h: Harness;
  let composed: ComposedServer;
  let root: string;
  let formsTable = '';
  let answersTable = '';
  let enquiries = '';
  let enquiriesId = '';
  let answersId = '';
  let repId = '';
  let nilsId = '';
  let leaId = '';
  let seq = 0;

  const t = (ref: string) => `crm_${ref}`;
  const count = async (table: string, where = '1=1') => Number((await h.rows(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`))[0]!['n']);
  const insertForm = async (id: string, slug: string, settings: FormSettingsInput, definition: FormDefinitionInput = SHOWROOM) => {
    const { db } = await h.manager.data(h.connectionId);
    await db.insertInto(formsTable).values({ id, title: slug, slug, kind: definition.kind, state: 'live', definition: '{}', settings: '{}', published: published(definition, settings) } as never).execute();
  };
  /** A stranger's send: a fresh proof for the form, then the answer. */
  const send = async (slug: string, values: Record<string, unknown>, opts: { website?: string; query?: Record<string, string>; ip?: string; proofFor?: string; headers?: Record<string, string>; from?: string } = {}) => {
    const challenge = (await composed.app.inject({ method: 'GET', url: `/x/forms/api/${opts.proofFor ?? slug}/challenge`, headers: { host: HOST } })).json() as Doc;
    // A door that is shut hands out no challenge: the send then carries none.
    const proof = typeof challenge.salt === 'string' ? `${challenge.id as string}.${solveProof(challenge.salt, challenge.difficulty as number)}` : 'none';
    seq += 1;
    return composed.app.inject({
      method: 'POST',
      url: `/x/forms/api/${slug}/answers`,
      remoteAddress: opts.ip ?? `198.51.100.${String(seq % 250)}`,
      headers: { host: HOST, origin: ORIGIN, 'x-adminium-proof': proof, 'user-agent': 'Mozilla/5.0 test', ...(opts.headers ?? {}) },
      payload: { language: 'en-US', values, query: opts.query ?? {}, website: opts.website ?? '', ...(opts.from === undefined ? {} : { from: opts.from }) },
    });
  };
  /** The mails queued since the last look, opened. */
  const mails = async (): Promise<{ to: string; subject: string; html: string; text: string; templateKey: string }[]> => {
    const rows = await h.meta.db.selectFrom('adminium_jobs').select(['id', 'payload']).where('kind', '=', 'email.send').where('status', '=', 'pending').orderBy('createdAt', 'asc').execute();
    for (const row of rows) await h.meta.db.updateTable('adminium_jobs').set({ status: 'cancelled' } as never).where('id', '=', row.id).execute();
    return rows.map((row) => {
      const payload = (typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload) as { envelope: string; templateKey: string };
      return { ...(JSON.parse(decryptSecret(payload.envelope, emailEnvelopeKey(TEST_SECRET))) as { to: string; subject: string; html: string; text: string }), templateKey: payload.templateKey };
    });
  };
  const runJobs = async () => {
    for (let round = 0; round < 20; round += 1) {
      await h.meta.db.updateTable('adminium_jobs').set({ runAt: 0 } as never).where('status', '=', 'pending' as never).where('kind', '!=', 'email.send').execute();
      if ((await composed.jobs.worker.runOnce()) === 0) break;
    }
  };
  const answerRows = async (formId: string) => (await h.rows(`SELECT * FROM ${answersTable} WHERE form_id = '${formId}' ORDER BY submitted_at`)) as Doc[];

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageApp(crm());
    const app = await h.install('crm', '1.0.0');
    expect(app.statusCode, app.body).toBe(200);
    await h.stageAddOn(formsAddOn(), { bundled: true });
    const added = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'forms', version: '1.0.0', attachTo: ['crm'] } });
    expect(added.statusCode, added.body).toBe(200);
    // Vouched for as a bundled package is: its bytes recorded as trusted.
    await recordDeciderTrust(h.meta, { key: 'forms', version: '1.0.0', integrity: (await h.addOnStore.verifyTree('forms', '1.0.0')).integrity });
    const tableOf = async (appKey: string, ref: string) => (await h.meta.db.selectFrom('adminium_app_tables').select(['tableName']).where('appKey', '=', appKey).where('ref', '=', ref).executeTakeFirstOrThrow()).tableName;
    formsTable = await tableOf('forms', 'forms');
    answersTable = await tableOf('forms', 'answers');
    enquiries = await tableOf('crm', 'enquiries');
    const snapshot = await h.meta.db.selectFrom('adminium_schema_snapshots').select(['schema']).where('connectionId', '=', h.connectionId).orderBy('createdAt', 'desc').executeTakeFirstOrThrow();
    const schema = (typeof snapshot.schema === 'string' ? JSON.parse(snapshot.schema) : snapshot.schema) as { tables: { id: string; name: string }[] };
    enquiriesId = schema.tables.find((table) => table.name === enquiries)!.id;
    answersId = schema.tables.find((table) => table.name === answersTable)!.id;
    const secretsId = schema.tables.find((table) => table.name === t('secrets'))!.id;

    const tell = [{ kind: 'role' as const, id: 'crm-rep' }];
    const becomes = { table: enquiriesId, map: { qname: 'person', qemail: 'email', qnote: 'message' }, source: { column: 'form_name', value: 'Showroom form' } };
    await insertForm('frm_show', 'showroom', { becomes, tell, limits: { perHour: 200, harder: false } });
    await insertForm('frm_keep', 'keep-only', { tell, limits: { perHour: 200, harder: false } });
    await insertForm('frm_cap', 'capped', { limits: { perHour: 3, harder: false } });
    await insertForm('frm_state', 'names-state', { becomes: { table: enquiriesId, map: { qname: 'person', qnote: 'state' } } });
    await insertForm('frm_claim', 'names-claimed', { becomes: { table: enquiriesId, map: { qname: 'person', qnote: 'claimed_by_id' } } });
    await insertForm('frm_link', 'names-link', { becomes: { table: enquiriesId, map: { qname: 'person', qnote: 'contact_id' } } });
    await insertForm('frm_secret', 'names-secret', { becomes: { table: secretsId, map: { qname: 'note' } } });
    await insertForm('frm_quick', 'quick', { limits: { perHour: 200, harder: false } }, QUICK);
    await insertForm('frm_blank', 'blank-email', { becomes: { table: enquiriesId, map: { qname: 'person', qemail: 'email' } } }, BLANK_EMAIL);
    await insertForm('frm_typed', 'typed-address', { becomes: { table: enquiriesId, map: { qname: 'person', qaddr: 'email' } } }, TYPED_ADDRESS);

    const settings = settingsRepo(h.meta);
    await settings.set('system.publicOrigin', ORIGIN, { updatedBy: null });
    await settings.set('privacy.businessName', 'Meridian Workplace Ltd', { updatedBy: null });
    await settings.set('privacy.noticeUrl', 'https://www.meridian.example/privacy', { updatedBy: null });
    await settings.set('email.smtp', { host: '127.0.0.1', port: 9, user: 'postmaster', passEncrypted: encryptSecret('not-a-real-password', emailSecretKey(TEST_SECRET)), from: 'Desk <no-reply@desk.test>', secure: false }, { updatedBy: null });
    await paymentSettingsRepo(h.meta).set(PAY_PAGE_DOC, payPageSchema, { shopName: 'Meridian', logoFileId: null, contactEmail: 'hello@meridian.example', contactPhone: null, shopCountry: 'GB', showLines: false });

    // A rep, who is told of each answer, and reads the forms add-on's answers.
    const rep = await usersRepo(h.meta).create({ email: 'rita@meridian.example', name: 'Rita' });
    const repRole = (await rolesRepo(h.meta).findBySlug('crm-rep'))!;
    await rolesRepo(h.meta).assignToUser(rep.id, repRole.id);
    const answersRead = { read: true, create: false, update: false, delete: false, export: false, import: false };
    await permissionsRepo(h.meta).grant(repRole.id, 'table', `${h.connectionId}/${answersId}`, answersRead as never);
    repId = rep.id;
    // Two more a form names: one who does not read the answers, one who reads only another form's.
    const nils = await usersRepo(h.meta).create({ email: 'nils@meridian.example', name: 'Nils' });
    nilsId = nils.id;
    const lea = await usersRepo(h.meta).create({ email: 'lea@meridian.example', name: 'Lea' });
    const otherForm = await rolesRepo(h.meta).create({ slug: 'other-form-reader', name: 'Other form' });
    await permissionsRepo(h.meta).grant(otherForm.id, 'table', `${h.connectionId}/${answersId}`, { ...answersRead, rowLimit: { read: { reach: 'all', while: { column: 'form_id', in: ['frm_other'] } } } } as never);
    await rolesRepo(h.meta).assignToUser(lea.id, otherForm.id);
    leaId = lea.id;
    const named = [{ kind: 'role' as const, id: 'crm-rep' }, { kind: 'person' as const, id: nilsId }, { kind: 'person' as const, id: leaId }];
    await insertForm('frm_told', 'told', { tell: named, limits: { perHour: 200, harder: false } });
    await insertForm('frm_told_cap', 'told-capped', { tell: named, limits: { perHour: 1, harder: false } });
    const { db } = await h.manager.data(h.connectionId);
    await db.insertInto(t('contacts')).values({ id: 1, name: 'Marta on file', email: 'marta@cobalt.example' } as never).execute();

    root = await mkdtemp(join(tmpdir(), 'forms-answer-'));
    await mkdir(join(root, 'dist', 'x'), { recursive: true });
    await writeFile(join(root, 'dist', 'index.html'), '<!doctype html><html><body></body></html>');
    await writeFile(join(root, 'dist', 'x', 'index.html'), '<!doctype html><html><body><noscript>x</noscript></body></html>');
    const runService = createRunService({ meta: h.meta });
    composed = await composeServer({
      env: makeEnv({ ADMINIUM_DATA_DIR: h.dataDir, HOST: '127.0.0.1', ADMINIUM_SECRET: TEST_SECRET }),
      metaStore: { meta: h.meta, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() },
      manager: h.manager,
      runService,
      applyService: createApplyService({ meta: h.meta, runService }),
      allowed: null,
      staticRoot: join(root, 'dist'),
      logger: false,
      telemetry: false,
    });
    await composed.app.ready();
    await composed.addOnsLoaded;
    await composed.jobs.worker.stop();
    composed.jobs.scheduler.stop();
  }, 240_000);

  afterAll(async () => {
    if (!available) return;
    await composed?.app.close();
    await h?.close();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  beforeEach(async () => {
    if (!available) return;
    await mails();
  });

  it.skipIf(!available)('a form mapped to the enquiries makes one, with its source fixed and its state from the entry; a contact on file is left alone; the rule fires', async () => {
    const before = await h.rows(`SELECT * FROM ${t('contacts')}`);
    const sent = await send('showroom', { qname: 'Marta Kovac', qemail: 'Marta@Cobalt.example', qnote: 'Two booths, please.', qsee: ['booths'] }, { query: { from: 'flyer' } });
    expect(sent.statusCode, sent.body).toBe(200);
    expect(sent.json()).toEqual({ state: 'sent', ending: 'sent' });
    const made = (await h.rows(`SELECT * FROM ${enquiries}`)) as Doc[];
    expect(made).toHaveLength(1);
    const { id: _id, ...row } = made[0]!;
    expect(row).toEqual({ person: 'Marta Kovac', email: 'Marta@Cobalt.example', message: 'Two booths, please.', state: 'open', source: 'form', form_name: 'Showroom form', claimed_by_id: null, contact_id: null });
    // The contact with the same address is not touched.
    expect(await h.rows(`SELECT * FROM ${t('contacts')}`)).toEqual(before);
    // The answer, beside it: the row it became, and no network address (nothing was ticked).
    const answer = (await answerRows('frm_show'))[0]!;
    expect(answer).toMatchObject({ email: 'marta@cobalt.example', name: 'Marta Kovac', became_table: 'crm:enquiries', became_key: String(made[0]!['id']), confirm: 'none', ip: null, user_agent: null, consent_purpose: null });
    const values = typeof answer['values'] === 'string' ? JSON.parse(answer['values'] as string) : answer['values'];
    expect(values).toMatchObject({ qname: 'Marta Kovac', qfrom: 'flyer', qsee: ['booths'] });
    // The app's own rule saw the new enquiry, as a stranger's.
    await runJobs();
    expect((await h.rows(`SELECT body FROM ${t('notes')}`)).map((row) => row['body'])).toEqual(['Rule saw Marta Kovac']);
  });

  it.skipIf(!available)('a forged body cannot write state, claimed_by_id or a link: the map cannot name them, and a form whose map does serves nothing', async () => {
    const before = await count(enquiries);
    // A body naming the columns is no answer: they are not questions.
    const forged = await send('showroom', { qname: 'Bob', qemail: 'bob@x.example', state: 'closed', claimed_by_id: 1, contact_id: 1 });
    expect(forged.statusCode).toBe(400);
    expect((forged.json() as Doc).state).toBe('refused');
    // A map naming them is the form's fault: not available, nothing written.
    for (const slug of ['names-state', 'names-claimed', 'names-link']) {
      const sent = await send(slug, { qname: 'Bob', qemail: 'bob@x.example', qnote: '1' });
      expect([slug, sent.statusCode, (sent.json() as Doc).state]).toEqual([slug, 404, 'unavailable']);
    }
    // A table its app never opened to forms cannot be named either.
    const secret = await send('names-secret', { qname: 'Bob', qemail: 'bob@x.example' });
    expect(secret.statusCode).toBe(404);
    expect(await count(enquiries)).toBe(before);
    expect(await count(t('secrets'))).toBe(0);
    for (const id of ['frm_state', 'frm_claim', 'frm_link', 'frm_secret']) expect(await answerRows(id)).toEqual([]);
  });

  it.skipIf(!available)('a hidden "show if" answer is refused; a filled trap answers sent and writes nothing; a proof for another form is refused', async () => {
    const before = await answerRows('frm_keep');
    const hidden = await send('keep-only', { qname: 'Ann', qemail: 'ann@x.example', qsee: ['booths'], qseats: 40 });
    expect(hidden.statusCode).toBe(400);
    expect(hidden.json()).toEqual({ state: 'refused', errors: { qseats: 'not-shown' } });
    const trapped = await send('keep-only', { qname: 'Bot', qemail: 'bot@x.example', qnews: true }, { website: 'https://spam.example' });
    expect(trapped.statusCode).toBe(200);
    expect(trapped.json()).toEqual({ state: 'sent', ending: 'sent-confirm' });
    const other = await send('keep-only', { qname: 'Ann', qemail: 'ann@x.example' }, { proofFor: 'showroom' });
    expect(other.statusCode).toBe(403);
    expect(await answerRows('frm_keep')).toEqual(before);
    expect(await mails()).toEqual([]);
  });

  it.skipIf(!available)('fifty sign-ups for one address in a day send one confirmation; the address is held to its day after five, and told tomorrow', async () => {
    const replies: number[] = [];
    for (let i = 0; i < 50; i += 1) replies.push((await send('keep-only', { qname: 'Nina', qemail: `nina+${String(i)}@sample.example`, qnews: true })).statusCode);
    // The address's day: five answers to one form, then "too many" with the day's window.
    expect(replies.filter((status) => status === 200)).toHaveLength(5);
    const held = await send('keep-only', { qname: 'Nina', qemail: 'nina@sample.example', qnews: true });
    expect(held.statusCode).toBe(429);
    expect((held.json() as Doc).window).toBe('day');
    const confirmations = (await mails()).filter((mail) => mail.templateKey === 'sign-up-confirm');
    expect(confirmations).toHaveLength(1);
    expect(confirmations[0]!.to).toBe('nina+0@sample.example');
  });

  it.skipIf(!available)('the form’s hourly cap trips at N+1, tells its owner once, and says its real wait', async () => {
    for (let i = 0; i < 3; i += 1) expect((await send('capped', { qname: `P${String(i)}`, qemail: `p${String(i)}@cap.example` })).statusCode).toBe(200);
    const over = await send('capped', { qname: 'P3', qemail: 'p3@cap.example' });
    expect(over.statusCode).toBe(429);
    const wait = (over.json() as Doc).retryAfter as number;
    expect(wait).toBeGreaterThan(3500);
    expect(wait).toBeLessThanOrEqual(3600);
    expect((over.json() as Doc).window).toBe('hour');
    expect((await send('capped', { qname: 'P4', qemail: 'p4@cap.example' })).statusCode).toBe(429);
    // Told once, though it tripped twice: the form tells nobody, so those who may change the form are.
    const alerts = await h.meta.db.selectFrom('adminium_notifications').select(['userId', 'title', 'body', 'actionUrl']).where('kind', '=', 'forms.limit').where('actionUrl', 'like', '%/capped%').execute();
    expect(alerts.length).toBeGreaterThan(0);
    expect(new Set(alerts.map((one) => one.userId)).size).toBe(alerts.length);
    expect(alerts[0]!.title).toBe('A form hit its limit');
    // The forms add-on's forms page, then the form: the first segment after the add-on is the page the dashboard opens.
    expect(alerts[0]!.actionUrl).toBe('/add-ons/forms/forms/capped?settings=limits');
    expect(await answerRows('frm_cap')).toHaveLength(3);
  });

  it.skipIf(!available)('a forged Host changes no link in the confirmation; with no public address no mail goes and the answer is kept', async () => {
    const sent = await send('keep-only', { qname: 'Hana Host', qemail: 'hana@host.example', qnews: true }, { headers: { host: 'evil.example', origin: 'https://evil.example' } });
    // The door answers on any host it is reached on; the mail's link is the public address's alone.
    expect(sent.statusCode, sent.body).toBe(200);
    expect(sent.json()).toEqual({ state: 'sent', ending: 'sent-confirm' });
    const [mail] = (await mails()).filter((one) => one.templateKey === 'sign-up-confirm');
    expect(mail!.html).toContain(`${ORIGIN}/m/c/`);
    expect(mail!.html).not.toContain('evil.example');
    expect(mail!.text).toContain('Hello Hana,');
    expect(mail!.html).not.toContain('Hana Host');

    await settingsRepo(h.meta).set('system.publicOrigin', null, { updatedBy: null });
    try {
      // With no public address the door itself is shut: nothing is taken.
      expect((await send('keep-only', { qname: 'Ivo', qemail: 'ivo@x.example', qnews: true })).statusCode).toBe(404);
    } finally {
      await settingsRepo(h.meta).set('system.publicOrigin', ORIGIN, { updatedBy: null });
    }
    // No mail server: the answer is kept, and no mail goes.
    const smtp = await settingsRepo(h.meta).get('email.smtp');
    await settingsRepo(h.meta).set('email.smtp', null, { updatedBy: null });
    try {
      expect((await send('keep-only', { qname: 'Ivo', qemail: 'ivo@x.example', qnews: true })).statusCode).toBe(200);
    } finally {
      await settingsRepo(h.meta).set('email.smtp', smtp, { updatedBy: null });
    }
    expect((await answerRows('frm_keep')).filter((row) => row['email'] === 'ivo@x.example')).toHaveLength(1);
    expect(await mails()).toEqual([]);
    const blocked = await composed.app.inject({ method: 'GET', url: '/api/v1/forms/mail', headers: { host: HOST } });
    expect(blocked.statusCode).toBe(401);
  });

  it.skipIf(!available)('the confirm page: a scanner’s GET changes nothing; the POST confirms once and lifts the stop list; the log keeps both', async () => {
    const consent = createConsentService({ meta: h.meta, secret: TEST_SECRET });
    // Zoe unsubscribed once: a "no" in the log, and the address on the do-not-email list.
    await consent.withdraw({ address: 'zoe@stop.example', purpose: 'newsletter', source: 'unsubscribe', detail: 'link-all' });
    await consent.stop.add({ address: 'zoe@stop.example', reason: 'link' });
    const sent = await send('keep-only', { qname: 'Zoe', qemail: 'zoe@stop.example', qnews: true }, { ip: '203.0.113.77' });
    expect(sent.statusCode, sent.body).toBe(200);
    const [mail] = (await mails()).filter((one) => one.templateKey === 'sign-up-confirm');
    const token = /\/m\/c\/([A-Za-z0-9_~-]+)/.exec(mail!.html)![1]!;
    const page = (method: 'GET' | 'POST', payload?: string, path = `/m/c/${token}`) =>
      composed.app.inject({ method, url: path, headers: { host: HOST, ...(payload === undefined ? {} : { 'content-type': 'application/x-www-form-urlencoded' }) }, ...(payload === undefined ? {} : { payload }) });
    const answer = async () => (await answerRows('frm_keep')).find((row) => row['email'] === 'zoe@stop.example')!;
    expect(await answer()).toMatchObject({ confirm: 'pending', consent_purpose: 'newsletter', consent_version: 3, ip: '203.0.113.77', user_agent: 'Mozilla/5.0 test' });

    // A scanner opens it, twice: the page shows the address and the button, and changes nothing.
    for (let i = 0; i < 2; i += 1) {
      const shown = await page('GET');
      expect(shown.statusCode).toBe(200);
      expect(shown.body).toContain('zoe@stop.example');
      expect(shown.body).toContain('value="confirm"');
      expect(shown.headers['content-security-policy']).toContain("default-src 'none'");
    }
    expect((await answer())['confirm']).toBe('pending');
    expect(await consent.stop.has('zoe@stop.example')).toBe(true);
    // A post that is not the button does nothing either.
    expect((await page('POST', 'act=other')).body).toContain('value="confirm"');
    expect((await answer())['confirm']).toBe('pending');

    const done = await page('POST', 'act=confirm');
    expect(done.statusCode).toBe(200);
    expect(done.body).toContain('You’re signed up. Thank you.');
    expect((await answer())['confirm']).toBe('confirmed');
    expect(await consent.stop.has('zoe@stop.example')).toBe(false);
    const history = await consent.history({ address: 'zoe@stop.example' });
    const yes = history.find((event) => event.state === 'yes')!;
    expect(yes).toMatchObject({ purpose: 'newsletter', source: 'form', wording: "Send me Meridian's newsletter.", wordingVersion: '3', ip: '203.0.113.77', userAgent: 'Mozilla/5.0 test' });
    expect(yes.confirmedAt).not.toBeNull();
    // The log keeps the old objection and the new yes.
    expect(history.map((event) => [event.state, event.source])).toEqual([
      ['yes', 'form'],
      ['no', 'unsubscribe'],
    ]);
    // Pressed again: already, and nothing more written.
    expect((await page('POST', 'act=confirm')).body).toContain('You’ve already confirmed.');
    expect((await consent.history({ address: 'zoe@stop.example' })).filter((event) => event.state === 'yes')).toHaveLength(1);

    // One byte changed: the link does not work.
    const changed = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;
    const dead = await page('GET', undefined, `/m/c/${changed}`);
    expect(dead.statusCode).toBe(404);
    expect(dead.body).toContain('This link doesn’t work.');
  });

  it.skipIf(!available)('two presses at the same moment confirm once', async () => {
    const consent = createConsentService({ meta: h.meta, secret: TEST_SECRET });
    expect((await send('keep-only', { qname: 'Tess', qemail: 'tess@twice.example', qnews: true })).statusCode).toBe(200);
    const [mail] = (await mails()).filter((one) => one.templateKey === 'sign-up-confirm');
    const token = /\/m\/c\/([A-Za-z0-9_~-]+)/.exec(mail!.html)![1]!;
    const press = () => composed.app.inject({ method: 'POST', url: `/m/c/${token}`, headers: { host: HOST, 'content-type': 'application/x-www-form-urlencoded' }, payload: 'act=confirm' });
    const [one, two] = await Promise.all([press(), press()]);
    expect([one.body.includes('You’re signed up.'), two.body.includes('You’re signed up.')].filter(Boolean)).toHaveLength(1);
    expect((await consent.history({ address: 'tess@twice.example' })).filter((event) => event.state === 'yes')).toHaveLength(1);
  });

  it.skipIf(!available)('a yes no link proved never replaces a no nor passes the stop list: the answer waits for the click; a fresh address has its yes at once', async () => {
    const consent = createConsentService({ meta: h.meta, secret: TEST_SECRET });
    await consent.withdraw({ address: 'nora@said-no.example', purpose: 'newsletter', source: 'unsubscribe', detail: 'link-all' });
    await consent.stop.add({ address: 'sam@stopped.example', reason: 'link' });

    const links = new Map<string, string>();
    for (const address of ['nora@said-no.example', 'sam@stopped.example']) {
      const sent = await send('quick', { qname: 'Someone', qemail: address, qnews: true });
      expect(sent.statusCode, sent.body).toBe(200);
      // The stranger is told what the form says: whoever typed the address learns nothing of its standing.
      expect(sent.json()).toEqual({ state: 'sent', ending: 'sent' });
      expect((await consent.history({ address })).filter((event) => event.state === 'yes')).toHaveLength(0);
      expect((await answerRows('frm_quick')).find((row) => row['email'] === address)!['confirm']).toBe('pending');
      const confirmations = (await mails()).filter((mail) => mail.templateKey === 'sign-up-confirm');
      expect(confirmations.map((mail) => mail.to)).toEqual([address]);
      links.set(address, /\/m\/c\/([A-Za-z0-9_~-]+)/.exec(confirmations[0]!.html)![1]!);
    }
    expect((await consent.stateFor({ address: 'nora@said-no.example' }, 'newsletter')).state).toBe('no');
    expect(await consent.stop.has('sam@stopped.example')).toBe(true);

    // The click proves it: the yes is written then, and the stop list lifted.
    for (const [address, token] of links) {
      const done = await composed.app.inject({ method: 'POST', url: `/m/c/${token}`, headers: { host: HOST, 'content-type': 'application/x-www-form-urlencoded' }, payload: 'act=confirm' });
      expect(done.body).toContain('You’re signed up.');
      expect((await consent.stateFor({ address }, 'newsletter')).state).toBe('yes');
    }
    expect(await consent.stop.has('sam@stopped.example')).toBe(false);

    const fresh = await send('quick', { qname: 'Fay', qemail: 'fay@fresh.example', qnews: true });
    expect(fresh.statusCode, fresh.body).toBe(200);
    expect((await consent.stateFor({ address: 'fay@fresh.example' }, 'newsletter')).state).toBe('yes');
    expect((await answerRows('frm_quick')).find((row) => row['email'] === 'fay@fresh.example')!['confirm']).toBe('none');
    expect((await mails()).filter((mail) => mail.templateKey === 'sign-up-confirm' && mail.to === 'fay@fresh.example')).toHaveLength(0);
  });

  it.skipIf(!available)('a confirmation asked with the address left blank writes no yes, not even for the row the answer became', async () => {
    const consent = createConsentService({ meta: h.meta, secret: TEST_SECRET });
    const sent = await send('blank-email', { qname: 'Bo Blank', qnews: true });
    expect(sent.statusCode, sent.body).toBe(200);
    expect(sent.json()).toEqual({ state: 'sent', ending: 'sent-confirm' });
    const answer = (await answerRows('frm_blank'))[0]!;
    expect(answer).toMatchObject({ email: null, confirm: 'none', consent_purpose: 'newsletter' });
    const person = { connectionId: h.connectionId, table: enquiriesId, key: String(answer['became_key']) };
    expect(await consent.history({ person })).toEqual([]);
    expect((await mails()).filter((mail) => mail.templateKey === 'sign-up-confirm')).toHaveLength(0);
  });

  it.skipIf(!available)('a no for the address the row it became holds stands, and with no checked address nothing is written', async () => {
    const consent = createConsentService({ meta: h.meta, secret: TEST_SECRET });
    await consent.withdraw({ address: 'tom@typed.example', purpose: 'newsletter', source: 'unsubscribe', detail: 'link-all' });
    const sent = await send('typed-address', { qname: 'Tom Typed', qaddr: 'Tom@Typed.example', qnews: true });
    expect(sent.statusCode, sent.body).toBe(200);
    const answer = (await answerRows('frm_typed'))[0]!;
    expect(answer).toMatchObject({ email: null, confirm: 'none' });
    const person = { connectionId: h.connectionId, table: enquiriesId, key: String(answer['became_key']) };
    expect((await consent.history({ person })).filter((event) => event.state === 'yes')).toHaveLength(0);
    expect((await consent.stateFor({ person, address: 'tom@typed.example' }, 'newsletter')).state).toBe('no');
    expect((await mails()).filter((mail) => mail.templateKey === 'sign-up-confirm')).toHaveLength(0);
    // A person nobody objected for: the yes, for the row it became.
    const told = await send('typed-address', { qname: 'Una Typed', qaddr: 'una@typed.example', qnews: true });
    expect(told.statusCode).toBe(200);
    const una = (await answerRows('frm_typed')).find((row) => row['name'] === 'Una Typed')!;
    expect((await consent.stateFor({ person: { connectionId: h.connectionId, table: enquiriesId, key: String(una['became_key']) } }, 'newsletter')).state).toBe('yes');
  });

  it.skipIf(!available)('a link whose answer no longer holds the address the mail went to confirms nobody', async () => {
    const consent = createConsentService({ meta: h.meta, secret: TEST_SECRET });
    await consent.withdraw({ address: 'vic@target.example', purpose: 'newsletter', source: 'unsubscribe', detail: 'link-all' });
    await consent.stop.add({ address: 'vic@target.example', reason: 'link' });
    expect((await send('keep-only', { qname: 'Mallory', qemail: 'mallory@own.example', qnews: true })).statusCode).toBe(200);
    const [mail] = (await mails()).filter((one) => one.templateKey === 'sign-up-confirm');
    const token = /\/m\/c\/([A-Za-z0-9_~-]+)/.exec(mail!.html)![1]!;
    // The pending answer's address changed under it (as a write to the answers table would).
    const { db } = await h.manager.data(h.connectionId);
    await db.updateTable(answersTable).set({ email: 'vic@target.example' } as never).where('email' as never, '=', 'mallory@own.example' as never).execute();
    const shown = await composed.app.inject({ method: 'GET', url: `/m/c/${token}`, headers: { host: HOST } });
    expect(shown.body).toContain('This link doesn’t work.');
    expect(shown.body).not.toContain('vic@target.example');
    const posted = await composed.app.inject({ method: 'POST', url: `/m/c/${token}`, headers: { host: HOST, 'content-type': 'application/x-www-form-urlencoded' }, payload: 'act=confirm' });
    expect(posted.body).toContain('This link doesn’t work.');
    expect((await answerRows('frm_keep')).find((row) => row['email'] === 'vic@target.example')!['confirm']).toBe('pending');
    expect((await consent.stateFor({ address: 'vic@target.example' }, 'newsletter')).state).toBe('no');
    expect(await consent.stop.has('vic@target.example')).toBe(true);
  });

  it.skipIf(!available)('a link 31 days old is too old, with the business’s website', async () => {
    const sent = await send('keep-only', { qname: 'Olga', qemail: 'olga@old.example', qnews: true });
    expect(sent.statusCode).toBe(200);
    const [mail] = (await mails()).filter((one) => one.templateKey === 'sign-up-confirm');
    const token = /\/m\/c\/([A-Za-z0-9_~-]+)/.exec(mail!.html)![1]!;
    const install = String(await settingsRepo(h.meta).get('system.instanceId'));
    const claim = readConfirmToken(confirmKey(TEST_SECRET), install, token)!;
    const old = makeConfirmToken(confirmKey(TEST_SECRET), install, { ...claim, issuedAt: Date.now() - 31 * 86_400_000 });
    const page = await composed.app.inject({ method: 'GET', url: `/m/c/${old}`, headers: { host: HOST } });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('This link is too old.');
    expect(page.body).toContain('href="https://www.meridian.example"');
    const posted = await composed.app.inject({ method: 'POST', url: `/m/c/${old}`, headers: { host: HOST, 'content-type': 'application/x-www-form-urlencoded' }, payload: 'act=confirm' });
    expect(posted.body).toContain('This link is too old.');
    expect((await answerRows('frm_keep')).find((row) => row['email'] === 'olga@old.example')!['confirm']).toBe('pending');
  });

  it.skipIf(!available)('a staff notice shows a typed <a href> and a web address as plain text', async () => {
    const sent = await send('keep-only', { qname: 'Eve', qemail: 'eve@x.example', qnote: '<a href="https://evil.example/pay">pay here</a> or www.evil.example' });
    expect(sent.statusCode, sent.body).toBe(200);
    const [notice] = await h.meta.db.selectFrom('adminium_notifications').select(['title', 'body', 'actionUrl']).where('userId', '=', repId).where('kind', '=', 'forms.answer').orderBy('createdAt', 'desc').execute();
    expect(notice!.title).toBe('New answer: Book a showroom visit');
    expect(notice!.body).toContain('Anything else?: <a href="https:​//evil.​example/pay">pay here</a>');
    expect(notice!.actionUrl).toMatch(/^\/add-ons\/forms\/forms\/keep-only\/answers\?answer=/);
    const staffMail = (await mails()).find((mail) => mail.to === 'rita@meridian.example')!;
    expect(staffMail.html).toContain('&lt;a href=');
    expect(staffMail.html).not.toMatch(/<a [^>]*href="https:\/\/evil/);
    expect(staffMail.text).not.toContain('https://evil.example');
    expect(staffMail.text).not.toContain('www.evil.example');
  });

  it.skipIf(!available)('only those the form names who may read the answer are told: no grant, or rows limited to another form, are skipped; the cap’s alert alike', async () => {
    const noticesOf = async (userId: string, kind: string) => (await h.meta.db.selectFrom('adminium_notifications').select(['actionUrl']).where('userId', '=', userId).where('kind', '=', kind).execute()).length;
    const before = { rita: await noticesOf(repId, 'forms.answer'), nils: await noticesOf(nilsId, 'forms.answer'), lea: await noticesOf(leaId, 'forms.answer') };
    const sent = await send('told', { qname: 'Tia', qemail: 'tia@told.example' });
    expect(sent.statusCode, sent.body).toBe(200);
    expect(await noticesOf(repId, 'forms.answer')).toBe(before.rita + 1);
    expect(await noticesOf(nilsId, 'forms.answer')).toBe(before.nils);
    expect(await noticesOf(leaId, 'forms.answer')).toBe(before.lea);
    const staffMail = (await mails()).map((mail) => mail.to);
    expect(staffMail).toContain('rita@meridian.example');
    expect(staffMail).not.toContain('nils@meridian.example');
    expect(staffMail).not.toContain('lea@meridian.example');

    const ip = '192.0.2.77';
    expect((await send('told-capped', { qname: 'Una', qemail: 'una@told.example' }, { ip })).statusCode).toBe(200);
    expect((await send('told-capped', { qname: 'Una', qemail: 'una@told.example' }, { ip })).statusCode).toBe(429);
    expect(await noticesOf(repId, 'forms.limit')).toBeGreaterThan(0);
    expect(await noticesOf(nilsId, 'forms.limit')).toBe(0);
    // Lea holds the read grant (limited to other rows): the alert shows no answer, so the grant is enough.
    expect(await noticesOf(leaId, 'forms.limit')).toBe(1);
  });

  it.skipIf(!available)('a hand-uploaded package that declares forms serves nothing', async () => {
    const settings = settingsRepo(h.meta);
    const recorded = await settings.get('addOns.deciderTrust');
    await settings.set('addOns.deciderTrust', {}, { updatedBy: null });
    try {
      // The catalogue keeps a lookup a few seconds, and the trust a minute: a server that starts now reads it fresh.
      const fresh = await composeServer({
        env: makeEnv({ ADMINIUM_DATA_DIR: h.dataDir, HOST: '127.0.0.1', ADMINIUM_SECRET: TEST_SECRET }),
        metaStore: { meta: h.meta, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() },
        manager: h.manager,
        runService: createRunService({ meta: h.meta }),
        applyService: createApplyService({ meta: h.meta, runService: createRunService({ meta: h.meta }) }),
        allowed: null,
        staticRoot: join(root, 'dist'),
        logger: false,
        telemetry: false,
      });
      try {
        await fresh.app.ready();
        await fresh.jobs.worker.stop();
        fresh.jobs.scheduler.stop();
        const shown = await fresh.app.inject({ method: 'GET', url: '/x/forms/api/showroom', headers: { host: HOST } });
        expect(shown.statusCode).toBe(404);
        const posted = await fresh.app.inject({ method: 'POST', url: '/x/forms/api/showroom/answers', headers: { host: HOST, origin: ORIGIN }, payload: { language: 'en-US', values: { qname: 'X' }, website: '' } });
        expect(posted.statusCode).toBe(404);
      } finally {
        await fresh.app.close();
      }
    } finally {
      await settings.set('addOns.deciderTrust', recorded, { updatedBy: null });
    }
  }, 60_000);
});
