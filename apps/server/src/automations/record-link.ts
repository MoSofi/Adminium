// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE RUN'S RECORD, AS ONE PERSON MAY OPEN IT.
 *
 * Two steps hand a person the record a run is about: a notice to the lead of
 * the person on the row (only a lead who can open the record is told), and a
 * rule's e-mail to a person, whose `{{recordUrl}}` is the record's address.
 * Both ask the same question: do this person's roles read the record's table,
 * and is this row among the rows they reach? Asked as that person, never as
 * the rule, which reads the connection whole.
 *
 * The address is the one a notice's e-mail carries: the app's own screen for
 * the record when the person's roles open the app's staff side, else the
 * dashboard's record page; on the operator's mapped host or the server's
 * public address. Somebody who cannot open the record gets no address at all.
 */
import { pagesRepo, settingsRepo } from '@adminium/meta';

import { placeLink, recordPlaceForUser } from '../apps/record-address.js';
import type { Row } from '../crud/mask.js';
import { fetchVisible } from '../crud/row-limit.js';
import { rowLimitContextOf } from '../crud/row-limit-context.js';
import { permissionSetAllows, resolvePermissionSet } from '../rbac/resolver.js';
import { rowReachesOf } from '../rbac/row-limits.js';
import type { ActionContext } from './actions/types.js';

/** Whether somebody's roles open the run's record: they read its table, and it is among the rows they reach. */
export async function opensRecord(ctx: Pick<ActionContext, 'meta' | 'source' | 'now'>, userId: string): Promise<boolean> {
  const source = ctx.source;
  if (source === null) return false;
  const set = await resolvePermissionSet(ctx.meta, { kind: 'user', id: userId, label: userId });
  if (!permissionSetAllows(set, `table:${source.connectionId}:${source.table.id}:read`)) return false;
  const reach = await rowLimitContextOf(ctx.meta, set, source.connectionId, source.view.model, new Date(ctx.now));
  if (reach === null) return true;
  // A removed row cannot be read again, so somebody whose read of its table is limited cannot be shown to reach it: they are not told of it.
  if (source.removed === true) return rowReachesOf(set, source.connectionId, source.table.id, 'read') === null;
  return (await fetchVisible(reach, source.db, source.table, source.record.pk as Row, 'read')) !== undefined;
}

/** `config.source.table` of a page: which table it shows. */
function sourceTableOf(config: unknown): string | null {
  const source = (config as { source?: { table?: unknown } } | null)?.source;
  return typeof source?.table === 'string' && source.table.length > 0 ? source.table : null;
}

/** The record's id as its page takes it: the key, or the keys as JSON. */
export function recordIdOf(pk: Readonly<Record<string, unknown>>): string {
  const values = Object.values(pk);
  return values.length === 1 ? String(values[0]) : JSON.stringify(values);
}

/** The dashboard's page for the run's record (`/p/<slug>/r/<id>`), or null when no page shows its table. */
export async function recordPagePath(ctx: Pick<ActionContext, 'meta' | 'source'>): Promise<string | null> {
  const source = ctx.source;
  if (source === null) return null;
  const page = (await pagesRepo(ctx.meta).listForConnection(source.connectionId)).find((row) => row.isEnabled && sourceTableOf(row.config) === source.table.id);
  return page === undefined ? null : `/p/${page.slug}/r/${encodeURIComponent(recordIdOf(source.record.pk))}`;
}

/** The address an e-mail gives this person to the run's record; empty when they cannot open it or nothing shows it. */
export async function recordUrlFor(ctx: Pick<ActionContext, 'meta' | 'source' | 'now'>, user: { id: string; name: string }): Promise<string> {
  const source = ctx.source;
  if (source === null || !(await opensRecord(ctx, user.id))) return '';
  const stored = await settingsRepo(ctx.meta).get('system.publicOrigin').catch(() => null);
  const origin = typeof stored === 'string' && stored !== '' ? stored.replace(/\/+$/, '') : undefined;
  const place = await recordPlaceForUser(ctx.meta, user, { connectionId: source.connectionId, table: source.table.id, recordId: recordIdOf(source.record.pk) });
  if (place !== null) return placeLink(place, origin);
  const path = await recordPagePath(ctx);
  if (path === null) return '';
  return origin === undefined ? path : `${origin}${path}`;
}
