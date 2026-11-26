// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A folder app's public access on a server whose project has no config file
 * (an operator project: a trial, or the hosted installation it became). The
 * folder is never given it by the reconciler; a person allows it, for the
 * list the server shows them, and takes it back. A manifest that asks for
 * more afterwards is applied without the more, which waits for another yes.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { auditRepo, publicEndpointsRepo, publicKeysRepo } from '@adminium/meta';

import type { InstallActor, InstallHost } from '../src/apps/install-service.js';
import { PERMISSIONS } from '../src/rbac/permissions.js';
import { ENGINES } from './app-install-harness.js';
import { folderHarness, type FolderHarness } from './folder-app-harness.js';

let h: FolderHarness;
afterEach(async () => {
  await h.close();
});

/** What anyone may read and send, as `app new --customer` grants it. */
const ACCESS = {
  publicAccess: [
    { table: 'items', methods: ['GET'], select: ['id', 'title', 'status'] },
    { table: 'requests', methods: ['POST'], select: ['id'], writable: ['message'] },
  ],
};

/** Someone signed in who may manage API keys, and someone who may not. */
const OWNER: InstallActor = { id: null, label: 'owner@example.com', superAdmin: async () => true, can: async () => true };
const NO_KEYS: InstallActor = { id: null, label: 'staff@example.com', superAdmin: async () => false, can: async (permission) => permission !== PERMISSIONS.apiKeysManage };
const HOST: InstallHost = { log: { info: () => undefined, warn: () => undefined } };

/** A change to the folder that touches nothing a stranger reaches: one more column of a table. */
const addColumn = (ref: string): void => {
  h.edit('apps/repairs/manifest/tables/items.json', (table) => ({ ...table, columns: [...(table['columns'] as unknown[]), { ref, type: 'text', maxLength: 40, nullable: true }] }));
};

const stored = async (): Promise<[string, string[]][]> =>
  (await publicEndpointsRepo(h.harness.meta).listByConnection(h.harness.connectionId))
    .filter((endpoint) => endpoint.managedBy === 'repairs')
    .map((endpoint): [string, string[]] => [endpoint.ref, (JSON.parse(endpoint.definition) as { select: string[] }).select])
    .sort(([a], [b]) => a.localeCompare(b));

const liveKeys = async (): Promise<string[]> =>
  (await publicKeysRepo(h.harness.meta).listManagedBy('repairs')).filter((key) => key.revokedAt === null).map((key) => key.id);

const view = async (actor: InstallActor = OWNER) => {
  const found = await h.service.folderAccess.view(actor, 'repairs');
  if (found === null) throw new Error('the app asks for no public access');
  return found;
};

/** The person's yes, run in turn with the folder's applies as the route runs it. */
const allow = async (actor: InstallActor = OWNER, checksum?: string) =>
  h.apps().inTurn(async () => h.service.folderAccess.allow(actor, HOST, { key: 'repairs', checksum: checksum ?? (await view(actor)).checksum }));
