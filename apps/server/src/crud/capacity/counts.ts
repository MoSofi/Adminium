// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE COUNTS A DESK SEES — every pool of a limit with its size, what is
 * taken, what holds keep, and what is left: the kitchen's "4 / 6" per slot,
 * the box office's sold / held / left per ticket type, the hotel calendar's
 * sold per room type per night.
 *
 * Counted exactly as the write path counts (staff's view: places kept back
 * for a waitlist are shown apart, not taken), with no lock and no write, and
 * none of a guest's filters: no notice, pause or sales window hides a pool.
 * A pool made smaller after it was sold (a room out of service) can show less
 * than nothing left; that is said, not refused.
 *
 * The counts read the rows the pools are held on (the ticket types, the room
 * types and their rooms): the asker must be able to read those tables too,
 * and a column they are asked under must be one the asker sees unmasked.
 * They are made of the rule's own columns (its dates, its state, a pool's
 * size), so a role that may not read one of them is refused the counts, as a
 * masked column is — here, where every door that answers them passes.
 */
import type { ResolvedTable } from '../identifiers.js';
import type { Row } from '../mask.js';
import { refuseHiddenIn } from '../read-view.js';
import type { WriteTarget } from '../write-context.js';
import { addDays, outOfService, Reads } from './count.js';
import { capacityState, rangeOf, tallyFor, widerKeysOf } from './judge.js';
import { hhmm, slotDays } from './placement.js';
import { rulesFor, type Rule } from './rules.js';

export interface CountsAsk {
  rule: number;
  date?: string | undefined;
  from?: string | undefined;
  days?: number | undefined;
  /** A column of the pools' rows, and the value they share. */
  under?: string | undefined;
  value?: string | undefined;
  ids?: readonly string[] | undefined;
}

/** What the asker may read, beyond the limited table: each refuses (403) what they may not. */
export interface CountsAccess {
  table(tableId: string): Promise<void>;
  column(table: ResolvedTable, name: string): Promise<void>;
}

export type CountsAnswer = { ok: true; data: { kind: Rule['kind']; rows: Record<string, unknown>[] } } | { ok: false; message: string };

const refused = (message: string): CountsAnswer => ({ ok: false, message });

