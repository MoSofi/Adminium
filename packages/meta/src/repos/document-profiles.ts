// SPDX-License-Identifier: AGPL-3.0-only
/**
 * documentProfilesRepo — adminium_document_profiles (wave 0031).
 *
 * A profile is an operator's answer to "which columns of which table make one
 * of these documents". It is generated in Studio from the PROVIDER's own
 * `describe(kind)`, so every slot id inside `mapping` belongs to the
 * provider's vocabulary and this repo never has an opinion about them: it
 * stores the mapping whole and hands it back whole. A provider that grows a
 * slot needs no migration here.
 *
 * ─── `addOnKey` IS A SOFT REFERENCE AND THAT IS THE POINT ──────────────────
 *
 * There is no foreign key to `adminium_manifests`. Uninstalling an add-on
 * deletes its manifest row, and a profile — like the documents issued through
 * it — has to survive that (D5). What uninstall DOES do is disable the
 * profile, so nothing tries to render through a provider that is gone; that
 * is transaction, and `setEnabledForAddOn` below is the half of it that lives
 * here.
 *
 * ─── `trigger` IS JSON, NOT A ROW IN A TRIGGER TABLE ───────────────────────
 *
 * `adminium_record_triggers` was designed for this. It was not built: the
 * owner ruled on 2026-09-10 (D55, reversing O4) that a profile's trigger is
 * an AUTOMATION with a one-node graph, because automations had already
 * shipped the matcher, the 60 s undo window, the per-row dedupe key and the
 * delay-by-origin rule a trigger table would have needed. This column holds what the operator chose — `{event, when?}` —
 * and the automation row is derived from it, so the profile stays the single
 * thing an operator edits.
 */

import type { Kysely, Selectable } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import type { AdminiumDocumentProfilesTable, MetaDB } from '../schema/tables.js';
import { affected, packJson, readBool, readJson, readJsonOrNull, writeBool } from './util.js';

/**
 * What the operator chose, plus the id of the rule derived from it.
 *
 * `automationId` is written by the SERVER after it reconciles the rule
 * (`documents/trigger-sync.ts`), never by a client. It lives here rather than
 * in a column of its own because the trigger IS the rule: a second place to
 * keep them in step is a second place for them to disagree, and this way a
 * profile with no trigger provably has no rule id either.
 */
export interface DocumentProfileTrigger {
  event: 'record.created' | 'record.updated' | 'record.deleted';
  when?: { column: string; op: string; value?: unknown | undefined } | null | undefined;
  /** The `adminium_automations` row that fires this mapping. Server-written. */
  automationId?: string | null | undefined;
}

export interface DocumentProfile {
  id: string;
  addOnKey: string;
  kind: string;
  name: string;
  connectionId: string;
  table: string;
  mapping: Record<string, unknown>;
  options: Record<string, unknown>;
  trigger: DocumentProfileTrigger | null;
  deliver: Record<string, unknown>;
  enabled: boolean;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
  /** The app whose install made this profile; null for an operator's own. */
  ownerApp: string | null;
  /** The column a document's lines are listed by. */
  orderBy: string | null;
}

/**
 * Optional fields carry `| undefined` explicitly.
 *
 * `exactOptionalPropertyTypes` is on, and this type is built from a PARSED
 * REQUEST BODY where an absent field really is `undefined` — so a route
 * spreading its body in would otherwise have to strip the keys one at a time.
 * "Not given" and "given as undefined" mean the same thing for an input DTO.
 */
export interface CreateDocumentProfileInput {
  addOnKey: string;
  kind: string;
  name: string;
  connectionId: string;
  table: string;
  mapping: Record<string, unknown>;
  options?: Record<string, unknown> | undefined;
  trigger?: DocumentProfileTrigger | null | undefined;
  deliver?: Record<string, unknown> | undefined;
  enabled?: boolean | undefined;
  createdBy?: string | null | undefined;
  ownerApp?: string | null | undefined;
  orderBy?: string | null | undefined;
}

export interface PatchDocumentProfileInput {
  name?: string | undefined;
  mapping?: Record<string, unknown> | undefined;
  options?: Record<string, unknown> | undefined;
  trigger?: DocumentProfileTrigger | null | undefined;
  deliver?: Record<string, unknown> | undefined;
  enabled?: boolean | undefined;
  orderBy?: string | null | undefined;
}

function hydrate(row: Selectable<AdminiumDocumentProfilesTable>): DocumentProfile {
  return {
    id: row.id,
    addOnKey: row.addOnKey,
    kind: row.kind,
    name: row.name,
    connectionId: row.connectionId,
    table: row.table,
    mapping: readJson<Record<string, unknown>>(row.mapping),
    options: readJson<Record<string, unknown>>(row.options),
    trigger: readJsonOrNull<DocumentProfileTrigger>(row.trigger),
    deliver: readJson<Record<string, unknown>>(row.deliver),
    enabled: readBool(row.enabled),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ownerApp: row.ownerApp,
    orderBy: row.orderBy,
  };
}

