// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Runtime-translations routes (23-runtime-translations.md §6).
 *
 * The assertions concentrate on the things that are load-bearing rather than
 * on CRUD happy paths: the validator's rejections (which are the ONLY thing
 * standing between an admin's typing and every user's screen once the build
 * gates can no longer see the text), the built-in field lock, and the
 * cross-store cleanup a locale delete has to perform.
 */
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createSqliteMetaDb,
  emailTemplatesRepo,
  firstRun,
  rolesRepo,
  settingsRepo,
  translationsRepo,
  userPrefsRepo,
  usersRepo,
  type MetaDb,
  type Role,
  type User,
} from '@adminium/meta';
import { resetRuntimeLocales } from '@adminium/i18n';

import { buildServer, type AdminiumServer } from '../src/app.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { RealtimeHub, type RealtimeEvent } from '../src/realtime/hub.js';
import { i18nRoutes, I18N_CHANGED } from '../src/routes/i18n/index.js';
import { makeEnv } from './helpers.js';

interface Harness {
  app: AdminiumServer;
  meta: MetaDb;
  events: RealtimeEvent[];
  superAdmin: User;
  viewer: User;
}

function asUser(user: User): Record<string, string> {
  return { 'x-test-user-id': user.id };
}

async function buildHarness(): Promise<Harness> {
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);

  const roles = rolesRepo(meta);
  const users = usersRepo(meta);
  async function makeUser(name: string, roleSlug: string): Promise<User> {
    const role: Role | null = await roles.findBySlug(roleSlug);
    if (role === null) throw new Error(`missing built-in role ${roleSlug}`);
    const user = await users.create({
      email: `${name.toLowerCase()}@adminium.test`,
      name,
      passwordHash: 'test-hash',
      status: 'active',
    });
    await roles.assignToUser(user.id, role.id);
    return user;
  }
  const superAdmin = await makeUser('Ava', 'super-admin');
  const viewer = await makeUser('Liam', 'viewer');

  const app = await buildServer({ env: makeEnv(), logger: false });
  app.addHook('onRequest', async (request) => {
    const id = request.headers['x-test-user-id'];
    if (typeof id === 'string') {
      const user = await users.findById(id);
      if (user !== null) {
        (request as unknown as { user: { id: string; name: string; email: string } }).user = {
          id: user.id,
          name: user.name,
          email: user.email,
        };
      }
    }
  });
  await app.register(rbacPlugin, { meta });

  const hub = new RealtimeHub();
  const events: RealtimeEvent[] = [];
  hub.subscribe('config-changed', (event) => events.push(event));
  app.decorate('realtime', hub);

  await app.register(
    async (api) => {
      await api.register(i18nRoutes({ meta }));
    },
    { prefix: '/api/v1' },
  );
  await app.ready();

  return { app, meta, events, superAdmin, viewer };
}

/** A key that certainly exists in the compiled en-US bundles. */
const KEY = { locale: 'de_DE', namespace: 'common', key: 'account.title' } as const;

