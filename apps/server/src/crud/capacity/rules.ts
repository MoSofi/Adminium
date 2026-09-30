// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A TABLE'S LIMITS, READY TO COUNT — each stored rule with the rows it reads
 * through its foreign keys found in the connection's model.
 *
 * A rule names columns; the rows it reaches through a foreign key (the order
 * a ticket belongs to, the ticket type it takes from, the room a stay is
 * given) are found here, once per table of a schema view, from the live
 * relations. A link the model no longer has reads nothing: a row whose
 * `via` cannot be followed is judged as if the link were empty.
 *
 * "Level" is where a condition, a hold or a day is read: the row itself
 * (`own`) or the one row it belongs to (`owner`, one hop through `via`). A
 * rule reads one owner.
 */
import type { NightCapacityRule, ParentCapacityRule, SlotCapacityRule } from '@adminium/manifest';

import type { CapacitySetting, EffectiveCapacityRule, EffectiveTable } from '../../connections/effective-schema.js';
import type { ResolvedTable, SnapshotView } from '../identifiers.js';

/** A foreign key of a table, and the row it points at: its table and key column. */
export interface Link {
  column: string;
  table: ResolvedTable;
  key: string;
}

export type Level = 'own' | 'owner';

/** Rows count only while this column holds one of the values (on the row, or on its owner). */
export interface Condition {
  level: Level;
  column: string;
  values: readonly string[];
}

/** Where a hold's end is read: a column of the level's row, or of a row it links to. */
export interface HoldEnd {
  column: string;
  /** A link of the level's row; null for a column of that row itself. */
  link: Link | null;
  /** The link's column when the model has lost it: the end reads nothing. */
  lost?: boolean;
}

export interface Hold {
  level: Level;
  states: readonly string[];
  /** The ends, the first that is filled answering: one for a plain column. */
  ends: readonly HoldEnd[];
}

/** Places kept back from the public (a returned ticket held for the waitlist). */
export interface Kept {
  level: Level;
  states: readonly string[];
  /** The state a claim moves the kept rows it takes to (the pool's own rows). */
  releaseTo?: string;
}

/** A size: a number, a setting, or a column of the row a pool is keyed by (with the day it holds for). */
export type Size =
  | { kind: 'number'; value: number }
  | { kind: 'setting'; setting: CapacitySetting }
  | { kind: 'column'; column: string; onDay?: string | undefined }
  | { kind: 'hop'; link: Link | null; column: string };

/** A column read at a level: an own column, or the owner's. */
export interface LevelColumn {
  level: Level;
  column: string;
}

interface Common {
  index: number;
  table: ResolvedTable;
  /** The one owner row the rule reads through, when it reads one. */
  owner: Link | null;
  /** The owner's link column, when the rule names one the model has lost. */
  ownerColumn: string | null;
  conditions: readonly Condition[];
  hold: Hold | null;
  kept: Kept | null;
  /** How much a row takes: a column, or a number. */
  amount: { column: string } | { value: number };
}

export interface SlotRule extends Common {
  kind: 'slot';
  rule: SlotCapacityRule;
  /** The rule a released app writes: it answers exactly as it always has. */
  legacy: boolean;
}

/** A pool a parent rule's rows also take from (a room's cap across its ticket types). */
export interface WiderPool {
  part: string;
  via: Link | null;
  column: string;
  size: Size;
}

export interface ParentRule extends Common {
  kind: 'parent';
  rule: ParentCapacityRule;
  via: Link | null;
  viaColumn: string;
  size: Size;
  also: readonly WiderPool[];
  day: LevelColumn | null;
  perWrite: { max: Size; within: string } | null;
  lockBy: string | null;
}

export interface NightRule extends Common {
  kind: 'night';
  rule: NightCapacityRule;
  from: LevelColumn;
  to: LevelColumn;
  /** The pool's key column on the row, and the rows it points at. */
  via: Link | null;
  viaColumn: string;
  /** The room given, whose own type the row counts against when set. */
  given: { via: Link | null; column: string } | null;
  /** The states of a stay that has begun: a change of it is judged from the venue's today on. */
  arrived: Kept | null;
  pool:
    | { kind: 'count'; table: string; column: string }
    | { kind: 'size'; size: Size };
  /** Rooms out of service; `roomsKey` is the key of the counted rooms a closure's room points at (a count pool). */
  outOfService: { table: string; room: string; from: string; to: string; active?: string | undefined; roomsKey: string } | null;
}

