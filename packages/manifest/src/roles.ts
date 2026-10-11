// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `roles[].limits` — what a role's `update` on one of the app's tables may
 * write, when it may not write everything.
 *
 * A clinician moves a visit along and does nothing else to it:
 *
 * ```json
 * "limits": {
 *   "appointments": {
 *     "writable": ["status"],
 *     "writableValues": { "status": ["roomed", "with_clinician", "ready"] }
 *   }
 * }
 * ```
 *
 * The names are the public-access entries' (`writable`, `writableValues`).
 * A limit narrows the role's own `table:@<ref>:update`, so a role must grant
 * that update (itself or through `cloneFrom`) for a limit on the table to
 * mean anything. Roles add up: someone who also holds a role with a plain
 * update on the table is not held to the limit. Creating rows is not limited.
 *
 * `readable` limits the role's READ of the table to some columns, the same
 * way: housekeeping reads a stay's room and dates, and none of its guest or
 * its money. The key and the table's links to other rows are always read (a
 * screen moves through them). A column the role may not read is not written
 * through it either, unless `writable` names it.
 *
 * `writableFrom` says which rows the update reaches at all, by the value a
 * column of the row holds NOW: a clinician moves a visit along while it is
 * checked in, roomed or with them, and a visit already seen is not theirs to
 * take back —
 *
 * ```json
 * "writableFrom": { "status": ["checked_in", "roomed", "with_clinician"] }
 * ```
 *
 * `writableValues` holds what a column is moved TO; this, what it is moved
 * FROM. It is judged on the stored row, whatever columns the update changes.
 *
 * `rows` says which ROWS the role's read, update or delete reaches, when it
 * does not reach every row. A rep reads the deals they own and a manager the
 * deals of the teams they lead:
 *
 * ```json
 * "rows": { "read": { "reach": "own" }, "update": { "reach": "own" } }
 * ```
 *
 * A row is somebody's by what its table says of it (`belongs`, below): a
 * column that holds a staff member, a table that lists people against the
 * row, or the row it hangs off. `unowned` adds the rows that are nobody's
 * yet, and `while` keeps only the rows whose column holds one of some values
 * now. Roles add up here too: someone whose other role reads the table with
 * no `rows` reads every row.
 */
import { z } from 'zod';

import { refSchema, scalarSchema, valueFits, type ColumnShape, type ReferenceIssue, type TableIndex } from './refs.js';

/** How far one action reaches: the person's own rows, their teams', or every row (only `while` some value). */
export const ROW_REACHES = ['own', 'team', 'all'] as const;

export const rowReachSchema = z
  .object({
    reach: z.enum(ROW_REACHES),
    /** Also the rows nobody belongs to yet (an inbox everyone picks from). */
    unowned: z.literal(true).optional(),
    /** Only rows whose column holds, now, one of these values. */
    while: z.object({ column: refSchema, in: z.array(scalarSchema).min(1).max(32) }).strict().optional(),
  })
  .strict()
  .refine((reach) => reach.reach !== 'all' || reach.while !== undefined, { message: 'a reach of every row is no limit: leave the action out, or say `while`' })
  .refine((reach) => reach.reach !== 'all' || reach.unowned === undefined, { message: 'every row includes the rows nobody owns' });
export type RowReach = z.infer<typeof rowReachSchema>;

/** The actions a row limit narrows. A create makes a new row: it is held by the links and people it names. */
export const ROW_LIMIT_ACTIONS = ['read', 'update', 'delete'] as const;

/** Which rows a role's read, update and delete reach, each on its own. */
export const rowsLimitSchema = z
  .object({ read: rowReachSchema.optional(), update: rowReachSchema.optional(), delete: rowReachSchema.optional() })
  .strict()
  .refine((rows) => rows.read !== undefined || rows.update !== undefined || rows.delete !== undefined, { message: 'name the action whose rows are limited: read, update or delete' });
export type RowsLimit = z.infer<typeof rowsLimitSchema>;

/** Who a person who is limited to some rows may put in a staff column: themselves, someone they reach, or anyone. */
export const STAFF_SET_RULES = ['self', 'team', 'anyone'] as const;

/**
 * One way a person belongs to a row of the table:
 *
 *  - `column`: the staff member this column holds; with `person`, the column
 *    is a link and `person` the staff column of the row it points at (a
 *    ticket's agent, whose own row holds the staff member);
 *  - `through`: a table that lists people against the row — its `link` holds
 *    this row's key (or this row's `on` column), its `user` the staff member
 *    (or, with `person`, a link to the row that holds one), and `from` / `to`
 *    the days the listing counts on, both `date` columns (cover for a colleague on leave);
 *  - `via`: whoever belongs to the row this link points at (a quote's deal).
 */
