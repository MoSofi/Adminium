// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A FORM'S FILES ON THE REAL SERVER, over a forms add-on installed on a real
 * database per engine:
 *
 * - a file a stranger uploads through the file door is attached by the
 *   answer that names it (the door's seam, `formsFiles.attachToAnswer`), and
 *   written into the add-on's files table; a file taken for another form, or
 *   from another address, refuses the whole answer;
 * - staff who read the add-on's answers open it, as a download; staff
 *   without that grant, and a stranger, are refused; a file no answer took
 *   is nobody's;
 * - deleting an answer (one, or several at once) removes its files: the
 *   add-on's rows, the bytes and the store's rows; deleting a form removes
 *   every file taken for it.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parseForm } from '@adminium/add-on-contracts/forms';
import { parseDatabaseModel } from '@adminium/engine';
import { permissionsRepo, publicUploadsRepo, rolesRepo, settingsRepo, snapshotsRepo, usersRepo } from '@adminium/meta';

import { formsAddOn } from '../../../packages/manifest/test/forms-fixture.js';
import { recordDeciderTrust } from '../src/add-ons/decider-trust.js';
import { composeServer, type ComposedServer } from '../src/compose.js';
import type { LiveForm } from '../src/forms/catalog.js';
import type { FormsFiles } from '../src/forms/files.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import { solveProof } from '../src/public-api/proof.js';
import { matrixRowsFromGrants } from '../src/rbac/permissions.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { published, SHOWROOM, SHOWROOM_SETTINGS, words } from './forms-door.helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';
import { LEGS } from './invoicing-install.helpers.js';

const HOST = 'forms.meridian.example';
const ORIGIN = `https://${HOST}`;
const PDF = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n', 'latin1');

