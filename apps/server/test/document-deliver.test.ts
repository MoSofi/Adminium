// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A drawn document on its way out.
 *
 * ─── WHAT IS WORTH ASKING HERE ─────────────────────────────────────────────
 *
 * Not "does an email get sent" — `email-send.test.ts` owns the transport, and
 * has since wave 39. What is new is the four ways a send does NOT happen and
 * what the REGISTER says afterwards, because the register is the only witness
 * that outlives the request. A document that was never emailed and says
 * nothing about it is indistinguishable from one that was.
 */
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  connectionsRepo,
  createSqliteMetaDb,
  documentProfilesRepo,
  documentsRepo,
  filesRepo,
  firstRun,
  settingsRepo,
  type DocumentProfile,
  type DocumentRow,
  type MetaDb,
} from '@adminium/meta';

import { encryptSecret } from '../src/config/secrets.js';
import { seedBuiltinEmailTemplates } from '../src/email/builtins.js';
import { emailSecretKey } from '../src/email/config.js';
import { resetEmailRuntime } from '../src/email/send.js';
import { emailDocument } from '../src/documents/deliver.js';

const TEST_SECRET = 'a'.repeat(64);

async function freshMeta(): Promise<MetaDb> {
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  await seedBuiltinEmailTemplates(meta, Date.now());
  return meta;
}

async function configureSmtp(meta: MetaDb): Promise<void> {
  await settingsRepo(meta).set(
    'email.smtp',
    {
      host: 'localhost',
      port: 587,
      user: 'postmaster',
      passEncrypted: encryptSecret('hunter2', emailSecretKey(TEST_SECRET)),
      from: 'Adminium <no-reply@adminium.test>',
      secure: false,
    },
    { updatedBy: null },
  );
}

/** A file row the attachment token can resolve to. */
async function seedFile(meta: MetaDb, id = 'file_1'): Promise<string> {
  await filesRepo(meta).create({
    id,
    filename: 'INV-1042.pdf',
    mime: 'application/pdf',
    sizeBytes: 12,
    sha256: 'x'.repeat(64),
    kind: 'document',
    uploadedBy: null,
    storageKey: `documents/${id}.pdf`,
    destinationId: null,
    storage: 'local',
  });
  return id;
}

async function seedDocument(
  meta: MetaDb,
  over: Partial<Parameters<ReturnType<typeof documentsRepo>['create']>[0]> = {},
): Promise<DocumentRow> {
  return await documentsRepo(meta).create({
    profileId: null,
    addOnKey: 'invoices',
    kind: 'invoice',
    connectionId: null,
    entity: null,
    subject: {
      fields: { customerEmail: 'buyer@example.test' },
      business: { name: 'Acme Supplies', lines: [] },
    },
    locale: 'en-US',
    format: 'pdf',
    requestedBy: null,
    actorKind: 'system',
    jobId: null,
    ...over,
  });
}

async function seedProfile(meta: MetaDb, deliver: Record<string, unknown>): Promise<DocumentProfile> {
  // A profile's connection is NOT NULL — a mapping without one names no table.
  const connectionId = (
    await connectionsRepo(meta, {
      encrypt: (plain) => `enc:${plain}`,
      decrypt: (cipher) => cipher.replace('enc:', ''),
    }).create({ name: 'main', engine: 'postgres', introspectDsn: 'postgres://ro@localhost/app' })
  ).id;
  return await documentProfilesRepo(meta).create({
    addOnKey: 'invoices',
    kind: 'invoice',
    name: 'Invoice',
    connectionId,
    table: 'public.orders',
    mapping: {},
    deliver,
  });
}

let meta: MetaDb;

beforeEach(async () => {
  resetEmailRuntime();
  meta = await freshMeta();
});

afterEach(async () => {
  resetEmailRuntime();
  await meta.db.destroy();
});