export const belongsWaySchema = z.union([
  z.object({ column: refSchema, person: refSchema.optional(), set: z.enum(STAFF_SET_RULES).optional() }).strict(),
  z
    .object({
      through: z
        .object({ table: refSchema, link: refSchema, on: refSchema.optional(), user: refSchema, person: refSchema.optional(), from: refSchema.optional(), to: refSchema.optional() })
        .strict(),
    })
    .strict(),
  z.object({ via: refSchema }).strict(),
]);
export type BelongsWay = z.infer<typeof belongsWaySchema>;

/** The ways people belong to a table's rows: any one is enough. */
export const belongsSchema = z.array(belongsWaySchema).min(1).max(6);

/** How many links a `via` may follow before it reaches a table people belong to directly. */
export const BELONGS_VIA_MAX_STEPS = 2;

/** One table's limit. */
export const roleLimitSchema = z
  .object({
    /** The only columns the update may change. */
    writable: z.array(refSchema).min(1).optional(),
    /** For some of those columns, the only values it may set. */
    writableValues: z.record(refSchema, z.array(scalarSchema).min(1).max(32)).optional(),
    /** For some columns of the table, the only values a row may hold for the update to reach it. */
    writableFrom: z.record(refSchema, z.array(scalarSchema).min(1).max(32)).optional(),
    /** The only columns the read shows (with the key and the links to other rows). */
    readable: z.array(refSchema).min(1).max(200).optional(),
    /** The only columns a new row it creates may be given (the rest take their defaults). */
    creatable: z.array(refSchema).min(1).optional(),
    /** For some of those columns, the only values a new row may be given. */
    creatableValues: z.record(refSchema, z.array(scalarSchema).min(1).max(32)).optional(),
    /** The only rows its read, update or delete reaches. */
    rows: rowsLimitSchema.optional(),
  })
  .strict()
  .refine((limit) => limit.writable !== undefined || limit.readable !== undefined || limit.creatable !== undefined || limit.rows !== undefined, {
    message: 'a limit names what the role may write (writable), read (readable) or create with (creatable), or which rows it reaches (rows)',
  });
export type RoleLimit = z.infer<typeof roleLimitSchema>;

/** Per table ref, the limit on the role's update there. */
export const roleLimitsSchema = z.record(refSchema, roleLimitSchema);

/** What the checks read of a role. */
export interface RoleShape {
  key: string;
  cloneFrom?: string | undefined;
  permissions?: readonly string[] | undefined;
  limits?: Readonly<Record<string, RoleLimit>> | undefined;
}

/** The grants a role ends up with: its own and the ones of the role it clones. */
function grantsOf(role: RoleShape, roles: readonly RoleShape[]): Set<string> {
  const from = role.cloneFrom === undefined ? undefined : roles.find((other) => other.key === role.cloneFrom);
  return new Set([...(from?.permissions ?? []), ...(role.permissions ?? [])]);
}