export async function capacityCounts(target: WriteTarget, ask: CountsAsk, now: Date, access: CountsAccess): Promise<CountsAnswer> {
  const rule = rulesFor(target.view, target.table)[ask.rule];
  if (rule === undefined) return refused('This table has no such limit.');
  refuseHiddenIn(target.view, target.table.table?.capacityRules?.[ask.rule]);
  const db = target.db;
  const zone = target.timezone ?? 'UTC';
  const oneDay = ask.date !== undefined && ask.from === undefined && ask.days === undefined;
  const strip = ask.date === undefined && ask.from !== undefined && ask.days !== undefined;

  if (rule.kind === 'slot') {
    if (!oneDay && !strip) return refused('Ask for one date, or a from date with a number of days.');
    if (strip && ask.days! > 31) return refused('Ask for at most 31 days.');
    const days = oneDay ? [ask.date!] : rangeOf(ask.from!, addDays(ask.from!, ask.days!));
    const reads = new Reads(db);
    const grid = await slotDays(rule, reads, zone, days);
    const states = new Map((await capacityState(db, target, { rule: rule.index, from: days[0], to: addDays(days.at(-1)!, 1) }, now)).map((s) => [s.key, s]));
    const size = await reads.number(rule.rule.perSlot);
    if (oneDay) {
      const day = grid[0]!;
      return {
        ok: true,
        data: {
          kind: 'slot',
          rows: day.slots.map((slot) => {
            const state = states.get(slot.instant.toISOString());
            return {
              time: hhmm(slot.minute % 1440),
              size,
              taken: state?.taken ?? 0,
              held: state?.held ?? 0,
              ...(day.paused.has(slot.instant.getTime()) ? { paused: true } : {}),
              ...(day.closed ? { closed: true } : {}),
            };
          }),
        },
      };
    }
    return {
      ok: true,
      data: {
        kind: 'slot',
        rows: grid.map((day) => {
          let taken = 0;
          let held = 0;
          for (const slot of day.slots) {
            const state = states.get(slot.instant.toISOString());
            taken += state?.taken ?? 0;
            held += state?.held ?? 0;
          }
          return { date: day.day, size: size === null ? null : size * day.slots.length, taken, held, ...(day.closed ? { closed: true } : {}) };
        }),
      },
    };
  }

  if (rule.kind === 'parent') {
    if (rule.via === null) return { ok: true, data: { kind: 'parent', rows: [] } };
    await access.table(rule.via.table.id);
    for (const wider of rule.also) if (wider.via !== null) await access.table(wider.via.table.id);
    let ids = [...(ask.ids ?? [])];
    if (ask.under !== undefined) {
      // The rows sharing a value of one of their columns (the ticket types of an event).
      if (ask.value === undefined || !rule.via.table.columns.has(ask.under)) return refused('Ask under a column of the pools\' rows, with its value.');
      await access.column(rule.via.table, ask.under);
      const found = (await db
        .selectFrom(rule.via.table.id)
        .select(db.dynamic.ref(rule.via.key) as never)
        .where((eb) => eb(db.dynamic.ref(ask.under!), '=', ask.value!))
        .orderBy(db.dynamic.ref(rule.via.key))
        .limit(200)
        .execute()) as Row[];
      ids = [...ids, ...found.map((row) => String(row[rule.via!.key]))];
    }
    if (ids.length === 0) return refused('Ask for rows by ids, or by the column they share (under).');
    ids = ids.slice(0, 200);
    const day = rule.day === null ? undefined : (ask.date ?? undefined);
    if (rule.day !== null && day === undefined) return refused('This limit counts by day: ask for a date.');
    const own = new Map((await capacityState(db, target, { rule: rule.index, keys: ids, ...(day === undefined ? {} : { day }) }, now)).map((s) => [s.key, s]));
    const reads = new Reads(db);
    const wider = await widerKeysOf(target, rule, ids, reads);
    const widerStates = new Map<string, { key: string; size: number | null; taken: number; held: number }>();
    for (const pool of rule.also) {
      const keys = [...new Set(wider.get(pool.part)?.values() ?? [])];
      if (keys.length === 0) continue;
      for (const s of await tallyFor(db, target, rule, keys.map((key) => ({ part: pool.part, key, at: day })), now, [], 'staff')) {
        widerStates.set(`${pool.part}|${s.key}`, { key: s.key, size: s.size, taken: s.taken, held: s.held });
      }
    }
    return {
      ok: true,
      data: {
        kind: 'parent',
        rows: ids.map((id) => {
          const state = own.get(id);
          return {
            id,
            size: state?.size ?? null,
            taken: state?.taken ?? 0,
            held: state?.held ?? 0,
            ...(rule.kept === null ? {} : { kept: state?.kept ?? 0 }),
            left: state?.left ?? null,
            also: rule.also.flatMap((pool) => {
              const key = wider.get(pool.part)?.get(id);
              const found = key === undefined ? undefined : widerStates.get(`${pool.part}|${key}`);
              return found === undefined ? [] : [found];
            }),
          };
        }),
      },
    };
  }

  if (!strip) return refused('Ask for a from date with a number of days.');
  if (ask.days! > 62) return refused('Ask for at most 62 nights.');
  if (rule.via === null) return { ok: true, data: { kind: 'night', rows: [] } };
  await access.table(rule.via.table.id);
  if (rule.pool.kind === 'count') await access.table(rule.pool.table);
  if (rule.outOfService !== null) await access.table(rule.outOfService.table);
  const pools =
    ask.ids !== undefined && ask.ids.length > 0
      ? ask.ids.slice(0, 200)
      : ((await db.selectFrom(rule.via.table.id).select(db.dynamic.ref(rule.via.key) as never).orderBy(db.dynamic.ref(rule.via.key)).limit(200).execute()) as Row[]).map((row) =>
          String(row[rule.via!.key]),
        );
  const states = await capacityState(db, target, { rule: rule.index, keys: pools, from: ask.from, to: addDays(ask.from!, ask.days!) }, now);
  // Rooms out of service, per pool and night: what the size already leaves out.
  const closed = await outOfService(rule, pools, rangeOf(ask.from!, addDays(ask.from!, ask.days!)), new Reads(db));
  return {
    ok: true,
    data: {
      kind: 'night',
      rows: states.map((s) => ({ pool: s.key, date: s.at, size: s.size, outOfService: closed.get(s.key)?.get(s.at!) ?? 0, taken: s.taken, held: s.held, left: s.left })),
    },
  };
}
