// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the model is told about the page it was opened on — and the rule that
 * every word of it is true.
 *
 * The blurb, the chips and the prompt's first section are built from live
 * counts, not from a sentence somebody wrote once. A page with no templates
 * says so; a connection nobody may read counts as zero readable tables. The
 * cost of a confident fiction here is the model proposing work over documents
 * or tables that do not exist, which it then cannot do.
 */

import { settingsRepo, type MetaDb } from '@adminium/meta';

import { loadSnapshotView } from '../data-io/snapshot-view.js';
import { readableTablesOf } from './tools/schema.js';
import type { AssistantToolDeps } from './types.js';

/** One connected database, as the page facts count it. */
export interface ConnectionFacts {
  id: string;
  name: string;
  engine: string;
  /** Tables the acting person may read; `[]` for a connection with no snapshot. */
  tables: string[];
}

/** Every enabled connection with the tables this turn's person may read. */
export async function readableConnections(deps: AssistantToolDeps): Promise<ConnectionFacts[]> {
  const rows = await deps.manager.connections.list();
  const out: ConnectionFacts[] = [];
  for (const row of rows) {
    if (row.disabled) continue;
    let tables: string[] = [];
    try {
      const view = await loadSnapshotView(deps.meta, row.id);
      tables = await readableTablesOf(view, await deps.canReadTable(row.id));
    } catch {
      // No snapshot yet: the connection exists and holds nothing readable.
      tables = [];
    }
    out.push({ id: row.id, name: row.name, engine: row.engine, tables });
  }
  return out;
}

/** The workspace's own name, for the prompt's first line. */
export async function appNameOf(meta: MetaDb): Promise<string> {
  return settingsRepo(meta).get('branding.appName');
}

/** `12 tables across 2 connections` / `no readable tables`, for the scope chip. */
export function tablesSummary(connections: readonly ConnectionFacts[]): { tables: number; connections: number } {
  const withTables = connections.filter((connection) => connection.tables.length > 0);
  return {
    tables: connections.reduce((total, connection) => total + connection.tables.length, 0),
    connections: withTables.length,
  };
}

/**
 * The prompt's connection paragraph: each connection with the tables this
 * person may read, capped so a 900-table warehouse does not become the whole
 * prompt. The model asks `describe_schema` for the rest.
 */
export const PROMPT_TABLES_PER_CONNECTION = 60;

export function connectionsSection(connections: readonly ConnectionFacts[]): string {
  if (connections.length === 0) return 'No database is connected to this workspace.';
  return connections
    .map((connection) => {
      if (connection.tables.length === 0) {
        return `- ${connection.name} (${connection.id}, ${connection.engine}): no tables you may read.`;
      }
      const listed = connection.tables.slice(0, PROMPT_TABLES_PER_CONNECTION);
      const rest = connection.tables.length - listed.length;
      const tail = rest > 0 ? `, and ${String(rest)} more (ask describe_schema)` : '';
      return `- ${connection.name} (${connection.id}, ${connection.engine}): ${listed.join(', ')}${tail}`;
    })
    .join('\n');
}

/** `3 templates · 2 campaigns` — the chip row's text, with the count first. */
export function countLabel(count: number, singular: string, plural: string): string {
  return `${String(count)} ${count === 1 ? singular : plural}`;
}

/** At most this many document names travel in the prompt's page section. */
export const PROMPT_DOCUMENT_NAMES = 50;

export function documentNamesSection(names: readonly string[]): string {
  if (names.length === 0) return 'none yet';
  const listed = names.slice(0, PROMPT_DOCUMENT_NAMES);
  const rest = names.length - listed.length;
  return rest > 0 ? `${listed.join(', ')}, and ${String(rest)} more` : listed.join(', ');
}