/** Every `limits` problem across the app's roles. */
export function roleLimitIssues<C extends ColumnShape>(roles: readonly RoleShape[], index: TableIndex<C>, rowTables?: RowTables): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  roles.forEach((role, r) => {
    const grants = grantsOf(role, roles);
    for (const [ref, limit] of Object.entries(role.limits ?? {})) {
      const at = (...rest: (string | number)[]) => ['roles', r, 'limits', ref, ...rest];
      if (index.table(ref) === undefined) {
        out.push({ path: at(), message: `"${ref}" is not a table of this app` });
        continue;
      }
      if (limit.writable !== undefined && !grants.has(`table:@${ref}:update`)) {
        out.push({ path: at(), message: `the role does not grant table:@${ref}:update, so there is nothing to limit` });
      }
      if (limit.writable === undefined && limit.writableValues !== undefined) {
        out.push({ path: at('writableValues'), message: 'values are limited for the columns the role may write: name them (writable)' });
      }
      if (limit.writable === undefined && limit.writableFrom !== undefined) {
        out.push({ path: at('writableFrom'), message: 'rows are limited for an update that is limited itself: name the columns it may write (writable)' });
      }
      if (limit.writableFrom !== undefined && Object.keys(limit.writableFrom).length === 0) {
        out.push({ path: at('writableFrom'), message: 'name at least one column the row is judged by' });
      }
      for (const [column, values] of Object.entries(limit.writableFrom ?? {})) {
        const found = index.column(ref, column);
        if (found === undefined) {
          out.push({ path: at('writableFrom', column), message: `"${ref}" has no column "${column}"` });
          continue;
        }
        for (const value of values) {
          if (!valueFits(found, value)) out.push({ path: at('writableFrom', column), message: `${JSON.stringify(value)} is not a value of "${ref}.${column}"` });
        }
      }
      const writable = new Set(limit.writable ?? []);
      for (const column of limit.writable ?? []) {
        if (index.column(ref, column) === undefined) out.push({ path: at('writable'), message: `"${ref}" has no column "${column}"` });
      }
      if (limit.readable !== undefined) {
        if (!grants.has(`table:@${ref}:read`)) out.push({ path: at('readable'), message: `the role does not grant table:@${ref}:read, so there is nothing to limit` });
        limit.readable.forEach((column, c) => {
          if (index.column(ref, column) === undefined) out.push({ path: at('readable', c), message: `"${ref}" has no column "${column}"` });
          else if (limit.readable!.indexOf(column) !== c) out.push({ path: at('readable', c), message: `"${column}" is listed twice` });
        });
      }
      for (const [column, values] of Object.entries(limit.writableValues ?? {})) {
        if (!writable.has(column)) out.push({ path: at('writableValues', column), message: `"${column}" is not writable` });
        const found = index.column(ref, column);
        if (found === undefined) continue;
        for (const value of values) {
          if (!valueFits(found, value)) out.push({ path: at('writableValues', column), message: `${JSON.stringify(value)} is not a value of "${ref}.${column}"` });
        }
      }
      if (limit.creatable !== undefined && !grants.has(`table:@${ref}:create`)) {
        out.push({ path: at('creatable'), message: `the role does not grant table:@${ref}:create, so there is nothing to limit` });
      }
      if (limit.creatable === undefined && limit.creatableValues !== undefined) {
        out.push({ path: at('creatableValues'), message: 'values are limited for the columns a new row may be given: name them (creatable)' });
      }
      for (const column of limit.creatable ?? []) {
        if (index.column(ref, column) === undefined) out.push({ path: at('creatable'), message: `"${ref}" has no column "${column}"` });
      }
      const creatable = new Set(limit.creatable ?? []);
      for (const [column, values] of Object.entries(limit.creatableValues ?? {})) {
        if (!creatable.has(column)) out.push({ path: at('creatableValues', column), message: `"${column}" is not creatable` });
        const found = index.column(ref, column);
        if (found === undefined) continue;
        for (const value of values) {
          if (!valueFits(found, value)) out.push({ path: at('creatableValues', column), message: `${JSON.stringify(value)} is not a value of "${ref}.${column}"` });
        }
      }
      for (const action of ROW_LIMIT_ACTIONS) {
        const reach = limit.rows?.[action];
        if (reach === undefined) continue;
        if (!grants.has(`table:@${ref}:${action}`)) out.push({ path: at('rows', action), message: `the role does not grant table:@${ref}:${action}, so there is nothing to limit` });
        if (reach.reach !== 'all' && rowTables?.belongs(ref) !== true) {
          out.push({ path: at('rows', action, 'reach'), message: `"${ref}" does not say how people belong to its rows: give the table "belongs"` });
        }
        if (reach.unowned === true && rowTables?.belongs(ref) !== true) {
          out.push({ path: at('rows', action, 'unowned'), message: `"${ref}" does not say how people belong to its rows, so none is unowned` });
        }
        if (reach.while !== undefined) {
          const found = index.column(ref, reach.while.column);
          if (found === undefined) out.push({ path: at('rows', action, 'while', 'column'), message: `"${ref}" has no column "${reach.while.column}"` });
          else for (const value of reach.while.in) {
            if (!valueFits(found, value)) out.push({ path: at('rows', action, 'while', 'in'), message: `${JSON.stringify(value)} is not a value of "${ref}.${reach.while.column}"` });
          }
        }
      }
    }
    // A private table: every action the role holds there reaches the person's own rows, and no others.
    for (const ref of rowTables?.privateTables() ?? []) {
      const limit = role.cloneFrom === undefined ? role.limits?.[ref] : (role.limits?.[ref] ?? roles.find((other) => other.key === role.cloneFrom)?.limits?.[ref]);
      for (const action of ROW_LIMIT_ACTIONS) {
        if (!grants.has(`table:@${ref}:${action}`)) continue;
        const reach = limit?.rows?.[action];
        if (reach === undefined || reach.reach !== 'own' || reach.unowned !== undefined || reach.while !== undefined) {
          out.push({ path: ['roles', r, 'limits', ref, 'rows', action], message: `"${ref}" is private: the role's ${action} reaches the person's own rows only ({ "reach": "own" })` });
        }
      }
      for (const action of ['export', 'import'] as const) {
        if (grants.has(`table:@${ref}:${action}`)) out.push({ path: ['roles', r, 'permissions'], message: `"${ref}" is private: it is not ${action}ed (table:@${ref}:${action})` });
      }
    }
  });
  return out;
}

