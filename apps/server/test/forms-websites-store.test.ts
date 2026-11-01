// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Your websites" as the meta store keeps it, on SQLite, Postgres and MySQL:
 *
 *  - the list at its full width (fifty websites, each origin as long as an
 *    origin may be, each listed by the longest id) and the add-on pages'
 *    hosts at theirs, read back exactly as written (Postgres and MySQL hand
 *    the JSON back parsed, SQLite as text);
 *  - an add is all or none: one refused line adds nothing, and the list
 *    never grows past fifty;
 *  - a removal takes one website off; an unlisted one is said to be unlisted;
 *  - the forms door's read is kept a few seconds, and a save on this server
 *    drops it at once: no restart.
 */
import { settingsRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { addWebsites, forgetListedWebsites, listedWebsitesOf, readWebsites, removeWebsite, WEBSITES_CACHE_MS } from '../src/forms/websites.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

/** An https origin exactly 255 characters long: four labels, the longest a label may be. */
function longOrigin(n: number): string {
  const tag = String(n).padStart(2, '0');
  const host = `${'a'.repeat(61)}${tag}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(55)}`;
  return `https://${host}`;
}

describe.each(META_ENGINES)('"Your websites" in the meta store — $name', (engine) => {
  let handle: MetaHandle;
  let owner = '';

  beforeAll(async () => {
    if (!engine.available) return;
    handle = await engine.make();
    owner = (await usersRepo(handle.meta).create({ email: 'owner@websites.test', name: 'Tessa Marlow' })).id;
    await settingsRepo(handle.meta).set('system.publicOrigin', 'https://crm.meridian.example', { updatedBy: null });
  }, 60_000);

  afterAll(async () => {
    if (!engine.available) return;
    await handle.destroy();
  });

  it.skipIf(!engine.available)('keeps fifty of the longest origins, each by the longest id, and the page hosts at their widest, exactly', async () => {
    const settings = settingsRepo(handle.meta);
    const full = Array.from({ length: 50 }, (_, n) => ({ origin: longOrigin(n), addedBy: 'u'.repeat(64), addedAt: 1_793_000_000_000 + n }));
    expect(full[0]!.origin).toHaveLength(255);
    await settings.set('publicPages.websites', full, { updatedBy: null });
    expect(await readWebsites(handle.meta)).toEqual(full);
    // A fifty-first is refused by the store itself.
    await expect(settings.set('publicPages.websites', [...full, { origin: 'https://one.more.example', addedBy: null, addedAt: 1 }], { updatedBy: null })).rejects.toThrow();

    const hosts = Object.fromEntries(Array.from({ length: 64 }, (_, n) => [`${'h'.repeat(245)}${String(n).padStart(2, '0')}.example`, { home: `/x/forms/${'f'.repeat(189)}${String(n).padStart(2, '0')}` }]));
    expect(Object.keys(hosts)[0]).toHaveLength(255);
    expect(Object.values(hosts)[0]!.home).toHaveLength(200);
    await settings.set('surfaces.pageHosts', hosts, { updatedBy: null });
    expect(await settings.get('surfaces.pageHosts')).toEqual(hosts);
    await settings.set('surfaces.pageHosts', {}, { updatedBy: null });
    await settings.set('publicPages.websites', [], { updatedBy: null });
  });

  it.skipIf(!engine.available)('adds several at once, all or none, and never past fifty', async () => {
    forgetListedWebsites(handle.meta);
    const by = { userId: owner, at: 1_793_000_000_000 };
    const refused = await addWebsites(handle.meta, ['https://www.meridian.example', 'http://events.meridian.example'], by);
    expect(refused).toMatchObject({ ok: false, tooMany: false });
    expect(refused.ok ? [] : refused.lines.map((line) => line.code)).toEqual(['ok', 'https']);
    expect(await readWebsites(handle.meta)).toEqual([]);

    const added = await addWebsites(handle.meta, ['HTTPS://WWW.Meridian.Example/', 'https://shop.meridian.example:443'], by);
    expect(added).toMatchObject({ ok: true, added: ['https://www.meridian.example', 'https://shop.meridian.example'] });
    expect(await readWebsites(handle.meta)).toEqual([
      { origin: 'https://www.meridian.example', addedBy: owner, addedAt: by.at },
      { origin: 'https://shop.meridian.example', addedBy: owner, addedAt: by.at },
    ]);

    // This server's own address, and one already listed.
    const again = await addWebsites(handle.meta, ['https://crm.meridian.example', 'https://shop.meridian.example'], by);
    expect(again.ok ? [] : again.lines.map((line) => line.code)).toEqual(['self', 'listed']);

    // Forty-nine more would make fifty-one: none of them is added.
    const many = Array.from({ length: 49 }, (_, n) => `https://site-${String(n)}.example`);
    const over = await addWebsites(handle.meta, many, by);
    expect(over).toMatchObject({ ok: false, tooMany: true });
    expect(await readWebsites(handle.meta)).toHaveLength(2);
    expect((await addWebsites(handle.meta, many.slice(0, 48), by)).ok).toBe(true);
    expect(await readWebsites(handle.meta)).toHaveLength(50);
  });

  it.skipIf(!engine.available)('takes one website off, and says so of one not listed', async () => {
    const by = { userId: owner, at: 1_793_000_000_500 };
    const removed = await removeWebsite(handle.meta, 'https://shop.meridian.example', by);
    expect(removed.removed).toBe(true);
    expect(removed.websites.map((site) => site.origin)).not.toContain('https://shop.meridian.example');
    expect((await removeWebsite(handle.meta, 'https://shop.meridian.example', by)).removed).toBe(false);
    expect(await readWebsites(handle.meta)).toHaveLength(49);
    await settingsRepo(handle.meta).set('publicPages.websites', [], { updatedBy: null });
  });

  it.skipIf(!engine.available)('the forms door’s read is kept a few seconds; a save here drops it at once', async () => {
    forgetListedWebsites(handle.meta);
    let clock = 1_000_000;
    const listed = listedWebsitesOf(handle.meta, () => clock);
    expect(await listed()).toEqual([]);
    // Written past this module (another server process): not seen until the kept read runs out.
    await settingsRepo(handle.meta).set('publicPages.websites', [{ origin: 'https://www.meridian.example', addedBy: null, addedAt: 1 }], { updatedBy: null });
    expect(await listed()).toEqual([]);
    clock += WEBSITES_CACHE_MS;
    expect(await listed()).toEqual(['https://www.meridian.example']);
    // Saved through this module: seen on the very next read, the clock unmoved.
    await addWebsites(handle.meta, ['https://shop.meridian.example'], { userId: owner, at: clock });
    expect(await listed()).toEqual(['https://www.meridian.example', 'https://shop.meridian.example']);
    await removeWebsite(handle.meta, 'https://www.meridian.example', { userId: owner, at: clock });
    expect(await listed()).toEqual(['https://shop.meridian.example']);
  });
});
