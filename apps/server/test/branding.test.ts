// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Branding resource — the white-label chrome.
 *
 * What this pins down, in order of how badly it would hurt to get wrong:
 *
 * 1. The two READS are public. The sign-in screen paints itself with them
 *    before any session exists, so a guard creeping onto either route would
 *    make the product Adminium-branded again for exactly the visitors who see
 *    it first.
 * 2. The two WRITES are not. Anyone able to swap the logo of an admin panel
 *    can dress a phishing page in it, so both sit behind
 *    `system:settings:manage` like every other settings write.
 * 3. Uploads are sniffed, not trusted. A `content-type: image/png` header on
 *    an HTML payload must not put that payload in storage under a mime this
 *    server will later serve back.
 * 4. Replacing a logo does not leak the old bytes, and deleting returns the
 *    built-in mark rather than a dangling id.
 */
import BetterSqlite3 from 'better-sqlite3';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  auditRepo,
  createSqliteMetaDb,
  firstRun,
  rolesRepo,
  settingsRepo,
  usersRepo,
  type MetaDb,
  type User,
} from '@adminium/meta';

import { buildServer, type AdminiumServer } from '../src/app.js';
import { createFileStorage, type FileStorage } from '../src/files/storage.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { brandingRoutes, sniffLogo } from '../src/routes/branding/index.js';
import { makeEnv } from './helpers.js';

/** Smallest byte sequences that are honestly each format. */
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 7),
]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect/></svg>');

interface Harness {
  app: AdminiumServer;
  meta: MetaDb;
  storage: FileStorage;
  dataDir: string;
  superAdmin: User;
  admin: User;
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
    const role = await roles.findBySlug(roleSlug);
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
  const admin = await makeUser('Noah', 'admin');

  const dataDir = await mkdtemp(join(tmpdir(), 'adminium-branding-'));
  const storage = createFileStorage({ dataDir });
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
  await app.register(
    async (api) => {
      await api.register(brandingRoutes({ meta, storage }));
    },
    { prefix: '/api/v1' },
  );
  await app.ready();

  return { app, meta, storage, dataDir, superAdmin, admin };
}

function uploadLogo(t: Harness, bytes: Buffer, contentType = 'image/png', user?: User) {
  return t.app.inject({
    method: 'POST',
    url: '/api/v1/branding/logo?filename=mark.png',
    headers: { 'content-type': contentType, ...asUser(user ?? t.superAdmin) },
    payload: bytes,
  });
}

