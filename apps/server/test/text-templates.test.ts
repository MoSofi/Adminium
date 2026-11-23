// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The text-template store on every engine: an app's texts written beside its
 * emails, an operator's edit kept across an update, and an email row that a
 * text install leaves exactly as it was. Then a public form's box for texts,
 * which is its own answer and never a condition of the write.
 */
import { appOutboxesRepo, connectionsRepo, emailTemplatesRepo, manifestsRepo, textTemplatesRepo } from '@adminium/meta';
import { SMS_WORDS_FLOOR, validateManifest, type Manifest } from '@adminium/manifest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { installOutbox, removeOutbox } from '../src/apps/manifest-outbox.js';
import { saveTextTemplateWords } from '../src/apps/manifest-text-templates.js';
import type { PeopleWrite, PublicTextConsentTick } from '../src/crud/write-context.js';
import { MANIFEST_WORDS_RUN, UNBUILT_MANIFEST_WORDS, unbuiltInManifest } from '../src/crud/unbuilt-rules.js';
import { createPeopleConsent, type TextConsentDoor } from '../src/people/consent-writes.js';
import { renameManifest } from '../src/project/apps/copy-app.js';
import { createConsentTicks } from '../src/public-api/consent-tick.js';
import { publicEntryRefs, servedPublicEntries } from '../src/apps/manifest-public.js';
import { createTextConsentService } from '../src/sms/consent/index.js';
import { checkTextTemplate } from '../src/sms/send/template.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a loose fixture, changed by path in each case
type Doc = Record<string, any>;

const manifest = (body = '{{appName}}: visit soon. Reply STOP to opt out.', extra: Doc = {}): Manifest => {
  const doc: Doc = {
    manifestVersion: 1,
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    description: { key: 'd', fallback: 'd' },
    kind: 'app',
    key: 'clinic',
    name: 'Clinic',
    version: '1.0.0',
    categories: ['operations'],
    compatibility: { minAdminiumVersion: SMS_WORDS_FLOOR },
    pages: [{ ref: 'messages', template: 'page-crud', title: { key: 't', fallback: 'Messages' }, nav: { group: 'manage', icon: 'list', order: 1 }, bindings: { main: 'messages' } }],
    frontends: [{ side: 'staff', kind: 'none' }],
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'patients', keyField: 'name', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'name', type: 'text', maxLength: 80 }, { ref: 'email', type: 'text', maxLength: 200, nullable: true }, { ref: 'mobile', type: 'text', maxLength: 32, nullable: true }] },
        { ref: 'messages', keyField: 'id', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'kind', type: 'enum', enum: ['visit_mail', 'reminder_text'] }, { ref: 'status', type: 'enum', enum: ['queued', 'sent', 'failed', 'skipped'] }, { ref: 'to', type: 'text', maxLength: 200, nullable: true }, { ref: 'patient_id', type: 'fk', references: 'patients', nullable: true }] },
      ],
    },
    people: [{ table: 'patients', kind: 'people', email: 'email', phone: 'mobile', name: 'name' }],
    emailTemplates: [{ key: 'clinic-visit-mail', name: 'Visit', locales: { 'en-US': { subject: 'Your visit', blocks: [{ block: 'email.text', data: { text: 'See you.' } }] } } }],
    textTemplates: [{ key: 'clinic-reminder-text', name: { 'en-US': 'Visit reminder', 'de-DE': 'Erinnerung' }, locales: { 'en-US': { body }, 'de-DE': { body: '{{appName}}: Termin bald.' } } }],
    outbox: {
      table: 'messages',
      columns: { kind: 'kind', status: 'status', to: 'to' },
      recipient: { via: 'patient_id', table: 'patients', email: 'email', phone: 'mobile', name: 'name' },
      kinds: { visit_mail: 'clinic-visit-mail', reminder_text: 'clinic-reminder-text' },
      channels: { reminder_text: 'sms' },
      classes: { visit_mail: 'service', reminder_text: 'service' },
    },
    ...extra,
  };
  const checked = validateManifest(doc, { allowLocalPublisher: true });
  if (!checked.ok) throw new Error(JSON.stringify(checked.issues));
  return checked.manifest;
};

const CRYPTO = { encrypt: (value: string) => value, decrypt: (value: string) => value };

