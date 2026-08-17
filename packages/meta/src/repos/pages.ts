// SPDX-License-Identifier: AGPL-3.0-only
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
 * bump `revision`, rows the generator no longer emits are pruned (unless
 * human-edited — see below), and rows whose `origin` is not `generated`
 * (user/manifest/system pages) are never touched or pruned. The M5
 * regeneration safety net keys on the `config.generatedHash` the engine
 * embeds in each generated envelope (04-widget-registry.md §6.3 note: user
 * delta wins): when the caller supplies the hash function, a stored document
 * whose embedded hash no longer matches (a human edited it — `setLayout`
 * deliberately leaves the hash stale) is skipped, not overwritten, and
 * reported in `skippedEdited` — the full diff proposal UI is 04-T15. The
 * same guard extends to deletion: an edited row missing from the new set is
 * kept, not pruned, and reported in `keptEdited`; only unedited orphans
 * (byte-identically regenerable) are deleted. Without `hashEnvelope` the
 * legacy full prune applies.
 */

import type { Selectable } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import type { AdminiumPagesTable } from '../schema/tables.js';
import {
  MetaValidationError,
  affected,
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

/** Row projection for the Studio page manager — every column but `config`. */
export interface PageSummary {
  id: string;
  connectionId: string | null;
  slug: string;
  type: string;
  title: string;
  icon: string | null;
  navGroup: string | null;
  navOrder: number;
  origin: string;
  manifestId: string | null;
  isEnabled: boolean;
  revision: number;
  updatedAt: number;
}

/**
 * The editable nav/identity fields. Every key is optional; `icon` and
 * `navGroup` accept an explicit `null` to clear, which is why they are read
 * with an `undefined` check rather than `??`.
 */
export interface PageMetaPatch {
  slug?: string | undefined;
  title?: string | undefined;
  icon?: string | null | undefined;
  navGroup?: string | null | undefined;
  navOrder?: number | undefined;
  isEnabled?: boolean | undefined;
  /** Page-template id. Changing it requires a matching `envelope`. */
  type?: string | undefined;
  /** Owning connection. Changing it requires a matching `envelope`. */
  connectionId?: string | null | undefined;
  /**
   * A full replacement envelope, from a recompose against a different
   * template or table.
   *
   * Supplied instead of merging because the per-template BODIES are not
   * interchangeable: a `page-crud` body is `{columns, detail, form}` and an
   * archetype body is `{layout, toolbar, overlays}`, so merging one over the
   * other leaves keys the new renderer cannot read and the old one still can.
   * The nav/title mirror still applies on top, so the row and the document
   * agree afterwards exactly as they do for a metadata-only edit.
   */
  envelope?: Record<string, unknown> | undefined;
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
   * and the id lands in `skippedEdited`. The prune pass applies the same
   * test: an edited orphan is kept (`keptEdited`) instead of deleted.
   * Omitted ⇒ the pre-M5 overwrite-and-full-prune behavior (unit tests,
   * seeds).
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
  /**
   * Generated pages skipped because another row of the same connection already
   * holds their slug — almost always a user-authored page (Studio → Pages)
   * that claimed it first. Writing anyway violates
   * `uq_adminium_pages_conn_slug`, and because the whole upsert is one
   * transaction that unique violation would roll the ENTIRE generation run
   * back and 500 `POST /connections/:id/generate` — permanently, since the
   * offending row is not something regeneration can clear. So the collision is
   * reported rather than thrown: the run completes, every other page lands,
   * and the caller surfaces a warning naming the slug so an admin can rename
   * either side. Entries are `{ id, slug }` of the SKIPPED generated page.
   */
  blockedSlugs: { id: string; slug: string }[];
  /**
   * Human-edited generated-origin ids the new set no longer contains — kept,
   * not pruned (user delta wins extends to deletion, 04 §6.3). The row is
   * untouched: it keeps `origin: 'generated'`, stays enabled, and keeps its
   * snapshot lineage. Unedited orphans are byte-identically regenerable and
   * still delete; without `hashEnvelope` this is always empty (legacy full
   * prune).
   */
  keptEdited: string[];
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

/** Narrow an opaque stored value to an object we can spread over. */
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/**
 * Mirror a row's nav/identity fields into the stored envelope (01 §6.1
 * `title` / `nav` blocks), preserving every other key.
 *
 * Two rules make this safe on documents this repo is not allowed to
 * understand:
 *
 * - `config.generatedHash` is left exactly as found. Re-stamping it is what
 *   would make the edit invisible to `isEditedEnvelope` and therefore
 *   revertible by the next generation run; leaving it stale is the designed
 *   "a human touched this" signal (04 §6.3).
 * - Blocks that are absent or the wrong shape are not invented. A document
 *   with no `nav` object gets none — hand-authored and llm-seed rows are not
 *   full envelopes yet, and fabricating a partial `nav` block would fail
 *   `pageEnvelopeSchema` on the next read for a page that validates fine
 *   today.
 */
function mergeEnvelopeMeta(
  stored: unknown,
  next: {
    slug: string;
    title: string;
    icon: string | null;
    navGroup: string | null;
    navOrder: number;
  },
): Record<string, unknown> {
  const envelope = asRecord(stored);
  const out: Record<string, unknown> = { ...envelope };

  const title = envelope['title'];
  if (typeof title === 'object' && title !== null) {
    out['title'] = { ...(title as Record<string, unknown>), fallback: next.title };
  }

  const nav = envelope['nav'];
  if (typeof nav === 'object' && nav !== null) {
    const navOut: Record<string, unknown> = {
      ...(nav as Record<string, unknown>),
      order: next.navOrder,
      slug: next.slug,
    };
    // `nav.group` and `nav.icon` are `z.string().min(1)` — a null row value
    // means "unset", which the envelope expresses by omitting the key rather
    // than by storing null.
    if (next.navGroup === null) delete navOut['group'];
    else navOut['group'] = next.navGroup;
    if (next.icon === null) delete navOut['icon'];
    else navOut['icon'] = next.icon;
    out['nav'] = navOut;
  }

  return out;
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
          keptEdited: [],
          blockedSlugs: [],
        };

        // Prune BEFORE upserting. Both halves of that matter:
        //
        // - resolving the set first keeps the "should this orphan die?"
        //   predicate in one place instead of two that can drift, and lets the
        //   slug index below ignore rows this run is about to delete (a dropped
        //   page whose slug a renamed page now wants is a hand-off, not a
        //   collision);
        // - deleting first is what makes that hand-off physically possible.
        //   uq_adminium_pages_conn_slug is checked per statement, not at
        //   commit, so inserting the new owner while the old row still exists
        //   raises a UNIQUE violation and rolls the whole run back — the exact
        //   failure `blockedSlugs` exists to prevent.
        //
        // Ordering is otherwise unobservable: the prune set is disjoint from
        // the ids being written (`ids.has(row.id)` skips them), and the whole
        // pass is one transaction.
        const toPrune: string[] = [];
        if (prune) {
          for (const row of existing) {
            if (row.origin !== 'generated' || ids.has(row.id)) continue;
            if (
              opts.hashEnvelope !== undefined &&
              isEditedEnvelope(readJson(row.config), opts.hashEnvelope)
            ) {
              // User delta wins extends to deletion (04 §6.3): the generator
              // dropped this page (table removed/hidden between runs), but a
              // human customized the stored document, so pruning would
              // destroy work that cannot be regenerated. Keep the row exactly
              // as-is — origin stays 'generated', it stays enabled, and its
              // snapshot lineage is untouched. Unedited orphans are
              // byte-identically regenerable and still delete below.
              result.keptEdited.push(row.id);
              continue;
            }
            toPrune.push(row.id);
          }
        }
        const pruning = new Set(toPrune);
        for (const id of toPrune) {
          await trx.deleteFrom('adminium_pages').where('id', '=', id).execute();
          result.pruned += 1;
        }

        // Slug → owning id, for rows that will still exist and will NOT be
        // rewritten by this run. Rows the run itself writes are excluded
        // because each is free to keep or change its own slug; they register
        // their claim as they are processed, which also catches two generated
        // inputs asking for one slug.
        const slugOwner = new Map<string, string>();
        for (const row of existing) {
          if (ids.has(row.id) || pruning.has(row.id)) continue;
          slugOwner.set(row.slug, row.id);
        }

        for (const input of pages) {
          const row = byId.get(input.id);
          const packed = packJson(input.config);
          if (slugOwner.has(input.slug)) {
            // Someone else already owns this slug and is not going anywhere.
            // Writing it would break uq_adminium_pages_conn_slug and abort the
            // whole run (see `blockedSlugs`). Report and move on.
            result.blockedSlugs.push({ id: input.id, slug: input.slug });
            continue;
          }
          slugOwner.set(input.slug, input.id);
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

        return result;
      });
    },

    /**
     * Create a non-generated page (user/manifest/system flows, seeds).
     *
     * `id` is optional and defaults to a fresh `page_<ULID>`. Callers that
     * must know the id before they build the document — the envelope embeds
     * its own id (01 §6.1) — mint one with `newId('page')` and pass it here.
     * Do NOT hand it a deterministic `page_<slug>`-shaped id: those belong to
     * the generator's `pageIdFor` allocator, and a user page squatting on one
     * lands in `upsertGenerated`'s `preserved` list forever, silently
     * preventing that generated page from ever materializing.
     */
    async create(input: {
      id?: string;
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
      if (input.id !== undefined && input.id.length > 36) {
        throw new MetaValidationError(`page id exceeds char(36): ${input.id}`);
      }
      const row = {
        id: input.id ?? newId('page'),
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
     * Every page, all connections, nav-ordered — the Studio page manager's
     * list (09 §8.1). Returns the row projection plus `origin`/`type`, which
     * the manager needs to explain why a page behaves the way it does (a
     * `generated` row warns about regeneration, a `manifest` row is
     * undeletable). Deliberately excludes `config`: the list renders ~100 rows
     * and the envelopes are the largest column in the table.
     */
    async listAll(): Promise<PageSummary[]> {
      const rows = await db
        .selectFrom('adminium_pages')
        .select([
          'id',
          'connectionId',
          'slug',
          'type',
          'title',
          'icon',
          'navGroup',
          'navOrder',
          'origin',
          'manifestId',
          'isEnabled',
          'revision',
          'updatedAt',
        ])
        .orderBy('navOrder', 'asc')
        .orderBy('slug', 'asc')
        .execute();
      return rows.map((row) => ({ ...row, isEnabled: readBool(row.isEnabled) }));
    },

    /**
     * Write the row's nav projection AND the matching envelope fields
     * (04 §6.3 "user delta wins"), in one transaction.
     *
     * Writing both halves is the whole point. The row columns are what the
     * bootstrap nav tree reads, so a column-only write is what makes the edit
     * *visible*; the envelope write is what makes it *durable*. `upsertGenerated`
     * compares slug/title/icon/navGroup/navOrder against the regenerated values
     * and rewrites the row when they differ, and its edited-page guard keys
     * solely on `config.generatedHash`. A column-only edit therefore leaves the
     * hash valid, so the very next generation run silently reverts it — the
     * exact dead end `generate/run.ts` documents for the LLM nav path. Mirroring
     * the change into the envelope without re-stamping the hash makes
     * `isEditedEnvelope` true, so the row lands in `skippedEdited` and the
     * admin's edit survives, while the page keeps `origin: 'generated'` and
     * stays in the connection's page count.
     *
     * `expectedRevision`, when given, is the 08 §2.6 `If-Match` check: a
     * mismatch returns `'conflict'` rather than clobbering a concurrent write.
     * Returns `'not-found'` for an unknown id, otherwise the reloaded page.
     */
    async updateMeta(
      pageId: string,
      patch: PageMetaPatch,
      opts: { expectedRevision?: number; at?: number } = {},
    ): Promise<Page | 'not-found' | 'conflict'> {
      const at = opts.at ?? Date.now();
      const page = await this.findById(pageId);
      if (page === null) return 'not-found';
      if (opts.expectedRevision !== undefined && opts.expectedRevision !== page.revision) {
        return 'conflict';
      }

      const next = {
        slug: patch.slug ?? page.slug,
        title: patch.title ?? page.title,
        icon: patch.icon === undefined ? page.icon : patch.icon,
        navGroup: patch.navGroup === undefined ? page.navGroup : patch.navGroup,
        navOrder: patch.navOrder ?? page.navOrder,
        isEnabled: patch.isEnabled ?? page.isEnabled,
      };

      // A recompose supplies the whole document; a metadata edit merges into
      // the one already stored. Either way the nav/title mirror lands on top,
      // so the row and the envelope never disagree.
      const base = patch.envelope ?? page.config;

      await db
        .updateTable('adminium_pages')
        .set({
          ...next,
          ...(patch.type === undefined ? {} : { type: patch.type }),
          ...(patch.connectionId === undefined ? {} : { connectionId: patch.connectionId }),
          isEnabled: writeBool(meta, next.isEnabled),
          config: packJson(mergeEnvelopeMeta(base, next)),
          revision: page.revision + 1,
          updatedAt: at,
        })
        .where('id', '=', pageId)
        .execute();
      return (await this.findById(pageId)) ?? 'not-found';
    },

    /**
     * Replace a page's per-template config BODY (the envelope's `config` key)
     * while leaving every other envelope field alone — the Studio item editor's
     * write (crud `columns[]`, an archetype `layout`, …).
     *
     * Distinct from `replaceConfig`, which swaps the whole document. Like
     * `setLayout` this deliberately does not re-stamp `config.generatedHash`;
     * the resulting staleness is what protects the edit from the next
     * generation run. The body is validated by the server route before it
     * reaches here.
     */
    async setTemplateConfig(
      pageId: string,
      body: Record<string, unknown>,
      opts: { expectedRevision?: number; at?: number } = {},
    ): Promise<Page | 'not-found' | 'conflict'> {
      const at = opts.at ?? Date.now();
      const page = await this.findById(pageId);
      if (page === null) return 'not-found';
      if (opts.expectedRevision !== undefined && opts.expectedRevision !== page.revision) {
        return 'conflict';
      }
      const envelope = asRecord(page.config);
      await db
        .updateTable('adminium_pages')
        .set({
          config: packJson({ ...envelope, config: body }),
          revision: page.revision + 1,
          updatedAt: at,
        })
        .where('id', '=', pageId)
        .execute();
      return (await this.findById(pageId)) ?? 'not-found';
    },

    /**
     * Bulk nav placement write — one drag in the sidebar organizer renumbers
     * every sibling, so this takes the whole group at once and runs in a single
     * transaction (a partial reorder is a visibly scrambled sidebar).
     *
     * Renumbers densely from 0 in the given order rather than preserving the
     * caller's numbers: producers emit three different strides today (10,11,12
     * for dashboards, 20,30,40 for crud, 25,35,45 for archetypes) and
     * `nav_order` is an `int`, so there is no midpoint to insert into. Dense
     * renumbering is the only scheme that stays correct without a column
     * migration. Envelopes are mirrored for the same durability reason as
     * `updateMeta`. Unknown ids are ignored; returns how many rows moved.
     */
    async reorderNav(
      entries: readonly { id: string; navGroup: string | null }[],
      at: number = Date.now(),
    ): Promise<number> {
      return db.transaction().execute(async (trx) => {
        const ids = entries.map((entry) => entry.id);
        if (ids.length === 0) return 0;
        const rows = await trx
          .selectFrom('adminium_pages')
          .selectAll()
          .where('id', 'in', ids)
          .execute();
        const byId = new Map(rows.map((row) => [row.id, row]));

        // Dense per-group ordering, in the order the caller listed them.
        const nextOrder = new Map<string | null, number>();
        let moved = 0;
        for (const entry of entries) {
          const row = byId.get(entry.id);
          if (row === undefined) continue;
          const order = nextOrder.get(entry.navGroup) ?? 0;
          nextOrder.set(entry.navGroup, order + 1);
          if (row.navGroup === entry.navGroup && row.navOrder === order) continue;
          const page = decode(row);
          await trx
            .updateTable('adminium_pages')
            .set({
              navGroup: entry.navGroup,
              navOrder: order,
              config: packJson(
                mergeEnvelopeMeta(page.config, {
                  slug: page.slug,
                  title: page.title,
                  icon: page.icon,
                  navGroup: entry.navGroup,
                  navOrder: order,
                }),
              ),
              revision: page.revision + 1,
              updatedAt: at,
            })
            .where('id', '=', entry.id)
            .execute();
          moved += 1;
        }
        return moved;
      });
    },

    /**
     * Delete a page. `adminium_views` (saved filters AND per-user layout
     * overrides) and `adminium_scheduled_reports` cascade via their FKs; the
     * caller is responsible for the `page:<id>:*` grants, which live in the
     * polymorphic `adminium_role_permissions.resource_ref` column that no FK
     * can reach (see `permissionsRepo.revokeAllForResource`).
     */
    async delete(pageId: string): Promise<boolean> {
      const result = await db
        .deleteFrom('adminium_pages')
        .where('id', '=', pageId)
        .executeTakeFirst();
      return affected(result.numDeletedRows) > 0;
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
     * `icon` is back-filled only when the row has none. `title`/`navGroup`,
     * when provided, sync the row's nav projection from the envelope — the
     * bootstrap tree reads the ROW columns, so without this an expanded llm
     * page would stay outside the nav (and `/p/$slug` resolves from the nav
     * tree, leaving the page unreachable). Returns the reloaded page, or null
     * if the id does not exist.
     */
    async replaceConfig(
      pageId: string,
      config: unknown,
      opts: { icon?: string | null; title?: string; navGroup?: string | null; at?: number } = {},
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
          ...(opts.title === undefined ? {} : { title: opts.title }),
          ...(opts.navGroup === undefined ? {} : { navGroup: opts.navGroup }),
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
