// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE ADDRESS IN EMAIL LINKS IS NEVER A MAPPED HOST, on every engine.
 *
 * A host an app's side or the add-on pages answer on opens them, not the
 * dashboard: a record's link, an invitation or a reset mailed there would
 * open the app. So:
 *
 *  - the address is never learnt from a request on such a host (a settings
 *    admin signing in on a staff side's host, which lets `/login` and `/api`
 *    through): the next request from the dashboard's own address is learnt;
 *  - "Address in email links" refuses a new address on one, naming the
 *    mapping that holds it, and a save of the other fields still goes while
 *    an address stored before is kept.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFirstSuperAdmin, settingsRepo, usersRepo, type MetaDb, type User } from '@adminium/meta';

import { buildServer, type AdminiumServer } from '../src/app.js';
import { emailSecretKey } from '../src/email/config.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { settingsRoutes } from '../src/routes/settings/index.js';
import { capturePublicOrigin, notePublicOrigin } from '../src/security/public-origin.js';
import { adminPasswordHash } from './auth-helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

const STAFF_HOST = 'pos.shop.example';
const PAGES_HOST = 'forms.shop.example';
const DASHBOARD = 'https://admin.shop.example';

/** What a browser sends with a same-origin write from a page on `host`. */
const from = (host: string) => ({ method: 'POST', headers: { host, origin: `https://${host}`, 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors' } });

describe.each(META_ENGINES)('the address in email links and the mapped hosts — $name', (engine) => {
  let handle: MetaHandle;
  let meta: MetaDb;
  let app: AdminiumServer;
  let owner: User;

  beforeAll(async () => {
    if (!engine.available) return;
    handle = await engine.make();
    meta = handle.meta;
    owner = await createFirstSuperAdmin(meta, { email: 'owner@shop.example', name: 'Owner', passwordHash: await adminPasswordHash() });
    app = await buildServer({ env: makeEnv(), logger: false, metaDb: meta });
    app.addHook('onRequest', async (request) => {
      const id = request.headers['x-test-user-id'];
      if (typeof id !== 'string') return;
      const user = await usersRepo(meta).findById(id);
      if (user !== null) (request as unknown as { user: unknown }).user = { id: user.id, name: user.name, email: user.email };
    });
    await app.register(rbacPlugin, { meta });
    await app.register(async (api) => api.register(settingsRoutes({ meta, emailKey: emailSecretKey(TEST_SECRET) })), { prefix: '/api/v1' });
    await app.ready();
    const settings = settingsRepo(meta);
    await settings.set('surfaces.domains', { [STAFF_HOST]: { appKey: 'pos', side: 'staff' } }, { updatedBy: null });
    await settings.set('surfaces.pageHosts', { [PAGES_HOST]: { home: '/x/forms/newsletter' } }, { updatedBy: null });
  }, 240_000);

  afterAll(async () => {
    if (!engine.available) return;
    await app.close();
    await handle.destroy();
  });

  const put = (publicOrigin: string | null, more: Record<string, unknown> = {}) =>
    app.inject({ method: 'PUT', url: '/api/v1/settings/email', headers: { 'x-test-user-id': owner.id }, payload: { publicOrigin, ...more } });
  const stored = () => settingsRepo(meta).get('system.publicOrigin');

  it.runIf(engine.available)('is not learnt from a request on a mapped host, and is learnt from the dashboard’s own', async () => {
    await settingsRepo(meta).unset('system.publicOrigin');
    notePublicOrigin(meta, null);
    const ctx = { meta, allowedOrigins: new Set<string>(), user: { id: owner.id, name: owner.name } };
    // A settings admin signed in on the staff side's host, then on the add-on pages' host: neither is the address.
    expect(await capturePublicOrigin(ctx, from(STAFF_HOST))).toBeNull();
    expect(await capturePublicOrigin(ctx, from(PAGES_HOST.toUpperCase()))).toBeNull();
    expect(await stored()).toBeNull();
    // The dashboard's own address is still learnt afterwards: a skipped request did not mark it known.
    expect(await capturePublicOrigin(ctx, from(new URL(DASHBOARD).host))).toBe(DASHBOARD);
    expect(await stored()).toBe(DASHBOARD);
  });

  it.runIf(engine.available)('refuses a new address on a mapped host, saying which mapping holds it; keeps an address stored before', async () => {
    await settingsRepo(meta).set('system.publicOrigin', DASHBOARD, { updatedBy: null });
    const staff = await put(`https://${STAFF_HOST}`);
    expect(staff.statusCode).toBe(422);
    expect(staff.json().error.message).toBe(`"${STAFF_HOST}" opens the staff side of "pos" (Surfaces, Domains): links in email there would open that instead of the dashboard. Use the dashboard's own address, or unmap "${STAFF_HOST}" first.`);
    expect(staff.json().error.details).toMatchObject({ field: 'publicOrigin', code: 'public_origin_mapped' });
    const pages = await put(`https://${PAGES_HOST}`);
    expect(pages.statusCode).toBe(422);
    expect(pages.json().error.message).toContain('opens the add-on pages');
    // Nothing of a refused save is written.
    expect(await stored()).toBe(DASHBOARD);

    // An address stored before its host was mapped (an upgrade) is not judged again: the rest of the card still saves.
    await settingsRepo(meta).set('system.publicOrigin', `https://${STAFF_HOST}`, { updatedBy: null });
    const again = await put(`https://${STAFF_HOST}`, { maxAttachmentBytes: 5_000_000 });
    expect(again.statusCode, again.body).toBe(200);
    expect(await settingsRepo(meta).get('email.maxAttachmentBytes')).toBe(5_000_000);
    // Another host is fine, and so is clearing it.
    expect((await put(DASHBOARD)).statusCode).toBe(200);
    expect(await stored()).toBe(DASHBOARD);
    expect((await put(null)).statusCode).toBe(200);
    expect(await stored()).toBeNull();
  });
});