describe('emailing a drawn document', () => {
  it('queues the message and records `sent` on the register row', async () => {
    await configureSmtp(meta);
    const fileId = await seedFile(meta);
    const document = await documentsRepo(meta).markRendered(
      (await seedDocument(meta)).id,
      { number: 'INV-1042', fileId, htmlFileId: null, format: 'pdf' },
      Date.now(),
    );
    const profile = await seedProfile(meta, { store: true, emailSlot: 'customerEmail' });

    const outcome = await emailDocument(
      { meta, secret: TEST_SECRET },
      { document: document!, profile },
    );

    expect(outcome).toBe('sent');
    const jobs = await meta.db.selectFrom('adminium_jobs').selectAll().execute();
    expect(jobs.filter((job) => job.kind === 'email.send')).toHaveLength(1);
    // The row, not the return value, is what somebody reads in six months.
    expect((await documentsRepo(meta).findById(document!.id))?.delivery).toBe('sent');
  });

  it('attaches THIS document, by resolving the template’s generated token', async () => {
    /*
     * One stored template row serves every recipient because the attachment is
     * a `{{token}}` the send fills. If the token were not passed, the message
     * would go out with nothing attached — and every other assertion here
     * would still pass.
     */
    await configureSmtp(meta);
    const fileId = await seedFile(meta);
    const document = await documentsRepo(meta).markRendered(
      (await seedDocument(meta)).id,
      { number: 'INV-1042', fileId, htmlFileId: null, format: 'pdf' },
      Date.now(),
    );
    await emailDocument(
      { meta, secret: TEST_SECRET },
      { document: document!, profile: await seedProfile(meta, { emailSlot: 'customerEmail' }) },
    );

    const [job] = await meta.db
      .selectFrom('adminium_jobs')
      .selectAll()
      .where('kind', '=', 'email.send')
      .execute();
    const payload = JSON.parse(String(job!.payload)) as {
      templateKey: string;
      attachments?: { fileId: string; filename: string }[];
    };
    expect(payload.templateKey).toBe('document-ready');
    expect(payload.attachments).toEqual([{ fileId, filename: 'INV-1042.pdf' }]);
  });

  it('renders the template in the DOCUMENT’s language', async () => {
    /*
     * Documents speak locale TAGS (`de-DE`) and email template rows are keyed
     * by locale IDS (`de_DE`). Handing one to the other looks like it works,
     * because `resolveEmailTemplate` falls back to `en_US` when it finds no
     * row — so a German customer gets an English email and nothing anywhere
     * says so.
     */
    await configureSmtp(meta);
    const fileId = await seedFile(meta);
    const document = await documentsRepo(meta).markRendered(
      (await seedDocument(meta, { locale: 'de-DE' })).id,
      { number: 'INV-1', fileId, htmlFileId: null, format: 'pdf' },
      Date.now(),
    );
    await emailDocument(
      { meta, secret: TEST_SECRET },
      { document: document!, profile: await seedProfile(meta, { emailSlot: 'customerEmail' }) },
    );
    const [job] = await meta.db
      .selectFrom('adminium_jobs')
      .selectAll()
      .where('kind', '=', 'email.send')
      .execute();
    expect((JSON.parse(String(job!.payload)) as { locale: string }).locale).toBe('de_DE');
  });

  it('falls back to the HTML file when there is no PDF', async () => {
    await configureSmtp(meta);
    const fileId = await seedFile(meta, 'file_html');
    const document = await documentsRepo(meta).markRendered(
      (await seedDocument(meta, { format: 'html' })).id,
      { number: 'INV-1', fileId: null, htmlFileId: fileId, format: 'html' },
      Date.now(),
    );
    const outcome = await emailDocument(
      { meta, secret: TEST_SECRET },
      { document: document!, profile: await seedProfile(meta, { emailSlot: 'customerEmail' }) },
    );
    expect(outcome).toBe('sent');
  });
});

