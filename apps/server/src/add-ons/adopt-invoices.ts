// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The upgrade path for a workspace that already has invoices.
 *
 * The invoice manager and editor were built into Adminium through 0.2.11 and
 * are an add-on's page from 0.2.12. The rows did not move — the documents
 * people authored are still in `adminium_invoice_documents`, in the meta store,
 * read by the same routes — but the SCREEN now arrives with the add-on. On an
 * instance that never installs it, those documents would have nothing to open
 * them with, and the only clue would be a rail row that used to be there.
 *
 * So an upgrade adopts the bundled add-on for the workspaces that were using
 * it: if the table has rows and the package is on disk, it is installed once,
 * and the log says that it happened. An empty table installs nothing — nobody
 * gains an add-on they never opened — and this is the whole of the difference.
 *
 * ─── Three rules this follows, each learned from something else ─────────────
 *
 * IT NEVER FAILS A BOOT. Everything here is wrapped by the caller and every
 * failure is a log line: an instance that cannot adopt its add-on must still
 * start, serve, and let an operator install it by hand from Studio.
 *
 * IT IS IDEMPOTENT, and cheaply so: the first thing it does is ask whether the
 * add-on is already installed, which is also the state after the first boot
 * that adopted it. It runs on every boot and does nothing on all but one.
 *
 * IT INSTALLS NO TABLES. The invoices add-on declares no `requiredSchema` —
 * its rows are the ENGINE's, which is why they did not move — so adoption is
 * the meta row and its attachment, with no DDL and no connection to resolve.
 * A future add-on adopted this way that DID need tables would need the
 * installer's planner, and this function should refuse rather than guess.
 */
import { manifestsRepo, type MetaDb } from '@adminium/meta';
import { parseManifest } from '@adminium/manifest';

import type { AddOnStore } from './store.js';

/** The key of the add-on that now owns the invoice surface. */
export const INVOICES_ADD_ON_KEY = 'invoices';

/** The host key a stock deployment attaches its add-ons to. */
const DASHBOARD_HOST = 'dashboard';

export type AdoptionOutcome =
  | {
      adopted: false;
      reason: 'already-installed' | 'no-documents' | 'not-bundled' | 'needs-tables' | 'no-page';
    }
  | { adopted: true; version: string };

export interface AdoptInvoicesDeps {
  meta: MetaDb;
  store: AddOnStore;
  /** The credential codec the manifest repository takes, unchanged. */
  crypto: { encrypt(v: string): string; decrypt(v: string): string };
  /** Rows in `adminium_invoice_documents`; injected so this stays testable. */
  countDocuments: () => Promise<number>;
}

export async function adoptInvoicesAddOn(deps: AdoptInvoicesDeps): Promise<AdoptionOutcome> {
  const manifests = manifestsRepo(deps.meta, deps.crypto);

  if ((await manifests.findByKey(INVOICES_ADD_ON_KEY)) !== null) {
    return { adopted: false, reason: 'already-installed' };
  }

  /*
   * The question is about THIS workspace's own documents, and it is asked
   * before the package is looked for: an instance with no invoices should not
   * care whether the bundle shipped one.
   */
  if ((await deps.countDocuments()) === 0) {
    return { adopted: false, reason: 'no-documents' };
  }

  const versions = await deps.store.versions(INVOICES_ADD_ON_KEY);
  const version = versions.at(-1);
  if (version === undefined) {
    return { adopted: false, reason: 'not-bundled' };
  }

  const document = JSON.parse(
    (await deps.store.readFile(INVOICES_ADD_ON_KEY, version, 'manifest.json')).toString('utf8'),
  ) as unknown;
  const manifest = parseManifest(document);

  // See the header: adoption creates no tables, and refuses rather than guess.
  if (manifest.kind === 'add-on' && (manifest.requiredSchema?.tables.length ?? 0) > 0) {
    return { adopted: false, reason: 'needs-tables' };
  }

  /*
   * THE VERSION HAS TO HAVE THE PAGE, and this is not hypothetical.
   *
   * The whole point of adopting is that a workspace keeps the screen its
   * documents belong to. A bundled version from before the page moved in
   * declares no `pages`, so installing it would leave the add-on present, the
   * rail row still missing and nothing able to open a document — a worse answer
   * than declining, and a silent one. The release that removes the surface must
   * bundle a version that provides it; until it does, this says no.
   */
  if (manifest.kind === 'add-on' && (manifest.addOn.pages?.length ?? 0) === 0) {
    return { adopted: false, reason: 'no-page' };
  }

  await manifests.install({
    manifestKey: INVOICES_ADD_ON_KEY,
    version,
    kind: 'add-on',
    source: 'bundled',
    document: manifest,
    /*
     * Nobody clicked anything: this is the upgrade adopting what the workspace
     * was already using, and `installed_by` says so by being null rather than
     * by naming whichever admin happened to boot the process.
     */
    installedBy: null,
    attachTo: [DASHBOARD_HOST],
  });

  return { adopted: true, version };
}