describe.each(LEGS)('a form’s files on the real server — %s', (dialect, available) => {
  let h: Harness;
  let composed: ComposedServer;
  let root: string;
  let formsFiles: FormsFiles;
  const table = { forms: '', answers: '', files: '' };
  let owner = '';
  let reader = '';
  let other = '';
  let signIns = 0;

  const liveOf = (id: string): LiveForm => {
    const parsed = parseForm(SHOWROOM, SHOWROOM_SETTINGS);
    if (!parsed.ok) throw new Error('the showroom form does not parse');
    return { id, slug: id, addOn: 'forms', connectionId: h.connectionId, form: parsed.form };
  };

  async function signIn(email: string): Promise<string> {
    signIns += 1;
    const res = await composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.8.0.${String(signIns)}`, payload: { email, password: ADMIN_PASSWORD } });
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

  /** A file uploaded through the file door, from `ip`, for the form at `slug`. */
  async function upload(slug: string, ip = '127.0.0.1', body: Buffer = PDF): Promise<string> {
    const challenge = (await composed.app.inject({ method: 'GET', url: `/x/forms/api/${slug}/challenge`, headers: { host: HOST }, remoteAddress: ip })).json() as { id: string; salt: string; difficulty: number };
    const reply = await composed.app.inject({
      method: 'POST',
      url: `/x/forms/api/${slug}/files?q=qfiles&name=plan.pdf`,
      remoteAddress: ip,
      headers: { host: HOST, origin: ORIGIN, 'content-type': 'application/octet-stream', 'x-adminium-proof': `${challenge.id}.${solveProof(challenge.salt, challenge.difficulty)}` },
      payload: body,
    });
    expect(reply.statusCode, reply.body).toBe(200);
    return (reply.json() as { id: string }).id;
  }

  async function answer(key: string, formId = 'frm_showroom'): Promise<void> {
    const { db } = await h.manager.data(h.connectionId);
    await db
      .insertInto(table.answers)
      .values({ id: key, form_id: formId, submitted_at: dialect === 'mysql' ? '2026-11-02 10:00:00' : '2026-11-02T10:00:00.000Z', language: 'en-US', values: '{}', confirm: 'none' } as never)
      .execute();
  }

  const fileRows = async () => {
    const { db } = await h.manager.data(h.connectionId);
    return (await db.selectFrom(table.files).selectAll().orderBy('file_id').execute()) as Record<string, unknown>[];
  };

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageAddOn(formsAddOn(), { bundled: true });
    const added = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'forms', version: '1.0.0', attachTo: ['dashboard'] } });
    expect(added.statusCode, added.body).toBe(200);
    // Vouched for as a bundled package is: its bytes recorded as trusted (a package nobody vouches for serves no form).
    await recordDeciderTrust(h.meta, { key: 'forms', version: '1.0.0', integrity: (await h.addOnStore.verifyTree('forms', '1.0.0')).integrity });
    const model = parseDatabaseModel((await snapshotsRepo(h.meta).latest(h.connectionId))!.schema);
    const idOf = async (ref: string) => {
      const record = await h.meta.db.selectFrom('adminium_app_tables').select(['tableName']).where('appKey', '=', 'forms').where('ref', '=', ref).executeTakeFirstOrThrow();
      return model.tables.find((t) => t.name === record.tableName)!.id;
    };
    table.forms = await idOf('forms');
    table.answers = await idOf('answers');
    table.files = await idOf('answer_files');
    const { db } = await h.manager.data(h.connectionId);
    for (const [id, slug] of [
      ['frm_showroom', 'showroom-visit'],
      ['frm_other', 'other-visit'],
    ] as const) {
      await db.insertInto(table.forms).values({ id, title: slug, slug, kind: 'form', state: 'live', definition: '{}', settings: '{}', published: published(SHOWROOM, SHOWROOM_SETTINGS) } as never).execute();
    }

    const settings = settingsRepo(h.meta);
    await settings.set('system.publicOrigin', ORIGIN, { updatedBy: null });
    await settings.set('privacy.businessName', 'Meridian Workplace Ltd', { updatedBy: null });
    await settings.set('privacy.noticeUrl', 'https://www.meridian.example/privacy', { updatedBy: null });

    root = await mkdtemp(join(tmpdir(), 'forms-files-'));
    await mkdir(join(root, 'x'), { recursive: true });
    await writeFile(join(root, 'index.html'), '<!doctype html><html><body></body></html>');
    await writeFile(join(root, 'x', 'index.html'), '<!doctype html><html><body><div id="x-root"></div></body></html>');
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
    reader = await person('marketer@meridian.example', [`table:${h.connectionId}:${table.answers}:read`, `table:${h.connectionId}:${table.files}:read`]);
    // Reads the forms, not their answers.
    other = await person('builder@meridian.example', [`table:${h.connectionId}:${table.forms}:read`]);
  }, 240_000);

  afterAll(async () => {
    if (!available) return;
    await composed?.app.close();
    await h?.close();
    await rm(root, { recursive: true, force: true });
  });

  it.skipIf(!available)('attaches an answer’s files and writes them into the add-on’s files table; another form or address refuses the whole answer', async () => {
    const mine = await upload('showroom-visit');
    const second = await upload('showroom-visit');
    const forOther = await upload('other-visit');
    const elsewhere = await upload('showroom-visit', '198.51.100.9');
    await answer('ans_1');

    const live = liveOf('frm_showroom');
    expect(await formsFiles.attachToAnswer({ live, ip: '127.0.0.1', answerKey: 'ans_1', files: [{ question: 'qfiles', ids: [mine, forOther] }] })).toBeNull();
    expect(await formsFiles.attachToAnswer({ live, ip: '127.0.0.1', answerKey: 'ans_1', files: [{ question: 'qfiles', ids: [mine, elsewhere] }] })).toBeNull();
    expect(await formsFiles.attachToAnswer({ live, ip: '198.51.100.9', answerKey: 'ans_1', files: [{ question: 'qfiles', ids: [mine] }] })).toBeNull();
    expect(await fileRows()).toEqual([]);

    const attached = await formsFiles.attachToAnswer({ live, ip: '127.0.0.1', answerKey: 'ans_1', files: [{ question: 'qfiles', ids: [mine, second] }] });
    expect(attached?.map((one) => one.id).sort()).toEqual([mine, second].sort());
    const rows = await fileRows();
    expect(rows.map((row) => ({ answer: String(row['answer_id']), file: String(row['file_id']), question: row['question'], name: row['name'], size: Number(row['size']), kind: row['kind'] })).sort((a, b) => (a.file < b.file ? -1 : 1))).toEqual(
      [mine, second].sort().map((id) => ({ answer: 'ans_1', file: id, question: 'qfiles', name: 'plan.pdf', size: PDF.length, kind: 'pdf' })),
    );
  });

  it.skipIf(!available)('a file named under a question that takes another kind, or a smaller size, refuses the whole answer and stays unattached', async () => {
    // The showroom form with two more file questions: one for pictures only, one for a file of 1 MB at most.
    const parsed = parseForm(
      {
        ...SHOWROOM,
        questions: [
          ...SHOWROOM.questions,
          { id: 'qphoto', kind: 'file', section: 'sfiles', maxMb: 10, kinds: ['jpg', 'png'], label: words('A photo') },
          { id: 'qsmall', kind: 'file', section: 'sfiles', maxMb: 1, kinds: ['pdf'], label: words('A small file') },
        ],
      },
      SHOWROOM_SETTINGS,
    );
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    const live: LiveForm = { id: 'frm_showroom', slug: 'showroom-visit', addOn: 'forms', connectionId: h.connectionId, form: parsed.form };
    const pdf = await upload('showroom-visit');
    // A PDF of a little over 1 MB: taken by the 10 MB question it was uploaded for.
    const big = await upload('showroom-visit', '127.0.0.1', Buffer.concat([PDF, Buffer.alloc(1024 * 1024 + 10, 0x20)]));
    await answer('ans_kind');
    expect(await formsFiles.attachToAnswer({ live, ip: '127.0.0.1', answerKey: 'ans_kind', files: [{ question: 'qphoto', ids: [pdf] }] })).toBeNull();
    expect(await formsFiles.attachToAnswer({ live, ip: '127.0.0.1', answerKey: 'ans_kind', files: [{ question: 'qsmall', ids: [big] }] })).toBeNull();
    expect(await formsFiles.attachToAnswer({ live, ip: '127.0.0.1', answerKey: 'ans_kind', files: [{ question: 'qfiles', ids: [pdf] }, { question: 'qsmall', ids: [big] }] })).toBeNull();
    for (const id of [pdf, big]) expect((await publicUploadsRepo(h.meta).findById(id))?.owner ?? null).toBeNull();
    expect((await fileRows()).some((row) => row['answer_id'] === 'ans_kind')).toBe(false);
    // Under the questions that take them, both attach.
    expect((await formsFiles.attachToAnswer({ live, ip: '127.0.0.1', answerKey: 'ans_kind', files: [{ question: 'qphoto', ids: [] }, { question: 'qfiles', ids: [pdf, big] }] }))?.length).toBe(2);
  });

  it.skipIf(!available)('opens a file for staff who read the answers, as a download; refuses staff without the grant, a stranger, and a file no answer took', async () => {
    const id = await upload('showroom-visit');
    await answer('ans_2');
    expect(await formsFiles.attachToAnswer({ live: liveOf('frm_showroom'), ip: '127.0.0.1', answerKey: 'ans_2', files: [{ question: 'qfiles', ids: [id] }] })).not.toBeNull();

    for (const cookie of [owner, reader]) {
      const got = await composed.app.inject({ method: 'GET', url: `/api/v1/forms/files/${id}`, headers: { cookie } });
      expect(got.statusCode, got.body).toBe(200);
      expect(got.rawPayload.equals(PDF)).toBe(true);
      expect(got.headers['content-type']).toBe('application/pdf');
      expect(got.headers['content-disposition']).toBe(`attachment; filename="plan.pdf"; filename*=UTF-8''plan.pdf`);
      expect(got.headers['x-content-type-options']).toBe('nosniff');
      expect(String(got.headers['content-security-policy'])).toContain('sandbox');
      expect(got.headers['cache-control']).toBe('private, no-store');
    }
    const refused = await composed.app.inject({ method: 'GET', url: `/api/v1/forms/files/${id}`, headers: { cookie: other } });
    expect(refused.statusCode).toBe(403);
    const stranger = await composed.app.inject({ method: 'GET', url: `/api/v1/forms/files/${id}` });
    expect(stranger.statusCode).toBe(401);
    // …and the same for a file that is not there: a stranger learns nothing.
    expect((await composed.app.inject({ method: 'GET', url: `/api/v1/forms/files/${'y'.repeat(32)}` })).statusCode).toBe(401);
    // The staff files routes never serve a stranger's file, whoever asks.
    const fileId = (await publicUploadsRepo(h.meta).findById(id))!.fileId!;
    expect((await composed.app.inject({ method: 'GET', url: `/api/v1/files/${fileId}/content`, headers: { cookie: owner } })).statusCode).toBe(404);
    expect((await composed.app.inject({ method: 'GET', url: `/api/v1/files/${fileId}`, headers: { cookie: owner } })).statusCode).toBe(404);
    // Picked, never sent: nobody's to open.
    const loose = await upload('showroom-visit');
    expect((await composed.app.inject({ method: 'GET', url: `/api/v1/forms/files/${loose}`, headers: { cookie: owner } })).statusCode).toBe(404);
    expect((await composed.app.inject({ method: 'GET', url: `/api/v1/forms/files/${'x'.repeat(32)}`, headers: { cookie: owner } })).statusCode).toBe(404);
  });

  it.skipIf(!available)('removes an answer’s files with the answer, one at a time or several at once', async () => {
    const live = liveOf('frm_showroom');
    const ids: Record<string, string> = {};
    for (const key of ['ans_3', 'ans_4', 'ans_5']) {
      ids[key] = await upload('showroom-visit');
      await answer(key);
      expect(await formsFiles.attachToAnswer({ live, ip: '127.0.0.1', answerKey: key, files: [{ question: 'qfiles', ids: [ids[key]!] }] })).not.toBeNull();
    }
    const fileIdOf = async (id: string) => (await publicUploadsRepo(h.meta).findById(id))?.fileId ?? null;
    const bytesOf3 = await fileIdOf(ids['ans_3']!);

    const one = await composed.app.inject({ method: 'DELETE', url: `/api/v1/data/${h.connectionId}/${encodeURIComponent(table.answers)}/ans_3?confirm=true`, headers: { cookie: owner } });
    expect(one.statusCode, one.body).toBe(200);
    expect(await publicUploadsRepo(h.meta).findById(ids['ans_3']!)).toBeNull();
    expect(await h.meta.db.selectFrom('adminium_files').select('id').where('id', '=', bytesOf3!).executeTakeFirst()).toBeUndefined();
    expect((await fileRows()).some((row) => row['file_id'] === ids['ans_3'])).toBe(false);

    const many = await composed.app.inject({ method: 'POST', url: `/api/v1/data/${h.connectionId}/${encodeURIComponent(table.answers)}/bulk`, headers: { cookie: owner }, payload: { action: 'delete', ids: ['ans_4', 'ans_5'] } });
    expect(many.statusCode, many.body).toBe(200);
    for (const key of ['ans_4', 'ans_5']) expect(await publicUploadsRepo(h.meta).findById(ids[key]!)).toBeNull();
    expect((await fileRows()).some((row) => row['file_id'] === ids['ans_4'] || row['file_id'] === ids['ans_5'])).toBe(false);
  });

  it.skipIf(!available)('staff who hold every grant on the answers and their files still never write them: no create, change or import; a delete goes', async () => {
    const grants = ['read', 'create', 'update', 'delete', 'import'].flatMap((action) => [`table:${h.connectionId}:${table.answers}:${action}`, `table:${h.connectionId}:${table.files}:${action}`]);
    const editor = await person('answers-editor@meridian.example', grants);
    await answer('ans_edit');
    const data = (rest: string) => `/api/v1/data/${h.connectionId}/${rest}`;
    const answers = encodeURIComponent(table.answers);
    const refusedAsOwn = (reply: { statusCode: number; body: string; json: () => unknown }) => {
      expect(reply.statusCode, reply.body).toBe(403);
      expect((reply.json() as { error: { details?: { reason?: string } } }).error.details?.reason).toBe('adminium-writes');
    };

    refusedAsOwn(await composed.app.inject({ method: 'PATCH', url: data(`${answers}/ans_edit`), headers: { cookie: editor }, payload: { values: { email: 'victim@target.example' } } }));
    refusedAsOwn(await composed.app.inject({ method: 'POST', url: data(answers), headers: { cookie: editor }, payload: { values: { id: 'ans_made', form_id: 'frm_showroom', language: 'en-US', values: '{}', confirm: 'pending', email: 'victim@target.example' } } }));
    refusedAsOwn(
      await composed.app.inject({ method: 'POST', url: data(`${encodeURIComponent(table.files)}`), headers: { cookie: editor }, payload: { values: { answer_id: 'ans_edit', file_id: 'f'.repeat(32), question: 'qfiles', name: 'x.pdf', size: 1, kind: 'pdf' } } }),
    );
    const bulk = await composed.app.inject({ method: 'POST', url: data(`${answers}/bulk`), headers: { cookie: editor }, payload: { action: 'update', ids: ['ans_edit'], values: { email: 'victim@target.example' } } });
    expect(bulk.statusCode, bulk.body).not.toBe(200);
    // Not even the owner writes them.
    refusedAsOwn(await composed.app.inject({ method: 'PATCH', url: data(`${answers}/ans_edit`), headers: { cookie: owner }, payload: { values: { email: 'victim@target.example' } } }));

    // A file brought in: refused when it is judged, and nothing lands.
    const up = await composed.app.inject({ method: 'POST', url: '/api/v1/imports/upload?filename=answers.csv', headers: { cookie: editor, 'content-type': 'text/csv' }, payload: 'id,form_id,language,values,confirm,email\nans_brought,frm_showroom,en-US,{},pending,victim@target.example\n' });
    expect(up.statusCode, up.body).toBe(201);
    const columns = ['id', 'form_id', 'language', 'values', 'confirm', 'email'].map((name) => ({ from: name, to: name }));
    const made = await composed.app.inject({ method: 'POST', url: '/api/v1/imports', headers: { cookie: editor }, payload: { fileId: (up.json() as { data: { fileId: string } }).data.fileId, connectionId: h.connectionId, table: table.answers, mapping: { columns }, options: { mode: 'insert' } } });
    if (made.statusCode < 300) {
      const id = (made.json() as { data: { import: { id: string } } }).data.import.id;
      const preview = await composed.app.inject({ method: 'GET', url: `/api/v1/imports/${id}/preview`, headers: { cookie: editor } });
      expect(preview.statusCode, preview.body).toBe(403);
      await composed.app.inject({ method: 'POST', url: `/api/v1/imports/${id}/run`, headers: { cookie: editor } });
      await composed.jobs.worker.runOnce();
    } else {
      expect(made.statusCode, made.body).toBe(403);
    }

    const { db } = await h.manager.data(h.connectionId);
    const rows = (await db.selectFrom(table.answers).selectAll().where('id' as never, 'in', ['ans_edit', 'ans_made', 'ans_brought'] as never).execute()) as Record<string, unknown>[];
    expect(rows.map((row) => [row['id'], row['email'] ?? null])).toEqual([['ans_edit', null]]);

    // Staff read and delete them.
    expect((await composed.app.inject({ method: 'GET', url: data(`${answers}/ans_edit`), headers: { cookie: editor } })).statusCode).toBe(200);
    const gone = await composed.app.inject({ method: 'DELETE', url: data(`${answers}/ans_edit?confirm=true`), headers: { cookie: editor } });
    expect(gone.statusCode, gone.body).toBe(200);
  });

  it.skipIf(!available)('removes every file taken for a form when the form goes', async () => {
    const loose = await upload('other-visit');
    expect(await publicUploadsRepo(h.meta).findById(loose)).not.toBeNull();
    const gone = await composed.app.inject({ method: 'DELETE', url: `/api/v1/data/${h.connectionId}/${encodeURIComponent(table.forms)}/frm_other?confirm=true`, headers: { cookie: owner } });
    expect(gone.statusCode, gone.body).toBe(200);
    expect(await publicUploadsRepo(h.meta).findById(loose)).toBeNull();
  });
});