describe.each(META_ENGINES)('text templates — $name', (engine) => {
  let handle: MetaHandle;
  let INSTALL = { id: '', key: 'clinic', slug: '' };
  let connectionId = '';
  const put = (m: Manifest, install = INSTALL) => installOutbox({ meta: handle.meta, manifest: m, install, connectionId, realId: (ref) => `clinic_${ref}` });

  beforeAll(async () => {
    if (!engine.available) return;
    handle = await engine.make();
    connectionId = (await connectionsRepo(handle.meta, CRYPTO as never).create({ name: 'Clinic', engine: 'sqlite', introspectDsn: 'sqlite::memory:' })).id;
    const installed = await manifestsRepo(handle.meta, CRYPTO as never).install({ manifestKey: 'clinic', version: '1.0.0', kind: 'app', source: 'file', document: {} });
    INSTALL = { id: installed.row.id, key: 'clinic', slug: '' };
  });
  afterAll(async () => {
    if (engine.available) await handle.destroy();
  });
  beforeEach(async () => {
    if (!engine.available) return;
    await removeOutbox(handle.meta, INSTALL);
    const texts = textTemplatesRepo(handle.meta);
    for (const row of await texts.listByKey('clinic-reminder-text')) await texts.remove(row.key, row.locale);
  });

  it.skipIf(!engine.available)('writes each language, with the fallback a person without one reads', async () => {
    const result = await put(manifest());
    expect(result?.texts?.written.sort()).toEqual(['clinic-reminder-text/de_DE', 'clinic-reminder-text/en_US']);
    const texts = textTemplatesRepo(handle.meta);
    expect((await texts.findByKeyLocale('clinic-reminder-text', 'de_DE'))?.name).toBe('Erinnerung');
    expect((await texts.findSendable('clinic-reminder-text', 'fr_FR'))?.locale).toBe('en_US');
    await texts.upsert('clinic-reminder-text', 'en_US', { name: 'x', body: 'y', enabled: false });
    expect(await texts.findSendable('clinic-reminder-text', 'fr_FR')).toBeNull();
  });

  it.skipIf(!engine.available)('leaves the installed email exactly as an install without texts writes it', async () => {
    await put(manifest());
    const email = await emailTemplatesRepo(handle.meta).findByKeyLocale('clinic-visit-mail', 'en_US');
    expect(email?.subject).toBe('Your visit');
    const hash = email?.contentHash;
    await put(manifest('{{appName}}: new words.'));
    const after = await emailTemplatesRepo(handle.meta).findByKeyLocale('clinic-visit-mail', 'en_US');
    expect(after?.contentHash).toBe(hash);
    expect(after?.updatedAt).toBe(email?.updatedAt === undefined ? undefined : after?.updatedAt);
    expect((await emailTemplatesRepo(handle.meta).listManagedBy('clinic', INSTALL.id)).map((row) => row.key)).toEqual(['clinic-visit-mail']);
  });

  it.skipIf(!engine.available)('an update brings new words, and leaves an operator\'s edit alone', async () => {
    await put(manifest());
    await put(manifest('{{appName}}: second words.'));
    const texts = textTemplatesRepo(handle.meta);
    expect((await texts.findByKeyLocale('clinic-reminder-text', 'en_US'))?.body).toBe('{{appName}}: second words.');
    const saved = await saveTextTemplateWords(handle.meta, { key: 'clinic-reminder-text', locale: 'en_US', body: 'Our own words.', codeColumns: new Set(), updatedBy: null });
    expect('saved' in saved).toBe(true);
    const result = await put(manifest('{{appName}}: third words.'));
    expect(result?.texts?.kept).toEqual(['clinic-reminder-text/en_US']);
    expect((await texts.findByKeyLocale('clinic-reminder-text', 'en_US'))?.body).toBe('Our own words.');
  });

  it.skipIf(!engine.available)('a save is held to the same check as an install', async () => {
    await put(manifest());
    const refused = await saveTextTemplateWords(handle.meta, { key: 'clinic-reminder-text', locale: 'en_US', body: 'Reply YES', codeColumns: new Set(), updatedBy: null });
    expect(refused).toEqual({ refused: { ok: false, reason: 'asks-for-yes' } });
    const code = await saveTextTemplateWords(handle.meta, { key: 'clinic-reminder-text', locale: 'en_US', body: 'Door {{patient.locker}}', codeColumns: new Set(['locker']), updatedBy: null });
    expect(code).toMatchObject({ refused: { reason: 'credential-in-template' } });
    expect(await saveTextTemplateWords(handle.meta, { key: 'clinic-nope', locale: 'en_US', body: 'Hello', codeColumns: new Set(), updatedBy: null })).toEqual({ missing: true });
  });

  it.skipIf(!engine.available)('a row of that key another app keeps is not touched', async () => {
    const texts = textTemplatesRepo(handle.meta);
    await texts.upsert('clinic-reminder-text', 'en_US', { name: 'Theirs', body: 'Their words', enabled: true, managedBy: 'other', installId: 'mfs_two', contentHash: 'x' });
    const result = await put(manifest());
    expect(result?.texts?.skipped.map((one) => one.locale)).toEqual(['en_US']);
    expect((await texts.findByKeyLocale('clinic-reminder-text', 'en_US'))?.body).toBe('Their words');
  });

  it.skipIf(!engine.available)('an uninstall takes the unedited texts and keeps an edited one', async () => {
    await put(manifest());
    await saveTextTemplateWords(handle.meta, { key: 'clinic-reminder-text', locale: 'de_DE', body: 'Unsere Worte.', codeColumns: new Set(), updatedBy: null });
    await removeOutbox(handle.meta, INSTALL);
    const left = await textTemplatesRepo(handle.meta).listByKey('clinic-reminder-text');
    expect(left.map((row) => row.locale)).toEqual(['de_DE']);
  });

  it.skipIf(!engine.available)('an update that stops shipping a text takes its unedited rows', async () => {
    await put(manifest());
    const without = manifest(undefined, { textTemplates: undefined, outbox: { ...(manifest() as Doc)['outbox'], kinds: { visit_mail: 'clinic-visit-mail' }, channels: undefined, classes: { visit_mail: 'service' } } });
    const result = await put(without);
    expect(result?.texts?.removed).toBe(2);
    expect(await textTemplatesRepo(handle.meta).listByKey('clinic-reminder-text')).toEqual([]);
  });

  it.skipIf(!engine.available)('a later install keeps its texts under keys of its own, and its outbox names them', async () => {
    const second = await manifestsRepo(handle.meta, CRYPTO as never).install({ manifestKey: 'clinic', version: '1.0.0', kind: 'app', source: 'file', document: {}, scopeKey: 'scope_two', instanceSlug: 'two' });
    const install = { id: second.row.id, key: 'clinic', slug: 'two' };
    await put(manifest(), install);
    expect((await textTemplatesRepo(handle.meta).findByKeyLocale('clinic-two-reminder-text', 'en_US'))?.installId).toBe(install.id);
    const stored = JSON.parse((await appOutboxesRepo(handle.meta).findByInstall(install.id))!.definition as string) as { kinds: Record<string, string> };
    expect(stored.kinds['reminder_text']).toBe('clinic-two-reminder-text');
    await removeOutbox(handle.meta, install);
    expect(await textTemplatesRepo(handle.meta).listByKey('clinic-two-reminder-text')).toEqual([]);
  });

  it.skipIf(!engine.available)('a public box reaches the real text log as its own answer, and unlocks only that number and class', async () => {
    const base = manifest() as Doc;
    const tables = base['requiredSchema'].tables.map((table: Doc) => (table['ref'] === 'patients' ? { ...table, columns: [...table['columns'], { ref: 'may_email', type: 'bool', nullable: true }, { ref: 'may_text', type: 'bool', nullable: true }] } : table));
    const form = manifest(undefined, {
      requiredSchema: { ...base['requiredSchema'], tables },
      publicAccess: [{
        table: 'patients',
        methods: ['POST'],
        select: ['id'],
        writable: ['name', 'mobile', 'may_email', 'may_text'],
        consent: { column: 'may_email', purpose: 'newsletter', wording: { version: 1, text: { 'en-US': 'Email me news.' } } },
        textConsent: { column: 'may_text', phone: 'mobile', class: 'service', wording: { version: 2, text: { 'en-US': 'Text me about my visit.' } } },
      }],
    });
    await manifestsRepo(handle.meta, CRYPTO as never).install({ manifestKey: 'clinic', version: '1.0.0', kind: 'app', source: 'file', document: form, connectionId, instanceSlug: 'box' });
    const entries = servedPublicEntries(form as never);
    const request = { params: { ref: publicEntryRefs(entries, {})[0] }, method: 'POST', headers: { 'accept-language': 'en-US', 'user-agent': 'test' }, ip: '203.0.113.9' } as never;
    const key = { managedBy: 'clinic', connectionId } as never;
    const view = { table: (name: string) => ({ id: name }) } as never;
    const ticks = createConsentTicks(handle.meta);
    expect((await ticks.tickFor({ request, key, view }))?.column).toBe('may_email');
    const given = await ticks.textTickFor({ request, key, view });
    expect(given).toMatchObject({ column: 'may_text', phone: 'mobile', purpose: 'text-service', means: 'yes', person: { table: 'patients', link: null } });

    const texts = createTextConsentService({ meta: handle.meta, secret: 'a-text-template-test-secret-of-some-length' });
    const phone = '+4915123456789';
    const asked = { phone, country: 'DE', class: 'service' as const, sender: { kind: 'number' as const }, repliesReachUs: true };
    expect(await texts.decide(asked)).toMatchObject({ send: false, reason: 'no-consent' });
    const emailRecord = vi.fn();
    const people = createPeopleConsent({ meta: handle.meta, consent: { record: emailRecord } as never, tables: {} as never, viewFor: async () => null, people: { of: async () => null, all: async () => [] }, textConsent: texts, textCountry: async () => 'DE' });
    await people.written({
      action: 'create',
      target: { connectionId, table: { id: 'patients', primaryKey: ['id'] }, view: { model: undefined } },
      context: { origin: 'public', textConsentTick: given },
      record: { id: 9, name: 'Ada', mobile: phone, may_email: false, may_text: true },
      before: null,
    } as unknown as PeopleWrite);
    expect(await texts.decide(asked)).toMatchObject({ send: true, e164: phone });
    expect(await texts.decide({ ...asked, class: 'marketing' })).toMatchObject({ send: false, reason: 'no-consent' });
    expect(await texts.decide({ ...asked, phone: '+4915123456780' })).toMatchObject({ send: false, reason: 'no-consent' });
    expect((await texts.standing({ phone, country: 'DE' }, 'text-service')).event).toMatchObject({ source: 'form', wording: 'Text me about my visit.', wordingVersion: 'v2 en-US' });
    expect(emailRecord).not.toHaveBeenCalled();
  });

  it.skipIf(!engine.available)('an app with no texts writes none and reports none', async () => {
    const plain = manifest(undefined, { textTemplates: undefined, people: [{ table: 'patients', kind: 'people', email: 'email', name: 'name' }], outbox: { table: 'messages', columns: { kind: 'kind', status: 'status', to: 'to' }, recipient: { via: 'patient_id', table: 'patients', email: 'email', name: 'name' }, kinds: { visit_mail: 'clinic-visit-mail' }, classes: { visit_mail: 'service' } } });
    const result = await put(plain);
    expect(result).toBeDefined();
    expect(result).not.toHaveProperty('texts');
  });
});

