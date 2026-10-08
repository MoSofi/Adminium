// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE OWNER'S PRICE RULE — which of their own tables takes discounts.
 *
 * An app ships its price rule with its manifest. An owner whose orders live in
 * a table of their own draws the rule themselves: which table the lines are
 * in, which columns hold a price and a quantity, where a reduction is written,
 * where a code is typed. These are the owner's side of that:
 *
 *  - store or change the rule of a table, take it away, switch it — each
 *    needing the grant that changes what a table's columns mean
 *    (`system:schema:remap`). An app's rule is never changed or removed here:
 *    the owner switches it off instead, and an app update leaves the switch
 *    be. Off asks nothing of the add-on and refuses nothing but a code typed
 *    on an order (a code is never taken in silence at the full price);
 *  - one read for the add-on's rules page: every table whose price the add-on
 *    lowers on a connection — whose rule it is, whether it runs, how many
 *    orders still hold something under it. A session and the connection are
 *    enough: it shows rules and counts, never rows.
 *
 * A rule is held to what it names being there (`storedAdjustIssue`), and no
 * column it makes Adminium's own may be one another rule already writes.
 * Stored rules are never dropped with their data: a removed rule leaves its
 * columns as they are.
 *
 * After changing this file: build, then `pnpm openapi`.
 */
import { isDeepStrictEqual } from 'node:util';

import { adjustDecidedColumns, type Adjust } from '@adminium/manifest';
import { MetaValidationError, overridesRepo, validateOverrideInput, type DsnCrypto, type MetaDb } from '@adminium/meta';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { audited } from '../../audit/coverage.js';
import { columnPolicyFor, type EffectiveTable, type TableAdjust, type TableSwitchedOff } from '../../connections/effective-schema.js';
import type { ConnectionManager } from '../../connections/manager.js';
import { ruleDecidedColumns } from '../../crud/decided-columns.js';
import type { ResolvedTable, SnapshotView } from '../../crud/identifiers.js';
import { requestWriteContext } from '../../crud/write-service.js';
import { runIntrospection } from '../../connections/introspect.js';
import { loadSnapshotView } from '../../data-io/snapshot-view.js';
import { AppError, ConflictError, ForbiddenError, NotFoundError, PostingRefusedError, ValidationFailedError } from '../../errors.js';
import type { LedgerRuntime } from '../../ledgers/registry.js';
import { changeTableRule, holdingCount, ownTableRule, storedAdjustIssue } from '../../ledgers/rules.js';
import { unauthorableReason } from '../../schema-ddl/authorable.js';
import { applyServerEdit, planServerEdit } from '../../schema-ddl/programmatic.js';
import { SCHEMA_DDL } from '../schema-ddl/index.js';
import { SCHEMA_REMAP } from '../schema/index.js';
import { FILLS, NUMBERS, planMake, type Made } from './adjust-make.js';

export interface AdjustRuleDeps {
  manager: ConnectionManager;
  meta: MetaDb;
  ledgers: LedgerRuntime;
  /** For the schema edit a rule's `make` runs. */
  crypto: DsnCrypto;
}

const name = z.string().min(1).max(128);
export const adjustRuleParams = z.object({ id: z.string().min(1).max(64), table: name });
const madeSchema = z.object({
  columns: z.array(z.object({ table: z.string(), column: z.string(), type: z.string(), made: z.boolean() })),
  tables: z.array(z.string()),
  rules: z.array(z.object({ table: z.string(), column: z.string().optional(), op: z.string() })),
});
export const adjustRuleBody = z
  .object({
    adjust: z.record(z.string(), z.unknown()),
    /** Which of the columns the rule names, and the table of typed codes, Adminium is to add. `codes.table`: the new table's name; the rule names it by that name. */
    make: z.object({ lineAmount: z.literal(true).optional(), subtotal: z.literal(true).optional(), discount: z.literal(true).optional(), total: z.literal(true).optional(), codes: z.object({ table: z.string().regex(/^[a-z][a-z0-9_]*$/).max(60) }).strict().optional() }).strict().optional(),
    /** With `make`: answer what would be added, and add nothing. */
    dryRun: z.literal(true).optional(),
    /** With `make`: the checksum a dry run answered; a database that moved since is `SCHEMA_DRIFT`. */
    checksum: z.string().min(1).max(200).optional(),
  })
  .strict();
