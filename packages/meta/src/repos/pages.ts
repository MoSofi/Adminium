/**
 * pagesRepo — adminium_pages (07-meta-store.md §3.16).
 *
 * Every navigable page of the Generated App, dashboards included. The
 * `config` column is the opaque, already-validated envelope JSON
 * (01-architecture.md §6.1) — `@adminium/meta` never imports the engine
 * schemas; the server is the single write-time validator.
 *
 * Generator contract (M4-T08): `upsertGenerated` is idempotent — stable
 * `page_<slug>` ids, unchanged documents are not rewritten, changed ones
 * bump `revision`, rows the generator no longer emits are pruned, and rows
 * whose `origin` is not `generated` (user/manifest/system pages) are never
 * touched or pruned. The M5 regeneration safety net keys on the
 * `config.generatedHash` the engine embeds in each generated envelope
 * (04-widget-registry.md §6.3 note: user delta wins): when the caller supplies
 * the hash function, a stored document whose embedded hash no longer matches
 * (a human edited it — `setLayout` deliberately leaves the hash stale) is
 * skipped, not overwritten, and reported in `skippedEdited` — the full diff
 * proposal UI is 04-T15.
 */

import type { Selectable } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import type { AdminiumPagesTable } from '../schema/tables.js';
import {
  MetaValidationError,
  jsonEquals,
  packJson,
  readBool,
  readJson,
  writeBool,
} from './util.js';

export const PAGE_ORIGINS = ['generated', 'user', 'manifest', 'system', 'llm'] as const;
export type PageOrigin = (typeof PAGE_ORIGINS)[number];

export interface Page {
  id: string;
  connectionId: string | null;
  slug: string;
  /** Page-template id, e.g. `page-crud`, `page-dashboard`. */
  type: string;
  title: string;
  icon: string | null;
  navGroup: string | null;
  navOrder: number;
  /** Opaque validated envelope (§3.17). */
  config: unknown;
  origin: string;
  manifestId: string | null;
  generatedFromSnapshotId: string | null;
  revision: number;
  isEnabled: boolean;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
}

/** The projection the bootstrap nav tree builds from (09 §2.2). */
export interface PageNavRow {
  id: string;
  /** Owning connection — lets the nav disambiguate multi-connection setups. */
  connectionId: string | null;
  slug: string;
  title: string;
  icon: string | null;
  navGroup: string | null;
  navOrder: number;
  isEnabled: boolean | 0 | 1;
  updatedAt: number;
}

/** One generated page as the server glue hands it over (engine-validated). */
export interface GeneratedPageInput {
  /** Stable `page_<slug>` id from the generator. */
  id: string;
  slug: string;
  /** Template id → the `type` column. */
  type: string;
  title: string;
  icon?: string | null;
  navGroup?: string | null;
  navOrder?: number;
  /** The full validated envelope document. */
  config: unknown;
}

export interface UpsertGeneratedOptions {
  snapshotId?: string | null;
  createdBy?: string | null;
  /** Delete generated rows the new set no longer contains. Default true. */
  prune?: boolean;
  at?: number;
  /**
   * The engine's `hashEnvelope` (canonical-JSON sha256, embedded-hash
   * excluded), injected because `@adminium/meta` never imports the engine.
   * When present, a changed generated-origin row is re-hashed first: a
   * mismatch with its embedded `config.generatedHash` means a human edited the
   * stored document, so the overwrite is skipped (user delta wins, 04 §6.3)
   * and the id lands in `skippedEdited`. Omitted ⇒ the pre-M5 overwrite
   * behavior (unit tests, seeds).
   */
  hashEnvelope?: (envelope: Record<string, unknown>) => string;
}

export interface UpsertGeneratedResult {
  created: number;
  updated: number;
  unchanged: number;
  pruned: number;
  /** Ids that exist with a non-generated origin — left untouched (user wins). */
  preserved: string[];
  /** Generated-origin ids whose stored document was human-edited — not overwritten. */
  skippedEdited: string[];
}