export function documentProfilesRepo(meta: MetaDb) {
  const db = meta.db as unknown as Kysely<MetaDB>;

  async function findById(id: string): Promise<DocumentProfile | null> {
    const row = await db
      .selectFrom('adminium_document_profiles')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row === undefined ? null : hydrate(row);
  }

  async function list(
    filter: { connectionId?: string | undefined; addOnKey?: string | undefined } = {},
  ): Promise<
    DocumentProfile[]
  > {
    let query = db.selectFrom('adminium_document_profiles').selectAll();
    if (filter.connectionId !== undefined) {
      query = query.where('connectionId', '=', filter.connectionId);
    }
    if (filter.addOnKey !== undefined) query = query.where('addOnKey', '=', filter.addOnKey);
    const rows = await query.orderBy('name', 'asc').execute();
    return rows.map(hydrate);
  }

  /**
   * Every ENABLED profile that fires on a write to this table.
   *
   * The matcher's read. It is deliberately narrow — connection, table, and
   * enabled — because the `when` clause is evaluated against the row's before
   * and after images, which this repo has never seen.
   */
  async function listTriggeredBy(connectionId: string, table: string): Promise<DocumentProfile[]> {
    const rows = await db
      .selectFrom('adminium_document_profiles')
      .selectAll()
      .where('connectionId', '=', connectionId)
      .where('table', '=', table)
      .where('enabled', '=', writeBool(meta, true))
      .execute();
    return rows.map(hydrate).filter((profile) => profile.trigger !== null);
  }

  async function create(input: CreateDocumentProfileInput, at = Date.now()): Promise<DocumentProfile> {
    const row = {
      id: newId('dpf'),
      addOnKey: input.addOnKey,
      kind: input.kind,
      name: input.name,
      connectionId: input.connectionId,
      table: input.table,
      mapping: packJson(input.mapping),
      options: packJson(input.options ?? {}),
      trigger: input.trigger == null ? null : packJson(input.trigger),
      deliver: packJson(input.deliver ?? { store: true }),
      enabled: writeBool(meta, input.enabled ?? true),
      createdBy: input.createdBy ?? null,
      createdAt: at,
      updatedAt: at,
      ownerApp: input.ownerApp ?? null,
      orderBy: input.orderBy ?? null,
    };
    await db.insertInto('adminium_document_profiles').values(row).execute();
    return (await findById(row.id))!;
  }

  async function patch(
    id: string,
    input: PatchDocumentProfileInput,
    at = Date.now(),
  ): Promise<DocumentProfile | null> {
    const values: Record<string, unknown> = { updatedAt: at };
    if (input.name !== undefined) values.name = input.name;
    if (input.mapping !== undefined) values.mapping = packJson(input.mapping);
    if (input.options !== undefined) values.options = packJson(input.options);
    if (input.trigger !== undefined) {
      values.trigger = input.trigger === null ? null : packJson(input.trigger);
    }
    if (input.deliver !== undefined) values.deliver = packJson(input.deliver);
    if (input.enabled !== undefined) values.enabled = writeBool(meta, input.enabled);
    if (input.orderBy !== undefined) values.orderBy = input.orderBy;

    const rows = await db
      .updateTable('adminium_document_profiles')
      .set(values as never)
      .where('id', '=', id)
      .executeTakeFirst();
    return affected(rows.numUpdatedRows) === 0 ? null : await findById(id);
  }

  async function remove(id: string): Promise<boolean> {
    const rows = await db
      .deleteFrom('adminium_document_profiles')
      .where('id', '=', id)
      .executeTakeFirst();
    return affected(rows.numDeletedRows) === 1;
  }

  /**
   * Disable (or re-enable) every profile belonging to an add-on.
   *
   * The half that lives here, and it is DISABLE rather than DELETE on
   * purpose: uninstall keeps the operator's mapping so that reinstalling the
   * add-on does not mean re-doing the work of pointing twenty columns at
   * twenty slots. What must stop is rendering, and `enabled: false` is what
   * stops it — in the same transaction as the manifest change, so no job is
   * ever enqueued for a provider that is already gone.
   */
  async function setEnabledForAddOn(
    addOnKey: string,
    enabled: boolean,
    at = Date.now(),
  ): Promise<number> {
    const rows = await db
      .updateTable('adminium_document_profiles')
      .set({ enabled: writeBool(meta, enabled), updatedAt: at } as never)
      .where('addOnKey', '=', addOnKey)
      .executeTakeFirst();
    return affected(rows.numUpdatedRows);
  }

  /** The profiles one app's install made on a connection. */
  async function listOwnedBy(connectionId: string, appKey: string): Promise<DocumentProfile[]> {
    const rows = await db
      .selectFrom('adminium_document_profiles')
      .selectAll()
      .where('connectionId', '=', connectionId)
      .where('ownerApp', '=', appKey)
      .orderBy('name', 'asc')
      .execute();
    return rows.map(hydrate);
  }

  /** Remove the profiles one app's install made; an operator's own are never touched. */
  async function removeOwnedBy(connectionId: string, appKey: string): Promise<number> {
    const rows = await db
      .deleteFrom('adminium_document_profiles')
      .where('connectionId', '=', connectionId)
      .where('ownerApp', '=', appKey)
      .executeTakeFirst();
    return affected(rows.numDeletedRows);
  }

  return { findById, list, listTriggeredBy, listOwnedBy, create, patch, remove, removeOwnedBy, setEnabledForAddOn };
}

export type DocumentProfilesRepo = ReturnType<typeof documentProfilesRepo>;
