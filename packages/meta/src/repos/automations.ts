// SPDX-License-Identifier: AGPL-3.0-only
/**
 * automationsRepo — adminium_automations (migration 0006 + 0028).
 *
 * One row per rule: WHAT fires it (`trigger`), WHAT it does (`graph`), and the
 * bookkeeping the engine keeps against it (`last_run_at`, `next_run_at`,
 * `watch_cursor`).
 *
 * ─── Why the trigger is not queried ────────────────────────────────────────
 *
 * `listEnabledFor(connection, table, event)` loads every enabled rule and
 * filters in JavaScript rather than reaching into the `trigger` json. That is
 * the store's rule (json columns are opaque, never queried with JSON
 * operators — the three dialects spell those operators three different ways),
 * and it costs nothing here: the matcher keeps an in-memory index built from
 * this list and rebuilt on every rule write, so the query runs on boot and on
 * edit, not per record.
 *
 * `next_run_at` IS a column, because `listDue` runs every minute and is the
 * one question that must be answerable by an index.
 */

import type { Selectable } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import {
  automationGraphSchema,
  automationTriggerSchema,
  automationWatchCursorSchema,
  type AutomationGraph,
  type AutomationTrigger,
  type AutomationWatchCursor,
} from '../schema/json-payloads.js';
import type { AdminiumAutomationsTable } from '../schema/tables.js';
import { affected, packJson, readBool, readJson, readJsonOrNull, writeBool } from './util.js';

