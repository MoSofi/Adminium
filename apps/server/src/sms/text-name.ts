// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE NAME AUTOMATIC TEXTS GIVE THE BUSINESS BY: the "not read" answer, a
 * STOP's confirmation, a country's opt-out line "through the business".
 *
 * A text shows on a locked phone and in the provider's logs, so it names the
 * business only by a name chosen for texts:
 *  1. the app's own name for texts (`outbox.settings.textName`, a neutral
 *     name a sensitive practice saves), when its settings row holds one;
 *  2. else the sender name set in Studio → Texts, when the business sends
 *     from a name;
 *  3. else the business's name as the server's privacy notice gives it.
 * Never the name an app's emails are signed with (`outbox.settings.name`):
 * that is the name the app chose for mail, not for texts.
 */
import { appOutboxesRepo, type MetaDb } from '@adminium/meta';

import type { ConnectionManager } from '../connections/manager.js';
import { settingsRow } from '../crud/settings-row.js';
import { businessName } from '../privacy/business.js';
import { createSmsAccountStore } from './account-store.js';

/** One line of text, or null for nothing, a non-text or blank. */
function oneLine(value: unknown): string | null {
  const line = typeof value === 'string' ? value.replaceAll(/\s+/g, ' ').trim() : '';
  return line === '' ? null : line;
}

/** The sender name set in Studio → Texts; null when the business sends from a number, or has no account. */
export async function textSenderName(meta: MetaDb): Promise<string | null> {
  try {
    const account = await createSmsAccountStore(meta).read();
    return account?.sender?.kind === 'name' ? oneLine(account.sender.value) : null;
  } catch {
    return null;
  }
}

/** The app's own name for texts, from its settings row; null when it declares none, holds none, or on any doubt. */
export async function appTextName(meta: MetaDb, manager: Pick<ConnectionManager, 'data'>, appKey: string, connectionId: string): Promise<string | null> {
  try {
    const stored = await appOutboxesRepo(meta).findOnConnection(appKey, connectionId);
    if (stored === null) return null;
    const settings = (JSON.parse(stored.definition) as { settings?: { table: string; textName?: string } }).settings;
    if (settings?.textName === undefined) return null;
    const { db } = await manager.data(connectionId);
    const row = await settingsRow(db, settings.table, [settings.textName]);
    return oneLine(row?.[settings.textName]);
  } catch {
    return null;
  }
}

/** The name an automatic text gives the business by (see the header); `own` is the app's name for texts when the caller read it already. */
export async function textBusinessName(meta: MetaDb, own: string | null): Promise<string> {
  return oneLine(own) ?? (await textSenderName(meta)) ?? (await businessName(meta));
}
