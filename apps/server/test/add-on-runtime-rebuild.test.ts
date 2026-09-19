// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The runtime rebuild and uninstall's document half.
 *
 * ─── The behaviour `runtime.ts` claimed for a fortnight and never had ──────
 *
 * "Rebuild whole after each of the three routes" has been in that file since
 * wave 26. `compose.ts` built the state once, at boot, and kept it nowhere —
 * so a provider installed at 10am was unreachable until the process restarted,
 * round trip step `install-without-restart` could never have passed. Nothing
 * could have caught it: the runtime had no reader, so a stale one and a fresh
 * one were indistinguishable.
 *
 * These tests exercise the HOOKS rather than a live install, because a live
 * install needs a staged package and a real store — which
 * `add-on-routes.test.ts` already covers. What is asked here is the question
 * that file cannot: does uninstall reach the document tables, and in the right
 * order.
 */

import BetterSqlite3 from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import {
  addOnSettingsRepo,
  applyMigrations,
  connectionsRepo,
  createSqliteMetaDb,
  documentProfilesRepo,
  documentsRepo,
  initMetaDb,
  manifestsRepo,
  type DsnCrypto,
  type MetaDb,
} from '@adminium/meta';

const crypto: DsnCrypto = {
  encrypt: (plaintext) => `enc:${plaintext}`,
  decrypt: (ciphertext) => ciphertext.replace('enc:', ''),
};

async function freshMeta(): Promise<MetaDb> {
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await initMetaDb(meta);
  await applyMigrations(meta.db, { dialect: meta.dialect });
  return meta;
}

/** Exactly what `compose.ts` hands the add-on routes as `onAddOnRemoved`. */
async function onAddOnRemoved(meta: MetaDb, key: string): Promise<void> {
  await documentProfilesRepo(meta).setEnabledForAddOn(key, false);
  await addOnSettingsRepo(meta).clear(key);
}

describe('uninstall reaches the document tables, and stops there', () => {
  it('DISABLES the profiles and CLEARS the settings, keeping the documents', async () => {
    const meta = await freshMeta();
    const connectionId = (
      await connectionsRepo(meta, crypto).create({
        name: 'main',
        engine: 'postgres',
        introspectDsn: 'postgres://ro@localhost/app',
      })
    ).id;

    const profile = await documentProfilesRepo(meta).create({
      addOnKey: 'invoices',
      kind: 'invoice',
      name: 'Invoice',
      connectionId,
      table: 'public.orders',
      mapping: { customerName: { column: 'customer' } },
    });
    const document = await documentsRepo(meta).create({
      profileId: profile.id,
      addOnKey: 'invoices',
      kind: 'invoice',
      connectionId,
      entity: { connectionId, table: 'public.orders', pk: { id: 1 }, label: 'Order 1' },
      subject: { fields: { customerName: 'Acme' } },
      locale: 'en-US',
      format: 'pdf',
    });
    await documentsRepo(meta).markRendered(document.id, {
      number: 'INV-1',
      fileId: null,
      htmlFileId: null,
      format: 'pdf',
    });
    await addOnSettingsRepo(meta).patch('invoices', { business_name: 'Northwind' }, [
      { key: 'business_name' },
    ]);

    await onAddOnRemoved(meta, 'invoices');

    // The mapping SURVIVES, switched off: reinstalling should not mean
    // pointing twenty columns at twenty slots again.
    const after = await documentProfilesRepo(meta).findById(profile.id);
    expect(after, 'the profile must survive an uninstall').not.toBeNull();
    expect(after?.enabled).toBe(false);
    expect(after?.mapping).toEqual({ customerName: { column: 'customer' } });

    // The document is untouched — number, subject and all.
    const stillThere = await documentsRepo(meta).findById(document.id);
    expect(stillThere?.number).toBe('INV-1');
    expect(stillThere?.subject).toEqual({ fields: { customerName: 'Acme' } });

    // The add-on's OWN configuration goes with it. This is the one place
    // "uninstall keeps data" bends, and it bends because an add-on's settings
    // are part of the add-on rather than the customer's data.
    expect(await addOnSettingsRepo(meta).valuesFor('invoices')).toEqual({});
  });

  it('stops NOTHING belonging to another add-on', async () => {
    const meta = await freshMeta();
    const connectionId = (
      await connectionsRepo(meta, crypto).create({
        name: 'main',
        engine: 'postgres',
        introspectDsn: 'postgres://ro@localhost/app',
      })
    ).id;
    const mine = await documentProfilesRepo(meta).create({
      addOnKey: 'invoices',
      kind: 'invoice',
      name: 'Invoice',
      connectionId,
      table: 'public.orders',
      mapping: {},
    });
    const theirs = await documentProfilesRepo(meta).create({
      addOnKey: 'barcode-labels',
      kind: 'label-sheet',
      name: 'Labels',
      connectionId,
      table: 'public.parts',
      mapping: {},
    });
    await addOnSettingsRepo(meta).patch('barcode-labels', { codes: [] }, [{ key: 'codes' }]);

    await onAddOnRemoved(meta, 'invoices');

    expect((await documentProfilesRepo(meta).findById(mine.id))?.enabled).toBe(false);
    expect((await documentProfilesRepo(meta).findById(theirs.id))?.enabled).toBe(true);
    expect(await addOnSettingsRepo(meta).valuesFor('barcode-labels')).toEqual({ codes: [] });
  });

  it('a disabled profile no longer answers the matcher’s read', async () => {
    /*
     * The behavioural consequence, and the reason the order in the uninstall
     * handler matters: `onAddOnRemoved` runs BEFORE the manifest row goes, so
     * there is no window in which a write can enqueue a render for a provider
     * that is already gone.
     */
    const meta = await freshMeta();
    const connectionId = (
      await connectionsRepo(meta, crypto).create({
        name: 'main',
        engine: 'postgres',
        introspectDsn: 'postgres://ro@localhost/app',
      })
    ).id;
    await documentProfilesRepo(meta).create({
      addOnKey: 'invoices',
      kind: 'invoice',
      name: 'Invoice',
      connectionId,
      table: 'public.orders',
      mapping: {},
      trigger: { event: 'record.created' },
    });

    expect(
      await documentProfilesRepo(meta).listTriggeredBy(connectionId, 'public.orders'),
    ).toHaveLength(1);
    await onAddOnRemoved(meta, 'invoices');
    expect(
      await documentProfilesRepo(meta).listTriggeredBy(connectionId, 'public.orders'),
    ).toHaveLength(0);
  });
});

