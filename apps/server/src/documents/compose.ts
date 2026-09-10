// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The document pipeline's WIRING — what turns `documents/render.ts` from a
 * function nobody calls into a feature (34-invoices-add-on.md §7.3; 34-T11).
 *
 * ─── THIS FILE EXISTS BECAUSE OF A PATTERN THIS REPOSITORY KEEPS HITTING ───
 *
 * Four features once passed every layer's tests and were reachable from
 * nothing. The tell was always the same: a grep for the export returned its
 * definition and its test, and no third line. `renderDocument` was in exactly
 * that state until this file — its own suite green, its action's suite green,
 * its job's schema written, and no server anywhere able to draw a document.
 *
 * So the assembly is one named function, called from `compose.ts`, rather than
 * an object literal inline at the call site. It has a name a grep finds, and
 * a place a reader can put a breakpoint.
 *
 * ─── THE SOURCE IS READ WITH THE REQUESTER'S GRANTS (D16) ──────────────────
 *
 * `readSource` re-reads the row and its children at render time rather than
 * trusting whatever the trigger captured. Two reasons, and the second is the
 * one that matters: a trigger's snapshot is a minute old by the time the undo
 * window closes, and — more importantly — a document is built from tables the
 * profile MAPS, which can be more than the one that was written. Reading them
 * here is what makes "every mapped table's read grant" a thing the routes can
 * resolve at all.
 */

import type { Kysely } from 'kysely';

import { addOnSettingsRepo, settingsRepo, type MetaDb } from '@adminium/meta';

import type { AddOnRuntimeState } from '../add-ons/runtime.js';
import type { ConnectionManager, SourceDatabase } from '../connections/manager.js';
import { fetchByPk } from '../crud/records.js';
import { loadSnapshotView } from '../data-io/snapshot-view.js';
import { connectionTenantConfig } from '@adminium/meta';
import type { EmailLogger } from '../email/send.js';
import type { FileStore } from '../files/store.js';
import type { RenderDeps, SourceRead } from './render.js';
import type { ProfileMapping } from './subject.js';

export interface DocumentPipelineDeps {
  meta: MetaDb;
  manager: ConnectionManager;
  storage: FileStore;
  /** The live add-on runtime; null before the first build. */
  runtime: () => AddOnRuntimeState | null;
  /** Where delivery reports itself (§7.7); the outcome is on the row regardless. */
  logger?: EmailLogger | undefined;
}


/**
 * The connection's currency and timezone, or the safe defaults.
 *
 * `connectionTenantConfig` reads exactly two columns and holds no DSN key —
 * which is why it exists, and why this uses it rather than the full repo.
 *
 * THE CURRENCY WAS HARDCODED `'USD'` here until 34d. Both the column and this
 * helper have existed since the public-API wave; the pipeline simply never
 * asked. Every document drawn on a connection configured in euros or pounds
 * was rendered in dollars, with the right NUMBERS — the minor units are
 * currency-agnostic — under the wrong symbol, which is the shape of a mistake
 * an operator notices from a customer's email rather than from a test.
 */
async function connectionFacts(
  meta: MetaDb,
  connectionId: string | null,
): Promise<{ currency: string; timezone: string }> {
  const config = connectionId === null ? null : await connectionTenantConfig(meta, connectionId);
  return { currency: config?.currency ?? 'USD', timezone: config?.timezone ?? 'UTC' };
}