export type Rule = SlotRule | ParentRule | NightRule;

const CACHE = new WeakMap<ResolvedTable, Rule[]>();

/** The link a one-column foreign key of `table` follows, or null. */
export function linkOf(view: SnapshotView, table: ResolvedTable, column: string): Link | null {
  const relation = (view.model?.relations ?? []).find(
    (r) => r.through === null && r.from.tableId === table.id && r.from.columns.length === 1 && r.from.columns[0] === column,
  );
  if (relation === undefined || relation.to.columns.length !== 1) return null;
  const target = view.linkTable(relation.to.tableId);
  if (target === null) return null;
  return { column, table: target, key: relation.to.columns[0]! };
}

const isSetting = (value: unknown): value is CapacitySetting =>
  typeof value === 'object' && value !== null && 'table' in value && 'column' in value;

function sizeOf(value: unknown, onTarget: Link | null, view: SnapshotView): Size {
  if (typeof value === 'number') return { kind: 'number', value };
  if (isSetting(value)) return { kind: 'setting', setting: { table: value.table, column: value.column } };
  const shape = value as { column: string; onDay?: string; via?: string };
  if (shape.via !== undefined) {
    return { kind: 'hop', link: onTarget === null ? null : linkOf(view, onTarget.table, shape.via), column: shape.column };
  }
  return { kind: 'column', column: shape.column, ...(shape.onDay === undefined ? {} : { onDay: shape.onDay }) };
}

/** The rules of a table, compiled against the view it was resolved from (cached per table). */
export function rulesFor(view: SnapshotView, table: ResolvedTable): Rule[] {
  const cached = CACHE.get(table);
  if (cached !== undefined) return cached;
  const rules = (table.table.capacityRules ?? []).map((rule, index) => compile(view, table, rule, index));
  CACHE.set(table, rules);
  return rules;
}

/** Whether a table keeps a limit of any kind. */
export const hasLimits = (table: { table: EffectiveTable | undefined }): boolean => (table.table?.capacityRules?.length ?? 0) > 0;