describe('i18n routes', () => {
  let t: Harness;

  beforeEach(async () => {
    t = await buildHarness();
  });

  afterEach(async () => {
    await t.app.close();
    await t.meta.db.destroy();
    resetRuntimeLocales();
  });

  const put = async (body: unknown, user = t.superAdmin) =>
    t.app.inject({ method: 'PUT', url: '/api/v1/i18n/keys', headers: asUser(user), payload: body });

  it('manifest lists the compiled eight, all enabled, with a zero version', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/v1/i18n/manifest',
      headers: asUser(t.viewer),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.version).toBe(0);
    expect(body.locales).toHaveLength(8);
    expect(body.locales.every((l: { builtin: boolean; enabled: boolean }) => l.builtin && l.enabled)).toBe(true);
    expect(body.locales.find((l: { locale: string }) => l.locale === 'ar_EG').dir).toBe('rtl');
  });

  it('refuses writes without settings.manage', async () => {
    const res = await put({ ...KEY, value: 'Mein Konto' }, t.viewer);
    expect(res.statusCode).toBe(403);
  });

  it('stores an override, bumps the version and broadcasts', async () => {
    const res = await put({ ...KEY, value: 'Mein Konto' });
    expect(res.statusCode).toBe(200);
    expect(res.json().version).toBe(1);
    expect(t.events.some((e) => e.type === I18N_CHANGED)).toBe(true);

    const bundle = await t.app.inject({
      method: 'GET',
      url: '/api/v1/i18n/bundle/de_DE/common',
      headers: asUser(t.viewer),
    });
    // OVERRIDES only — never the compiled bundle (23 §6.1).
    expect(bundle.json().overrides).toEqual({ 'account.title': 'Mein Konto' });
  });

  it('resets to the built-in with a hard delete and bumps again', async () => {
    await put({ ...KEY, value: 'Mein Konto' });
    const res = await t.app.inject({
      method: 'DELETE',
      url: '/api/v1/i18n/keys?locale=de_DE&namespace=common&key=account.title',
      headers: asUser(t.superAdmin),
    });
    expect(res.statusCode).toBe(200);
    // The version MUST move on a delete — a MAX(updated_at) stamp could not
    // see this, and it is the most common admin operation (23 §3.4).
    expect(res.json().version).toBe(2);
    expect(await translationsRepo(t.meta).get(KEY)).toBeNull();
  });

  it('rejects an unknown key so a bad import cannot grow junk rows', async () => {
    const res = await put({ ...KEY, key: 'not.a.real.key', value: 'x' });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('ERR_I18N_INVALID_MESSAGE');
  });

  it('rejects placeholder drift and a changed placeholder type', async () => {
    // `studio.remap.diff.count` is `{count} changes` in en-US.
    const drift = await put({
      locale: 'de_DE',
      namespace: 'common',
      key: 'studio.remap.diff.count',
      value: 'Änderungen',
    });
    expect(drift.statusCode).toBe(422);

    // Type change is the literal-token hazard (23 §4.6).
    const typed = await put({
      locale: 'de_DE',
      namespace: 'common',
      key: 'studio.remap.diff.count',
      value: '{count, number} Änderungen',
    });
    expect(typed.statusCode).toBe(422);

    const ok = await put({
      locale: 'de_DE',
      namespace: 'common',
      key: 'studio.remap.diff.count',
      value: '{count} Änderungen',
    });
    expect(ok.statusCode).toBe(200);
  });

  it('refuses to blank a key that feeds an accessible name', async () => {
    const keys = await t.app.inject({
      method: 'GET',
      url: '/api/v1/i18n/keys?locale=de_DE&namespace=common&state=all&limit=200',
      headers: asUser(t.superAdmin),
    });
    const critical = keys
      .json()
      .items.find((row: { a11yCritical: boolean }) => row.a11yCritical) as { key: string } | undefined;
    expect(critical, 'expected at least one a11y-critical key in common').toBeDefined();

    const blanked = await put({
      locale: 'de_DE',
      namespace: 'common',
      key: critical?.key,
      value: '',
    });
    expect(blanked.statusCode).toBe(422);
    expect(blanked.json().error.message).toMatch(/accessible name/i);
  });

  it('reports item-wise rejections in a bulk write instead of failing the batch', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/i18n/keys/bulk',
      headers: asUser(t.superAdmin),
      payload: {
        items: [
          { ...KEY, value: 'Mein Konto' },
          { ...KEY, key: 'nope.not.here', value: 'x' },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().written).toBe(1);
    expect(res.json().rejected).toHaveLength(1);
  });

  it('locks the immutable fields of a built-in locale', async () => {
    const hijack = await t.app.inject({
      method: 'PATCH',
      url: '/api/v1/i18n/locales/ar_EG',
      headers: asUser(t.superAdmin),
      payload: { dir: 'ltr' },
    });
    expect(hijack.statusCode).toBe(422);
    expect(hijack.json().error.code).toBe('ERR_I18N_BUILTIN_FIELD_LOCKED');

    const disable = await t.app.inject({
      method: 'PATCH',
      url: '/api/v1/i18n/locales/ar_EG',
      headers: asUser(t.superAdmin),
      payload: { enabled: false },
    });
    expect(disable.statusCode).toBe(200);
    expect(disable.json().locale.enabled).toBe(false);
    expect(disable.json().locale.dir).toBe('rtl');
  });

  it('creates a custom locale with frozen plural categories from its borrow tag', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/i18n/locales',
      headers: asUser(t.superAdmin),
      payload: {
        locale: 'tlh_KL',
        english: 'Klingon',
        native: 'tlhIngan Hol',
        dir: 'ltr',
        fontHint: 'latin',
        intlTag: 'pl-PL',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().locale.pluralCategories).toEqual(
      expect.arrayContaining(['one', 'few', 'many', 'other']),
    );
  });

  it('rejects a borrow tag no ICU implementation has rules for', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/i18n/locales',
      headers: asUser(t.superAdmin),
      payload: {
        locale: 'xx_YY',
        english: 'X',
        native: 'X',
        dir: 'ltr',
        fontHint: 'latin',
        intlTag: 'not a tag',
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('ERR_I18N_BAD_INTL_TAG');
  });

  it('refuses to delete a compiled locale', async () => {
    const res = await t.app.inject({
      method: 'DELETE',
      url: '/api/v1/i18n/locales/de_DE',
      headers: asUser(t.superAdmin),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('ERR_I18N_BUILTIN_LOCALE');
  });

  it('refuses to delete the workspace default', async () => {
    await t.app.inject({
      method: 'POST',
      url: '/api/v1/i18n/locales',
      headers: asUser(t.superAdmin),
      payload: { locale: 'sw_KE', english: 'Swahili', native: 'Kiswahili', dir: 'ltr', fontHint: 'latin', intlTag: 'sw-KE' },
    });
    await settingsRepo(t.meta).set('locale.default', 'sw_KE');

    const res = await t.app.inject({
      method: 'DELETE',
      url: '/api/v1/i18n/locales/sw_KE',
      headers: asUser(t.superAdmin),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('ERR_I18N_LOCALE_IS_DEFAULT');
  });

  // The delete has to reach FOUR stores (23 §5.7). Missing one leaves an
  // orphan that renders as a raw identifier or collides on a unique index.
  it('cleans up user prefs, overrides and email variants when a locale is deleted', async () => {
    await t.app.inject({
      method: 'POST',
      url: '/api/v1/i18n/locales',
      headers: asUser(t.superAdmin),
      payload: { locale: 'sw_KE', english: 'Swahili', native: 'Kiswahili', dir: 'ltr', fontHint: 'latin', intlTag: 'sw-KE' },
    });
    await put({ locale: 'sw_KE', namespace: 'common', key: 'account.title', value: 'Akaunti' });
    await userPrefsRepo(t.meta).set(t.viewer.id, { locale: 'sw_KE' });
    await emailTemplatesRepo(t.meta).upsert('password-reset', 'sw_KE', {
      name: 'Reset',
      subject: 'Weka upya',
      blocks: [],
      enabled: true,
    });

    const res = await t.app.inject({
      method: 'DELETE',
      url: '/api/v1/i18n/locales/sw_KE?reassignTo=inherit',
      headers: asUser(t.superAdmin),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.reassignedUsers).toBe(1);
    expect(body.deletedOverrides).toBe(1);
    expect(body.deletedEmailTemplates).toBe(1);

    // `inherit` means NULL — back to following the workspace default, which is
    // the state the user was in before they ever chose.
    expect((await userPrefsRepo(t.meta).get(t.viewer.id))?.locale).toBeNull();
    expect(await translationsRepo(t.meta).listLocale('sw_KE')).toEqual([]);
    expect(await emailTemplatesRepo(t.meta).findByKeyLocale('password-reset', 'sw_KE')).toBeNull();
  });

  it('marks a row stale once the en-US source moves under it', async () => {
    await translationsRepo(t.meta).upsert({
      ...KEY,
      value: 'Mein Konto',
      sourceText: 'Something the English used to say',
    });
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/v1/i18n/keys?locale=de_DE&namespace=common&state=stale&limit=50',
      headers: asUser(t.superAdmin),
    });
    expect(res.json().items.some((row: { key: string }) => row.key === 'account.title')).toBe(true);
  });
});

describe('i18n transfer (23 §3.6)', () => {
  let t: Harness;

  beforeEach(async () => {
    t = await buildHarness();
  });
  afterEach(async () => {
    await t.app.close();
    await t.meta.db.destroy();
    resetRuntimeLocales();
  });

  const exportLocale = async (locale: string) =>
    t.app.inject({
      method: 'GET',
      url: `/api/v1/i18n/export/${locale}`,
      headers: asUser(t.superAdmin),
    });

  const importLocale = async (locale: string, payload: unknown, includeSensitive = false) =>
    t.app.inject({
      method: 'POST',
      url: `/api/v1/i18n/import/${locale}?includeSensitive=${String(includeSensitive)}`,
      headers: asUser(t.superAdmin),
      payload,
    });

  it('round-trips a locale', async () => {
    await t.app.inject({
      method: 'PUT',
      url: '/api/v1/i18n/keys',
      headers: asUser(t.superAdmin),
      payload: { ...KEY, value: 'Mein Konto' },
    });

    const exported = await exportLocale('de_DE');
    expect(exported.statusCode).toBe(200);
    expect(exported.json().entries.common['account.title']).toBe('Mein Konto');

    const imported = await importLocale('fr_FR', exported.json());
    expect(imported.statusCode).toBe(200);
    expect(imported.json().written).toBe(1);
    expect(await translationsRepo(t.meta).get({ locale: 'fr_FR', namespace: 'common', key: 'account.title' })).not.toBeNull();
  });

  // An import must never GROW the key space — that is how a bad file quietly
  // fills the table with rows nobody can find or delete.
  it('rejects keys this build does not have', async () => {
    const res = await importLocale('de_DE', {
      formatVersion: 1,
      entries: { common: { 'totally.made.up': 'x' } },
    });
    expect(res.json().written).toBe(0);
    expect(res.json().rejected[0].reason).toMatch(/No such key/);
  });

  // Carrying translations turns import into a UI-copy injection channel; the
  // error and sign-in namespaces need saying yes on purpose (23 §3.6).
  it('refuses error copy without an explicit opt-in, and reports the count', async () => {
    const payload = { formatVersion: 1, entries: { errors: { NOT_FOUND: 'Gone.' } } };

    const refused = await importLocale('de_DE', payload, false);
    expect(refused.json().written).toBe(0);
    expect(refused.json().sensitiveCount).toBe(1);
    expect(refused.json().rejected[0].reason).toMatch(/explicit opt-in/);

    const allowed = await importLocale('de_DE', payload, true);
    expect(allowed.json().written).toBe(1);
  });

  it('applies the same message validation an editor write gets', async () => {
    const res = await importLocale('de_DE', {
      formatVersion: 1,
      entries: { common: { 'studio.remap.diff.count': '{count, number} Änderungen' } },
    });
    expect(res.json().written).toBe(0);
    expect(res.json().rejected[0].reason).toMatch(/placeholder/i);
  });

  it('refuses a document from an unknown format version', async () => {
    const res = await importLocale('de_DE', { formatVersion: 9, entries: {} });
    // 422 is this API's validation envelope (08-server-api.md §1.4).
    expect(res.statusCode).toBe(422);
  });
});