export const adjustRuleReply = z.union([
  z.object({ adjust: z.record(z.string(), z.unknown()), owner: z.null(), made: madeSchema.optional() }),
  z.object({ checksum: z.string(), made: madeSchema, refusals: z.array(z.object({ table: z.string().optional(), column: z.string().optional(), reason: z.string() }).passthrough()) }),
]);
export const adjustSwitchBody = z.object({ enabled: z.boolean() }).strict();
export const adjustSwitchReply = z.object({ enabled: z.boolean() });
export const adjustsParams = z.object({ key: z.string().min(1).max(64) });
export const adjustsQuery = z.object({ connectionId: z.string().min(1).max(64) });
export const adjustsReply = z.object({
  adjusts: z.array(
    z.object({
      table: z.string(),
      tableLabel: z.string(),
      /** The app whose manifest stored the rule; null for the owner's own. */
      owner: z.string().nullable(),
      ownerName: z.string().optional(),
      enabled: z.boolean(),
      state: z.enum(['live', 'off', 'idle', 'unavailable']),
      adjust: z.record(z.string(), z.unknown()),
      /** The tables the rule's lines say what they sell by. */
      /** `ref`: the table's stored name, as a row that names one of its rows keeps it (an offer's target, a voucher's thing). */
      what: z.array(z.object({ table: z.string(), ref: z.string(), label: z.string(), as: z.string() })),
      /** How many rows of the table hold something under the rule that records what an order used. */
      holding: z.number().int().min(0),
    }),
  ),
  canChange: z.boolean(),
});

/** What a dry run answers for a checksum when there is nothing to make. */
const NOTHING_TO_MAKE = 'nothing-to-make';
const column = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).max(64);
/**
 * As much of a rule as what Adminium is to make is planned from: every name a
 * column or a table is made under, or a made rule reads, is a plain name. The
 * whole rule is held to its full shape once what it names is there.
 */
const makeNames = z
  .object({
    by: z.object({ addOn: z.string().min(1).max(80) }).passthrough(),
    lines: z.array(z.union([z.object({ self: z.literal(true), discount: column }).passthrough(), z.object({ table: z.string().min(1).max(200), via: column, price: column, quantity: column.optional(), discount: column }).passthrough()])).min(1).max(3),
    order: z.object({ discount: column }).passthrough(),
    codes: z.object({ table: z.string().min(1).max(200), via: column, typed: column, code: column, voucher: column, removed: column.optional() }).passthrough().optional(),
    expect: column.optional(),
  })
  .passthrough();