describe('the four ways it does not go, each written to the row', () => {
  it('`not-sent:no-email` when the mapping names no address slot', async () => {
    await configureSmtp(meta);
    const fileId = await seedFile(meta);
    const document = await documentsRepo(meta).markRendered(
      (await seedDocument(meta)).id,
      { number: 'INV-1', fileId, htmlFileId: null, format: 'pdf' },
      Date.now(),
    );
    const outcome = await emailDocument(
      { meta, secret: TEST_SECRET },
      { document: document!, profile: await seedProfile(meta, { store: true }) },
    );
    expect(outcome).toBe('not-sent:no-email');
    expect((await documentsRepo(meta).findById(document!.id))?.delivery).toBe('not-sent:no-email');
  });

  it('`not-sent:no-email` when the slot is named but the row had nothing in it', async () => {
    await configureSmtp(meta);
    const fileId = await seedFile(meta);
    const document = await documentsRepo(meta).markRendered(
      (await seedDocument(meta, { subject: { fields: {}, business: { name: 'Acme', lines: [] } } })).id,
      { number: 'INV-1', fileId, htmlFileId: null, format: 'pdf' },
      Date.now(),
    );
    const outcome = await emailDocument(
      { meta, secret: TEST_SECRET },
      { document: document!, profile: await seedProfile(meta, { emailSlot: 'customerEmail' }) },
    );
    expect(outcome).toBe('not-sent:no-email');
  });

  it('`not-sent:no-file` when the document has no bytes to attach', async () => {
    // A `failed` render leaves a row with a number and no file. Emailing it
    // would be an email about a document that does not exist.
    await configureSmtp(meta);
    const document = await seedDocument(meta);
    const outcome = await emailDocument(
      { meta, secret: TEST_SECRET },
      { document, profile: await seedProfile(meta, { emailSlot: 'customerEmail' }) },
    );
    expect(outcome).toBe('not-sent:no-file');
  });

  it('`not-sent:smtp-unconfigured` rather than throwing, when no server is set up', async () => {
    // The most common state of a fresh install, and the one where an exception
    // would turn "we could not email it" into "the render failed".
    const fileId = await seedFile(meta);
    const document = await documentsRepo(meta).markRendered(
      (await seedDocument(meta)).id,
      { number: 'INV-1', fileId, htmlFileId: null, format: 'pdf' },
      Date.now(),
    );
    const outcome = await emailDocument(
      { meta, secret: TEST_SECRET },
      { document: document!, profile: await seedProfile(meta, { emailSlot: 'customerEmail' }) },
    );
    expect(outcome).toBe('not-sent:smtp-unconfigured');
    expect((await documentsRepo(meta).findById(document!.id))?.delivery).toBe(
      'not-sent:smtp-unconfigured',
    );
  });
});

describe('a document nobody mapped', () => {
  it('goes to the CLAIM that made it, never to an address a caller supplies', async () => {
    /*
     * An intent settles only to "the claimed session's own bound address".
     * The operator settling a `pending-review` row decides whether, never
     * where — otherwise this is a way to send somebody else's document
     * anywhere.
     */
    await configureSmtp(meta);
    const fileId = await seedFile(meta);
    const created = await seedDocument(meta, {
      subject: { fields: {}, business: { name: 'Acme', lines: [] } },
      claim: { column: 'email', value: 'claimed@example.test' },
    });
    const document = await documentsRepo(meta).markRendered(
      created.id,
      { number: 'INV-9', fileId, htmlFileId: null, format: 'pdf' },
      Date.now(),
    );

    const outcome = await emailDocument({ meta, secret: TEST_SECRET }, { document: document!, profile: null });
    expect(outcome).toBe('sent');

    const [job] = await meta.db
      .selectFrom('adminium_jobs')
      .selectAll()
      .where('kind', '=', 'email.send')
      .execute();
    // The address is sealed inside the envelope, so what is asserted here is
    // that a job exists at all — an unclaimed intent produces none.
    expect(job).toBeDefined();

    const unclaimed = await documentsRepo(meta).markRendered(
      (await seedDocument(meta, { subject: { fields: {}, business: { name: 'A', lines: [] } } })).id,
      { number: 'INV-10', fileId, htmlFileId: null, format: 'pdf' },
      Date.now(),
    );
    expect(
      await emailDocument({ meta, secret: TEST_SECRET }, { document: unclaimed!, profile: null }),
    ).toBe('not-sent:no-email');
  });
});