function compile(view: SnapshotView, table: ResolvedTable, rule: EffectiveCapacityRule, index: number): Rule {
  // The owner: the one row a condition, a hold, a day or a date is read through.
  const conditionsOf = rule.countWhere === undefined ? [] : Array.isArray(rule.countWhere) ? rule.countWhere : [rule.countWhere];
  const ownerVias = new Set<string>();
  for (const condition of conditionsOf) if (condition.via !== undefined) ownerVias.add(condition.via);
  if (rule.hold?.via !== undefined) ownerVias.add(rule.hold.via);
  if (rule.kind === 'parent') {
    if (typeof rule.day === 'object' && rule.day.via !== undefined) ownerVias.add(rule.day.via);
    if (rule.reserved?.via !== undefined) ownerVias.add(rule.reserved.via);
  }
  if (rule.kind === 'night') {
    for (const date of [rule.from, rule.to]) if (typeof date === 'object') ownerVias.add(date.via);
    if (rule.arrived?.via !== undefined) ownerVias.add(rule.arrived.via);
  }
  const ownerColumn = [...ownerVias][0] ?? null;
  const owner = ownerColumn === null ? null : linkOf(view, table, ownerColumn);
  const levelOf = (via: string | undefined): Level => (via === undefined ? 'own' : 'owner');

  const conditions: Condition[] = conditionsOf.map((c) => ({ level: levelOf(c.via), column: c.column, values: [...c.values] }));
  let hold: Hold | null = null;
  if (rule.hold !== undefined) {
    const level = levelOf(rule.hold.via);
    const levelTable = level === 'own' ? table : owner?.table;
    const column = rule.hold.column;
    const endOf = (end: { column: string; via?: string | undefined }): HoldEnd => {
      if (end.via === undefined) return { column: end.column, link: null };
      const link = levelTable === undefined ? null : linkOf(view, levelTable, end.via);
      return link === null ? { column: end.column, link: null, lost: true } : { column: end.column, link };
    };
    const ends = typeof column === 'string' ? [{ column, link: null }] : [endOf(column), ...(column.or ?? []).map(endOf)];
    hold = { level, states: [...rule.hold.states], ends };
  }
  const reserved = rule.kind === 'parent' ? rule.reserved : undefined;
  const kept: Kept | null =
    reserved === undefined ? null : { level: levelOf(reserved.via), states: [...reserved.states], ...(reserved.releaseTo === undefined ? {} : { releaseTo: reserved.releaseTo }) };
  const amountOf = (value: unknown): Common['amount'] => (typeof value === 'string' ? { column: value } : { value: typeof value === 'number' ? value : 1 });
  const common = { index, table, owner, ownerColumn, conditions, hold, kept };

  if (rule.kind === 'parent') {
    const via = linkOf(view, table, rule.via);
    const day: LevelColumn | null =
      rule.day === undefined ? null : typeof rule.day === 'string' ? { level: 'own', column: rule.day } : { level: levelOf(rule.day.via), column: rule.day.column };
    return {
      ...common,
      kind: 'parent',
      rule,
      amount: amountOf(rule.amount),
      via,
      viaColumn: rule.via,
      size: sizeOf(rule.size, via, view),
      also: (rule.also ?? []).map((wider, k) => {
        const link = linkOf(view, table, wider.via);
        return { part: `a${String(k)}`, via: link, column: wider.via, size: sizeOf(wider.size, link, view) };
      }),
      day,
      perWrite: rule.perWrite === undefined ? null : { max: sizeOf(rule.perWrite.max, via, view), within: rule.perWrite.within },
      lockBy: rule.lockBy ?? null,
    };
  }
  if (rule.kind === 'night') {
    const dateOf = (date: NightCapacityRule['from']): LevelColumn =>
      typeof date === 'string' ? { level: 'own', column: date } : { level: 'owner', column: date.column };
    const pool = rule.pool;
    const via = linkOf(view, table, pool.via);
    const given =
      'given' in pool && pool.given !== undefined ? { via: linkOf(view, table, pool.given.via), column: pool.given.column } : null;
    const oos = 'count' in pool ? pool.count.outOfService : pool.outOfService;
    return {
      ...common,
      kind: 'night',
      rule,
      amount: { value: 1 },
      from: dateOf(rule.from),
      to: dateOf(rule.to),
      via,
      viaColumn: pool.via,
      given,
      arrived: rule.arrived === undefined ? null : { level: levelOf(rule.arrived.via), states: [...rule.arrived.states] },
      pool: 'count' in pool ? { kind: 'count', table: pool.count.table, column: pool.count.column } : { kind: 'size', size: pool.size === 1 ? { kind: 'number', value: 1 } : sizeOf(pool.size, via, view) },
      outOfService:
        oos === undefined
          ? null
          : {
              table: oos.table,
              room: oos.room,
              from: oos.from,
              to: oos.to,
              ...(oos.active === undefined ? {} : { active: oos.active }),
              roomsKey: ('count' in pool ? view.linkTable(pool.count.table)?.primaryKey[0] : via?.key) ?? 'id',
            },
    };
  }
  const slot = rule as SlotCapacityRule & { kind: 'slot' };
  return {
    ...common,
    kind: 'slot',
    rule: slot,
    amount: amountOf(slot.amount),
    legacy: table.table.capacity !== undefined,
  };
}

/** The columns of the row itself a write may move a rule's count with. */
export function ownColumns(rule: Rule): string[] {
  const out = new Set<string>();
  if (rule.ownerColumn !== null) out.add(rule.ownerColumn);
  for (const condition of rule.conditions) if (condition.level === 'own') out.add(condition.column);
  if (rule.hold?.level === 'own') for (const end of rule.hold.ends) out.add(end.link?.column ?? end.column);
  if ('column' in rule.amount) out.add(rule.amount.column);
  if (rule.kind === 'slot') {
    out.add(rule.rule.slot);
    if (rule.rule.resource !== undefined) out.add(rule.rule.resource);
  } else if (rule.kind === 'parent') {
    out.add(rule.viaColumn);
    for (const wider of rule.also) out.add(wider.column);
    if (rule.day?.level === 'own') out.add(rule.day.column);
    if (rule.perWrite !== null) out.add(rule.perWrite.within);
    if (rule.lockBy !== null) out.add(rule.lockBy);
  } else {
    for (const date of [rule.from, rule.to]) if (date.level === 'own') out.add(date.column);
    out.add(rule.viaColumn);
    if (rule.given !== null) out.add(rule.given.via?.column ?? '');
  }
  out.delete('');
  return [...out];
}