/** What the row checks read of a table beside its columns. */
export interface BelongsTableShape {
  ref: string;
  belongs?: readonly BelongsWay[] | undefined;
  private?: true | undefined;
}

/** What `roleLimitIssues` asks of the tables' row words. */
export interface RowTables {
  belongs: (ref: string) => boolean;
  privateTables: () => readonly string[];
}

export function rowTablesOf(tables: readonly BelongsTableShape[]): RowTables {
  const byRef = new Map(tables.map((table) => [table.ref, table]));
  return {
    belongs: (ref) => byRef.get(ref)?.belongs !== undefined,
    privateTables: () => tables.filter((table) => table.private === true).map((table) => table.ref),
  };
}

/**
 * Every problem of the tables' `belongs` and `private`: a column that is not
 * there or not of the kind the way needs, a `via` that never reaches a table
 * people belong to directly, and a private table that is reached any way but
 * by its own staff columns.
 */
export function belongsIssues<C extends ColumnShape>(tables: readonly BelongsTableShape[], index: TableIndex<C>, isStaff: (table: string, column: string) => boolean): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  const byRef = new Map(tables.map((table) => [table.ref, table]));
  // A listing counts by the day: a time of day would make "today" a question of whose clock.
  const DATES: readonly string[] = ['date'];
  /** The staff column `column` of `table`, or — with `person` — the link `column` and the staff column of the row it points at. */
  const person = (table: string, column: string, personRef: string | undefined, at: (string | number)[], key: string): void => {
    const found = index.column(table, column);
    if (found === undefined) {
      out.push({ path: [...at, key], message: `"${table}" has no column "${column}"` });
      return;
    }
    if (personRef === undefined) {
      if (!isStaff(table, column)) out.push({ path: [...at, key], message: `"${table}.${column}" does not hold a staff member: mark it (rules.staff), or say which column of the row it links to does (person)` });
      return;
    }
    if (found.type !== 'fk' || found.references === undefined) {
      out.push({ path: [...at, key], message: `"${table}.${column}" is not a link, so there is no row to read "${personRef}" from` });
      return;
    }
    if (index.column(found.references, personRef) === undefined) out.push({ path: [...at, 'person'], message: `"${found.references}" has no column "${personRef}"` });
    else if (!isStaff(found.references, personRef)) out.push({ path: [...at, 'person'], message: `"${found.references}.${personRef}" does not hold a staff member (rules.staff)` });
  };
  /** The table a `via` of `table` points at, when it is a link. */
  const parentOf = (table: string, via: string): string | undefined => {
    const found = index.column(table, via);
    return found?.type === 'fk' ? found.references : undefined;
  };
  tables.forEach((table, t) => {
    const here = ['requiredSchema', 'tables', t];
    if (table.private === true && table.belongs === undefined) out.push({ path: [...here, 'private'], message: 'a private table says whose its rows are: give it "belongs"' });
    (table.belongs ?? []).forEach((way, w) => {
      const at = [...here, 'belongs', w];
      if ('column' in way) {
        person(table.ref, way.column, way.person, at, 'column');
        if (table.private === true && way.person !== undefined) out.push({ path: [...at, 'person'], message: 'a private table is reached by its own staff columns only' });
        return;
      }
      if (table.private === true) {
        out.push({ path: at, message: 'a private table is reached by its own staff columns only' });
        return;
      }
      if ('through' in way) {
        const through = way.through;
        const list = byRef.get(through.table);
        if (list === undefined) {
          out.push({ path: [...at, 'through', 'table'], message: `"${through.table}" is not a table of this manifest` });
          return;
        }
        if (through.table === table.ref) out.push({ path: [...at, 'through', 'table'], message: 'a table does not list the people of its own rows: use a column' });
        const link = index.column(through.table, through.link);
        if (link === undefined) out.push({ path: [...at, 'through', 'link'], message: `"${through.table}" has no column "${through.link}"` });
        const on = through.on === undefined ? index.pk(table.ref) : index.column(table.ref, through.on);
        if (on === undefined) out.push({ path: [...at, 'through', through.on === undefined ? 'link' : 'on'], message: through.on === undefined ? `"${table.ref}" declares no key for "${through.table}.${through.link}" to hold: name the column it matches (on)` : `"${table.ref}" has no column "${through.on}"` });
        // The two columns are compared as they are stored: a link to this table when it holds its key, else the same kind of column.
        if (link !== undefined && on !== undefined && through.on === undefined && !(link.type === 'fk' && link.references === table.ref)) {
          out.push({ path: [...at, 'through', 'link'], message: `"${through.table}.${through.link}" is not a link to "${table.ref}": name the column of "${table.ref}" it matches (on)` });
        }
        person(through.table, through.user, through.person, [...at, 'through'], 'user');
        for (const key of ['from', 'to'] as const) {
          const ref = through[key];
          if (ref === undefined) continue;
          const found = index.column(through.table, ref);
          if (found === undefined) out.push({ path: [...at, 'through', key], message: `"${through.table}" has no column "${ref}"` });
          else if (!DATES.includes(found.type)) out.push({ path: [...at, 'through', key], message: `"${through.table}.${ref}" is not a date` });
        }
        return;
      }
      const parent = parentOf(table.ref, way.via);
      if (index.column(table.ref, way.via) === undefined) {
        out.push({ path: [...at, 'via'], message: `"${table.ref}" has no column "${way.via}"` });
        return;
      }
      if (parent === undefined || byRef.get(parent) === undefined) {
        out.push({ path: [...at, 'via'], message: `"${table.ref}.${way.via}" is not a link to a table of this manifest` });
        return;
      }
      // Followed until a table people belong to directly, within the steps a read can afford.
      const reaches = (ref: string, steps: number, seen: ReadonlySet<string>): 'ok' | 'none' | 'far' | 'loop' => {
        const ways = byRef.get(ref)?.belongs;
        if (ways === undefined) return 'none';
        if (seen.has(ref)) return 'loop';
        let worst: 'ok' | 'none' | 'far' | 'loop' = 'ok';
        for (const other of ways) {
          if (!('via' in other)) continue;
          if (steps >= BELONGS_VIA_MAX_STEPS) return 'far';
          const next = parentOf(ref, other.via);
          if (next === undefined) continue;
          const answer = reaches(next, steps + 1, new Set([...seen, ref]));
          if (answer !== 'ok') worst = answer;
        }
        return worst;
      };
      const answer = reaches(parent, 1, new Set([table.ref]));
      if (answer === 'none') out.push({ path: [...at, 'via'], message: `"${parent}" does not say how people belong to its rows: give it "belongs"` });
      else if (answer === 'loop') out.push({ path: [...at, 'via'], message: `"${table.ref}" is reached through "${parent}", which is reached through "${table.ref}"` });
      else if (answer === 'far') out.push({ path: [...at, 'via'], message: `a row is reached through at most ${String(BELONGS_VIA_MAX_STEPS)} links` });
      if (byRef.get(parent)?.private === true) out.push({ path: [...at, 'via'], message: `"${parent}" is private: no other table's rows are reached through it` });
    });
  });
  return out;
}

