// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE RULES THAT HAND ROWS TO A LEDGER — read, drawn, switched, taken away.
 *
 * An add-on that keeps a ledger is posted into by rules on other tables: an
 * app's (its manifest stored them) and the owner's own. These routes are the
 * owner's side of that.
 *
 *  - Two READS for the add-on's rules page: every rule that posts into one
 *    ledger on a connection — whose it is, whether it runs, how many rows
 *    hold something under it, how many saves wait to be worked out — and the
 *    tables and columns a new rule may be drawn from. A session and the
 *    connection are enough: they show rules and row counts, never rows.
 *  - Three WRITES of an owner's rule on a table — store or change, remove,
 *    switch — each needing the grant that changes what a table's columns
 *    mean (`system:schema:remap`). An app's rule is never changed here: the
 *    owner switches it off instead, and an app update leaves the switch be.
 *    A rule that rows still hold something under keeps where it goes, when
 *    it fires and what it hands over until they are put back.
 *  - Two RUNS: "make items from this table" (the ledger's own `adopt` action,
 *    once a row, each its own save) and "record what waited" (the saves let
 *    through while the add-on could not be asked, oldest first).
 *
 * After changing this file: build, then `pnpm openapi`.
 */
import { isDeepStrictEqual } from 'node:util';

import type { Ledger, Posting } from '@adminium/manifest';
import { connectionTenantConfig, type MetaDb } from '@adminium/meta';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { sql } from 'kysely';
import type { z } from 'zod';

import { audited } from '../../audit/coverage.js';
import { columnPolicyFor, type EffectiveTable, type TablePosting, type TableSwitchedOff } from '../../connections/effective-schema.js';
import type { ConnectionManager } from '../../connections/manager.js';
import { ruleDecidedColumns } from '../../crud/decided-columns.js';
import type { ResolvedTable, SnapshotView } from '../../crud/identifiers.js';
import { receiptOf } from '../../crud/ledger-receipts.js';
import type { Row } from '../../crud/mask.js';
import { requestWriteContext, type RecordWriteService, type WriteTarget } from '../../crud/write-service.js';
import { normalizeWriteValue } from '../../crud/write-values.js';
import { loadSnapshotView } from '../../data-io/snapshot-view.js';
import { AppError, ConflictError, ForbiddenError, NotFoundError, PostingRefusedError, ValidationFailedError } from '../../errors.js';
import { tellPostings } from '../../ledgers/announce.js';
import type { LedgerRuntime, ResolvedLedger } from '../../ledgers/registry.js';
import { changeTableRule, columnsHanded, holdingCount, holdsChanged, ledgersOf, ownerPostingIssue, ownTableRule, statesOf, unplannedCount, type RuleReceipts } from '../../ledgers/rules.js';
import { SCHEMA_REMAP } from '../schema/index.js';
import {
  catchUpBody,
  catchUpReply,
  ledgerParams,
  ledgerQuery,
  makeItemsBody,
  makeItemsReply,
  postingBody,
  postingParams,
  postingsReply,
  sourcesReply,
  storedReply,
  switchBody,
  switchReply,
} from './schema.js';


/**
 * Who changed a rule, for the rule's own record: a signed-in person. An API
 * key that holds the right changes rules too, and its id is no user's — the
 * record's author is a link to a user, so a key's change is written with none
 * (the audit log still names the key).
 */
function changedBy(request: FastifyRequest): string | null {
  const actor = requestWriteContext(request, 'dashboard').actor;
  return actor?.kind === 'user' ? actor.id : null;
}
export interface LedgerRoutesDeps {
  manager: ConnectionManager;
  meta: MetaDb;
  ledgers: LedgerRuntime;
  writes: RecordWriteService;
  /** How long one of the two runs may go on before it answers what it has done (a test's shorter one). */
  runBudgetMs?: number | undefined;
}

/** The most postings one table carries, an app's and the owner's together. */
const POSTINGS_MAX = 6;
/** The action "make items from this table" runs, where a ledger declares it. */
const ADOPT = 'adopt';
/** The name its receipts carry: one no stored rule can take (a rule's id is a plain word), so it shadows none and no switch names it. */
const ADOPT_RULE = '~adopt';
/** Refusals told a call of "make items": past these the call answers, so a setting that refuses every row is said once and not five hundred times. */
const REFUSALS_TOLD = 20;