/** The owner's columns a rule reads: a change to one of them may move the count of the owner's rows. */
export function ownerColumns(rule: Rule): string[] {
  const out = new Set<string>();
  for (const condition of rule.conditions) if (condition.level === 'owner') out.add(condition.column);
  if (rule.hold?.level === 'owner') for (const end of rule.hold.ends) out.add(end.link?.column ?? end.column);
  if (rule.kind === 'parent' && rule.day?.level === 'owner') out.add(rule.day.column);
  if (rule.kind === 'night') for (const date of [rule.from, rule.to]) if (date.level === 'owner') out.add(date.column);
  return [...out];
}

/**
 * A rule of another table whose rows' count reads rows of this one: the rows
 * they belong to (tickets of an order), or the row a hold's end is read on
 * (the waitlist offer an order is held for). A change of this table's rows is
 * judged for them, as if they had moved.
 */
export interface OwnedRule {
  /** The child table, resolved in the same view. */
  table: ResolvedTable;
  rule: Rule;
  /** The child's column the reach follows: its owner's link, or the link its hold's end is read through. */
  via: string;
  /** This table's column the child's (or its owner's) link points at. */
  key: string;
  /** This table's columns the rule reads. */
  watched: readonly string[];
  /** What this table's row is to the child: its owner, or where its hold's end is read. */
  reads: 'owner' | 'end';
  /** Reached through the child's owner (an owner's hold read on this table): the owner's table, its key, and its column pointing here. */
  through?: { table: ResolvedTable; key: string; column: string } | undefined;
}

const OWNED = new WeakMap<ResolvedTable, OwnedRule[]>();

/** The rules whose rows' count reads rows of this table (tickets of an order; an order held for a waitlist offer's end). */
export function ownedRules(view: SnapshotView, table: ResolvedTable): OwnedRule[] {
  const cached = OWNED.get(table);
  if (cached !== undefined) return cached;
  const out: OwnedRule[] = [];
  if (table.primaryKey.length === 1) {
    for (const model of view.model?.tables ?? []) {
      if ((model.capacityRules?.length ?? 0) === 0) continue;
      const child = view.linkTable(model.id);
      if (child === null) continue;
      for (const rule of rulesFor(view, child)) {
        if (rule.owner !== null && rule.owner.table.id === table.id) {
          const watched = ownerColumns(rule);
          if (watched.length > 0) out.push({ table: child, rule, via: rule.owner.column, key: rule.owner.key, watched, reads: 'owner' });
        }
        // A hold's end read on a row of this table: moving it may make a lapsed hold count again.
        for (const end of rule.hold?.ends ?? []) {
          if (end.link === null || end.link.table.id !== table.id) continue;
          if (rule.hold!.level === 'own') {
            out.push({ table: child, rule, via: end.link.column, key: end.link.key, watched: [end.column], reads: 'end' });
          } else if (rule.owner !== null) {
            const through = { table: rule.owner.table, key: rule.owner.key, column: end.link.column };
            out.push({ table: child, rule, via: rule.owner.column, key: end.link.key, watched: [end.column], reads: 'end', through });
          }
        }
      }
    }
  }
  OWNED.set(table, out);
  return out;
}

/**
 * The columns of a row through which its count reads another row a write may
 * change meanwhile: its owner's link, and the links its own hold's end is read
 * through. A new row takes a lock per such link, the lock a change of the
 * linked row takes too.
 */
export function linkColumns(rule: Rule): { column: string; table: ResolvedTable }[] {
  const out: { column: string; table: ResolvedTable }[] = [];
  if (rule.owner !== null) out.push({ column: rule.owner.column, table: rule.owner.table });
  if (rule.hold?.level === 'own') {
    for (const end of rule.hold.ends) if (end.link !== null && !out.some((o) => o.column === end.link!.column)) out.push({ column: end.link.column, table: end.link.table });
  }
  return out;
}

/** The column holding the state at a level: its condition's (a hold and a kept place read it). */
export function stateColumn(rule: Rule, level: Level): string | null {
  return rule.conditions.find((condition) => condition.level === level)?.column ?? null;
}
