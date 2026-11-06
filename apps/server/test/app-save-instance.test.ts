// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SAVING A SERVER'S LOOK, LANGUAGES, WORDING, SYSTEM EMAILS AND SETTINGS.
 *
 * Only when the person chose it: the name, the colour and the logo, the two
 * languages on and the one first, the words somebody changed, the edited
 * password-reset email (without its sender) and the plain settings travel.
 * A system email nobody edited and a secret setting do not. The file
 * validates, and installed with the part ticked on a fresh server, that server
 * holds the same.
 */
import { parseDatabaseModel } from '@adminium/engine';
import { validateManifest } from '@adminium/manifest';
import { emailTemplatesRepo, filesRepo, localesRepo, snapshotsRepo, translationsRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { convertToApp } from '../src/apps/save/convert.js';
import { seedBuiltinEmailTemplates } from '../src/email/builtins.js';
import type { SaveSourceWithFiles } from '../src/apps/save/instance.js';
import type { SaveChoices } from '../src/apps/save/types.js';
import { installHarness, type Harness } from './app-install-harness.js';
import { ASSISTANT_KEY, HELP_HOST, LOGO, LOGO_SHA, dressServer, memoryLibrary, settingOf, withTableAndPage, type Doc } from './app-instance.helpers.js';

const choices = (over: Partial<SaveChoices> = {}): SaveChoices => ({ key: 'fern-notes', name: 'Fern notes', version: '1.0.0', label: 'Fernhill', lineage: 'lineage_test_fern', savedAt: '2026-11-06T10:00:00.000Z', ...over });

async function sourceOf(h: Harness, library: ReturnType<typeof memoryLibrary> | null): Promise<SaveSourceWithFiles> {
  const snapshot = await snapshotsRepo(h.meta).latest(h.connectionId);
  return {
    meta: h.meta,
    connectionId: h.connectionId,
    dialect: 'sqlite',
    model: parseDatabaseModel(snapshot!.schema as never),
    adminiumVersion: '0.3.49',
    ...(library === null ? {} : { files: { readFile: async (id: string) => library.kept.get(id) ?? null } }),
  };
}

describe('saving the server-wide part', () => {
  const open: Harness[] = [];
  afterEach(async () => {
    for (const h of open.splice(0)) await h.close();
  });

  it('carries what somebody set, without a pristine email or a secret, and installs as the same server', async () => {
    const library = memoryLibrary();
    const h = await installHarness('sqlite', { library });
    open.push(h);
    const { logoFileId } = await dressServer(h.meta, library);

    const result = await convertToApp(await sourceOf(h, library), choices({ instance: true }));
    const instance = (result.manifest as unknown as Doc)['instance'] as Doc;
    expect(instance['branding']).toEqual({ appName: 'Fernhill', showVersion: false, accent: 'teal', logo: { file: 'instance/logo.svg', sha256: LOGO_SHA } });
    expect(Buffer.from(result.files.get('instance/logo.svg')!).toString('utf8')).toBe(LOGO);
    expect(instance['languages']).toEqual({ enabled: ['en_US', 'de_DE'], default: 'de_DE' });
    expect(instance['wording']).toEqual([
      { locale: 'de_DE', namespace: 'common', key: 'common.save', value: 'Sichern' },
      { locale: 'en_US', namespace: 'common', key: 'auth.trust', value: '' },
    ]);
    expect(instance['settings']).toEqual({ 'assistant.name': 'Fern', 'privacy.businessName': 'Fernhill Ltd', 'privacy.noticeUrl': 'https://fernhill.example/privacy' });
    // The edited email alone; the other built-ins, untouched, stay out.
    const emails = instance['systemEmails'] as Doc[];
    expect(emails.map((email) => [email.key, email.locale])).toEqual([['password-reset', 'en_US']]);
    expect(emails[0]!.content.subject).toBe('Choose a new Fernhill password');
    expect(emails[0]!.content.blocks.at(-1)).toEqual({ id: 'help', block: 'email.text', data: { text: `Stuck? Read https://${HELP_HOST}/reset or write to us.` } });

    // No secret, no sender, no id of this server.
    const text = JSON.stringify(result.manifest);
    for (const value of [ASSISTANT_KEY, 'desk@fernhill.example', 'Fernhill desk"', logoFileId, h.connectionId, 'llm.apiKey']) expect(text, value).not.toContain(value);
    const check = result.check.map((item) => [item.group, item.code, item.item, item.afterKind]);
    expect(check).toEqual(expect.arrayContaining([
      ['after', 'INSTANCE_EMAIL_SENDER', 'password-reset (en_US)', 'sender'],
      ['info', 'INSTANCE_EMAIL_LOOK', 'password-reset (en_US)', undefined],
      ['info', 'INSTANCE_SECRET_SETTING', 'llm.apiKey', undefined],
      ['info', 'INSTANCE_TICKED', 'this server', undefined],
    ]));
    expect(JSON.stringify(result.check)).not.toContain(ASSISTANT_KEY);
    expect(JSON.stringify(result.check)).not.toContain('desk@fernhill.example');

    const doc = withTableAndPage(result.manifest as unknown as Doc);
    const validated = validateManifest(doc, { allowLocalPublisher: true });
    expect(validated.ok ? [] : validated.issues).toEqual([]);

    // Installed, ticked, on a fresh server: it holds the same.
    const targetLibrary = memoryLibrary();
    const target = await installHarness('sqlite', { library: targetLibrary });
    open.push(target);
    await dressTarget(target);
    await target.stage(doc, { 'instance/logo.svg': LOGO });
    const reply = await target.inject({ method: 'POST', url: '/apps/install', payload: { key: 'fern-notes', version: '1.0.0', connectionId: target.connectionId, instance: true, instanceHosts: { 'password-reset/en_US': [HELP_HOST] } } });
    expect(reply.statusCode, reply.body).toBe(200);
    expect((JSON.parse(reply.body) as Doc)['instance']['left']).toEqual([]);
    for (const [key, value] of [['branding.appName', 'Fernhill'], ['branding.showVersion', false], ['appearance.accent', 'teal'], ['assistant.name', 'Fern'], ['privacy.businessName', 'Fernhill Ltd'], ['locale.default', 'de_DE'], ['llm.apiKey', null]] as const) {
      expect(await settingOf(target.meta, key), key).toEqual(value);
    }
    const logo = await filesRepo(target.meta).findById(String(await settingOf(target.meta, 'branding.logoFileId')));
    expect(logo).toMatchObject({ kind: 'branding', mime: 'image/svg+xml', sha256: LOGO_SHA, deletedAt: null });
    expect(targetLibrary.kept.get(logo!.storageKey)?.toString('utf8')).toBe(LOGO);
    const on = (await localesRepo(target.meta).list()).filter((row) => row.enabled).map((row) => row.locale);
    expect(on).toEqual([]);
    expect((await localesRepo(target.meta).list()).filter((row) => !row.enabled).map((row) => row.locale).sort()).toEqual(['ar_EG', 'cs_CZ', 'da_DK', 'fr_FR', 'zh_CN', 'zh_TW']);
    expect((await translationsRepo(target.meta).get({ locale: 'de_DE', namespace: 'common', key: 'common.save' }))?.value).toBe('Sichern');
    expect((await translationsRepo(target.meta).get({ locale: 'en_US', namespace: 'common', key: 'auth.trust' }))?.value).toBe('');
    const reset = await emailTemplatesRepo(target.meta).findByKeyLocale('password-reset', 'en_US');
    expect(reset).toMatchObject({ subject: 'Choose a new Fernhill password', isBuiltinCopy: false, brand: null });
    expect(reset!.blocks.at(-1)).toEqual({ id: 'help', block: 'email.text', data: { text: `Stuck? Read https://${HELP_HOST}/reset or write to us.` } });
    expect(await emailTemplatesRepo(target.meta).findByKeyLocale('user-invite', 'en_US')).toMatchObject({ isBuiltinCopy: true });
  });

  it('carries nothing unless the person chose it, and nothing a server never changed', async () => {
    const library = memoryLibrary();
    const h = await installHarness('sqlite', { library });
    open.push(h);
    const fresh = await convertToApp(await sourceOf(h, library), choices({ instance: true }));
    expect((fresh.manifest as unknown as Doc)['instance']).toBeUndefined();
    expect(fresh.check.map((item) => item.code)).toContain('INSTANCE_NOTHING');

    await dressServer(h.meta, library);
    const unchosen = await convertToApp(await sourceOf(h, library), choices());
    expect((unchosen.manifest as unknown as Doc)['instance']).toBeUndefined();
    expect(unchosen.files.size).toBe(0);
    expect(unchosen.check.some((item) => item.kind === 'instance')).toBe(false);
  });

  it('leaves out a logo it cannot read, a word and an email it cannot carry, and says so', async () => {
    const library = memoryLibrary();
    const h = await installHarness('sqlite', { library });
    open.push(h);
    await dressServer(h.meta, library);
    await translationsRepo(h.meta).upsert({ locale: 'en_US', namespace: 'common', key: 'not a key', value: 'x' });
    const invite = (await emailTemplatesRepo(h.meta).findByKeyLocale('user-invite', 'en_US'))!;
    await emailTemplatesRepo(h.meta).upsert('user-invite', 'en_US', { name: invite.name, subject: invite.subject, blocks: [{ id: 'raw', block: 'email.html', data: { html: '<p>Hi</p>' } }], enabled: true, isBuiltinCopy: false });
    const result = await convertToApp(await sourceOf(h, null), choices({ instance: true }));
    const instance = (result.manifest as unknown as Doc)['instance'] as Doc;
    expect((instance['wording'] as Doc[]).map((word) => word.key)).toEqual(['common.save', 'auth.trust']);
    expect((instance['systemEmails'] as Doc[]).map((email) => email.key)).toEqual(['password-reset']);
    expect(result.check.filter((item) => item.code === 'INSTANCE_LEFT' || item.code === 'INSTANCE_EMAIL_HTML').map((item) => [item.code, item.item])).toEqual([
      ['INSTANCE_LEFT', 'common.not a key (en_US)'],
      ['INSTANCE_EMAIL_HTML', 'user-invite (en_US)'],
    ]);
    expect(((result.manifest as unknown as Doc)['instance'] as Doc)['branding']).toEqual({ appName: 'Fernhill', showVersion: false, accent: 'teal' });
    expect(result.files.size).toBe(0);
    expect(result.check.find((item) => item.code === 'INSTANCE_PICTURE_LEFT')).toMatchObject({ group: 'info', item: 'logo' });
  });
});

/** A target server whose own languages were never touched: only its built-ins, all on, and its system emails. */
async function dressTarget(target: Harness): Promise<void> {
  await seedBuiltinEmailTemplates(target.meta, Date.now());
}
