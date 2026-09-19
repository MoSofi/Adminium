// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Adopting the invoices add-on on upgrade.
 *
 * The question this answers for an operator is "where did my invoices go", and
 * it has to answer it without asking anyone: a workspace that authored
 * documents before the surface moved gets the add-on installed for it, once,
 * and every other workspace is left exactly as it was.
 *
 * Each branch is here because each is a different promise. Installing twice
 * would be a duplicate row; installing where nothing was authored would be an
 * add-on nobody asked for; installing tables would be schema an upgrade has no
 * business creating unattended.
 */
import BetterSqlite3 from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { createSqliteMetaDb, firstRun, manifestsRepo, type MetaDb } from '@adminium/meta';

import { adoptInvoicesAddOn, INVOICES_ADD_ON_KEY } from '../src/add-ons/adopt-invoices.js';
import type { AddOnStore } from '../src/add-ons/store.js';

const crypto = {
  encrypt: (v: string) => `enc:${v}`,
  decrypt: (v: string) => v.slice(4),
};

function manifestFor(version: string, requiredSchema?: unknown): string {
  return JSON.stringify({
    kind: 'add-on',
    manifestVersion: 1,
    key: INVOICES_ADD_ON_KEY,
    name: 'Invoices & Receipts',
    version,
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'AGPL-3.0-only',
    description: { key: 'addon.invoices.line', fallback: 'Invoices.' },
    categories: ['data'],
    compatibility: { minAdminiumVersion: '0.2.11' },
    addOn: {
      attaches: [{ app: '*' }],
      connect: { kind: 'none' },
      hostApi: 1,
      pages: [
        {
          ref: 'documents',
          title: { key: 'addon.invoices.nav', fallback: 'Invoices' },
          icon: 'file-text',
          client: 'dist/page.js',
          nav: { group: 'library', order: 20, adminOnly: true },
          detail: true,
        },
      ],
    },
    ...(requiredSchema === undefined ? {} : { requiredSchema }),
  });
}

/** Only the two methods adoption calls. */
function storeWith(versions: string[], manifest = manifestFor('1.1.0')): AddOnStore {
  return {
    versions: async () => versions,
    readFile: async () => Buffer.from(manifest, 'utf8'),
  } as unknown as AddOnStore;
}

let meta: MetaDb;

beforeEach(async () => {
  meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
});

const adopt = (store: AddOnStore, documents: number) =>
  adoptInvoicesAddOn({ meta, store, crypto, countDocuments: async () => documents });

describe('adopting the invoices add-on', () => {
  it('installs it for a workspace that authored documents', async () => {
    const outcome = await adopt(storeWith(['1.1.0']), 7);
    expect(outcome).toEqual({ adopted: true, version: '1.1.0' });

    const installed = await manifestsRepo(meta, crypto).findByKey(INVOICES_ADD_ON_KEY);
    expect(installed?.row.version).toBe('1.1.0');
    // Nobody clicked anything, and the row says so rather than naming an admin.
    expect(installed?.row.installedBy).toBeNull();
    expect(installed?.attachments.map((a) => a.attachedTo)).toEqual(['dashboard']);
  });

  it('installs nothing where nothing was authored', async () => {
    expect(await adopt(storeWith(['1.1.0']), 0)).toEqual({ adopted: false, reason: 'no-documents' });
    expect(await manifestsRepo(meta, crypto).findByKey(INVOICES_ADD_ON_KEY)).toBeNull();
  });

  it('is idempotent — the second boot does nothing', async () => {
    await adopt(storeWith(['1.1.0']), 7);
    expect(await adopt(storeWith(['1.1.0']), 7)).toEqual({
      adopted: false,
      reason: 'already-installed',
    });
  });

  it('takes the newest version the bundle carries', async () => {
    const outcome = await adopt(storeWith(['1.0.1', '1.1.0']), 3);
    expect(outcome).toEqual({ adopted: true, version: '1.1.0' });
  });

  it('says so when the package is not bundled, rather than throwing at boot', async () => {
    expect(await adopt(storeWith([]), 7)).toEqual({ adopted: false, reason: 'not-bundled' });
  });

  it('declines a bundled version from before the page moved in', async () => {
    /*
     * The bundle can legitimately carry an older version than the release that
     * removes the surface — the two ship from different repositories. Adopting
     * it would leave the add-on installed, the rail row still missing and no
     * way to open a document: present, and useless, and silent about it.
     */
    const noPage = JSON.parse(manifestFor('1.0.1')) as {
      addOn: { pages?: unknown };
    };
    delete noPage.addOn.pages;
    const store = storeWith(['1.0.1'], JSON.stringify(noPage));
    expect(await adopt(store, 7)).toEqual({ adopted: false, reason: 'no-page' });
    expect(await manifestsRepo(meta, crypto).findByKey(INVOICES_ADD_ON_KEY)).toBeNull();
  });

  it('refuses an add-on that wants tables, rather than creating them unattended', async () => {
    // Creating schema is a conversation with an operator. This one needs none —
    // its rows are the engine's — and the day that changes, this refuses.
    const wantsTables = manifestFor('1.1.0', {
      tables: [{ ref: 'invoice_rows', columns: [{ ref: 'id', type: 'id', role: 'pk' }] }],
    });
    expect(await adopt(storeWith(['1.1.0'], wantsTables), 7)).toEqual({
      adopted: false,
      reason: 'needs-tables',
    });
    expect(await manifestsRepo(meta, crypto).findByKey(INVOICES_ADD_ON_KEY)).toBeNull();
  });
});