export function createDocumentPipeline(deps: DocumentPipelineDeps): RenderDeps {
  return {
    meta: deps.meta,
    storage: deps.storage,
    runtime: deps.runtime,
    ...(deps.logger === undefined ? {} : { logger: deps.logger }),

    /**
     * What a render needs from the connection when it reads no row (§7.6).
     *
     * The same two facts `readSource` takes off the connection for a mapped
     * render, resolved the same way — an intent must not draw a document dated
     * in a different timezone than one drawn from a row on the same connection.
     */
    connectionFacts: async (connectionId) => await connectionFacts(deps.meta, connectionId),

    settingsFor: (addOnKey) => addOnSettingsRepo(deps.meta).valuesFor(addOnKey),

    /**
     * The letterhead, in three layers.
     *
     *   1. THE ADD-ON'S OWN `business_name` / `business_lines` / `logo_data_url`
     *      — what somebody typed into the settings panel FOR DOCUMENTS. It
     *      wins because it is the only one of the three chosen for this
     *      purpose.
     *   2. The workspace's own name, so a deployment that never opened that
     *      panel still produces a document with a name on it rather than a
     *      blank header.
     *   3. The product name, which is a placeholder and looks like one — that
     *      is better than an empty letterhead, which looks like a bug.
     *
     * A DOCUMENT'S OWN AUTHORED VALUES BEAT ALL THREE and never reach here:
     * they are in the body, and the renderer prefers them (25 D12 — an invoice
     * made in March keeps March's letterhead however this panel is edited
     * afterwards).
     */
    business: async (addOnKey?: string) => {
      const own = addOnKey === undefined ? {} : await addOnSettingsRepo(deps.meta).valuesFor(addOnKey);
      const typed = typeof own.business_name === 'string' ? own.business_name : '';
      const lines = Array.isArray(own.business_lines)
        ? own.business_lines.filter((line): line is string => typeof line === 'string')
        : [];
      const logo = typeof own.logo_data_url === 'string' ? own.logo_data_url : '';

      if (typed !== '') {
        return { name: typed, lines, ...(logo === '' ? {} : { logoDataUrl: logo }) };
      }
      const workspace = await settingsRepo(deps.meta)
        .get('branding.appName')
        .catch(() => null);
      const name = typeof workspace === 'string' && workspace !== '' ? workspace : 'Adminium';
      return { name, lines, ...(logo === '' ? {} : { logoDataUrl: logo }) };
    },

    /*
     * `tables` is the mapped-table list the ROUTE resolved grants over; the
     * read itself follows the mapping, so it is named and not used here.
     */
    readSource: async ({ profile, pk }): Promise<SourceRead | null> => {
      const view = await loadSnapshotView(deps.meta, profile.connectionId);
      const { db } = await deps.manager.data(profile.connectionId);
      const table = view.table(profile.table);

      const row = await fetchByPk(db as Kysely<SourceDatabase>, table, pk as never);
      // The row was deleted between the trigger and the job — the undo
      // window's ordinary outcome, and a SKIP rather than a failure.
      if (row === undefined) return null;

      /*
       * Child rows, one query per mapped collection.
       *
       * ONE QUERY PER COLLECTION and not a join: a document has at most a
       * handful of collections, each is keyed by one foreign column, and a
       * join would multiply the header row by the line count and leave this
       * file to un-multiply it. The N here is the number of MAPPED
       * collections, not the number of rows.
       */
      const collections: Record<string, readonly Record<string, unknown>[]> = {};
      for (const [slotId, mapped] of Object.entries(profile.mapping as ProfileMapping)) {
        if (!('collection' in mapped)) continue;
        const child = view.table(mapped.collection.table);
        const parentKey = table.primaryKey[0];
        if (parentKey === undefined) continue;
        const rows = await (db as Kysely<SourceDatabase>)
          .selectFrom(child.id as never)
          .selectAll()
          .where(mapped.collection.fkColumn as never, '=', row[parentKey] as never)
          .limit(500)
          .execute();
        collections[slotId] = rows as Record<string, unknown>[];
      }

      /*
       * The connection's OWN timezone and currency (0018), not the server's. A
       * document dated off the process clock's zone is dated off somebody
       * else's Tuesday — the same rule `record.actions` carries for its `now`,
       * and the reason `DocumentSubject.now` has a timezone at all. The
       * currency was hardcoded here until 34d; `connectionFacts` says why that
       * mattered.
       */
      const facts = await connectionFacts(deps.meta, profile.connectionId);
      return {
        row: row as Record<string, unknown>,
        collections,
        lookups: {},
        entity: {
          connectionId: profile.connectionId,
          table: profile.table,
          pk: Object.fromEntries(table.primaryKey.map((column) => [column, row[column]])),
          label: String(row[table.primaryKey[0] ?? 'id'] ?? ''),
        },
        currency: facts.currency,
        timezone: facts.timezone,
      };
    },
  };
}

/** Every table a set of profiles reads — what the routes resolve grants over. */
export { mappedTables } from './subject.js';
