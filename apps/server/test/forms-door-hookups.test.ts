// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE FORMS DOOR'S HOOK-UPS ON THE REAL SERVER, as a stranger sends answers
 * and staff read and erase them, over a forms add-on attached to a CRM-like
 * app (jobs, and a feedback table opened to forms), on a real database per
 * engine.
 *
 * FILES AT THE DOOR
 * - An answer naming two uploaded files attaches both and writes them into
 *   the add-on's files table; a file taken for another form or from another
 *   address refuses the whole answer, and nothing is written. A required
 *   file question works end to end.
 * - An answer whose transaction does not stand lets its files go again.
 * - Staff who read the answers open its file; staff without the grant do not.
 *
 * NAMED SURVEYS AT THE DOOR
 * - A link scanner's GET spends nothing; the page is drawn with the
 *   invitee's first name and what the survey is about.
 * - Two sends with one token: one wins, the other is "already answered".
 * - An expired or unknown token "doesn't work"; no token is "not available".
 * - The feedback row gets `job_id` from the invitation, never from the body
 *   (a forged `job_id` is refused); a job that has its feedback already is
 *   "already answered" for a second invitee, nothing written.
 * - "Link answers to names" off keeps no address, name or invitation.
 * - An anonymous survey takes no token and works like a form.
 *
 * FILES IN A PERSON'S DATA AND IN EVERY DELETION
 * - Their answers' files are found, downloaded by name and size, and erased
 *   with the answers, out of the strangers' file store too; the keeping
 *   sweep deletes an old answer's files.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parseForm, type FormDefinitionInput, type FormSettingsInput } from '@adminium/add-on-contracts/forms';
import { permissionsRepo, publicUploadsRepo, rolesRepo, settingsRepo, snapshotsRepo, usersRepo } from '@adminium/meta';

import { formsWithInvitations } from '../../../packages/manifest/test/forms-invitations-fixture.js';
import { recordDeciderTrust } from '../src/add-ons/decider-trust.js';
import { keepAddOnInstalls } from '../src/apps/table-ref.js';
import { composeServer, FORM_ANSWERS_SWEEP_NAME, type ComposedServer } from '../src/compose.js';
import { createConsentService } from '../src/consent/index.js';
import { bindWriteValue } from '../src/crud/write-values.js';
import type { LiveForm } from '../src/forms/catalog.js';
import { deleteFormAnswers } from '../src/forms/answers.js';
import type { FormsFiles } from '../src/forms/files.js';
import { createSurveyInvitations } from '../src/forms/invitation.js';
import { createFormsScopes } from '../src/forms/scope.js';
import { surveyTokenHash } from '../src/forms/survey-token.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import { personZip } from '../src/privacy/export.js';
import { findPerson } from '../src/privacy/sources.js';
import { solveProof } from '../src/public-api/proof.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { matrixRowsFromGrants } from '../src/rbac/permissions.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { FIT_OUT, published, SHOWROOM } from './forms-door.helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';
import { LEGS } from './invoicing-install.helpers.js';

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- a reply read freely

const HOST = 'forms.meridian.example';
const ORIGIN = `https://${HOST}`;
const DAY = 86_400_000;
const PDF = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n', 'latin1');
const MARTA = 'marta@cobalt.example';
const pk = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength: number, more: Record<string, unknown> = {}) => ({ ref, type: 'text', maxLength, ...more });

/** A CRM-like app: jobs, contacts, and a job's one feedback row, opened to forms (its job and contact links among the columns). */
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
        { ref: 'contacts', columns: [pk, text('name', 80), text('email', 254, { nullable: true })] },
        { ref: 'jobs', columns: [pk, text('title', 120)] },
        // A table the forms entry links nothing to: an invitation naming one of its rows reads nothing of it.
        { ref: 'secrets', columns: [pk, text('title', 120)] },
        {
          ref: 'feedback',
          columns: [
            pk,
            { ref: 'job_id', type: 'fk', references: 'jobs', unique: true },
            { ref: 'contact_id', type: 'fk', references: 'contacts', nullable: true },
            // A link the forms entry does not open: its table is no invitation's to name.
            { ref: 'secret_id', type: 'fk', references: 'secrets', nullable: true },
            { ref: 'score', type: 'int', nullable: true, rules: { validation: { min: 1, max: 5 } } },
            text('text', 1000, { nullable: true }),
            { ref: 'answered_on', type: 'date', rules: { stamp: { set: 'today', on: 'create' } } },
          ],
        },
      ],
    },
    publicAccess: [{ table: 'feedback', methods: ['POST'], key: 'forms', writable: ['job_id', 'contact_id', 'score', 'text'], anonymous: { plainText: ['text'] } }],
    pages: [{ ref: 'crm-jobs', template: 'page-crud', title: { key: 't', fallback: 'Jobs' }, nav: { group: 'crm', icon: 'home', order: 1 }, bindings: { rows: 'jobs' } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
  };
}