export interface Automation {
  id: string;
  connectionId: string | null;
  name: string;
  description: string | null;
  enabled: boolean;
  trigger: AutomationTrigger;
  graph: AutomationGraph;
  lastRunAt: number | null;
  nextRunAt: number | null;
  watchCursor: AutomationWatchCursor | null;
  timeSavedMinutes: number | null;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateAutomationInput {
  connectionId: string | null;
  name: string;
  description?: string | null | undefined;
  enabled?: boolean | undefined;
  trigger: AutomationTrigger;
  graph: AutomationGraph;
  /** Computed by the caller (the schedule module) — null parks a schedule. */
  nextRunAt?: number | null | undefined;
  timeSavedMinutes?: number | null | undefined;
  createdBy?: string | null | undefined;
}

export interface UpdateAutomationInput {
  name?: string | undefined;
  description?: string | null | undefined;
  enabled?: boolean | undefined;
  trigger?: AutomationTrigger | undefined;
  graph?: AutomationGraph | undefined;
  nextRunAt?: number | null | undefined;
  timeSavedMinutes?: number | null | undefined;
}

/** What a tick or a poll writes back — never the rule's authored fields. */
export interface AdvanceAutomationInput {
  lastRunAt?: number | undefined;
  nextRunAt?: number | null | undefined;
  watchCursor?: AutomationWatchCursor | null | undefined;
}

function decode(row: Selectable<AdminiumAutomationsTable>): Automation {
  const cursor = readJsonOrNull(row.watchCursor);
  return {
    id: row.id,
    connectionId: row.connectionId,
    name: row.name,
    description: row.description,
    enabled: readBool(row.enabled),
    trigger: automationTriggerSchema.parse(readJson(row.trigger)),
    graph: automationGraphSchema.parse(readJson(row.graph)),
    lastRunAt: row.lastRunAt,
    nextRunAt: row.nextRunAt,
    watchCursor: cursor === null ? null : automationWatchCursorSchema.parse(cursor),
    timeSavedMinutes: row.timeSavedMinutes,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function automationsRepo(meta: MetaDb) {
  const { db } = meta;

  async function findById(id: string): Promise<Automation | null> {
    const row = await db
      .selectFrom('adminium_automations')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? decode(row) : null;
  }

  async function listEnabled(): Promise<Automation[]> {
    const rows = await db
      .selectFrom('adminium_automations')
      .selectAll()
      .where('enabled', '=', writeBool(meta, true))
      .orderBy('createdAt', 'asc')
      .orderBy('id', 'asc')
      .execute();
    return rows.map(decode);
  }

  return {
    findById,
    listEnabled,

    async create(input: CreateAutomationInput, at: number = Date.now()): Promise<Automation> {
      const row = {
        id: newId('auto'),
        connectionId: input.connectionId,
        name: input.name,
        description: input.description ?? null,
        enabled: writeBool(meta, input.enabled ?? false),
        trigger: packJson(automationTriggerSchema.parse(input.trigger)),
        graph: packJson(automationGraphSchema.parse(input.graph)),
        lastRunAt: null,
        nextRunAt: input.nextRunAt ?? null,
        watchCursor: null,
        timeSavedMinutes: input.timeSavedMinutes ?? null,
        createdBy: input.createdBy ?? null,
        createdAt: at,
        updatedAt: at,
      };
      await db.insertInto('adminium_automations').values(row).execute();
      return decode(row as unknown as Selectable<AdminiumAutomationsTable>);
    },

    /** Newest first — the rule list's order (comp 217-233 is a recency list). */
    async list(opts: { connectionId?: string | null } = {}): Promise<Automation[]> {
      let query = db.selectFrom('adminium_automations').selectAll();
      if (opts.connectionId !== undefined) {
        query =
          opts.connectionId === null
            ? query.where('connectionId', 'is', null)
            : query.where('connectionId', '=', opts.connectionId);
      }
      const rows = await query.orderBy('createdAt', 'desc').orderBy('id', 'desc').execute();
      return rows.map(decode);
    },

    async update(
      id: string,
      patch: UpdateAutomationInput,
      at: number = Date.now(),
    ): Promise<Automation | null> {
      const set: Record<string, unknown> = { updatedAt: at };
      if (patch.name !== undefined) set['name'] = patch.name;
      if (patch.description !== undefined) set['description'] = patch.description;
      if (patch.enabled !== undefined) set['enabled'] = writeBool(meta, patch.enabled);
      if (patch.trigger !== undefined) {
        set['trigger'] = packJson(automationTriggerSchema.parse(patch.trigger));
      }
      if (patch.graph !== undefined) {
        set['graph'] = packJson(automationGraphSchema.parse(patch.graph));
      }
      if (patch.nextRunAt !== undefined) set['nextRunAt'] = patch.nextRunAt;
      if (patch.timeSavedMinutes !== undefined) set['timeSavedMinutes'] = patch.timeSavedMinutes;
      const res = await db
        .updateTable('adminium_automations')
        .set(set)
        .where('id', '=', id)
        .executeTakeFirst();
      if (affected(res.numUpdatedRows) === 0) return null;
      return findById(id);
    },

    async remove(id: string): Promise<boolean> {
      const res = await db.deleteFrom('adminium_automations').where('id', '=', id).executeTakeFirst();
      return affected(res.numDeletedRows as bigint | undefined) === 1;
    },

    /**
     * Enabled record-triggered rules for one (connection, table, event). The
     * JS filter is deliberate — see the header.
     */
    async listEnabledFor(
      connectionId: string,
      table: string,
      event: 'created' | 'updated' | 'deleted',
    ): Promise<Automation[]> {
      const rules = await listEnabled();
      return rules.filter(
        (rule) =>
          rule.trigger.kind === 'record' &&
          rule.trigger.connectionId === connectionId &&
          rule.trigger.table === table &&
          rule.trigger.event === event,
      );
    },

    /** Enabled rules whose trigger asks the poller to watch (D4). `deleted` cannot be watched. */
    async listWatching(): Promise<Automation[]> {
      const rules = await listEnabled();
      return rules.filter(
        (rule) =>
          rule.trigger.kind === 'record' && rule.trigger.watch && rule.trigger.event !== 'deleted',
      );
    },

    /** Enabled schedule rules whose tick has passed — the scanner's worklist, every minute. */
    async listDue(at: number = Date.now()): Promise<Automation[]> {
      const rows = await db
        .selectFrom('adminium_automations')
        .selectAll()
        .where('enabled', '=', writeBool(meta, true))
        .where('nextRunAt', 'is not', null)
        .where('nextRunAt', '<=', at)
        .orderBy('nextRunAt', 'asc')
        .execute();
      return rows.map(decode).filter((rule) => rule.trigger.kind === 'schedule');
    },

    /**
     * Engine bookkeeping only. Separate from `update` so a tick can never
     * touch what a person authored — and so `updated_at`, which the UI reads
     * as "when was this rule last edited", does not move every minute.
     */
    async advance(id: string, input: AdvanceAutomationInput): Promise<boolean> {
      const set: Record<string, unknown> = {};
      if (input.lastRunAt !== undefined) set['lastRunAt'] = input.lastRunAt;
      if (input.nextRunAt !== undefined) set['nextRunAt'] = input.nextRunAt;
      if (input.watchCursor !== undefined) {
        set['watchCursor'] =
          input.watchCursor === null
            ? null
            : packJson(automationWatchCursorSchema.parse(input.watchCursor));
      }
      if (Object.keys(set).length === 0) return false;
      const res = await db
        .updateTable('adminium_automations')
        .set(set)
        .where('id', '=', id)
        .executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },
  };
}

export type AutomationsRepo = ReturnType<typeof automationsRepo>;