const takeBack = (actor: InstallActor = OWNER) => h.apps().inTurn(() => h.service.folderAccess.takeBack(actor, HOST, { key: 'repairs' }));

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`a folder app's public access where a person allows it [${dialect}]`, { timeout: 120_000 }, () => {
    it('installs with none, says who allows it, and lists what waits', async () => {
      h = await folderHarness(dialect, { mode: 'server', accessBy: 'person' });
      await h.newApp('repairs');
      h.put('apps/repairs/manifest/access.json', ACCESS);
      expect((await h.sync())[0]).toEqual({ key: 'repairs', state: 'installed', hash: expect.any(String), accessWaits: true });

      expect(await stored()).toEqual([]);
      expect(await liveKeys()).toEqual([]);
      const log = h.lines.log.join('\n');
      expect(log).toContain('App "repairs" is installed WITHOUT public access: nobody has allowed it yet');
      expect(log).toContain('on the app’s settings page');
      // No config file exists to name: the words of a config project are not said here.
      expect(log).not.toContain('adminium.config.ts');
      expect(h.lines.warn).toEqual([]);

      const shown = await view();
      expect(shown).toMatchObject({ key: 'repairs', open: false, waiting: 2, wider: [] });
      expect(shown.access.canGrant).toBe(true);
      expect(shown.access.endpoints.map((entry) => [entry.table, entry.methods, entry.onUpdate])).toEqual([
        ['items', ['GET'], 'granted'],
        ['requests', ['POST'], 'granted'],
      ]);
      // Someone who may not manage API keys sees the same list, and that it is not theirs to allow.
      expect((await view(NO_KEYS)).access.canGrant).toBe(false);
    });

    it('opens on a person’s yes for the list they were shown, and on nothing else', async () => {
      h = await folderHarness(dialect, { mode: 'server', accessBy: 'person' });
      await h.newApp('repairs');
      h.put('apps/repairs/manifest/access.json', ACCESS);
      await h.sync();

      // Not theirs to allow.
      await expect(allow(NO_KEYS)).rejects.toMatchObject({ statusCode: 403 });
      // Not the list that is there now.
      await expect(allow(OWNER, 'another-list')).rejects.toMatchObject({ statusCode: 409, details: { reason: 'ACCESS_CHANGED' } });
      expect(await stored()).toEqual([]);
      expect(await liveKeys()).toEqual([]);

      const after = await allow();
      expect(after).toMatchObject({ open: true, waiting: 0, skipped: [] });
      expect(after.access.endpoints.map((entry) => entry.onUpdate)).toEqual(['held', 'held']);
      expect((await stored()).map(([, select]) => select)).toEqual(expect.arrayContaining([['id', 'title', 'status'], ['id']]));
      expect(await liveKeys()).toHaveLength(1);

      // Audited as the person's, never as the folder's.
      const audit = (await auditRepo(h.harness.meta).list({ limit: 200 })).filter((entry) => entry.action === 'app.public-access-allowed' || entry.action === 'public-key.create');
      expect(audit.map((entry) => [entry.action, entry.actorKind, entry.actorLabel]).sort()).toEqual([
        ['app.public-access-allowed', 'user', 'owner@example.com'],
        ['public-key.create', 'user', 'owner@example.com'],
      ]);

      // The folder as it was is applied again with nothing to say: the key is the yes a later apply reads.
      expect((await h.sync())[0]).toEqual({ key: 'repairs', state: 'unchanged', hash: expect.any(String) });
      addColumn('colour');
      expect((await h.sync())[0]).toEqual({ key: 'repairs', state: 'applied', hash: expect.any(String) });
      expect(await liveKeys()).toHaveLength(1);
      expect(h.lines.warn).toEqual([]);
    });

    it('asks again when the manifest asks for more: a wider entry and a new one both wait', async () => {
      h = await folderHarness(dialect, { mode: 'server', accessBy: 'person' });
      await h.newApp('repairs');
      // Strangers may read items, and that is all a person allowed.
      h.put('apps/repairs/manifest/access.json', { publicAccess: [ACCESS.publicAccess[0]] });
      await h.sync();
      await allow();
      const before = await stored();
      expect(before).toHaveLength(1);
      const items = before[0]?.[0] as string;
      const [key] = await liveKeys();

      // The folder now shows them one more column of items, and lets them send requests too.
      h.put('apps/repairs/manifest/access.json', { publicAccess: [{ ...ACCESS.publicAccess[0], select: ['id', 'title', 'status', 'notes'] }, ACCESS.publicAccess[1]] });
      const applied = (await h.sync())[0];
      // Applied, with the more left out: not a fault of the folder, so no warning the Designer would try to mend.
      expect(applied).toEqual({ key: 'repairs', state: 'applied', hash: expect.any(String), accessWaits: true });
      expect(h.lines.warn).toEqual([]);
      expect(h.lines.log.join('\n')).toContain('App "repairs" asks for public access that is not open: nobody has allowed it yet');
      // What strangers reach is what was allowed, to the column.
      expect((await stored()).find(([ref]) => ref === items)?.[1]).toEqual(['id', 'title', 'status']);
      expect(await stored()).toHaveLength(2);
      const held = await h.harness.deps.publicAccess?.service.heldByKey(h.harness.connectionId, key as string);
      expect([...(held ?? new Map<string, string[]>()).values()].flat()).toEqual(['GET']);

      const shown = await view();
      expect(shown.open).toBe(true);
      expect(shown.waiting).toBe(2);
      expect(shown.wider).toEqual([expect.objectContaining({ ref: items, columns: ['notes'] })]);
      expect(shown.access.endpoints.map((entry) => [entry.table, entry.onUpdate])).toEqual([
        ['items', 'held'],
        ['requests', 'granted'],
      ]);

      // The yes for the list as it was shown before the change is not a yes for this one.
      const after = await allow();
      expect(after).toMatchObject({ open: true, waiting: 0, wider: [], skipped: [] });
      expect((await stored()).find(([ref]) => ref === items)?.[1]).toEqual(['id', 'title', 'status', 'notes']);
      // The same key, now with what was allowed: nobody's link or page changes.
      expect(await liveKeys()).toEqual([key]);
      const now = await h.harness.deps.publicAccess?.service.heldByKey(h.harness.connectionId, key as string);
      expect([...(now ?? new Map<string, string[]>()).values()].flat().sort()).toEqual(['GET', 'POST']);
    });

    it('loses at once what the manifest stops asking for, with nobody asked', async () => {
      h = await folderHarness(dialect, { mode: 'server', accessBy: 'person' });
      await h.newApp('repairs');
      h.put('apps/repairs/manifest/access.json', ACCESS);
      await h.sync();
      await allow();
      const [key] = await liveKeys();

      h.put('apps/repairs/manifest/access.json', { publicAccess: [ACCESS.publicAccess[0]] });
      expect((await h.sync())[0]).toEqual({ key: 'repairs', state: 'applied', hash: expect.any(String) });
      const held = await h.harness.deps.publicAccess?.service.heldByKey(h.harness.connectionId, key as string);
      expect([...(held ?? new Map<string, string[]>()).values()].flat()).toEqual(['GET']);
      expect(await view()).toMatchObject({ open: true, waiting: 0 });
    });

    it('is taken back by a person, and allowed again makes a key again', async () => {
      h = await folderHarness(dialect, { mode: 'server', accessBy: 'person' });
      await h.newApp('repairs');
      h.put('apps/repairs/manifest/access.json', ACCESS);
      await h.sync();
      await allow();
      const [first] = await liveKeys();

      await expect(takeBack(NO_KEYS)).rejects.toMatchObject({ statusCode: 403 });
      expect(await liveKeys()).toEqual([first]);

      expect(await takeBack()).toMatchObject({ open: false, waiting: 2 });
      expect(await liveKeys()).toEqual([]);
      expect(await stored()).toEqual([]);
      const taken = (await auditRepo(h.harness.meta).list({ limit: 200 })).filter((entry) => entry.action === 'app.public-access-taken-back' || entry.action === 'public-key.revoke');
      expect(taken.map((entry) => [entry.action, entry.actorLabel]).sort()).toEqual([
        ['app.public-access-taken-back', 'owner@example.com'],
        ['public-key.revoke', 'owner@example.com'],
      ]);

      // The folder applied again does not open it: taken back stays taken back until a person says otherwise.
      addColumn('colour');
      expect((await h.sync())[0]).toMatchObject({ state: 'applied', accessWaits: true });
      expect(await liveKeys()).toEqual([]);
      expect(await stored()).toEqual([]);

      // A person's new yes is not an update: the key they took back is made again.
      expect(await allow()).toMatchObject({ open: true, waiting: 0 });
      const again = await liveKeys();
      expect(again).toHaveLength(1);
      expect(again[0]).not.toBe(first);
      expect(await stored()).toHaveLength(2);
    });

    it('keeps the committed config as the say in a project that has one', async () => {
      h = await folderHarness(dialect, { mode: 'server' });
      await h.newApp('repairs');
      h.put('apps/repairs/manifest/access.json', ACCESS);
      // Today's rule, word for word: no access, and the config named as the place.
      expect((await h.sync())[0]).toEqual({ key: 'repairs', state: 'installed', hash: expect.any(String) });
      expect(h.lines.log.join('\n')).toContain('set apps.repairs.publicAccess to true to give it what its manifest declares');
      expect(await stored()).toEqual([]);
    });
  });
}