export function ledgerRoutes(deps: LedgerRoutesDeps): FastifyPluginAsyncZod {
  const { manager, meta, ledgers, writes } = deps;

  return async (app) => {
    async function requireSession(request: FastifyRequest): Promise<void> {
      await app.rbac.resolve(request);
    }

    /** A connection's tables as they stand now, with what is installed read again. */
    async function viewOf(connectionId: string): Promise<SnapshotView> {
      await manager.mustFind(connectionId);
      await ledgers.refresh?.();
      return loadSnapshotView(meta, connectionId, { lists: true });
    }

    /** An installed add-on's ledger: as its manifest declares it, and with its tables here (null while they cannot be found). */
    function ledgerOf(view: SnapshotView, addOn: string, id: string): { declared: Ledger; resolved: ResolvedLedger | null } {
      const manifest = ledgers.manifestOf(view.connectionId, addOn);
      const declared = manifest === null ? undefined : ledgersOf(manifest).find((candidate) => candidate.id === id);
      if (declared === undefined) throw new NotFoundError('There is no such ledger on this connection.', { addOn, ledger: id });
      return { declared, resolved: ledgers.ledgerOf?.(view, addOn, id) ?? null };
    }

    const tableOf = (view: SnapshotView, id: string): ResolvedTable => {
      try {
        return view.table(id);
      } catch {
        throw new NotFoundError('There is no such table on this connection.', { table: id });
      }
    };

    const receiptsOf = (view: SnapshotView, table: EffectiveTable, posting: Pick<TablePosting, 'id' | 'via' | 'into'>): RuleReceipts => ({
      ledger: posting.into.ledger,
      tableRef: ledgers.refOf(view.connectionId, table.id),
      posting: posting.id,
      lines: posting.via !== undefined,
    });

    /** Whether a table is one the add-on made for itself: its own manifest posts from those, never an owner's rule or run. */
    const ownTable = (view: SnapshotView, addOn: string, tableId: string): boolean => ledgers.refOf(view.connectionId, tableId).startsWith(`${addOn}:`);

    /**
     * A column whose values are kept from readers (a secret, masked personal
     * data) is handed to an add-on's code, and written into its rows, only on
     * the word of somebody who may show it anyway.
     */
    async function refuseKeptColumns(request: FastifyRequest, table: EffectiveTable, columns: readonly string[]): Promise<void> {
      const policy = columnPolicyFor(table);
      const kept = columns.find((column) => policy.secret.has(column) || policy.masked.has(column));
      if (kept === undefined || (await app.rbac.resolve(request)).superAdmin) return;
      throw new ForbiddenError(`${table.name}.${kept} is kept from readers: handing it to an add-on requires Super Admin.`);
    }

    const budget = () => {
      const started = Date.now();
      return () => Date.now() - started > (deps.runBudgetMs ?? 25_000);
    };

    // ── the two reads ─────────────────────────────────────────────────────────

    app.get(
      '/ledgers/:addOn/:ledger/postings',
      { preHandler: requireSession, schema: { params: ledgerParams, querystring: ledgerQuery, response: { 200: postingsReply } } },
      async (request) => {
        const { addOn, ledger: ledgerId } = request.params;
        const { connectionId } = request.query;
        const view = await viewOf(connectionId);
        const { resolved } = ledgerOf(view, addOn, ledgerId);
        const db = resolved === null ? null : (await manager.data(connectionId)).db;
        const postings: z.infer<typeof postingsReply>['postings'] = [];
        for (const table of view.model.tables) {
          for (const posting of table.postings ?? []) {
            if (posting.into.addOn !== addOn || posting.into.ledger !== ledgerId) continue;
            const at = tableOf(view, table.id);
            const where = receiptsOf(view, table, posting);
            const { into, ...rule } = posting;
            postings.push({
              ...rule,
              action: into.action,
              table: table.id,
              tableLabel: table.label ?? table.name,
              owner: ledgers.ownerOf?.(view, at, posting) ?? null,
              enabled: table.switchedOff?.postings.includes(posting.id) !== true,
              state: ledgers.resolve(view, at, posting).state,
              holding: resolved === null || db === null ? 0 : await holdingCount(db, resolved, where),
              unplanned: resolved === null || db === null ? 0 : await unplannedCount(db, resolved, where),
            });
          }
        }
        return { postings, canChange: await request.can(SCHEMA_REMAP) };
      },
    );

    app.get(
      '/ledgers/:addOn/:ledger/sources',
      { preHandler: requireSession, schema: { params: ledgerParams, querystring: ledgerQuery, response: { 200: sourcesReply } } },
      async (request) => {
        const { addOn, ledger: ledgerId } = request.params;
        const { connectionId } = request.query;
        const view = await viewOf(connectionId);
        const { declared, resolved } = ledgerOf(view, addOn, ledgerId);
        const tables = view.model.tables
          // A row a rule can name; and never the add-on's own tables, which its manifest posts from.
          .filter((table) => table.columns.filter((column) => column.isPrimaryKey).length === 1 && !ownTable(view, addOn, table.id))
          .map((table) => {
            const decided = ruleDecidedColumns(table, view.model);
            const states = statesOf(table);
            const lineOf = view.model.relations
              .filter((relation) => relation.through === null && relation.from.tableId === table.id && relation.from.columns.length === 1)
              .map((relation) => ({ table: relation.to.tableId, via: relation.from.columns[0]! }));
            return {
              table: table.id,
              label: table.label ?? table.name,
              ...(states.length === 0 ? {} : { states }),
              columns: table.columns.map((column) => {
                const values = column.options !== undefined && 'values' in column.options ? column.options.values.map((item) => item.value) : undefined;
                return { name: column.name, label: column.label ?? column.name, type: String(column.logicalType), ...(values === undefined ? {} : { enum: [...values] }), decided: decided.has(column.name) };
              }),
              ...(lineOf.length === 0 ? {} : { lineOf }),
            };
          });
        return {
          tables,
          actions: Object.fromEntries(Object.entries(declared.actions).map(([id, action]) => [id, { inputs: { ...action.inputs } }])),
          settings: resolved?.settings === null || resolved === null ? [] : [...resolved.settings.columns.keys()].filter((column) => !resolved.settings!.primaryKey.includes(column)),
        };
      },
    );

    // ── an owner's rule on a table ────────────────────────────────────────────

    /** The table a rule's address names, with the owner's stored postings on it and the ids an app's manifest put there. */
    async function ruleAt(connectionId: string, tableId: string) {
      const view = await viewOf(connectionId);
      const at = tableOf(view, tableId);
      const own = (await ownTableRule<{ postings?: Posting[] }>(meta, { connectionId, table: at.id, op: 'table.postings' }))?.postings ?? [];
      return { view, at, table: at.table, own, managed: new Set(at.table.managedPostings ?? []) };
    }

    const managedRefusal = (posting: string) => new ConflictError("This rule is the app's own: it can be switched off, not changed.", 'CONFLICT', { reason: 'managed', posting });
    /** The rule a table's price rule records its uses by stays, and stays that rule, while the price rule names it. */
    const usesRefusal = (posting: string) => new ConflictError("This table's price rule records what an order used through this rule: remove the price rule first.", 'CONFLICT', { reason: 'adjust-uses', posting });
    const holdingRefusal = (posting: string, rows: number) => new PostingRefusedError('Rows still hold something under this rule: put them back first.', { reason: 'receipt-open', posting, rows });
    /** What was read is what is stored still: of two people changing a table's rules at once, the second is asked to look again. */
    const unmoved = (own: readonly Posting[]) => (stored: { postings?: Posting[] } | null) => {
      if (!isDeepStrictEqual(stored?.postings ?? [], own)) throw new ConflictError('The rules of this table were changed a moment ago. Read them again.', 'CONFLICT', { retry: true });
    };

    /** How many rows hold something under a stored rule, as the ledger's receipts tell it. */
    async function holding(view: SnapshotView, table: EffectiveTable, posting: Posting): Promise<number> {
      const resolved = ledgers.ledgerOf?.(view, posting.into.addOn, posting.into.ledger) ?? null;
      if (resolved === null) return 0;
      return holdingCount((await manager.data(view.connectionId)).db, resolved, receiptsOf(view, table, posting));
    }

    app.put(
      '/connections/:id/tables/:table/postings/:posting',
      { preHandler: app.rbac.require(SCHEMA_REMAP), config: { audit: audited('rbac') }, schema: { params: postingParams, body: postingBody, response: { 200: storedReply } } },
      async (request) => {
        const { id: connectionId, posting: id } = request.params;
        const { view, at, table, own, managed } = await ruleAt(connectionId, request.params.table);
        const before = own.find((candidate) => candidate.id === id);
        if (before === undefined && managed.has(id)) throw managedRefusal(id);
        // A rule whose rows are lines of another row is drawn in a file, where its link can be said: this sheet would lose it.
        if (before?.via !== undefined) throw new ValidationFailedError('This rule reads its rows as lines of another row, which is not changed here: change it where it was drawn.', { table: at.id, posting: id });
        const posting = { id, ...request.body } as Posting;
        if (before !== undefined && table.adjust?.uses === id && !isDeepStrictEqual(before.into, posting.into)) throw usesRefusal(id);
        if (ownTable(view, posting.into.addOn, at.id)) throw new ValidationFailedError(`${at.name} is one of the add-on's own tables: its own rules post from it.`, { table: at.id, posting: id });
        const beside = own.filter((candidate) => candidate.id !== id);
        if (before === undefined && (table.postings ?? []).length >= POSTINGS_MAX) throw new ValidationFailedError(`A table carries ${String(POSTINGS_MAX)} postings at most.`, { table: at.id });
        const issue = ownerPostingIssue({ model: view.model, table, posting, beside, manifest: ledgers.manifestOf(connectionId, posting.into.addOn) });
        if (issue !== null) throw new ValidationFailedError(issue, { table: at.id, posting: id });
        await refuseKeptColumns(request, table, columnsHanded(posting));
        if (before !== undefined && holdsChanged(before, posting)) {
          const rows = await holding(view, table, before);
          if (rows > 0) throw holdingRefusal(id, rows);
        }
        // The rule keeps its place among the table's own.
        const next = before === undefined ? [...own, posting] : own.map((candidate) => (candidate.id === id ? posting : candidate));
        const same = unmoved(own);
        await changeTableRule<{ postings?: Posting[] }>(meta, { connectionId, table: at.id, op: 'table.postings', by: changedBy(request) }, (stored) => {
          same(stored);
          return { postings: next };
        });
        await app.rbac.audit(request, {
          category: 'schema',
          action: 'ledger.rule.stored',
          connectionId,
          changes: { ...(before === undefined ? {} : { before: { posting: before } }), after: { table: at.id, posting } },
        });
        return posting;
      },
    );

    app.delete(
      '/connections/:id/tables/:table/postings/:posting',
      { preHandler: app.rbac.require(SCHEMA_REMAP), config: { audit: audited('rbac') }, schema: { params: postingParams } },
      async (request, reply) => {
        const { id: connectionId, posting: id } = request.params;
        const { view, at, table, own, managed } = await ruleAt(connectionId, request.params.table);
        // The owner's own row first: one whose name an app's rule took later is still the owner's to take away.
        const before = own.find((candidate) => candidate.id === id);
        if (before === undefined) {
          if (managed.has(id)) throw managedRefusal(id);
          throw new NotFoundError('There is no such rule on this table.', { table: at.id, posting: id });
        }
        if (!managed.has(id) && table.adjust?.uses === id) throw usesRefusal(id);
        const rows = managed.has(id) ? 0 : await holding(view, table, before);
        if (rows > 0) throw holdingRefusal(id, rows);
        const next = own.filter((candidate) => candidate.id !== id);
        const same = unmoved(own);
        const by = changedBy(request);
        await changeTableRule<{ postings?: Posting[] }>(meta, { connectionId, table: at.id, op: 'table.postings', by }, (stored) => {
          same(stored);
          return next.length === 0 ? null : { postings: next };
        });
        // A switch for a rule that is gone would switch off the next rule given its name.
        if (!managed.has(id)) {
          await changeTableRule<TableSwitchedOff>(meta, { connectionId, table: at.id, op: 'table.switchedOff', by }, (stored) => {
            if (stored === null || !stored.postings.includes(id)) return stored;
            const left = stored.postings.filter((other) => other !== id);
            return left.length === 0 && stored.adjust !== true ? null : { ...stored, postings: left };
          });
        }
        await app.rbac.audit(request, { category: 'schema', action: 'ledger.rule.removed', connectionId, changes: { before: { table: at.id, posting: before } } });
        return reply.code(204).send();
      },
    );

    app.patch(
      '/connections/:id/tables/:table/postings/:posting/switch',
      { preHandler: app.rbac.require(SCHEMA_REMAP), config: { audit: audited('rbac') }, schema: { params: postingParams, body: switchBody, response: { 200: switchReply } } },
      async (request) => {
        const { id: connectionId, posting: id } = request.params;
        const { enabled } = request.body;
        const { at, table } = await ruleAt(connectionId, request.params.table);
        // An app's rule and the owner's are both the owner's to switch.
        if (!(table.postings ?? []).some((posting) => posting.id === id)) throw new NotFoundError('There is no such rule on this table.', { table: at.id, posting: id });
        let was = true;
        await changeTableRule<TableSwitchedOff>(meta, { connectionId, table: at.id, op: 'table.switchedOff', by: changedBy(request) }, (stored) => {
          was = stored?.postings.includes(id) !== true;
          if (was === enabled) return stored;
          const postings = enabled ? (stored?.postings ?? []).filter((other) => other !== id) : [...(stored?.postings ?? []), id];
          return postings.length === 0 && stored?.adjust !== true ? null : { postings, ...(stored?.adjust === true ? { adjust: true as const } : {}) };
        });
        if (was !== enabled) {
          await app.rbac.audit(request, { category: 'schema', action: 'ledger.rule.switched', connectionId, changes: { before: { table: at.id, posting: id, enabled: was }, after: { table: at.id, posting: id, enabled } } });
        }
        return { enabled };
      },
    );

    // ── the two runs ──────────────────────────────────────────────────────────

    /** A table as a save's target, on the connection's own handle. */
    async function targetOf(view: SnapshotView, table: ResolvedTable): Promise<WriteTarget> {
      const { db, dialect } = await manager.data(view.connectionId);
      return { connectionId: view.connectionId, view, table, db, dialect, timezone: (await connectionTenantConfig(meta, view.connectionId))?.timezone ?? 'UTC' };
    }

    /** A refusal as a run tells it of one row: its reason, or its code. Anything that is no refusal is the server's own fault and fails the call. */
    const reasonOf = (error: unknown): string => {
      if (!(error instanceof AppError) || error.statusCode >= 500) throw error;
      const reason = (error.details as { reason?: unknown } | undefined)?.reason;
      return typeof reason === 'string' ? reason : error.code;
    };

    app.post(
      '/ledgers/:addOn/:ledger/make-items',
      { preHandler: app.rbac.require(SCHEMA_REMAP), config: { audit: audited('rbac') }, schema: { params: ledgerParams, body: makeItemsBody, response: { 200: makeItemsReply } } },
      async (request) => {
        const { addOn, ledger: ledgerId } = request.params;
        const { connectionId, label } = request.body;
        const limit = request.body.limit ?? 500;
        const view = await viewOf(connectionId);
        const { declared } = ledgerOf(view, addOn, ledgerId);
        if (declared.actions[ADOPT] === undefined) throw new NotFoundError('This ledger makes no items from another table.', { addOn, ledger: ledgerId });
        const at = tableOf(view, request.body.table);
        if (ownTable(view, addOn, at.id)) throw new ValidationFailedError(`${at.name} is one of the add-on's own tables.`, { table: at.id });
        if (at.primaryKey.length !== 1) throw new ValidationFailedError(`${at.name} has no single-column key, so its rows cannot be named.`, { table: at.id });
        if (!at.columns.has(label)) throw new ValidationFailedError(`${at.name} has no column ${JSON.stringify(label)}.`, { table: at.id, column: label });
        await refuseKeptColumns(request, at.table, [label]);
        const key = at.primaryKey[0]!;
        // The table as it is, with one more rule on it for this call alone: the row itself, named by the chosen column.
        const rule = { id: ADOPT_RULE, into: { addOn, ledger: ledgerId, action: ADOPT }, map: { what: { row: true }, name: label }, post: { on: { create: true } } } as unknown as TablePosting;
        const adopting: ResolvedTable = { ...at, table: { ...at.table, postings: [...(at.table.postings ?? []), rule] } };
        const target = await targetOf(view, adopting);
        let query = target.db.selectFrom(at.id as never).select(sql.ref(key).as('key')).orderBy(sql.ref(key)).limit(limit + 1);
        if (request.body.after !== undefined) query = query.where(sql.ref(key), '>', normalizeWriteValue(at.columns.get(key)!, request.body.after) as never);
        const found = (await query.execute()) as { key: unknown }[];
        const context = requestWriteContext(request, 'dashboard');
        const late = budget();
        const refused: { row: string; reason: string }[] = [];
        let made = 0;
        let skipped = 0;
        let done = 0;
        let last: unknown;
        for (const row of found.slice(0, limit)) {
          if (late() || refused.length >= REFUSALS_TOLD) break;
          try {
            const posted = await writes.post({
              target,
              pk: { [key]: row.key },
              posting: ADOPT_RULE,
              phase: 'post',
              context,
              announce: async (_row, postings) => {
                await tellPostings(app, { connectionId, view, postings, origin: 'dashboard', request });
              },
            });
            // A row the ledger has already: its own code answers nothing for it.
            if (posted.some((outcome) => outcome.rows > 0)) made += 1;
            else skipped += 1;
          } catch (error) {
            // One row that cannot be taken does not stop the rows after it.
            refused.push({ row: String(row.key), reason: reasonOf(error) });
          }
          done += 1;
          last = row.key;
        }
        const more = done < found.length;
        await app.rbac.audit(request, { category: 'data', action: 'ledger.items.made', connectionId, changes: { after: { addOn, ledger: ledgerId, table: at.id, label, made, skipped, refused: refused.length, more } } });
        return { made, skipped, refused, more, ...(more && last !== undefined ? { next: String(last) } : {}) };
      },
    );

    app.post(
      '/ledgers/:addOn/:ledger/catch-up',
      { preHandler: app.rbac.require(SCHEMA_REMAP), config: { audit: audited('rbac') }, schema: { params: ledgerParams, body: catchUpBody, response: { 200: catchUpReply } } },
      async (request) => {
        const { addOn, ledger: ledgerId } = request.params;
        const { connectionId } = request.body;
        const limit = request.body.limit ?? 200;
        const view = await viewOf(connectionId);
        const { resolved } = ledgerOf(view, addOn, ledgerId);
        if (resolved === null) throw new NotFoundError("This ledger's tables are not on this connection.", { addOn, ledger: ledgerId });
        const { db } = await manager.data(connectionId);
        const receiptKey = resolved.receipts.primaryKey[0] ?? 'id';
        let waiting = db
          .selectFrom(resolved.receipts.id as never)
          .selectAll()
          .where(sql.ref('state'), '=', 'unplanned' as never)
          .where(sql.ref('ledger'), '=', ledgerId as never)
          .orderBy(sql.ref(receiptKey));
        // One that could not be worked out stays where it is: the next call starts after it.
        if (request.body.after !== undefined) waiting = waiting.where(sql.ref(receiptKey), '>', normalizeWriteValue(resolved.receipts.columns.get(receiptKey)!, request.body.after) as never);
        const found = ((await waiting.limit(limit + 1).execute()) as Row[]).map(receiptOf);
        // The one who asked, and the add-on told it is the system catching up (never a customer, whoever saved first).
        const context = { ...requestWriteContext(request, 'dashboard'), origin: 'automation' as const };
        const refused: { receipt: string; reason: string }[] = [];
        const asked = new Set<string>();
        const late = budget();
        let planned = 0;
        let done = 0;
        let last: string | number | undefined;
        for (const receipt of found.slice(0, limit)) {
          if (late()) break;
          done += 1;
          last = receipt.id;
          // One call plans a phase for every line of the row it waits for.
          const once = `${receipt.sourceTable}\u0000${receipt.sourceRow}\u0000${receipt.posting}\u0000${receipt.phase}`;
          if (asked.has(once)) continue;
          asked.add(once);
          const tableId = ledgers.tableOfRef?.(connectionId, receipt.sourceTable) ?? null;
          let source: ResolvedTable | null = null;
          try {
            source = tableId === null ? null : view.table(tableId);
          } catch {
            source = null;
          }
          if (source === null || source.primaryKey.length !== 1) {
            refused.push({ receipt: String(receipt.id), reason: 'source-gone' });
            continue;
          }
          const key = source.primaryKey[0]!;
          try {
            const posted = await writes.post({
              target: await targetOf(view, source),
              pk: { [key]: normalizeWriteValue(source.columns.get(key)!, receipt.sourceRow) },
              posting: receipt.posting,
              phase: receipt.phase,
              catchUp: true,
              context,
              announce: async (_row, postings) => {
                await tellPostings(app, { connectionId, view, postings, origin: 'automation', request });
              },
            });
            // Its row is gone, or its rule is off or not there any more: nothing can be worked out for it, and it is said so.
            if (posted.length === 0) refused.push({ receipt: String(receipt.id), reason: 'nothing-to-plan' });
            else planned += posted.reduce((sum, outcome) => sum + Math.max(1, outcome.lines.length), 0);
          } catch (error) {
            // One that cannot be worked out yet goes on waiting; the next is tried.
            refused.push({ receipt: String(receipt.id), reason: reasonOf(error) });
          }
        }
        const left = await unplannedCount(db, resolved);
        const more = done < found.length;
        await app.rbac.audit(request, { category: 'data', action: 'ledger.caught-up', connectionId, changes: { after: { addOn, ledger: ledgerId, planned, refused: refused.length, left } } });
        return { planned, refused, left, ...(more && last !== undefined ? { next: String(last) } : {}) };
      },
    );
  };
}