/** What a role may do on a table of an add-on: read it, add rows, change rows. Never delete, export or import. */
export const ROLE_ADD_ON_ACTIONS = ['read', 'create', 'update'] as const;

/**
 * A grant on a table of an add-on the app names, by the add-on's key and the
 * table's own short name, with the same limit an own table takes. Written
 * when the add-on is connected to the app and taken back when it leaves; the
 * table and its columns are the add-on's, so they are checked then.
 */
export const roleAddOnTableSchema = z
  .object({
    addOn: z.string().regex(/^[a-z][a-z0-9-]{1,79}$/, 'an add-on key'),
    table: refSchema,
    actions: z.array(z.enum(ROLE_ADD_ON_ACTIONS)).min(1).max(3),
    limit: roleLimitSchema.optional(),
  })
  .strict();
export type RoleAddOnTable = z.infer<typeof roleAddOnTableSchema>;

export const roleAddOnTablesSchema = z.array(roleAddOnTableSchema).min(1).max(12);

/** Every problem of the roles' grants on add-on tables that the app's own manifest can see. */
export function roleAddOnTableIssues(roles: readonly { key: string; tables?: readonly RoleAddOnTable[] | undefined }[], named: ReadonlySet<string>): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  roles.forEach((role, r) => {
    const seen = new Set<string>();
    (role.tables ?? []).forEach((grant, g) => {
      const at = (...rest: (string | number)[]) => ['roles', r, 'tables', g, ...rest];
      if (!named.has(grant.addOn)) out.push({ path: at('addOn'), message: `"${grant.addOn}" is not an add-on this app names: add it to addOns.requires or addOns.suggests` });
      const pair = `${grant.addOn}/${grant.table}`;
      if (seen.has(pair)) out.push({ path: at('table'), message: `"${role.key}" is granted "${grant.table}" of "${grant.addOn}" twice` });
      seen.add(pair);
      if (new Set(grant.actions).size !== grant.actions.length) out.push({ path: at('actions'), message: 'an action is listed once' });
      // A limit narrows what the grant gives: there must be something to narrow.
      const limit = grant.limit;
      if (limit === undefined) return;
      for (const [key, action] of [['writable', 'update'], ['writableValues', 'update'], ['writableFrom', 'update'], ['readable', 'read'], ['creatable', 'create'], ['creatableValues', 'create']] as const) {
        if (limit[key] !== undefined && !grant.actions.includes(action)) out.push({ path: at('limit', key), message: `the grant has no "${action}", so there is nothing for "${key}" to limit` });
      }
      for (const action of ROW_LIMIT_ACTIONS) {
        const reach = limit.rows?.[action];
        if (reach === undefined) continue;
        // An add-on's grant is read, create and update: its rows are never deleted through one.
        if (!(grant.actions as readonly string[]).includes(action)) out.push({ path: at('limit', 'rows', action), message: `the grant has no "${action}", so there is nothing for its rows to limit` });
        // An add-on's table does not say whose its rows are yet: its rows are limited by a value only.
        if (reach.reach !== 'all' || reach.unowned !== undefined) out.push({ path: at('limit', 'rows', action, 'reach'), message: 'an add-on\'s table does not say how people belong to its rows: limit it by a value ({ "reach": "all", "while": … })' });
      }
      for (const [values, columns] of [['writableValues', 'writable'], ['creatableValues', 'creatable']] as const) {
        for (const column of Object.keys(limit[values] ?? {})) {
          if (!(limit[columns] ?? []).includes(column)) out.push({ path: at('limit', values, column), message: `"${column}" takes only some values where it may be written at all: list it in "${columns}" too` });
        }
      }
      if (limit.writableFrom !== undefined && limit.writable === undefined) {
        out.push({ path: at('limit', 'writableFrom'), message: 'rows are limited for an update that is limited itself: name the columns it may write (writable)' });
      }
    });
  });
  return out;
}