describe('the add-on routes call the hooks at all', () => {
  it('declares both, so a composition that forgets one is a type error', async () => {
    // The cheap half of "does it have a caller". The expensive half —
    // installing a real package and watching a provider appear without a
    // restart — is the round trip's, which needs a staged tarball.
    const { readFile } = await import('node:fs/promises');
    const routes = await readFile(
      new URL('../src/routes/add-ons/index.ts', import.meta.url),
      'utf8',
    );
    // Install, upgrade, enable/disable, uninstall, and an upload of the
    // installed version (files put back after a data directory was lost) —
    // five rebuild sites.
    expect(routes.match(/deps\.rebuildRuntime\?\.\(\)/g) ?? []).toHaveLength(5);
    expect(routes).toContain('deps.onAddOnRemoved?.(key)');

    const compose = await readFile(new URL('../src/compose.ts', import.meta.url), 'utf8');
    expect(compose).toContain('rebuildRuntime: () => rebuildAddOnRuntime()');
    expect(compose).toContain('onAddOnRemoved:');
    // And the rebuild is ONE function, used by boot and by the routes alike.
    // Boot calls it once the store has settled; what that ordering buys is
    // `boot-empty-data-dir.test.ts`'s and `package-restore-boot.test.ts`'s to
    // prove.
    expect(compose).toContain('rebuildAddOnRuntime = async () =>');
    /*
     * THE GATE MOVED, AND IT MOVED OUTWARDS.
     *
     * It used to be `addOnSeed`: the bundled seed only. `packagesReady` is that
     * seed AND the restore of installed packages from their off-disk copies,
     * which is the later half of the same story — a package restored after the
     * runtime was built stays dark exactly as one seeded after it did on 0.2.9.
     * Asserted here, in source, because the defect is an ORDERING and a green
     * runtime suite is what it looks like when the order is wrong.
     */
    expect(compose).toMatch(/void packagesReady\s*\.then\(\(\) => rebuildAddOnRuntime\(\)\)/);
    // …and `packagesReady` is itself gated on BOTH seeds, so nothing here can
    // quietly become "restore only".
    expect(compose).toMatch(/const packagesReady = Promise\.all\(\[appSeed, addOnSeed\]\)/);
  });

  it('clears the provider map when the LAST add-on goes', async () => {
    // A rebuild that returned early on an empty list would leave the removed
    // provider reachable — the one branch where "no add-ons" and "not built
    // yet" must not mean the same thing.
    const { readFile } = await import('node:fs/promises');
    const compose = await readFile(new URL('../src/compose.ts', import.meta.url), 'utf8');
    const rebuild = compose.slice(compose.indexOf('rebuildAddOnRuntime = async () =>'));
    expect(rebuild.slice(0, 900)).toContain('addOnRuntime = null;');
  });
});