/** The showroom form with its file question required. */
const SHOWROOM_FILES_REQUIRED: FormDefinitionInput = { ...SHOWROOM, questions: SHOWROOM.questions.map((question) => (question.id === 'qfiles' ? { ...question, required: true } : question)) } as FormDefinitionInput;
const KEEP: FormSettingsInput = { limits: { perHour: 500, harder: false }, tell: [{ kind: 'role', id: 'super-admin' }] };

describe.each(LEGS)('the forms door’s hook-ups — %s', (dialect, available) => {
  let h: Harness;
  let composed: ComposedServer;
  let root: string;
  let formsFiles: FormsFiles;
  let views: ReturnType<typeof createPublicViews>;
  const names: Record<string, string> = {};
  const ids: Record<string, string> = {};
  let owner = '';
  let reader = '';
  let other = '';
  let signIns = 0;
  let seq = 0;
  let invites = 0;
  /** The jobs table's stored name, as a record tab and an invitation hold it. */
  let jobsStored = '';
  let secretsStored = '';

  const count = async (table: string, where = '1=1') => Number((await h.rows(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`))[0]!['n']);
  const nextIp = () => {
    seq += 1;
    return `198.51.100.${String(seq % 250)}`;
  };

  async function insert(ref: string, values: Record<string, unknown>): Promise<void> {
    const view = (await views.viewFor(h.connectionId))!;
    const table = view.table(names[ref]!);
    const { db } = await h.manager.data(h.connectionId);
    const bound = Object.fromEntries(Object.entries(values).map(([column, value]) => [column, value === null ? null : bindWriteValue(table.columns.get(column)!, value, dialect)]));
    await db.insertInto(table.id as never).values(bound as never).execute();
  }

  /** An invitation to a survey about a job, with its token; `at`: when it was sent. */
  async function invite(form: string, job: number | null, opts: { email?: string; name?: string; at?: number; days?: number; table?: string } = {}): Promise<{ id: string; token: string }> {
    invites += 1;
    const id = `inv_${String(invites)}`;
    const token = `${'T'.repeat(26)}${String(invites).padStart(6, '0')}`;
    const at = opts.at ?? Date.now() - DAY;
    await insert('invitations', {
      id,
      form_id: form,
      email: opts.email ?? MARTA,
      name: opts.name ?? 'Marta Kovac',
      language: 'en-US',
      person_table: 'crm:contacts',
      person_key: '1',
      record_table: job === null ? null : (opts.table ?? jobsStored),
      record_key: job === null ? null : String(job),
      token_hash: surveyTokenHash(token),
      class: 'service',
      invited_at: new Date(at).toISOString(),
      expires_at: new Date(at + (opts.days ?? 30) * DAY).toISOString(),
    });
    return { id, token };
  }
  const invitation = async (id: string) => (await h.rows(`SELECT * FROM ${names['invitations']!} WHERE id = '${id}'`))[0]!;

  async function signIn(email: string): Promise<string> {
    signIns += 1;
    const res = await composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.9.0.${String(signIns)}`, payload: { email, password: ADMIN_PASSWORD } });
    expect(res.statusCode, res.body).toBe(200);
    return sessionCookie(res.headers['set-cookie']);
  }

  async function person(email: string, grants: string[], slug?: string): Promise<string> {
    const user = await usersRepo(h.meta).create({ email, name: email.split('@')[0]!, passwordHash: await adminPasswordHash() });
    const role = slug === undefined ? await rolesRepo(h.meta).create({ slug: `own-${email.split('@')[0]!}`, name: 'Own' }) : (await rolesRepo(h.meta).findBySlug(slug))!;
    for (const row of matrixRowsFromGrants(grants).rows) await permissionsRepo(h.meta).grant(role.id, row.resourceKind, row.resourceRef, row.actions as never);
    await rolesRepo(h.meta).assignToUser(user.id, role.id);
    return signIn(email);
  }

  const challengeOf = async (slug: string, ip: string, token?: string) =>
    (await composed.app.inject({ method: 'GET', url: `/x/forms/api/${slug}/challenge${token === undefined ? '' : `?t=${token}`}`, headers: { host: HOST }, remoteAddress: ip })).json() as Doc;
  const proofOf = (challenge: Doc) => (typeof challenge.salt === 'string' ? `${challenge.id as string}.${solveProof(challenge.salt, challenge.difficulty as number)}` : 'none');

  /** A file uploaded through the file door for the form at `slug`, from `ip`. */
  async function upload(slug: string, ip: string, token?: string): Promise<string> {
    const proof = proofOf(await challengeOf(slug, ip, token));
    const reply = await composed.app.inject({
      method: 'POST',
      url: `/x/forms/api/${slug}/files?q=qfiles&name=plan.pdf${token === undefined ? '' : `&t=${token}`}`,
      remoteAddress: ip,
      headers: { host: HOST, origin: ORIGIN, 'content-type': 'application/octet-stream', 'x-adminium-proof': proof },
      payload: PDF,
    });
    expect(reply.statusCode, reply.body).toBe(200);
    return (reply.json() as { id: string }).id;
  }

  /** A stranger's send: a fresh proof for the form (with the token, for a named survey), then the answer. */
  async function send(slug: string, values: Record<string, unknown>, opts: { ip?: string; t?: string } = {}) {
    const ip = opts.ip ?? nextIp();
    const proof = proofOf(await challengeOf(slug, ip, opts.t));
    return composed.app.inject({
      method: 'POST',
      url: `/x/forms/api/${slug}/answers`,
      remoteAddress: ip,
      headers: { host: HOST, origin: ORIGIN, 'x-adminium-proof': proof, 'user-agent': 'Mozilla/5.0 test' },
      payload: { language: 'en-US', values, query: {}, website: '', ...(opts.t === undefined ? {} : { t: opts.t }) },
    });
  }
  const open = async (slug: string, t?: string) => composed.app.inject({ method: 'GET', url: `/x/forms/api/${slug}${t === undefined ? '' : `?t=${t}`}`, headers: { host: HOST } });
  const answersOf = async (form: string) => (await h.rows(`SELECT * FROM ${names['answers']!} WHERE form_id = '${form}' ORDER BY submitted_at`)) as Doc[];
  const fileRowsOf = async (answer: string) => (await h.rows(`SELECT * FROM ${names['answer_files']!} WHERE answer_id = '${answer}' ORDER BY file_id`)) as Doc[];
  const feedback = async () => (await h.rows(`SELECT * FROM crm_feedback ORDER BY id`)) as Doc[];

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageApp(crm());
    const app = await h.install('crm', '1.0.0');
    expect(app.statusCode, app.body).toBe(200);
    await h.stageAddOn(formsWithInvitations(), { bundled: true });
    const added = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'forms', version: '1.0.0', attachTo: ['crm'] } });
    expect(added.statusCode, added.body).toBe(200);
    // Vouched for as a bundled package is: its bytes recorded as trusted (a package nobody vouches for serves no form).
    await recordDeciderTrust(h.meta, { key: 'forms', version: '1.0.0', integrity: (await h.addOnStore.verifyTree('forms', '1.0.0')).integrity });
    for (const record of await h.meta.db.selectFrom('adminium_app_tables').select(['ref', 'tableName']).where('appKey', '=', 'forms').execute()) names[record.ref] = record.tableName;
    views = createPublicViews(h.meta);
    const view = (await views.viewFor(h.connectionId))!;
    for (const ref of ['answers', 'answer_files', 'forms']) ids[ref] = view.table(names[ref]!).id;
    ids['feedback'] = view.table('crm_feedback').id;
    const installs = await keepAddOnInstalls(h.meta, async (connectionId) => ((await snapshotsRepo(h.meta).latest(connectionId))?.schema as { tables: { id: string; name: string }[] } | undefined) ?? null).fresh();
    jobsStored = installs.refOf(h.connectionId, view.table('crm_jobs').id);
    secretsStored = installs.refOf(h.connectionId, view.table('crm_secrets').id);

    const { db } = await h.manager.data(h.connectionId);
    await db.insertInto('crm_contacts').values({ id: 1, name: 'Marta Kovac', email: MARTA } as never).execute();
    for (const [id, title] of [
      [7, 'Records-room fit-out at Cobalt Legal'],
      [8, 'Reception desks at Harbour'],
      [9, 'Meeting booths at Linden'],
      [10, 'Quiet room at Linden'],
    ] as const) {
      await db.insertInto('crm_jobs').values({ id, title } as never).execute();
    }
    await db.insertInto('crm_secrets').values({ id: 7, title: 'Pay rise for Bo' } as never).execute();

    const named = (linkNames: boolean, becomes: FormSettingsInput['becomes'] = null): FormSettingsInput => ({ survey: { mode: 'named', linkNames, stopAfterDays: 30 }, becomes, limits: { perHour: 500, harder: false } });
    const forms: [string, string, string, FormDefinitionInput, FormSettingsInput][] = [
      ['frm_show', 'showroom-visit', 'form', SHOWROOM, KEEP],
      ['frm_other', 'other-visit', 'form', SHOWROOM, KEEP],
      ['frm_needs', 'needs-drawings', 'form', SHOWROOM_FILES_REQUIRED, KEEP],
      ['frm_fit', 'fit-out', 'survey', FIT_OUT, { ...named(true, { table: ids['feedback']!, map: { qday: 'score', qdiff: 'text' } }), tell: [{ kind: 'role', id: 'super-admin' }] }],
      ['frm_cap', 'capped', 'form', SHOWROOM, { limits: { perHour: 1, harder: false }, tell: [{ kind: 'role', id: 'super-admin' }] }],
      ['frm_quiet', 'quiet-survey', 'survey', FIT_OUT, named(false)],
      ['frm_open', 'open-survey', 'survey', FIT_OUT, { survey: { mode: 'anonymous', linkNames: false }, limits: { perHour: 500, harder: false } }],
    ];
    for (const [id, slug, kind, definition, settings] of forms) {
      await insert('forms', { id, title: slug, slug, kind, state: 'live', definition: '{}', settings: '{}', published: published(definition, settings) });
    }

    const settings = settingsRepo(h.meta);
    await settings.set('system.publicOrigin', ORIGIN, { updatedBy: null });
    await settings.set('system.instanceId', 'install-1', { updatedBy: null });
    await settings.set('privacy.businessName', 'Meridian Workplace Ltd', { updatedBy: null });
    await settings.set('privacy.noticeUrl', 'https://www.meridian.example/privacy', { updatedBy: null });

    root = await mkdtemp(join(tmpdir(), 'forms-hookups-'));
    await mkdir(join(root, 'x'), { recursive: true });
    await writeFile(join(root, 'index.html'), '<!doctype html><html><body></body></html>');
    await writeFile(join(root, 'x', 'index.html'), '<!doctype html><html><body><noscript>x</noscript></body></html>');
    const runService = createRunService({ meta: h.meta });
    composed = await composeServer({
      env: makeEnv({ ADMINIUM_DATA_DIR: h.dataDir, HOST: '127.0.0.1', ADMINIUM_SECRET: TEST_SECRET }),
      metaStore: { meta: h.meta, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() },
      manager: h.manager,
      runService,
      applyService: createApplyService({ meta: h.meta, runService }),
      allowed: null,
      staticRoot: root,
      logger: false,
      telemetry: false,
    });
    await composed.app.ready();
    await composed.addOnsLoaded;
    await composed.jobs.worker.stop();
    composed.jobs.scheduler.stop();
    formsFiles = (composed.app as unknown as { formsFiles: FormsFiles }).formsFiles;

    owner = await person('boss@meridian.example', [], 'super-admin');
    reader = await person('marketer@meridian.example', [`table:${h.connectionId}:${ids['answers']!}:read`, `table:${h.connectionId}:${ids['answer_files']!}:read`]);
    // Reads the forms, never their answers.
    other = await person('builder@meridian.example', [`table:${h.connectionId}:${ids['forms']!}:read`]);
  }, 240_000);

  afterAll(async () => {
    if (!available) return;
    await composed?.app.close();
    await h?.close();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  // ── Files at the door ─────────────────────────────────────────────────────

  it.skipIf(!available)('an answer naming two uploaded files attaches both; staff who read answers open one, staff without the grant do not', async () => {
    const ip = nextIp();
    const first = await upload('showroom-visit', ip);
    const second = await upload('showroom-visit', ip);
    const sent = await send('showroom-visit', { qname: 'Marta Kovac', qemail: MARTA, qfiles: [first, second] }, { ip });
    expect(sent.statusCode, sent.body).toBe(200);
    const answer = (await answersOf('frm_show')).at(-1)!;
    const key = String(answer['id']);
    const rows = await fileRowsOf(key);
    expect(rows.map((row) => String(row['file_id'])).sort()).toEqual([first, second].sort());
    expect(rows.map((row) => ({ question: row['question'], name: row['name'], size: Number(row['size']), kind: row['kind'] }))).toEqual([
      { question: 'qfiles', name: 'plan.pdf', size: PDF.length, kind: 'pdf' },
      { question: 'qfiles', name: 'plan.pdf', size: PDF.length, kind: 'pdf' },
    ]);
    for (const id of [first, second]) expect((await publicUploadsRepo(h.meta).findById(id))?.owner).toEqual({ connectionId: h.connectionId, table: ids['answers'], key });

    for (const cookie of [owner, reader]) {
      const got = await composed.app.inject({ method: 'GET', url: `/api/v1/forms/files/${first}`, headers: { cookie } });
      expect(got.statusCode, got.body).toBe(200);
      expect(got.rawPayload.equals(PDF)).toBe(true);
    }
    expect((await composed.app.inject({ method: 'GET', url: `/api/v1/forms/files/${first}`, headers: { cookie: other } })).statusCode).toBe(403);
  });

  it.skipIf(!available)('a file taken for another form, or from another address, refuses the whole answer and writes nothing', async () => {
    const ip = nextIp();
    const mine = await upload('showroom-visit', ip);
    const forOther = await upload('other-visit', ip);
    const elsewhere = await upload('showroom-visit', nextIp());
    const before = await count(names['answers']!);
    const filesBefore = await count(names['answer_files']!);
    for (const files of [
      [mine, forOther],
      [mine, elsewhere],
    ]) {
      const sent = await send('showroom-visit', { qname: 'Marta Kovac', qemail: MARTA, qfiles: files }, { ip });
      expect(sent.statusCode, sent.body).toBe(400);
      expect(sent.json()).toEqual({ state: 'refused', errors: { qfiles: 'file' } });
    }
    expect(await count(names['answers']!)).toBe(before);
    expect(await count(names['answer_files']!)).toBe(filesBefore);
    // Nothing was attached: the stranger's own file is theirs to send again.
    for (const id of [mine, forOther, elsewhere]) expect((await publicUploadsRepo(h.meta).findById(id))?.owner).toBeNull();
    const again = await send('showroom-visit', { qname: 'Marta Kovac', qemail: MARTA, qfiles: [mine] }, { ip });
    expect(again.statusCode, again.body).toBe(200);
  });

  it.skipIf(!available)('a required file question works end to end', async () => {
    const ip = nextIp();
    const none = await send('needs-drawings', { qname: 'Ann Lee', qemail: 'ann@linden.example' }, { ip });
    expect(none.statusCode).toBe(400);
    expect(none.json()).toEqual({ state: 'refused', errors: { qfiles: 'required' } });
    const file = await upload('needs-drawings', ip);
    const sent = await send('needs-drawings', { qname: 'Ann Lee', qemail: 'ann@linden.example', qfiles: [file] }, { ip });
    expect(sent.statusCode, sent.body).toBe(200);
    expect(await fileRowsOf(String((await answersOf('frm_needs')).at(-1)!['id']))).toHaveLength(1);
  });

  it.skipIf(!available)('an answer whose transaction does not stand lets its files go again', async () => {
    const ip = nextIp();
    const file = await upload('showroom-visit', ip);
    const before = await count(names['answers']!);
    const attach = formsFiles.attachToAnswer;
    // The files attached, then the transaction fails after them.
    formsFiles.attachToAnswer = async (input) => {
      await attach(input);
      throw new Error('the disk filled up');
    };
    try {
      const sent = await send('showroom-visit', { qname: 'Marta Kovac', qemail: MARTA, qfiles: [file] }, { ip });
      expect(sent.statusCode).toBe(500);
    } finally {
      formsFiles.attachToAnswer = attach;
    }
    expect(await count(names['answers']!)).toBe(before);
    expect((await h.rows(`SELECT file_id FROM ${names['answer_files']!} WHERE file_id = '${file}'`)).length).toBe(0);
    expect((await publicUploadsRepo(h.meta).findById(file))?.owner).toBeNull();
    const again = await send('showroom-visit', { qname: 'Marta Kovac', qemail: MARTA, qfiles: [file] }, { ip });
    expect(again.statusCode, again.body).toBe(200);
  });

  // ── Named surveys ─────────────────────────────────────────────────────────

  it.skipIf(!available)('a link scanner’s GET spends nothing; the page greets the invitee and says what the survey is about; no token is not available', async () => {
    const { id, token } = await invite('frm_fit', 10);
    const before = await invitation(id);
    for (let round = 0; round < 3; round += 1) {
      const page = await open('fit-out', token);
      expect(page.statusCode, page.body).toBe(200);
      expect(page.json()).toMatchObject({ state: 'live', invitation: { firstName: 'Marta', about: 'Quiet room at Linden' } });
      expect((await composed.app.inject({ method: 'GET', url: `/x/forms/fit-out?t=${token}`, headers: { host: HOST } })).statusCode).toBe(200);
    }
    expect(await invitation(id)).toEqual(before);
    expect((await open('fit-out')).statusCode).toBe(404);
    expect((await open('fit-out')).json()).toMatchObject({ state: 'unavailable' });
    // The challenge and the file door are the form's only with the token.
    expect((await challengeOf('fit-out', nextIp())).salt).toBeTypeOf('string');
    const noToken = await composed.app.inject({ method: 'POST', url: '/x/forms/api/fit-out/files?q=qfiles', headers: { host: HOST, origin: ORIGIN, 'content-type': 'application/octet-stream' }, payload: PDF });
    expect(noToken.statusCode).toBe(404);
    const withToken = await composed.app.inject({ method: 'POST', url: `/x/forms/api/fit-out/files?q=qfiles&t=${token}`, headers: { host: HOST, origin: ORIGIN, 'content-type': 'application/octet-stream' }, payload: PDF });
    // The survey has no file question: the door got as far as asking which.
    expect(withToken.statusCode).toBe(400);
  });

  it.skipIf(!available)('an invitation naming a row of a table no forms entry links to says nothing of it and fills nothing', async () => {
    const { token } = await invite('frm_fit', 7, { table: secretsStored });
    const page = await open('fit-out', token);
    expect(page.statusCode, page.body).toBe(200);
    expect(page.json()).toMatchObject({ state: 'live', invitation: { firstName: 'Marta', about: null } });
    expect(page.body).not.toContain('Pay rise');
    // Nothing fills the job's link: the feedback row cannot be made, so nothing is.
    const before = await count('crm_feedback');
    const sent = await send('fit-out', { qnps: 9, qday: 4, qdiff: 'Fine.' }, { t: token });
    expect(sent.statusCode).not.toBe(200);
    expect(await count('crm_feedback')).toBe(before);
    // On a survey that becomes no row, the same: a job is linked to, a secret is not.
    expect((await open('quiet-survey', (await invite('frm_quiet', 7, { table: secretsStored })).token)).json()).toMatchObject({ state: 'live', invitation: { about: null } });
    expect((await open('quiet-survey', (await invite('frm_quiet', 10)).token)).json()).toMatchObject({ state: 'live', invitation: { about: 'Quiet room at Linden' } });
  });

  it.skipIf(!available)('the answer fills the job’s feedback from the invitation; the same token again is already answered', async () => {
    const { id, token } = await invite('frm_fit', 7);
    const sent = await send('fit-out', { qnps: 9, qday: 4, qdiff: 'Fewer cables.' }, { t: token });
    expect(sent.statusCode, sent.body).toBe(200);
    expect(sent.json()).toMatchObject({ state: 'sent' });
    const made = (await feedback()).filter((row) => Number(row['job_id']) === 7);
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ score: 4, text: 'Fewer cables.', contact_id: null });
    expect(made[0]!['answered_on']).not.toBeNull();
    const answer = (await answersOf('frm_fit')).find((row) => row['invitation_id'] === id)!;
    expect(answer).toMatchObject({ email: MARTA, name: 'Marta Kovac', became_table: 'crm:feedback', became_key: String(made[0]!['id']) });
    expect((await invitation(id))['answered_at']).not.toBeNull();

    const answersBefore = await count(names['answers']!);
    const twice = await send('fit-out', { qnps: 2 }, { t: token });
    expect(twice.statusCode).toBe(409);
    expect(twice.json()).toEqual({ state: 'already' });
    expect((await open('fit-out', token)).json()).toMatchObject({ state: 'already' });
    expect(await count(names['answers']!)).toBe(answersBefore);
    expect((await feedback()).filter((row) => Number(row['job_id']) === 7)).toHaveLength(1);
  });

  it.skipIf(!available)('two sends with one token at once: one wins, the other is already answered', async () => {
    const { id, token } = await invite('frm_quiet', null);
    const replies = await Promise.all([send('quiet-survey', { qnps: 7 }, { t: token }), send('quiet-survey', { qnps: 8 }, { t: token })]);
    expect(replies.map((reply) => reply.statusCode).sort()).toEqual([200, 409]);
    expect((await invitation(id))['answered_at']).not.toBeNull();
    expect(await count(names['answers']!, `form_id = 'frm_quiet'`)).toBe(1);
  });

  it.skipIf(!available)('an invitation found open but answered before its send is spent once: the second spend changes nothing', async () => {
    const { id, token } = await invite('frm_quiet', null);
    const installs = keepAddOnInstalls(h.meta, async (connectionId) => ((await snapshotsRepo(h.meta).latest(connectionId))?.schema as { tables: { id: string; name: string }[] } | undefined) ?? null);
    const invitations = createSurveyInvitations({ installs: () => installs.fresh(), viewFor: (connectionId) => views.viewFor(connectionId), data: (connectionId) => h.manager.data(connectionId), scopes: createFormsScopes({ meta: h.meta, modelOf: async (connectionId) => ((await snapshotsRepo(h.meta).latest(connectionId))?.schema as { tables: { id: string; name: string }[] } | undefined) ?? null }) });
    const parsed = parseForm(FIT_OUT, { survey: { mode: 'named', linkNames: false }, limits: { perHour: 500, harder: false } });
    if (!parsed.ok) throw new Error('the survey does not parse');
    const live: LiveForm = { id: 'frm_quiet', slug: 'quiet-survey', addOn: 'forms', connectionId: h.connectionId, form: parsed.form };
    const found = await invitations.find(live, token, Date.now());
    expect(found.state).toBe('open');
    if (found.state !== 'open') return;
    const { db, dialect: on } = await h.manager.data(h.connectionId);
    expect(await invitations.spend(db, on, found.invitation, Date.now())).toBe(true);
    const spentAt = (await invitation(id))['answered_at'];
    expect(await invitations.spend(db, on, found.invitation, Date.now() + DAY)).toBe(false);
    expect((await invitation(id))['answered_at']).toEqual(spentAt);
  });

  it.skipIf(!available)('a job with its feedback already is already answered for a second invitee; a forged job_id in the body is refused', async () => {
    await send('fit-out', { qnps: 9, qday: 5 }, { t: (await invite('frm_fit', 8)).token });
    const second = await invite('frm_fit', 8, { email: 'bob@harbour.example', name: 'Bob Harbour' });
    const before = await count(names['answers']!);
    const again = await send('fit-out', { qnps: 3, qday: 1 }, { t: second.token });
    expect(again.statusCode, again.body).toBe(409);
    expect(again.json()).toEqual({ state: 'already' });
    expect(await count(names['answers']!)).toBe(before);
    expect((await invitation(second.id))['answered_at']).toBeNull();
    expect((await feedback()).filter((row) => Number(row['job_id']) === 8).map((row) => row['score'])).toEqual([5]);

    const forging = await invite('frm_fit', 9);
    const forged = await send('fit-out', { qnps: 9, qday: 2, job_id: 7 }, { t: forging.token });
    expect(forged.statusCode).toBe(400);
    expect((forged.json() as Doc).state).toBe('refused');
    expect((await invitation(forging.id))['answered_at']).toBeNull();
    expect((await feedback()).filter((row) => Number(row['job_id']) === 9)).toEqual([]);
  });

  it.skipIf(!available)('an expired or unknown token does not work, by GET or by send', async () => {
    const expired = await invite('frm_fit', 9, { at: Date.now() - 40 * DAY });
    // A token is its own survey's only.
    const elsewhere = await invite('frm_quiet', null);
    for (const token of [expired.token, 'U'.repeat(32), elsewhere.token]) {
      const page = await open('fit-out', token);
      expect(page.statusCode).toBe(200);
      expect(page.json()).toMatchObject({ state: 'dead' });
      expect((await composed.app.inject({ method: 'GET', url: `/x/forms/fit-out?t=${token}`, headers: { host: HOST } })).statusCode).toBe(404);
      const sent = await send('fit-out', { qnps: 9 }, { t: token });
      expect([sent.statusCode, sent.json()]).toEqual([410, { state: 'dead' }]);
    }
    expect((await invitation(expired.id))['answered_at']).toBeNull();
    expect((await invitation(elsewhere.id))['answered_at']).toBeNull();
  });

  it.skipIf(!available)('"Link answers to names" off keeps no address, name or invitation on the answer; the page greets nobody', async () => {
    const { id, token } = await invite('frm_quiet', 10);
    expect((await open('quiet-survey', token)).json()).toMatchObject({ state: 'live', invitation: { firstName: null, about: 'Quiet room at Linden' }, form: { anonymous: true } });
    const sent = await send('quiet-survey', { qnps: 6 }, { t: token });
    expect(sent.statusCode, sent.body).toBe(200);
    const answer = (await answersOf('frm_quiet')).at(-1)!;
    expect(answer).toMatchObject({ email: null, name: null, invitation_id: null });
    expect((await invitation(id))['answered_at']).not.toBeNull();
  });

  it.skipIf(!available)('an anonymous survey takes no token and works like a form', async () => {
    expect((await open('open-survey')).json()).toMatchObject({ state: 'live', form: { anonymous: true } });
    const sent = await send('open-survey', { qnps: 10 });
    expect(sent.statusCode, sent.body).toBe(200);
    expect((await answersOf('frm_open')).at(-1)).toMatchObject({ email: null, invitation_id: null });
  });

  it.skipIf(!available)('an invitation names its record by the table’s stored name; a ref or a label names nothing', async () => {
    // The stored name is the maker's, as a record tab reads it.
    expect(jobsStored).toBe('crm:jobs');
    for (const table of ['jobs', 'Jobs', 'crm_jobs_x']) {
      const { token } = await invite('frm_quiet', 10, { table });
      expect((await open('quiet-survey', token)).json()).toMatchObject({ state: 'live', invitation: { about: null } });
    }
  });

  // ── Staff links ───────────────────────────────────────────────────────────

  it.skipIf(!available)('every staff link opens the forms add-on\'s page, whose ref is its key: then the form, or surveys and the survey', async () => {
    const pageOf = (url: string) => {
      const [path = '', query = ''] = url.split('?');
      const [, root, addOn, page, ...rest] = path.split('/');
      return { root, addOn, page, rest, query };
    };
    const notices = async (kind: string) => (await h.meta.db.selectFrom('adminium_notifications').select(['actionUrl']).where('kind', '=', kind).execute()).map((row) => row.actionUrl!);

    const sent = await send('showroom-visit', { qname: 'Ann Lee', qemail: 'ann@linden.example' });
    expect(sent.statusCode, sent.body).toBe(200);
    const answered = String((await answersOf('frm_show')).at(-1)!['id']);
    const formLink = (await notices('forms.answer')).find((url) => url.includes(answered))!;
    expect(pageOf(formLink)).toEqual({ root: 'add-ons', addOn: 'forms', page: 'forms', rest: ['showroom-visit', 'answers'], query: `answer=${answered}` });

    const survey = await send('fit-out', { qnps: 4 }, { t: (await invite('frm_fit', 10)).token });
    expect(survey.statusCode, survey.body).toBe(200);
    const surveyed = String((await answersOf('frm_fit')).at(-1)!['id']);
    const surveyLink = (await notices('forms.answer')).find((url) => url.includes(surveyed))!;
    expect(pageOf(surveyLink)).toEqual({ root: 'add-ons', addOn: 'forms', page: 'forms', rest: ['surveys', 'fit-out', 'results'], query: `answer=${surveyed}` });
    // The very links the dashboard's page host is shown to open on the add-on's own page (`addOnPageHost.test.tsx`).
    expect(surveyLink).toBe(`/add-ons/forms/forms/surveys/fit-out/results?answer=${surveyed}`);
    expect(formLink).toBe(`/add-ons/forms/forms/showroom-visit/answers?answer=${answered}`);

    const ip = nextIp();
    expect((await send('capped', { qname: 'Bo Ek', qemail: 'bo@linden.example' }, { ip })).statusCode).toBe(200);
    expect((await send('capped', { qname: 'Bo Ek', qemail: 'bo@linden.example' }, { ip })).statusCode).toBe(429);
    const limits = (await h.meta.db.selectFrom('adminium_notifications').select(['actionUrl']).where('actionUrl', 'like', '%settings=limits').execute()).map((row) => row.actionUrl!);
    expect(limits.length).toBeGreaterThan(0);
    for (const url of limits) expect(pageOf(url)).toEqual({ root: 'add-ons', addOn: 'forms', page: 'forms', rest: ['capped'], query: 'settings=limits' });
  });

  // ── Files in a person's data and in every deletion ────────────────────────

  it.skipIf(!available)('their answers’ files are found and downloaded by name and size, and erased with the answers, out of the store too', async () => {
    const ip = nextIp();
    const file = await upload('other-visit', ip);
    const sent = await send('other-visit', { qname: 'Cy Dunn', qemail: 'cy@harbour.example', qfiles: [file] }, { ip });
    expect(sent.statusCode, sent.body).toBe(200);
    const key = String((await answersOf('frm_other')).at(-1)!['id']);
    const bytes = (await publicUploadsRepo(h.meta).findById(file))!.fileId!;

    const deps = { meta: h.meta, manager: h.manager, consent: createConsentService({ meta: h.meta, secret: TEST_SECRET }) };
    const found = await findPerson(deps, 'Cy@Harbour.example');
    expect(found.sources.find((one) => one.kind === 'form-files')).toMatchObject({ id: 'form-files-forms', group: 'gave', count: 1, app: 'forms' });
    const zip = unzipSync(personZip(found, Date.now()));
    expect(JSON.parse(strFromU8(zip['form-files-forms.json']!))).toEqual([expect.objectContaining({ answer_id: key, question: 'qfiles', name: 'plan.pdf', kind: 'pdf' })]);
    expect(strFromU8(zip['form-files-forms.json']!)).not.toContain(file);

    const preview = await composed.app.inject({ method: 'POST', url: '/api/v1/privacy/erase/preview', headers: { cookie: owner }, payload: { address: 'cy@harbour.example' } });
    expect(preview.statusCode, preview.body).toBe(200);
    expect((preview.json() as Doc).data.goes).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'form-files', count: 1, app: 'forms' })]));
    const erased = await composed.app.inject({ method: 'POST', url: '/api/v1/privacy/erase', headers: { cookie: owner }, payload: { address: 'cy@harbour.example', confirm: 'cy@harbour.example' } });
    expect(erased.statusCode, erased.body).toBe(200);
    expect((erased.json() as Doc).data.counts).toMatchObject({ 'form-answers-forms': 1, 'form-files-forms': 1 });
    expect(await count(names['answers']!, `id = '${key}'`)).toBe(0);
    expect(await fileRowsOf(key)).toEqual([]);
    expect(await publicUploadsRepo(h.meta).findById(file)).toBeNull();
    expect(await h.meta.db.selectFrom('adminium_files').select('id').where('id', '=', bytes).executeTakeFirst()).toBeUndefined();
  });

  it.skipIf(!available)('an answer’s file rows go with it even when the store cannot be told: the link to the answer never blocks its delete', async () => {
    await insert('answers', { id: 'ans_bare', form_id: 'frm_show', submitted_at: new Date().toISOString(), language: 'en-US', values: '{}', confirm: 'none' });
    await insert('answer_files', { id: 'fil_bare', answer_id: 'ans_bare', file_id: 'x'.repeat(32), question: 'qfiles', name: 'plan.pdf', size: 10, kind: 'pdf', uploaded_at: new Date().toISOString() });
    const view = (await views.viewFor(h.connectionId))!;
    const { db } = await h.manager.data(h.connectionId);
    const gone = await deleteFormAnswers({ db, answers: view.table(names['answers']!), files: view.table(names['answer_files']!), connectionId: h.connectionId, addOn: 'forms' }, ['ans_bare']);
    expect(gone).toEqual({ answers: 1, files: 0 });
    expect(await fileRowsOf('ans_bare')).toEqual([]);
  });

  it.skipIf(!available)('the keeping sweep deletes an old answer with its files', async () => {
    const ip = nextIp();
    const file = await upload('showroom-visit', ip);
    const old = 'ans_old_files';
    await insert('answers', { id: old, form_id: 'frm_show', submitted_at: new Date(Date.now() - 300 * DAY).toISOString(), language: 'en-US', values: '{}', confirm: 'none' });
    const parsed = parseForm(SHOWROOM, KEEP);
    if (!parsed.ok) throw new Error('the showroom form does not parse');
    expect(await formsFiles.attachToAnswer({ live: { id: 'frm_show', slug: 'showroom-visit', addOn: 'forms', connectionId: h.connectionId, form: parsed.form }, ip, answerKey: old, files: [{ question: 'qfiles', ids: [file] }] })).not.toBeNull();
    expect(await fileRowsOf(old)).toHaveLength(1);
    await h.rows(`UPDATE ${names['forms_settings']!} SET answers_months = 6`);

    await composed.jobs.scheduler.trigger(FORM_ANSWERS_SWEEP_NAME);
    for (let round = 0; round < 5; round += 1) {
      await h.meta.db.updateTable('adminium_jobs').set({ runAt: 0 } as never).where('status', '=', 'pending' as never).execute();
      if ((await composed.jobs.worker.runOnce()) === 0) break;
    }
    expect(await count(names['answers']!, `id = '${old}'`)).toBe(0);
    expect(await fileRowsOf(old)).toEqual([]);
    expect(await publicUploadsRepo(h.meta).findById(file)).toBeNull();
    // The recent answers stay.
    expect(await count(names['answers']!, `form_id = 'frm_show'`)).toBeGreaterThan(0);
  });
});