/** The blocks of a manifest that read rows for somebody other than the person signed in: a visitor, a rule, a mail, a printed page. */
const BLOCKS_THAT_READ_FOR_OTHERS = ['publicAccess', 'documents', 'outbox', 'emailTemplates', 'automations'] as const;

/**
 * Every place one of those blocks names a private table. A private table's
 * rows are read by the people they belong to and by nothing that acts for
 * anyone else, so a rule, a public entry, a document or a mail that names
 * one is refused where it is written. Reads the plain document: a block it
 * does not know the shape of is walked all the same.
 */
export function privateTableIssues(document: Readonly<Record<string, unknown>>, privateTables: readonly string[]): ReferenceIssue[] {
  if (privateTables.length === 0) return [];
  const held = new Set(privateTables);
  const out: ReferenceIssue[] = [];
  const walk = (value: unknown, path: (string | number)[]): void => {
    if (Array.isArray(value)) {
      value.forEach((entry, i) => walk(entry, [...path, i]));
      return;
    }
    if (typeof value !== 'object' || value === null) return;
    for (const [key, inner] of Object.entries(value)) {
      if (key === 'table' && typeof inner === 'string' && held.has(inner)) {
        out.push({ path: [...path, key], message: `"${inner}" is private: only the people its rows belong to read it, so no ${String(path[0])} entry names it` });
      } else walk(inner, [...path, key]);
    }
  };
  for (const block of BLOCKS_THAT_READ_FOR_OTHERS) walk(document[block], [block]);
  return out;
}
