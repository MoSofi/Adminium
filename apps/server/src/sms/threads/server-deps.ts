// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What conversations need from the rest of the server, built once for
 * `compose.ts`: who a text is from, the business's clock and language, the
 * realtime notice, and the number on a record as a person reaches it.
 *
 * Kept apart from the conversations themselves, so their tests need none of
 * this and nothing here can bring an import cycle into `sms/`.
 */
import { appModulesOf, appTablesRepo, connectionTenantConfig, realTableOf, type MetaDb } from '@adminium/meta';
import type { FastifyRequest } from 'fastify';

import type { ConnectionManager } from '../../connections/manager.js';
import type { ResolvedTable, SnapshotView } from '../../crud/identifiers.js';
import { INSTALL_HEADER, installsOf } from '../../installs/resolve.js';
import { canReadPii } from '../../crud/mask.js';
import { fetchByPk, parseRecordId } from '../../crud/records.js';
import { rowLimitContextOf } from '../../crud/row-limit-context.js';
import { fetchVisible } from '../../crud/row-limit.js';
import { resolveMailSender } from '../../email/workspace-sender.js';
import { recipientLocale } from '../../i18n/server-i18n.js';
import { appContact } from '../../outbox/sender.js';
import { appTextName, textBusinessName } from '../text-name.js';
import { rowKeyOf } from '../../payments/payables.js';
import { tableOf } from '../../privacy/sources.js';
import type { PermissionSet } from '../../rbac/resolver.js';
import type { RealtimeHub } from '../../realtime/hub.js';
import { factsViewFor } from '../../routes/pages/column-facts.js';
import type { BusinessContact } from '../send/opt-out.js';
import type { RecordPhone } from './routes.js';
import type { TextThreadsDeps } from './service.js';

/** The realtime channel every conversation's notice goes to; one app's go to `texts:<app>` as well. */
export const TEXTS_CHANNEL = 'texts';
export const textsAppChannel = (app: string): string => `${TEXTS_CHANNEL}:${app}`;

/** The database an app is installed on, or null. */
async function connectionOf(meta: MetaDb, app: string | null): Promise<string | null> {
  if (app === null) return null;
  const installs = await appModulesOf(meta, [app]);
  return installs.find((one) => one.connectionId !== null)?.connectionId ?? null;
}

export function textConversationDeps(input: { meta: MetaDb; manager: ConnectionManager; hub?: RealtimeHub | undefined }): Pick<TextThreadsDeps, 'business' | 'zone' | 'locale' | 'notify'> {
  const { meta, manager } = input;
  return {
    async business(app): Promise<BusinessContact> {
      const connectionId = await connectionOf(meta, app);
      const contact = app === null || connectionId === null ? { name: null, phone: null } : await appContact(meta, manager, app, connectionId);
      const sender = await resolveMailSender(meta, { connectionId });
      // Named by the name chosen for texts (`sms/text-name.ts`), never by the one the app's emails are signed with.
      const own = app === null || connectionId === null ? null : await appTextName(meta, manager, app, connectionId);
      return { name: await textBusinessName(meta, own), phone: contact.phone, email: sender.replyTo };
    },
    async zone(app) {
      const connectionId = await connectionOf(meta, app);
      return connectionId === null ? null : ((await connectionTenantConfig(meta, connectionId))?.timezone ?? null);
    },
    locale: () => recipientLocale(meta, null),
    notify(change) {
      // Holds no number and no word: a page that hears it reads the list again.
      const data = { thread: change.threadId, app: change.app };
      input.hub?.publish(TEXTS_CHANNEL, 'texts.changed', data);
      if (change.app !== null) input.hub?.publish(textsAppChannel(change.app), 'texts.changed', data);
    },
  };
}

/**
 * The table a staff page names: by its id in the snapshot, by its name as the
 * data routes take it, or, for a page of an app (its `X-Adminium-Install`
 * names that app's install), by the app's own name for one of its tables or
 * the name it was made under on this database. The app's own tables are
 * looked in first, so a page of one app never lands on another's table of
 * the same name.
 */
async function tableNamed(meta: MetaDb, view: SnapshotView, request: FastifyRequest, connectionId: string, name: string): Promise<ResolvedTable | null> {
  const header = request.headers[INSTALL_HEADER];
  if (typeof header === 'string' && header !== '') {
    const install = await installsOf(meta).findById(header);
    const app = install?.row.kind === 'app' ? install.row.manifestKey : null;
    if (app !== null) {
      for (const record of await appTablesRepo(meta).forConnection(connectionId)) {
        if (record.appKey !== app || record.role !== 'app' || record.state === 'released' || record.state === 'dropped' || record.state === 'pending') continue;
        if (record.ref === name || record.tableName === name || realTableOf(record) === name) {
          const found = tableOf(view, realTableOf(record));
          if (found !== null) return found;
        }
      }
    }
  }
  return tableOf(view, name);
}

/** The app whose table it is, by the one name its record of the table gives; null for a table no app declares. */
async function appOfTable(meta: MetaDb, view: SnapshotView, connectionId: string, table: ResolvedTable): Promise<string | null> {
  for (const record of await appTablesRepo(meta).forConnection(connectionId)) {
    if (record.role !== 'app' || record.state === 'released' || record.state === 'dropped' || record.state === 'pending') continue;
    if (tableOf(view, realTableOf(record))?.id === table.id) return record.appKey;
  }
  return null;
}

/**
 * The number on a record, read under the person's row limits, with the app
 * whose table it is. Null when the person may not read the table, or the row
 * is out of their reach: such a record answers as one that is not there.
 * `mayChange` says whether they may also change the row: the table's update
 * grant, and the row inside their update reach.
 */
export function recordPhoneReader(input: { meta: MetaDb; manager: ConnectionManager; resolve: (request: FastifyRequest) => Promise<PermissionSet> }) {
  const { meta, manager } = input;
  return async (request: FastifyRequest, wanted: { connection: string; table: string; row: string; column: string }): Promise<RecordPhone | null> => {
    const view = await factsViewFor(meta, wanted.connection);
    if (view === null) return null;
    const table = await tableNamed(meta, view, request, wanted.connection, wanted.table);
    if (table === null || table.primaryKey.length !== 1) return null;
    if (!(await request.can(`table:${wanted.connection}:${table.id}:read`))) return null;
    let pk;
    try {
      pk = parseRecordId(table, wanted.row);
    } catch {
      return null;
    }
    const limits = await rowLimitContextOf(meta, await input.resolve(request), wanted.connection, view.model);
    const { db } = await manager.data(wanted.connection);
    const found = limits === null ? await fetchByPk(db, table, pk) : await fetchVisible(limits, db, table, pk, 'read');
    if (found === undefined) return null;
    const declared = table.table.columns.find((column) => column.name === wanted.column);
    const resolved = table.columns.get(wanted.column);
    const phoneColumn = declared?.semantics?.primary === 'phone' && resolved?.secret !== true;
    const mayChange = (await request.can(`table:${wanted.connection}:${table.id}:update`)) && (limits === null || (await fetchVisible(limits, db, table, pk, 'update')) !== undefined);
    return {
      tableId: table.id,
      rowKey: rowKeyOf(table, found),
      app: await appOfTable(meta, view, wanted.connection, table),
      phoneColumn,
      value: phoneColumn ? found[wanted.column] : null,
      mayReadNumber: resolved?.masked !== true || (await canReadPii(request, wanted.connection, table.id)),
      mayChange,
    };
  };
}
