// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT THE OWNER FILLS IN AFTER AN INSTALL.
 *
 * A file never carries what only the place it lands on may say: a webhook's
 * address and its header's value, the addresses a rule mails, the slot a
 * document is mailed to, who a scheduled report goes to, a payment service's
 * keys, a bank account, the address a mail is sent from, a console
 * permission a role held where the file was made. Those parts arrive empty
 * (and their rule switched off, the permission not given). A rule step that
 * sends out of Adminium with words of the file's own (`outbound`: an address
 * it writes, a link its mail carries) keeps them, and arrives switched off
 * for its owner to look at. Each is one item of the app's "After you install" list, said by what
 * it is (`kind`), the entry of the file it belongs to (`item`: a rule's key,
 * a report's key, a document's table and kind) and the field to fill.
 *
 * The install and every update hand the whole list to {@link recordAfterInstall}.
 */
import { appAfterInstallRepo, type MetaDb } from '@adminium/meta';

export type AfterInstallKind = 'webhook' | 'address' | 'document' | 'delivery' | 'recipients' | 'payment-key' | 'bank-account' | 'sender' | 'system-grant' | 'outbound';

export interface AfterInstallItem {
  kind: AfterInstallKind;
  /** The entry of the file: a rule's key, a scheduled report's key, `<table>/<kind>` of a document, a payment way, a mail's key, a role's key. */
  item: string;
  /** What to fill in, inside that entry. */
  field: string;
}

export interface AfterInstallTarget {
  /** The install's own row (`adminium_manifests.id`). */
  manifestId: string;
  appKey: string;
}

/**
 * Keeps the install's list in `adminium_app_after_install`: the whole list,
 * every time. An item already recorded keeps its tick (an update never undoes
 * what a person did), and one the new version no longer names goes.
 */
export async function recordAfterInstall(meta: MetaDb, install: AfterInstallTarget, items: readonly AfterInstallItem[]): Promise<void> {
  const repo = appAfterInstallRepo(meta);
  if (items.length > 0) await repo.put(install, items);
  await repo.remove(install.manifestId, items);
}
