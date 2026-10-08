// SPDX-License-Identifier: AGPL-3.0-only
/**
 * FROM A SHORT NAME TO A TABLE. A page names its add-on's tables as its
 * manifest does (`items`, `count_lines`) and the tables that hand it rows by
 * the name another manifest would use (`ordering:orders`). One read —
 * `GET /add-ons/:key/kit` — says where each is and what the signed-in reader
 * may do there; no hook takes a real table name or a connection.
 */
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { api } from '../../app/api.js';
import { useAddOnKey } from './context.js';

export interface KitTable {
  id: string;
  can: { read: boolean; create: boolean; update: boolean; delete: boolean };
  unreadable: string[];
  states?: { column: string; moves: Record<string, string[]>; actions?: { id: string; kind: 'move' | 'set' | 'link' | 'child'; from: string[] }[] };
}

export interface KitReply {
  connectionId: string;
  tables: Record<string, KitTable>;
  hosts: { tableRef: string; id: string; label: string; via: 'posting' | 'adjust' }[];
  has: Record<string, boolean>;
  /** Absent from a server older than this dashboard. */
  currency?: string | null;
}

export const addOnKitQuery = (addOnKey: string) =>
  queryOptions({
    queryKey: ['add-on-kit', addOnKey] as const,
    queryFn: () => api.get<KitReply>(`/api/v1/add-ons/${encodeURIComponent(addOnKey)}/kit`),
    // A grant changed by an owner is felt within a minute, and at once after any refusal (the hooks refetch on a 403).
    staleTime: 60_000,
  });

export interface Kit {
  addOnKey: string;
  reply: KitReply;
}

/** The kit's one read for the add-on whose page this is. Suspends until it is in. */
export function useKit(): Kit {
  const addOnKey = useAddOnKey();
  const { data } = useSuspenseQuery(addOnKitQuery(addOnKey));
  // The same object while the read is the same: a hook that keys on it (`useRead`, `useAccess`) hands a page the
  // same value on every draw, so a page's effect keyed on that value runs once and not for ever.
  return useMemo(() => ({ addOnKey, reply: data }), [addOnKey, data]);
}

export interface ResolvedKitTable {
  connectionId: string;
  /** The table's id, as the data routes take it. */
  id: string;
  /** One of the add-on's own tables; absent for a table that hands it rows. */
  own: KitTable | null;
}

/** The table a page means; a name that is neither the add-on's nor one of its hosts is refused by name. */
export function resolveTable(kit: Kit, table: string): ResolvedKitTable {
  const own = Object.prototype.hasOwnProperty.call(kit.reply.tables, table) ? kit.reply.tables[table] : undefined;
  if (own !== undefined) return { connectionId: kit.reply.connectionId, id: own.id, own };
  const host = kit.reply.hosts.find((candidate) => candidate.tableRef === table);
  if (host !== undefined) return { connectionId: kit.reply.connectionId, id: host.id, own: null };
  throw new Error(`"${table}" is not a table of ${kit.addOnKey}: name one of its own (${Object.keys(kit.reply.tables).join(', ') || 'none here yet'}).`);
}

/** As {@link resolveTable}, for a write: a table that hands the add-on rows is read, never written from its page. */
export function resolveOwnTable(kit: Kit, table: string): ResolvedKitTable & { own: KitTable } {
  const resolved = resolveTable(kit, table);
  if (resolved.own === null) throw new Error(`"${table}" is not ${kit.addOnKey}'s own table: its page reads it and writes nothing there.`);
  return resolved as ResolvedKitTable & { own: KitTable };
}
