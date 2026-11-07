// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN ADD-ON'S SETTINGS, KEPT PER COPY.
 *
 * The app, with the add-on it suggests, is installed on two databases:
 * Studio (the engine under test) and Kiln (SQLite). The owner of both keeps
 * both copies' settings: the bootstrap names each copy by its address and
 * its database, and a save names its copy (`X-Adminium-Install`) and lands
 * there. With no copy named, two copies are never guessed between. The
 * owner of Studio's copy alone is told of that one, and refused Kiln's.
 */
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { addOnSettingsRepo, manifestsRepo, rolesRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runIntrospection } from '../src/connections/introspect.js';
import { addOnHarness, addOnManifest, appManifest, CRYPTO, type Harness } from './app-add-ons.helpers.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { LEGS } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

const KEY = 'holidays';
const holidays = addOnManifest(KEY, {
  version: '1.0.0',
  name: 'Holiday Calendars',
  settings: [{ key: 'days', type: 'json', default: [] }],
  addOn: { attaches: [{ app: '*' }] },
});
const shop = appManifest('studio', {
  addOns: { suggests: [{ key: KEY, range: '^1.0.0', reason: { 'en-US': 'The days the studio is closed.' } }] },
  roles: [{ key: 'owner', name: 'Owner', permissions: ['table:@jobs:read', `addOn:${KEY}:settings`] }],
});

describe.each(LEGS)('settings kept per copy of an add-on — %s', (dialect, available) => {
  let h: Harness;
  let served: Served;
  let kiln: string;
  const copies = { studio: '', kiln: '' };
  const people: Record<'both' | 'studio', { cookie: string }> = {} as never;
  let signIns = 0;

  const person = async (email: string, ...slugs: string[]) => {
    const user = await usersRepo(h.meta).create({ email, name: email.split('@')[0]!, passwordHash: await adminPasswordHash() });
    for (const slug of slugs) await rolesRepo(h.meta).assignToUser(user.id, (await rolesRepo(h.meta).findBySlug(slug))!.id);
    signIns += 1;
    const res = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.11.0.${String(signIns)}`, payload: { email, password: ADMIN_PASSWORD } });
    expect(res.statusCode, res.body).toBe(200);
    return { cookie: sessionCookie(res.headers['set-cookie']) };
  };
  const kept = async (who: { cookie: string }) => {
    const res = await served.composed.app.inject({ method: 'GET', url: '/api/v1/bootstrap', headers: { cookie: who.cookie } });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: { addOnSettings?: { key: string; name: string; connectionName?: string | null }[] } }).data.addOnSettings;
  };
  const save = (who: { cookie: string }, days: unknown, install?: string) =>
    served.composed.app.inject({ method: 'PUT', url: `/api/v1/add-ons/${KEY}/settings`, headers: { cookie: who.cookie, ...(install === undefined ? {} : { 'x-adminium-install': install }) }, payload: { values: { days } } });

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    const file = join(h.dataDir, 'kiln.db');
    new BetterSqlite3(file).close();
    kiln = (await h.manager.connections.create({ name: 'Kiln', engine: 'sqlite', introspectDsn: `sqlite:${file}`, dataDsn: `sqlite:${file}` })).id;
    await runIntrospection({ manager: h.manager, meta: h.meta, connectionId: kiln });
    await h.stageAddOn(holidays);
    await h.stageApp(shop);
    for (const connectionId of [h.connectionId, kiln]) {
      const installed = await h.install('studio', '0.2.0', { connectionId, addOns: [{ key: KEY, version: '1.0.0' }] });
      expect(installed.statusCode, installed.body).toBe(200);
    }
    const manifests = manifestsRepo(h.meta, CRYPTO);
    copies.studio = (await manifests.findInScope(KEY, h.connectionId))!.row.id;
    copies.kiln = (await manifests.findInScope(KEY, kiln))!.row.id;
    served = await servePublic(h as never, null, { ADMINIUM_DATA_DIR: h.dataDir });
    people.both = await person('both@studio.test', 'studio-owner', 'studio-kiln-owner');
    people.studio = await person('studio@studio.test', 'studio-owner');
  }, 240_000);
  afterAll(async () => {
    if (!available) return;
    await served?.close();
    await h?.close();
  });

  it.skipIf(!available)('names each copy the owner keeps by its address and its database', async () => {
    expect(await kept(people.both)).toEqual([
      { key: KEY, name: 'Holiday Calendars', connectionName: 'Studio' },
      { key: `${KEY}~kiln`, name: 'Holiday Calendars', connectionName: 'Kiln' },
    ]);
    expect(await kept(people.studio)).toEqual([{ key: KEY, name: 'Holiday Calendars', connectionName: 'Studio' }]);
  });

  it.skipIf(!available)('saves to the copy named, never to a guess, and only for who keeps that copy', async () => {
    expect((await save(people.both, [])).statusCode).toBe(409);
    expect((await save(people.both, ['2026-12-25'], copies.kiln)).statusCode).toBe(200);
    const settings = addOnSettingsRepo(h.meta);
    expect((await settings.valuesForInstall(copies.kiln))['days']).toEqual(['2026-12-25']);
    expect((await settings.valuesForInstall(copies.studio))['days']).not.toEqual(['2026-12-25']);
    expect((await save(people.studio, ['2026-01-01'], copies.studio)).statusCode).toBe(200);
    expect((await save(people.studio, ['2026-01-01'], copies.kiln)).statusCode).toBe(403);
    expect((await settings.valuesForInstall(copies.kiln))['days']).toEqual(['2026-12-25']);
  });
});