/**
 * True when a stored generated-origin envelope no longer matches its embedded
 * `config.generatedHash` — the edited-page signal (human writes update the
 * document but never the hash). Rows without a string hash are treated as
 * untouched: only the generator embeds one, and regenerating restores it.
 */
function isEditedEnvelope(
  stored: unknown,
  hashEnvelope: (envelope: Record<string, unknown>) => string,
): boolean {
  if (typeof stored !== 'object' || stored === null) return false;
  const envelope = stored as Record<string, unknown>;
  const config = envelope['config'];
  if (typeof config !== 'object' || config === null) return false;
  const embedded = (config as Record<string, unknown>)['generatedHash'];
  if (typeof embedded !== 'string') return false;
  return hashEnvelope(envelope) !== embedded;
}

function decode(row: Selectable<AdminiumPagesTable>): Page {
  return {
    id: row.id,
    connectionId: row.connectionId,
    slug: row.slug,
    type: row.type,
    title: row.title,
    icon: row.icon,
    navGroup: row.navGroup,
    navOrder: row.navOrder,
    config: readJson(row.config),
    origin: row.origin,
    manifestId: row.manifestId,
    generatedFromSnapshotId: row.generatedFromSnapshotId,
    revision: row.revision,
    isEnabled: readBool(row.isEnabled),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function pagesRepo(meta: MetaDb) {
  const { db } = meta;

  return {
    /**
     * Idempotent bulk upsert of one generation run for a connection.
     * Insert new rows, update changed ones (revision + 1), skip unchanged,
     * prune generated rows missing from the new set. Non-generated rows are
     * reported in `preserved` and never modified.
     */
    async upsertGenerated(
      connectionId: string,
      pages: readonly GeneratedPageInput[],
      opts: UpsertGeneratedOptions = {},
    ): Promise<UpsertGeneratedResult> {
      const at = opts.at ?? Date.now();
      const prune = opts.prune ?? true;
      const ids = new Set(pages.map((p) => p.id));
      if (ids.size !== pages.length) {
        throw new MetaValidationError('duplicate page ids in one generation run');
      }
      for (const input of pages) {
        if (input.id.length > 36) {
          throw new MetaValidationError(`page id exceeds char(36): ${input.id}`);
        }
      }

      return db.transaction().execute(async (trx) => {
        const existing = await trx
          .selectFrom('adminium_pages')
          .selectAll()
          .where('connectionId', '=', connectionId)
          .execute();
        const byId = new Map(existing.map((row) => [row.id, row]));

        const result: UpsertGeneratedResult = {
          created: 0,
          updated: 0,
          unchanged: 0,
          pruned: 0,
          preserved: [],
          skippedEdited: [],
        };

        for (const input of pages) {
          const row = byId.get(input.id);
          const packed = packJson(input.config);
          if (row === undefined) {
            await trx
              .insertInto('adminium_pages')
              .values({
                id: input.id,
                connectionId,
                slug: input.slug,
                type: input.type,
                title: input.title,
                icon: input.icon ?? null,
                navGroup: input.navGroup ?? null,
                navOrder: input.navOrder ?? 0,
                config: packed,
                origin: 'generated',
                manifestId: null,
                generatedFromSnapshotId: opts.snapshotId ?? null,
                revision: 1,
                isEnabled: writeBool(meta, true),
                createdBy: opts.createdBy ?? null,
                createdAt: at,
                updatedAt: at,
              })
              .execute();
            result.created += 1;
            continue;
          }
          if (row.origin !== 'generated') {
            // A user/manifest page claimed this id — regeneration never
            // overwrites it (user delta wins, 04 §6.3).
            result.preserved.push(row.id);
            continue;
          }
          // Structural, not serialized-string, equality: pg jsonb / mysql json
          // do not preserve key order, so the round-tripped document rarely
          // re-serializes byte-identical to `packed` (util.ts jsonEquals).
          const unchanged =
            jsonEquals(readJson(row.config), input.config) &&
            row.slug === input.slug &&
            row.type === input.type &&
            row.title === input.title &&
            (row.icon ?? null) === (input.icon ?? null) &&
            (row.navGroup ?? null) === (input.navGroup ?? null) &&
            row.navOrder === (input.navOrder ?? 0);
          if (unchanged) {
            result.unchanged += 1;
            continue;
          }
          if (
            opts.hashEnvelope !== undefined &&
            isEditedEnvelope(readJson(row.config), opts.hashEnvelope)
          ) {
            // User delta wins (04 §6.3): the stored document was edited after
            // generation, so this run must not clobber it. The row keeps its
            // snapshot lineage too — it no longer descends from this run.
            result.skippedEdited.push(row.id);
            continue;
          }
          await trx
            .updateTable('adminium_pages')
            .set({
              slug: input.slug,
              type: input.type,
              title: input.title,
              icon: input.icon ?? null,
              navGroup: input.navGroup ?? null,
              navOrder: input.navOrder ?? 0,
              config: packed,
              generatedFromSnapshotId: opts.snapshotId ?? null,
              revision: row.revision + 1,
              updatedAt: at,
            })
            .where('id', '=', row.id)
            .execute();
          result.updated += 1;
        }

        if (prune) {
          for (const row of existing) {
            if (row.origin !== 'generated' || ids.has(row.id)) continue;
            await trx.deleteFrom('adminium_pages').where('id', '=', row.id).execute();
            result.pruned += 1;
          }
        }

        return result;
      });
    },

    /** Create a non-generated page (user/manifest/system flows, seeds). */
    async create(input: {
      connectionId?: string | null;
      slug: string;
      type: string;
      title: string;
      icon?: string | null;
      navGroup?: string | null;
      navOrder?: number;
      config: unknown;
      origin?: PageOrigin;
      createdBy?: string | null;
    }, at: number = Date.now()): Promise<Page> {
      const origin = input.origin ?? 'user';
      if (!PAGE_ORIGINS.includes(origin)) {
        throw new MetaValidationError(`invalid page origin ${JSON.stringify(origin)}`);
      }
      const row = {
        id: newId('page'),
        connectionId: input.connectionId ?? null,
        slug: input.slug,
        type: input.type,
        title: input.title,
        icon: input.icon ?? null,
        navGroup: input.navGroup ?? null,
        navOrder: input.navOrder ?? 0,
        config: packJson(input.config),
        origin,
        manifestId: null,
        generatedFromSnapshotId: null,
        revision: 1,
        isEnabled: writeBool(meta, true),
        createdBy: input.createdBy ?? null,
        createdAt: at,
        updatedAt: at,
      };
      await db.insertInto('adminium_pages').values(row).execute();
      return decode(row as never);
    },

    async findById(id: string): Promise<Page | null> {
      const row = await db
        .selectFrom('adminium_pages')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      return row === undefined ? null : decode(row);
    },

    /**
     * Write the shared default dashboard layout into the envelope's
     * `config.layout` slot (04-widget-registry.md §6.3; the renderer and engine
     * envelope validator both read `envelope.config.layout`). Merges over the
     * stored envelope so the rest of the document (title/source/nav and the
     * other template config keys) is untouched, and bumps `updatedAt` so the
     * bootstrap `configVersion` advances and clients re-fetch. `revision`
     * bumps too — the counter tracks every changed document, human or machine
     * (override-staleness and future H5 diff/telemetry read it) — while the
     * embedded `config.generatedHash` deliberately stays stale: that mismatch
     * IS the edited-page signal `upsertGenerated` keys on. The `layout` value
     * is validated by the server route before it reaches here. Returns the
     * reloaded page, or null if the id does not exist.
     */
    async setLayout(pageId: string, layout: unknown, at: number = Date.now()): Promise<Page | null> {
      const page = await this.findById(pageId);
      if (page === null) return null;
      const envelope =
        typeof page.config === 'object' && page.config !== null
          ? (page.config as Record<string, unknown>)
          : {};
      const templateConfig =
        typeof envelope['config'] === 'object' && envelope['config'] !== null
          ? (envelope['config'] as Record<string, unknown>)
          : {};
      const nextEnvelope = { ...envelope, config: { ...templateConfig, layout } };
      await db
        .updateTable('adminium_pages')
        .set({ config: packJson(nextEnvelope), revision: page.revision + 1, updatedAt: at })
        .where('id', '=', pageId)
        .execute();
      return this.findById(pageId);
    },

    /**
     * Replace a page's whole config document — the 06-llm-assist.md §8.3
     * materialization write: the apply executor seeds `origin: 'llm'` rows with
     * a minimal `{source, llmRunId}` config and the regeneration hook expands
     * it into the full validated envelope from the active snapshot. Bumps
     * `revision` + `updatedAt` (configVersion advances → clients re-fetch);
     * `icon` is back-filled only when the row has none. Returns the reloaded
     * page, or null if the id does not exist.
     */
    async replaceConfig(
      pageId: string,
      config: unknown,
      opts: { icon?: string | null; at?: number } = {},
    ): Promise<Page | null> {
      const page = await this.findById(pageId);
      if (page === null) return null;
      const at = opts.at ?? Date.now();
      const icon = opts.icon ?? null;
      await db
        .updateTable('adminium_pages')
        .set({
          config: packJson(config),
          ...(page.icon === null && icon !== null ? { icon } : {}),
          revision: page.revision + 1,
          updatedAt: at,
        })
        .where('id', '=', pageId)
        .execute();
      return this.findById(pageId);
    },

    /**
     * Toggle a page's visibility (nav + GET both key on `isEnabled`). Bumps
     * `updatedAt` only — the document itself is unchanged, so `revision`
     * stays. Used by the §8.3 materialization pass to park an llm seed whose
     * template cannot compose yet, instead of serving an invalid-config card.
     */
    async setEnabled(pageId: string, isEnabled: boolean, at: number = Date.now()): Promise<void> {
      await db
        .updateTable('adminium_pages')
        .set({ isEnabled: writeBool(meta, isEnabled), updatedAt: at })
        .where('id', '=', pageId)
        .execute();
    },

    /** Slugs are unique per connection (uq_adminium_pages_conn_slug). */
    async findBySlug(connectionId: string | null, slug: string): Promise<Page | null> {
      let q = db.selectFrom('adminium_pages').selectAll().where('slug', '=', slug);
      q =
        connectionId === null
          ? q.where('connectionId', 'is', null)
          : q.where('connectionId', '=', connectionId);
      const row = await q.executeTakeFirst();
      return row === undefined ? null : decode(row);
    },

    async listForConnection(connectionId: string): Promise<Page[]> {
      const rows = await db
        .selectFrom('adminium_pages')
        .selectAll()
        .where('connectionId', '=', connectionId)
        .orderBy('navOrder', 'asc')
        .orderBy('slug', 'asc')
        .execute();
      return rows.map(decode);
    },

    /**
     * The bootstrap nav projection — every page row, nav fields only
     * (09-generated-app.md §2.2; the route buckets these into the five fixed
     * groups and derives `configVersion` from max updatedAt).
     */
    async navRows(): Promise<PageNavRow[]> {
      return db
        .selectFrom('adminium_pages')
        .select(['id', 'connectionId', 'slug', 'title', 'icon', 'navGroup', 'navOrder', 'isEnabled', 'updatedAt'])
        .execute();
    },

    /** Generated-page counts per connection (connections-hub cards, 09 §8.1). */
    async countGeneratedByConnection(): Promise<Record<string, number>> {
      const rows = await db
        .selectFrom('adminium_pages')
        .select(['connectionId'])
        .select((eb) => eb.fn.countAll().as('pages'))
        .where('origin', '=', 'generated')
        .where('connectionId', 'is not', null)
        .groupBy('connectionId')
        .execute();
      const out: Record<string, number> = {};
      for (const row of rows) {
        if (row.connectionId !== null) out[row.connectionId] = Number(row.pages);
      }
      return out;
    },

    /** Max updatedAt over all pages — the bootstrap `configVersion` stamp. */
    async configVersion(): Promise<number> {
      const row = await db
        .selectFrom('adminium_pages')
        .select((eb) => eb.fn.max('updatedAt').as('max'))
        .executeTakeFirst();
      return Number(row?.max ?? 0);
    },
  };
}

export type PagesRepo = ReturnType<typeof pagesRepo>;