export function adjustRuleRoutes(deps: AdjustRuleDeps): FastifyPluginAsyncZod {
  const { manager, meta, ledgers } = deps;

  return async (app) => {
    /** A connection's tables as they stand now, with what is installed read again. */
    async function viewOf(connectionId: string): Promise<SnapshotView> {
      await manager.mustFind(connectionId);
      await ledgers.refresh?.();
      return loadSnapshotView(meta, connectionId, { lists: true });
    }
    const tableOf = (view: SnapshotView, id: string): ResolvedTable => {
      try {
        return view.table(id);
      } catch {
        throw new NotFoundError('There is no such table on this connection.', { table: id });
      }
    };
    /** The app that made a table, when one did: the owner of a rule its manifest stored there. */
    const makerOf = (view: SnapshotView, tableId: string): string | null => {
      const stored = ledgers.refOf(view.connectionId, tableId);
      const cut = stored.indexOf(':');
      return stored === tableId || cut <= 0 ? null : stored.slice(0, cut);
    };
    const managedRefusal = (view: SnapshotView, at: ResolvedTable) => new ConflictError('This table\'s price rule came with an app. Switch it off here; change it in the app.', 'CONFLICT', { reason: 'managed', app: makerOf(view, at.id) });
    /** What an installed app is called. */
    const appName = async (connectionId: string, key: string): Promise<string | undefined> => {
      const row = await meta.db.selectFrom('adminium_manifests').select('manifest').where('manifestKey', '=', key).where('connectionId', '=', connectionId).executeTakeFirst();
      const stored = row === undefined ? null : ((typeof row.manifest === 'string' ? JSON.parse(row.manifest) : row.manifest) as { name?: unknown } | null);
      return typeof stored?.name === 'string' ? stored.name : undefined;
    };
    /** Who stored a rule, where that is a person: the store keeps a user's id there, and an API key is not one. */
    const by = (request: Parameters<typeof requestWriteContext>[0]) => {
      const actor = requestWriteContext(request, 'dashboard').actor;
      return actor?.kind === 'user' ? actor.id : null;
    };

    /** How many rows of a table hold something under the rule that records what an order used. */
    async function holding(view: SnapshotView, table: EffectiveTable, adjust: TableAdjust): Promise<number> {
      const posting = adjust.uses === undefined ? undefined : (table.postings ?? []).find((candidate) => candidate.id === adjust.uses);
      if (posting === undefined) return 0;
      const resolved = ledgers.ledgerOf?.(view, posting.into.addOn, posting.into.ledger) ?? null;
      if (resolved === null) return 0;
      return holdingCount((await manager.data(view.connectionId)).db, resolved, { ledger: posting.into.ledger, tableRef: ledgers.refOf(view.connectionId, table.id), posting: posting.id, lines: posting.via !== undefined });
    }

    /** A part of the rule as a stored rule spells one: the order itself, or a child table by its id. */
    type Part = TableAdjust['lines'][number];
    const partTable = (at: ResolvedTable, part: Part): string => ('self' in part && part.self === true ? at.id : (part as { table: string }).table);

    /** The columns the rule READS, by table: handed to the add-on's code, or judged by. */
    function columnsRead(_view: SnapshotView, at: ResolvedTable, adjust: TableAdjust): Map<string, string[]> {
      const out = new Map<string, string[]>();
      const add = (table: string, ...columns: (string | undefined)[]) => out.set(table, [...(out.get(table) ?? []), ...columns.filter((column): column is string => column !== undefined)]);
      for (const part of adjust.lines) {
        const one = part as { via?: string; price: string; quantity?: string; what?: { column: string }[]; excludes?: { column: string }; paidBy?: { column: string }; only?: { column: string }; unlessSet?: string; nights?: { from: string; to: string } };
        add(partTable(at, part), one.via, one.price, one.quantity, ...(one.what ?? []).map((entry) => entry.column), one.excludes?.column, one.paidBy?.column, one.only?.column, one.unlessSet, one.nights?.from, one.nights?.to);
      }
      add(at.id, adjust.order.staff?.kind, adjust.order.staff?.value, adjust.order.staff?.reason, adjust.order.customer?.link, typeof adjust.order.currency === 'string' ? adjust.order.currency : undefined);
      if (adjust.codes !== undefined) add(adjust.codes.table, adjust.codes.via, adjust.codes.typed, adjust.codes.removed);
      if (adjust.refunds !== undefined) add(adjust.refunds.table, adjust.refunds.via, adjust.refunds.against);
      return out;
    }

    /** What a rule's own shape gets wrong beyond what it names being there: said in a sentence, or null. */
    function shapeIssue(view: SnapshotView, at: ResolvedTable, adjust: TableAdjust, typed = true): string | null {
      if (adjust.lines.filter((part) => 'self' in part && part.self === true).length > 1) return 'A rule reads the order itself as a line once at most.';
      // The add-on's own tables are priced by nobody, and are no part of another table's order.
      const tables = [...adjust.lines.map((part) => partTable(at, part)), adjust.codes?.table, adjust.refunds?.table, adjust.refunds?.lines?.table].filter((table): table is string => table !== undefined);
      const own = tables.find((table) => ledgers.refOf(view.connectionId, table).startsWith(`${adjust.by.addOn}:`));
      if (own !== undefined) return `${view.model.tables.find((table) => table.id === own)?.name ?? own} is one of the add-on's own tables.`;
      // A reduction is a number.
      const numbers: [string, string][] = [[at.id, adjust.order.discount], ...adjust.lines.map((part): [string, string] => [partTable(at, part), part.discount])];
      for (const [tableId, column] of numbers) {
        const found = view.model.tables.find((table) => table.id === tableId)?.columns.find((candidate) => candidate.name === column);
        if (typed && found !== undefined && !NUMBERS.has(String(found.logicalType))) return `${column} is ${String(found.logicalType)}: a reduction is kept in a decimal column.`;
      }
      return null;
    }

    /**
     * A column whose values are kept from readers (a secret, masked personal
     * data) is handed to an add-on's code only on the word of somebody who may
     * show it anyway.
     */
    async function refuseKeptColumns(request: FastifyRequest, view: SnapshotView, at: ResolvedTable, adjust: TableAdjust): Promise<void> {
      if ((await app.rbac.resolve(request)).superAdmin) return;
      for (const [tableId, columns] of columnsRead(view, at, adjust)) {
        const table = view.model.tables.find((candidate) => candidate.id === tableId);
        if (table === undefined) continue;
        const policy = columnPolicyFor(table);
        const kept = columns.find((column) => policy.secret.has(column) || policy.masked.has(column));
        if (kept !== undefined) throw new ForbiddenError(`${table.name}.${kept} is kept from readers: handing it to an add-on requires Super Admin.`);
      }
    }

    /** The first column the rule would make Adminium's own that something else already writes, with what writes it. */
    function decidedClash(view: SnapshotView, at: ResolvedTable, adjust: TableAdjust): { table: string; column: string; by: string } | null {
      const reads = columnsRead(view, at, adjust);
      for (const [tableId, columns] of adjustDecidedColumns(at.id, adjust as unknown as Adjust)) {
        const table = view.model.tables.find((candidate) => candidate.id === tableId);
        if (table === undefined) continue;
        // One column a thing Adminium writes: two of them in one column would overwrite each other.
        const twice = columns.find((column, index) => columns.indexOf(column) !== index);
        if (twice !== undefined) return { table: table.name, column: twice, by: 'adjust' };
        for (const column of columns) {
          // What the rule itself reads (a price, a quantity, the typed code), a link to another row, and where a row stands, are not Adminium's to overwrite.
          if ((reads.get(tableId) ?? []).includes(column)) return { table: table.name, column, by: 'adjust' };
          if (table.states?.column === column) return { table: table.name, column, by: 'states' };
          if (view.model.relations.some((r) => r.through === null && r.from.tableId === tableId && r.from.columns.includes(column))) return { table: table.name, column, by: 'link' };
        }
        // What other rules decide there: this table's own price rule left out (it is the one being stored).
        const others = ruleDecidedColumns({ ...table, ...(table.id === at.id ? { adjust: undefined } : {}) } as never, { tables: view.model.tables.map((one) => (one.id === at.id ? ({ ...one, adjust: undefined } as never) : one)), relations: view.model.relations });
        for (const column of columns) {
          const found = table.columns.find((candidate) => candidate.name === column);
          if (found === undefined) continue;
          if (table.primaryKey.includes(column)) return { table: table.name, column, by: 'key' };
          const fill = FILLS.find((rule) => (found as unknown as Record<string, unknown>)[rule] !== undefined);
          if (fill !== undefined) return { table: table.name, column, by: fill };
          if (others.has(column)) return { table: table.name, column, by: 'rule' };
        }
      }
      return null;
    }

    app.put(
      '/connections/:id/tables/:table/adjust',
      { preHandler: app.rbac.require(SCHEMA_REMAP), config: { audit: audited('rbac') }, schema: { params: adjustRuleParams, body: adjustRuleBody, response: { 200: adjustRuleReply } } },
      async (request) => {
        const { id: connectionId } = request.params;
        let view = await viewOf(connectionId);
        let at = tableOf(view, request.params.table);
        if (at.table.managedAdjust === true) throw managedRefusal(view, at);
        const { make, dryRun, checksum } = request.body;
        if (make === undefined && (dryRun === true || checksum !== undefined)) throw new ValidationFailedError('A dry run and a checksum go with `make`.', { fields: { [dryRun === true ? 'dryRun' : 'checksum']: { code: 'not-allowed' } } });
        let made: Made | undefined;
        let body = request.body.adjust;
        if (make !== undefined) {
          // Columns and a table are made: the grant, the signed-in person and the connection a schema edit asks for — before anything is read.
          if (!(await request.can(SCHEMA_DDL))) throw new ForbiddenError('Adding columns needs leave to change the schema.', 'FORBIDDEN', { permission: SCHEMA_DDL });
          if (request.apiKeyPrincipal !== null) throw new ForbiddenError('Schema changes cannot be made with an API key. Sign in to the Studio to edit your schema.', 'FORBIDDEN');
          const unauthorable = unauthorableReason(await manager.mustFind(connectionId));
          if (unauthorable !== null) throw new ForbiddenError(unauthorable.message, 'READ_ONLY_MODE', { reason: unauthorable.reason });
          // The names a plan is made from, held to being names before anything is built from them.
          const named = makeNames.safeParse(body);
          if (!named.success) throw new ValidationFailedError('This is not a price rule.', { table: at.id, path: named.error.issues[0]?.path.join('.') ?? '', issue: named.error.issues[0]?.message ?? '' });
          const wanted = body as unknown as TableAdjust;
          // A plan is made against the database as it is, not as it was last read.
          await runIntrospection({ manager, meta, connectionId });
          view = await viewOf(connectionId);
          at = tableOf(view, request.params.table);
          // What can be told before anything is made is told before: the add-on's own tables, and a column kept from readers.
          if (ledgers.refOf(connectionId, at.id).startsWith(`${wanted.by.addOn}:`)) throw new ValidationFailedError(`${at.name} is one of the add-on's own tables.`, { table: at.id });
          const ownIssue = shapeIssue(view, at, { ...wanted, codes: make.codes === undefined ? wanted.codes : undefined } as TableAdjust, false);
          if (ownIssue !== null) throw new ValidationFailedError(ownIssue, { table: at.id });
          await refuseKeptColumns(request, view, at, { ...wanted, codes: make.codes === undefined ? wanted.codes : undefined } as TableAdjust);
          const declared = ledgers.manifestOf(connectionId, wanted.by.addOn)?.addOn?.adjuster as { codes?: { table?: unknown }; vouchers?: { table?: unknown } } | undefined;
          const adjuster = typeof declared?.codes?.table === 'string' && typeof declared.vouchers?.table === 'string' ? { addOn: wanted.by.addOn, codes: declared.codes.table, vouchers: declared.vouchers.table } : null;
          const plan = planMake({ model: view.model, table: at.table, adjust: wanted, make, adjuster });
          const superAdmin = (await app.rbac.resolve(request)).superAdmin;
          const empty = Object.keys(plan.edit).length === 0;
          const edit = { meta, manager, crypto: deps.crypto };
          if (dryRun === true) {
            const planned = empty ? null : await planServerEdit(edit, connectionId, () => plan.edit, { superAdmin });
            const refused = (planned?.refusals ?? []) as unknown as { code?: unknown; message?: unknown; table?: unknown; column?: unknown }[];
            return {
              checksum: planned?.checksum ?? NOTHING_TO_MAKE,
              made: plan.made,
              refusals: [...plan.refusals, ...refused.map((one) => ({ reason: String(one.message ?? one.code ?? 'refused'), ...(typeof one.table === 'string' ? { table: one.table } : {}), ...(typeof one.column === 'string' ? { column: one.column } : {}) }))],
            };
          }
          if (plan.refusals.length > 0) throw new AppError(422, 'SCHEMA_EDIT_REFUSED', 'This cannot be made on this database.', { refusals: plan.refusals });
          // A review that found nothing to make reviewed nothing that is made now.
          if (!empty && checksum === NOTHING_TO_MAKE) throw new ConflictError('The database changed since this change was reviewed. Review it again.', 'SCHEMA_DRIFT', { expected: checksum });
          if (!empty) {
            await applyServerEdit(edit, connectionId, () => plan.edit, { superAdmin, createdBy: by(request), ...(checksum === undefined ? {} : { expectedChecksum: checksum }) });
            // …and the tables read again: the rule is held to what is there now, and every page reads the snapshot. (Tried once more
            // where it fails: what was made is made, and the rule below is judged on the tables as they are read.)
            await runIntrospection({ manager, meta, connectionId }).catch(() => runIntrospection({ manager, meta, connectionId }));
          }
          // The tables as they stand now, and the rules the made columns need: each held to its shape, each written once.
          view = await viewOf(connectionId);
          at = tableOf(view, request.params.table);
          const idOf = (name: string): string => view.model.tables.find((table) => table.id === name || table.name === name)?.id ?? name;
          const stored = await overridesRepo(meta).listForConnection(connectionId, { status: 'active' });
          for (const rule of plan.rules) {
            const tableName = idOf(rule.table);
            if (stored.some((row) => row.op === rule.op && row.tableName === tableName && row.columnName === rule.column)) continue;
            const value = rule.op === 'column.rollup' ? { ...rule.value, from: idOf(String(rule.value['from'])) } : rule.value;
            validateOverrideInput({ connectionId, op: rule.op, tableName, columnName: rule.column, value } as never);
            await overridesRepo(meta).create({ connectionId, op: rule.op, tableName, columnName: rule.column, value, origin: 'user', createdBy: by(request) } as never);
          }
          if (make.codes !== undefined && wanted.codes !== undefined) body = { ...body, codes: { ...wanted.codes, table: idOf(make.codes.table) } };
          made = plan.made;
          view = await viewOf(connectionId);
          at = tableOf(view, request.params.table);
        }
        // The shape first, as the store itself holds a stored rule to it (real table and column names).
        let adjust: TableAdjust;
        try {
          adjust = validateOverrideInput({ connectionId, op: 'table.adjust', tableName: at.id, columnName: null, value: body }).value as unknown as TableAdjust;
        } catch (error) {
          if (!(error instanceof MetaValidationError)) throw error;
          throw new ValidationFailedError('This is not a price rule.', { table: at.id, issue: error.message });
        }
        if (ledgers.refOf(connectionId, at.id).startsWith(`${adjust.by.addOn}:`)) throw new ValidationFailedError(`${at.name} is one of the add-on's own tables.`, { table: at.id });
        // (An add-on whose stored manifest no longer reads is not one a rule can be held to.)
        const read = ledgers.manifestOf(connectionId, adjust.by.addOn);
        const issue = storedAdjustIssue({ model: view.model, table: at.table, adjust, manifest: read?.addOn === undefined ? null : read });
        if (issue !== null) throw new ValidationFailedError(issue, { table: at.id });
        const shape = shapeIssue(view, at, adjust);
        if (shape !== null) throw new ValidationFailedError(shape, { table: at.id });
        await refuseKeptColumns(request, view, at, adjust);
        const clash = decidedClash(view, at, adjust);
        if (clash !== null) throw new ValidationFailedError(`${clash.table}.${clash.column} is already written by another rule, so a price rule cannot write it.`, { reason: 'column-decided', table: clash.table, column: clash.column, by: clash.by });
        const before = await ownTableRule<TableAdjust>(meta, { connectionId, table: at.id, op: 'table.adjust' });
        // A rule under which orders still hold a use keeps the rule that records it: changing that would strand what they hold.
        if (before !== null && before.uses !== adjust.uses) {
          const rows = await holding(view, at.table, before);
          if (rows > 0) throw new PostingRefusedError('Orders still hold something under this rule. Finish or cancel them first.', { reason: 'receipt-open', rows });
        }
        await changeTableRule<TableAdjust>(meta, { connectionId, table: at.id, op: 'table.adjust', by: by(request) }, (stored) => {
          // Of two people changing a table's rule at once, the second is asked to look again.
          if (!isDeepStrictEqual(stored, before)) throw new ConflictError('The rule of this table was changed a moment ago. Read it again.', 'CONFLICT', { retry: true });
          return adjust;
        });
        await app.rbac.audit(request, { category: 'schema', action: 'ledger.rule.stored', connectionId, changes: { ...(before === null ? {} : { before: { adjust: before } }), after: { table: at.id, adjust, ...(made === undefined ? {} : { made }) } } });
        return { adjust: adjust as unknown as Record<string, unknown>, owner: null, ...(made === undefined ? {} : { made }) };
      },
    );

    app.delete(
      '/connections/:id/tables/:table/adjust',
      { preHandler: app.rbac.require(SCHEMA_REMAP), config: { audit: audited('rbac') }, schema: { params: adjustRuleParams } },
      async (request, reply) => {
        const { id: connectionId } = request.params;
        const view = await viewOf(connectionId);
        const at = tableOf(view, request.params.table);
        const before = await ownTableRule<TableAdjust>(meta, { connectionId, table: at.id, op: 'table.adjust' });
        if (before === null) {
          if (at.table.managedAdjust === true) throw managedRefusal(view, at);
          throw new NotFoundError('This table has no price rule.', { table: at.id });
        }
        // (An owner's row an app's rule stands in front of holds nothing: the app's is the one that ran.)
        const rows = at.table.managedAdjust === true ? 0 : await holding(view, at.table, before);
        if (rows > 0) throw new PostingRefusedError('Orders still hold something under this rule. Finish or cancel them first.', { reason: 'receipt-open', rows });
        await changeTableRule<TableAdjust>(meta, { connectionId, table: at.id, op: 'table.adjust', by: by(request) }, (stored) => {
          if (!isDeepStrictEqual(stored, before)) throw new ConflictError('The rule of this table was changed a moment ago. Read it again.', 'CONFLICT', { retry: true });
          return null;
        });
        // A switch for a rule that is gone would switch off the next rule stored here.
        if (at.table.managedAdjust !== true) {
          await changeTableRule<TableSwitchedOff>(meta, { connectionId, table: at.id, op: 'table.switchedOff', by: by(request) }, (stored) => {
            if (stored === null || stored.adjust !== true) return stored;
            return stored.postings.length === 0 ? null : { postings: stored.postings };
          });
        }
        await app.rbac.audit(request, { category: 'schema', action: 'ledger.rule.removed', connectionId, changes: { before: { table: at.id, adjust: before } } });
        return reply.code(204).send();
      },
    );

    app.patch(
      '/connections/:id/tables/:table/adjust/switch',
      { preHandler: app.rbac.require(SCHEMA_REMAP), config: { audit: audited('rbac') }, schema: { params: adjustRuleParams, body: adjustSwitchBody, response: { 200: adjustSwitchReply } } },
      async (request) => {
        const { id: connectionId } = request.params;
        const { enabled } = request.body;
        const view = await viewOf(connectionId);
        const at = tableOf(view, request.params.table);
        // An app's rule and the owner's are both the owner's to switch.
        if (at.table.adjust === undefined) throw new NotFoundError('This table has no price rule.', { table: at.id });
        let was = true;
        await changeTableRule<TableSwitchedOff>(meta, { connectionId, table: at.id, op: 'table.switchedOff', by: by(request) }, (stored) => {
          was = stored?.adjust !== true;
          if (was === enabled) return stored;
          const postings = stored?.postings ?? [];
          return enabled ? (postings.length === 0 ? null : { postings }) : { postings, adjust: true as const };
        });
        if (was !== enabled) {
          await app.rbac.audit(request, { category: 'schema', action: 'ledger.rule.switched', connectionId, changes: { before: { table: at.id, adjust: true, enabled: was }, after: { table: at.id, adjust: true, enabled } } });
        }
        return { enabled };
      },
    );

    app.get(
      '/add-ons/:key/adjusts',
      {
        // A session and the connection are enough, as for the rules that post into a ledger: rules and counts, never rows.
        preHandler: async (request) => {
          await app.rbac.resolve(request);
        },
        schema: { params: adjustsParams, querystring: adjustsQuery, response: { 200: adjustsReply } },
      },
      async (request) => {
        const { connectionId } = request.query;
        const addOn = request.params.key;
        const view = await viewOf(connectionId);
        const out: z.infer<typeof adjustsReply>['adjusts'] = [];
        for (const table of view.model.tables) {
          const adjust = table.adjust;
          if (adjust === undefined || adjust.by.addOn !== addOn) continue;
          let at: ResolvedTable;
          try {
            at = view.table(table.id);
          } catch {
            continue;
          }
          // (A rule a manifest stored is never read as the owner's own, even where who made the table can no longer be told.)
          const owner = table.managedAdjust === true ? (makerOf(view, table.id) ?? 'app') : null;
          const state = ledgers.adjuster?.(view, at).state ?? 'unavailable';
          const what = new Map<string, { table: string; ref: string; label: string; as: string }>();
          for (const part of adjust.lines) {
            const partTable = 'self' in part && part.self === true ? table : view.model.tables.find((candidate) => candidate.id === (part as { table?: string }).table);
            for (const entry of part.what ?? []) {
              if (entry.as === 'tag' || partTable === undefined) continue;
              const relation = view.model.relations.find((r) => r.through === null && r.from.tableId === partTable.id && r.from.columns.length === 1 && r.from.columns[0] === entry.column);
              const target = relation === undefined ? undefined : view.model.tables.find((candidate) => candidate.id === relation.to.tableId);
              if (target !== undefined) what.set(`${target.id}\u0000${entry.as}`, { table: target.id, ref: ledgers.refOf(connectionId, target.id), label: target.label ?? target.name, as: entry.as });
            }
          }
          const ownerName = owner === null ? undefined : await appName(connectionId, owner);
          out.push({
            table: table.id,
            tableLabel: table.label ?? table.name,
            owner,
            ...(typeof ownerName === 'string' ? { ownerName } : {}),
            enabled: table.switchedOff?.adjust !== true,
            state,
            adjust: adjust as unknown as Record<string, unknown>,
            what: [...what.values()],
            holding: await holding(view, table, adjust),
          });
        }
        out.sort((a, b) => a.tableLabel.localeCompare(b.tableLabel) || a.table.localeCompare(b.table));
        return { adjusts: out, canChange: await request.can(SCHEMA_REMAP) };
      },
    );
  };
}