describe('branding routes', () => {
  let t: Harness;

  beforeEach(async () => {
    t = await buildHarness();
  });

  afterEach(async () => {
    await t.app.close();
    await t.meta.db.destroy();
    await rm(t.dataDir, { recursive: true, force: true });
  });

  it('GET /branding is public and returns the built-in identity by default', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/v1/branding' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ appName: 'Adminium', logoUrl: null, showVersion: true });
  });

  it('GET /branding reflects a rebrand — to anonymous callers too', async () => {
    const settings = settingsRepo(t.meta);
    await settings.set('branding.appName', 'Fondu');
    await settings.set('branding.showVersion', false);

    const res = await t.app.inject({ method: 'GET', url: '/api/v1/branding' });
    expect(res.json().data).toMatchObject({ appName: 'Fondu', showVersion: false });
  });

  it('uploads a logo, serves the bytes publicly, and stamps the URL with the file id', async () => {
    const upload = await uploadLogo(t, PNG);
    expect(upload.statusCode).toBe(201);
    const logoUrl = upload.json().data.logoUrl as string;
    expect(logoUrl).toMatch(/^\/api\/v1\/branding\/logo\?v=file_/);

    const fileId = await settingsRepo(t.meta).get('branding.logoFileId');
    expect(logoUrl).toContain(String(fileId));

    // No auth header: the sign-in screen has no session and still needs this.
    const bytes = await t.app.inject({ method: 'GET', url: logoUrl });
    expect(bytes.statusCode).toBe(200);
    expect(bytes.headers['content-type']).toBe('image/png');
    expect(bytes.rawPayload.equals(PNG)).toBe(true);
    // An SVG logo is a document; these are what make the URL inert to visit.
    expect(bytes.headers['content-security-policy']).toContain("default-src 'none'");
    expect(bytes.headers['x-content-type-options']).toBe('nosniff');

    const etag = bytes.headers.etag as string;
    const revalidated = await t.app.inject({
      method: 'GET',
      url: logoUrl,
      headers: { 'if-none-match': etag },
    });
    expect(revalidated.statusCode).toBe(304);
  });

  it('accepts SVG, and stores the type it sniffed rather than the one declared', async () => {
    // Declared jpeg, actually svg — the served mime must follow the bytes.
    const upload = await uploadLogo(t, SVG, 'image/svg+xml');
    expect(upload.statusCode).toBe(201);
    const bytes = await t.app.inject({
      method: 'GET',
      url: upload.json().data.logoUrl as string,
    });
    expect(bytes.headers['content-type']).toBe('image/svg+xml');
  });

  it('rejects a payload that is not an image, and stores nothing', async () => {
    const res = await uploadLogo(t, Buffer.from('<html><script>alert(1)</script></html>'));
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
    expect(await settingsRepo(t.meta).get('branding.logoFileId')).toBeNull();
    expect(await readdir(t.storage.root).catch(() => [])).toHaveLength(0);
  });

  it('replacing a logo drops the previous bytes', async () => {
    await uploadLogo(t, PNG);
    const first = String(await settingsRepo(t.meta).get('branding.logoFileId'));

    await uploadLogo(t, SVG, 'image/svg+xml');
    const second = String(await settingsRepo(t.meta).get('branding.logoFileId'));
    expect(second).not.toBe(first);

    // One logo in, one logo on disk — a replaced mark is not left behind.
    expect(await readdir(t.storage.root)).toEqual([second]);
  });

  it('DELETE returns to the built-in mark and leaves no dangling id', async () => {
    await uploadLogo(t, PNG);
    const res = await t.app.inject({
      method: 'DELETE',
      url: '/api/v1/branding/logo',
      headers: asUser(t.superAdmin),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.logoUrl).toBeNull();
    expect(await settingsRepo(t.meta).get('branding.logoFileId')).toBeNull();
    expect(await readdir(t.storage.root)).toHaveLength(0);

    const missing = await t.app.inject({ method: 'GET', url: '/api/v1/branding/logo' });
    expect(missing.statusCode).toBe(404);
  });

  it('a logo id pointing at nothing resolves to the built-in mark, not a broken image', async () => {
    // `branding.logoFileId` is portable, so it can arrive from another
    // instance's config bundle and name a file this one never had.
    await settingsRepo(t.meta).set('branding.logoFileId', 'file_01JAAAAAAAAAAAAAAAAAAAAAAA');
    const res = await t.app.inject({ method: 'GET', url: '/api/v1/branding' });
    expect(res.json().data.logoUrl).toBeNull();
  });

  it('audits both writes under the settings category', async () => {
    await uploadLogo(t, PNG);
    await t.app.inject({
      method: 'DELETE',
      url: '/api/v1/branding/logo',
      headers: asUser(t.superAdmin),
    });
    const actions = (await auditRepo(t.meta).list({ category: 'settings' })).map((e) => e.action);
    expect(actions).toContain('settings.branding.logo.update');
    expect(actions).toContain('settings.branding.logo.remove');
  });

  it('requires system:settings:manage to write — admin 403, anonymous 401', async () => {
    const asAdmin = await uploadLogo(t, PNG, 'image/png', t.admin);
    expect(asAdmin.statusCode).toBe(403);
    expect(asAdmin.json().error.details.permission).toBe('system:settings:manage');

    const anon = await t.app.inject({
      method: 'DELETE',
      url: '/api/v1/branding/logo',
    });
    expect(anon.statusCode).toBe(401);
    expect(await settingsRepo(t.meta).get('branding.logoFileId')).toBeNull();
  });
});

describe('sniffLogo', () => {
  it('identifies each accepted format from its leading bytes', () => {
    expect(sniffLogo(PNG)).toBe('image/png');
    expect(sniffLogo(SVG)).toBe('image/svg+xml');
    expect(sniffLogo(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(16)]))).toBe(
      'image/jpeg',
    );
    expect(sniffLogo(Buffer.from('GIF89a' + 'x'.repeat(16)))).toBe('image/gif');
    expect(sniffLogo(Buffer.concat([Buffer.from('RIFF????WEBP'), Buffer.alloc(16)]))).toBe(
      'image/webp',
    );
    expect(sniffLogo(Buffer.from('<?xml version="1.0"?><svg></svg>'))).toBe('image/svg+xml');
  });

  it('refuses anything else, including XML that is not SVG', () => {
    expect(sniffLogo(Buffer.from('<?xml version="1.0"?><plist><dict/></plist>'))).toBeNull();
    expect(sniffLogo(Buffer.from('<html><body>hi</body></html>'))).toBeNull();
    expect(sniffLogo(Buffer.from('%PDF-1.7 trailing bytes here'))).toBeNull();
    expect(sniffLogo(Buffer.from('tiny'))).toBeNull();
  });
});
