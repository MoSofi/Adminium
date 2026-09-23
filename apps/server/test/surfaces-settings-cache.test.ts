// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The placement cache as the availability gate reads it: app statuses, the
 * per-side `off` switch, and what it answers when the meta store fails.
 */
import BetterSqlite3 from 'better-sqlite3';
import { sql } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';
import { createSqliteMetaDb, firstRun, manifestsRepo, settingsRepo, type MetaDb } from '@adminium/meta';

import {
  availabilityOf,
  createSurfaceSettings,
  forgetAppSurfaceSettings,
  NO_SURFACE_SETTINGS,
  sideOffOf,
} from '../src/surfaces/settings.js';

let meta: MetaDb | null = null;
afterEach(async () => {
  await meta?.db.destroy();
  meta = null;
});

async function freshMeta(): Promise<MetaDb> {
  meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  return meta;
}

async function installApp(db: MetaDb, key: string): Promise<string> {
  const row = await manifestsRepo(db, { encrypt: (v) => v, decrypt: (v) => v }).install({
    manifestKey: key,
    version: '1.0.0',
    kind: 'app',
    source: 'file',
    document: { key },
  });
  return row.row.id;
}

describe('the surface settings cache', () => {
  it('reads each app’s status and switched-off sides, and says what may answer', async () => {
    const db = await freshMeta();
    await installApp(db, 'pos');
    const bookings = await installApp(db, 'bookings');
    await manifestsRepo(db, { encrypt: (v) => v, decrypt: (v) => v }).setStatus(bookings, 'disabled');
    await settingsRepo(db).set('surfaces.apps', { pos: { off: ['customer'] }, bookings: { off: ['staff'] } });

    const settings = await createSurfaceSettings({ meta: db }).read();
    expect(settings.statuses).toEqual({ pos: 'installed', bookings: 'disabled' });
    expect(sideOffOf(settings, 'pos', 'customer')).toBe(true);
    expect(availabilityOf(settings, 'pos', 'staff')).toBe('ok');
    expect(availabilityOf(settings, 'pos', 'customer')).toBe('side-off');
    // Disabled is the whole app, and wins over a side that is also off.
    expect(availabilityOf(settings, 'bookings', 'staff')).toBe('app-disabled');
    expect(availabilityOf(settings, 'bookings', 'customer')).toBe('app-disabled');
    // Not this switch's to turn off: a surface the store does not list.
    expect(availabilityOf(settings, 'directory-app', 'staff')).toBe('ok');
  });

  it('keeps the last good value when a refresh fails, and tries again on the next read', async () => {
    const db = await freshMeta();
    const id = await installApp(db, 'pos');
    await manifestsRepo(db, { encrypt: (v) => v, decrypt: (v) => v }).setStatus(id, 'disabled');
    let clock = 0;
    const cache = createSurfaceSettings({ meta: db, now: () => clock });
    expect((await cache.read()).statuses.pos).toBe('disabled');

    // The store fails after the TTL: the disabled app must stay disabled.
    await sql`ALTER TABLE adminium_manifests RENAME TO adminium_manifests_gone`.execute(db.db);
    clock = 60_000;
    expect(availabilityOf(await cache.read(), 'pos', 'staff')).toBe('app-disabled');

    // Recovered: the next read goes back to the store rather than a cached failure.
    await sql`ALTER TABLE adminium_manifests_gone RENAME TO adminium_manifests`.execute(db.db);
    await manifestsRepo(db, { encrypt: (v) => v, decrypt: (v) => v }).setStatus(id, 'installed');
    expect((await cache.read()).statuses.pos).toBe('installed');
  });

  it('fails open with nothing read yet', async () => {
    const db = await freshMeta();
    await sql`ALTER TABLE adminium_manifests RENAME TO adminium_manifests_gone`.execute(db.db);
    expect(await createSurfaceSettings({ meta: db }).read()).toEqual(NO_SURFACE_SETTINGS);
  });
});

describe('the off switch in the settings store', () => {
  it('survives the store’s parse — a key only the type knew would be stripped', async () => {
    const db = await freshMeta();
    await settingsRepo(db).set('surfaces.apps', { pos: { staff: 'external', off: ['staff', 'customer'] } });
    expect(await settingsRepo(db).get('surfaces.apps')).toEqual({ pos: { staff: 'external', off: ['staff', 'customer'] } });
  });

  it('refuses a side that does not exist, and a side named twice', async () => {
    const db = await freshMeta();
    await expect(settingsRepo(db).set('surfaces.apps', { pos: { off: ['kitchen'] } } as never)).rejects.toThrow();
    await expect(settingsRepo(db).set('surfaces.apps', { pos: { off: ['staff', 'staff'] } })).rejects.toThrow();
  });

  it('goes with the app on uninstall', async () => {
    const db = await freshMeta();
    await settingsRepo(db).set('surfaces.apps', { pos: { off: ['customer'] }, other: { name: 'Other' } });
    await forgetAppSurfaceSettings(db, 'pos', null);
    expect(await settingsRepo(db).get('surfaces.apps')).toEqual({ other: { name: 'Other' } });
  });
});