describe('once the send path is joined', () => {
  it('a copy of the app takes its texts under its new key, and its kinds follow', () => {
    const copied = renameManifest(manifest() as unknown as Record<string, unknown>, 'surgery', 'Surgery').manifest as Doc;
    expect(copied['textTemplates'][0].key).toBe('surgery-reminder-text');
    expect(copied['outbox'].kinds.reminder_text).toBe('surgery-reminder-text');
    expect(validateManifest(copied, { allowLocalPublisher: true }).ok).toBe(true);
  });

  it('a manifest that uses a text word is no longer refused at install', () => {
    expect(unbuiltInManifest(manifest())).toEqual([]);
    for (const word of ['textTemplates', 'outbox.channels', 'outbox.recipient.phone', 'outbox.waiting', 'people.phone', 'publicAccess.textConsent'] as const) {
      expect(UNBUILT_MANIFEST_WORDS[word]).toBeUndefined();
      expect(MANIFEST_WORDS_RUN).toContain(word);
    }
  });

  it('the send path asks the manifest package\'s own check', () => {
    expect(checkTextTemplate('Reply YES')).toEqual({ ok: false, reason: 'asks-for-yes' });
  });
});

describe('a public box for texts', () => {
  const tick: PublicTextConsentTick = {
    table: 'visits',
    column: 'may_text',
    phone: 'mobile',
    purpose: 'text-service',
    means: 'yes',
    wording: { version: 3, text: { 'en-US': 'Text me about this booking.', 'de-DE': 'Schreibt mir.' } },
    person: { table: 'patients', link: 'patient_id' },
    form: 'clinic:visits',
    ip: '203.0.113.9',
    userAgent: 'test',
    acceptLanguage: 'de-DE',
  };
  const write = (record: Doc, before: Doc | null = null, given: PublicTextConsentTick = tick, origin = 'public') =>
    ({
      action: before === null ? 'create' : 'update',
      target: { connectionId: 'con_one', table: { id: 'visits', primaryKey: ['id'] }, view: { model: undefined } },
      context: { origin, textConsentTick: given },
      record,
      before,
    }) as unknown as PeopleWrite;
  const make = (standing: 'yes' | 'no' | 'not-asked' = 'not-asked', failing?: Error, log?: { warn: ReturnType<typeof vi.fn> }) => {
    const door = {
      standing: vi.fn(async () => ({ state: standing })),
      record: vi.fn(async (input: Parameters<TextConsentDoor['record']>[0]): Promise<unknown> => {
        void input;
        if (failing !== undefined) throw failing;
        return {};
      }),
    };
    const emailRecord = vi.fn();
    const people = createPeopleConsent({
      meta: {} as never,
      consent: { record: emailRecord } as never,
      tables: {} as never,
      viewFor: async () => null,
      people: { of: async () => null, all: async () => [] },
      textConsent: door,
      textCountry: async () => 'DE',
      ...(log === undefined ? {} : { log }),
    });
    return { door, people, emailRecord };
  };
  const ROW = { id: 7, patient_id: 3, mobile: '+4915123456789', may_text: true };

  it('a tick records one yes in the text log, with the words shown, and nothing in the e-mail log', async () => {
    const { door, people, emailRecord } = make();
    await people.written(write(ROW));
    expect(door.record).toHaveBeenCalledTimes(1);
    expect(door.record.mock.calls[0]).toEqual([
      expect.objectContaining({
        phone: '+4915123456789',
        country: 'DE',
        person: { connectionId: 'con_one', table: 'patients', key: '3' },
        purpose: 'text-service',
        state: 'yes',
        source: 'form',
        detail: 'clinic:visits',
        wording: { text: 'Schreibt mir.', version: 'v3 de-DE' },
      }),
    ]);
    expect(emailRecord).not.toHaveBeenCalled();
  });

  it('a box left unticked writes nothing', async () => {
    const { door, people } = make();
    await people.written(write({ ...ROW, may_text: false }));
    await people.written(write({ ...ROW, may_text: null }));
    expect(door.record).not.toHaveBeenCalled();
  });

  it('a box already ticked is not told twice', async () => {
    const { door, people } = make();
    await people.written(write(ROW, ROW));
    expect(door.record).not.toHaveBeenCalled();
  });

  it('a stranger\'s tick never overrules a standing no', async () => {
    const { door, people } = make('no');
    await people.written(write(ROW));
    expect(door.record).not.toHaveBeenCalled();
  });

  it('a box that means no records a no, once', async () => {
    const said = make();
    await said.people.written(write(ROW, null, { ...tick, means: 'no' }));
    expect(said.door.record.mock.calls[0]).toEqual([expect.objectContaining({ state: 'no', purpose: 'text-service' })]);
    const already = make('no');
    await already.people.written(write(ROW, null, { ...tick, means: 'no' }));
    expect(already.door.record).not.toHaveBeenCalled();
  });

  it('with no number on the row, there is nothing to agree for', async () => {
    const { door, people } = make();
    await people.written(write({ ...ROW, mobile: '  ' }));
    await people.written(write({ ...ROW, mobile: null }));
    expect(door.record).not.toHaveBeenCalled();
  });

  it('only a public write carries it', async () => {
    const { door, people } = make();
    await people.written(write(ROW, null, tick, 'dashboard'));
    expect(door.record).not.toHaveBeenCalled();
  });

  it('a log that cannot be written costs the yes, never the booking, and the number stays out of the log line', async () => {
    const log = { warn: vi.fn() };
    const failing = new Error(`could not keep ${ROW.mobile}`);
    const { people } = make('not-asked', failing, log);
    await expect(people.written(write(ROW))).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.warn.mock.calls[0])).not.toContain(ROW.mobile);
  });
});
