// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Widget-data stream channel names (04-widget-registry.md §5.3). Channels are
 * `widget-data:{connectionId}:{qualifiedTable}`; the qualified table is the
 * snapshot's own id (`schema.name` on Postgres, bare `name` on MySQL/SQLite),
 * matching the CRUD mutation publisher (`table:{connectionId}:{table.id}`).
 *
 * The authoritative channel for a bound widget is the one the server returns in
 * the `StreamShape` envelope (it resolves the table id). `streamChannelForSource`
 * derives the same name client-side for demo/preview bindings that already carry
 * the qualified source.
 */

export const WIDGET_DATA_CHANNEL_PREFIX = 'widget-data';

/** A binding source as it appears in a query descriptor. */
export interface StreamSource {
  schema?: string | undefined;
  name: string;
}

/** `schema.name` (Postgres) or bare `name` (MySQL/SQLite). */
export function qualifiedTableName(source: StreamSource): string {
  return source.schema === undefined || source.schema === ''
    ? source.name
    : `${source.schema}.${source.name}`;
}

/** `widget-data:{connectionId}:{qualifiedTable}`. */
export function streamChannel(connectionId: string, qualifiedTable: string): string {
  return `${WIDGET_DATA_CHANNEL_PREFIX}:${connectionId}:${qualifiedTable}`;
}

/** Derive the channel from a descriptor's `connectionId` + `source`. */
export function streamChannelForSource(connectionId: string, source: StreamSource): string {
  return streamChannel(connectionId, qualifiedTableName(source));
}
