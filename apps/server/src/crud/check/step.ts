// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE DESIGN QUESTION, ASKED INSIDE A SAVE.
 *
 * An order line may name a design a shopper made with an add-on. Whenever a
 * save makes or changes such a line — or the features it pays for — Adminium
 * asks the add-on, in the save's own transaction, after the rows are written
 * and BEFORE any total is worked out (and in the dry run, the same way):
 *
 *  1. read each line as it now stands (held, in a save), its design row, the
 *     rows the add-on declared it reads for one (keyed, starting from the
 *     design: at most {@link CHECK_ROWS_MAX} rows a line, past which the line
 *     is refused by name), the features the line pays for, and what is known
 *     of each file the design holds;
 *  2. ask the add-on's code once, which touches no database and no clock;
 *  3. check the answer: every line answered once, in the contract's shape;
 *     any refusal refuses the save; the features the design uses must be the
 *     features the line pays for, as sets, both ways.
 *
 * A line with no design is not asked. A line with one whose add-on cannot be
 * asked — untrusted, not loaded, broken, being updated — is refused: a design
 * nobody checked is never ordered (the reason the add-on's code did not load
 * is on its card, with every other add-on that failed to load).
 *
 * Every read is a plain read on the transaction's handle, but for the line
 * itself, held in a save so two saves of its features are one after another.
 */
import { CHECK_FEATURES_MAX, CHECK_FILES_MAX, CHECK_LINES_MAX, CHECK_ROWS_MAX, checkAnswerIssues, checkOutputSchema, featureRefusals, type CheckFile, type CheckInput, type CheckLine, type CheckOutput } from '@adminium/add-on-contracts';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';

import { callDecider, DeciderFailed } from '../../add-ons/decide.js';
import type { SourceDatabase } from '../../connections/manager.js';
import { CheckRefusedError, ValidationFailedError } from '../../errors.js';
import type { CheckerState, LedgerRuntime, ResolvedChecker } from '../../ledgers/registry.js';
import type { TableRules } from '../column-rules.js';
import { ledgerSettings, rowOut, type ScalarRow } from '../ledger-reads.js';
import type { Row } from '../mask.js';
import type { WriteContext, WriteTarget } from '../write-context.js';
import type { CompiledCheck } from './rule.js';

type Db = Kysely<SourceDatabase>;

/** What is known of one stored file: its type and its size. */
export interface FileFact {
  kind: string;
  size: number;
}

/** What the step takes from the write service it is built in. */
export interface CheckKit {
  ledgers: LedgerRuntime | undefined;
  rulesOf(target: WriteTarget): TableRules | null;
  /** The stored files these ids name; an id it does not find is left out. Absent: no file is known, each is handed in as not there. */
  fileFacts?: ((ids: readonly string[]) => Promise<ReadonlyMap<string, FileFact>>) | undefined;
}

/** A line a save asks about: its table and its key. */
export interface LineAsked {
  target: WriteTarget;
  key: unknown;
}

/** Which line a refusal is about, beside the refusal and never in it: a write of many rows names the row with it. */
export interface CheckedAt {
  table: string;
  key: string;
}

export const checkedAt = (error: unknown): CheckedAt | undefined => (error as { checkAt?: CheckedAt } | null | undefined)?.checkAt;

/** What each reason is called to staff, in plain words (the dashboard says it in the reader's own language). */
const WORDS: Readonly<Record<string, string>> = {
  'too-long': 'The words are too long for this part of the design.',
  'required-empty': 'A part of the design that must be filled in is empty.',
  'font-not-allowed': 'This font is not one the design offers.',
  'size-out-of-range': 'This size is outside what the design allows.',
  'colour-not-allowed': 'This colour is not one the design offers.',
  'choice-not-allowed': 'This choice is not one the design offers.',
  'part-locked': 'This part of the design cannot be changed.',
  'file-missing': 'The design needs a file that is not there.',
  'file-kind': 'This kind of file cannot be used here.',
  'design-unknown': 'This design cannot be found.',
  'format-unknown': 'This design was saved in a way this shop cannot read.',
  'feature-not-paid': 'The design uses something that is not paid for on this line.',
  'feature-not-used': 'This line pays for something the design does not use.',
  'feature-paid-twice': 'This line pays for the same thing twice.',
  'design-too-large': 'This design is too large to be checked.',
  'check-unavailable': 'Designs cannot be checked right now, so this cannot be saved.',
  'check-failed': 'The add-on that checks designs did not answer as it should, so nothing was saved.',
};

/** What a refusal of the design question says, in plain words. */
export const checkWords = (reason: string): string => WORDS[reason] ?? 'This design cannot be ordered as it is.';

/** Who a write is: a customer is told on the field, staff and the system by the refusal's code. */
const isPublic = (context: Pick<WriteContext, 'origin'>): boolean => context.origin === 'public';

interface Refusal {
  reason: string;
  part?: string | undefined;
  feature?: string | undefined;
  refusals?: { part?: string; reason: string }[] | undefined;
}

/**
 * A guest's design refused: about their own design and nothing else (what
 * they typed, chose and uploaded, and what their line pays for), so a public
 * door tells it by name — on the column the guest typed the design's code
 * into, when a lookup fills the link from one, else on the link itself.
 */
export class DesignRefused extends ValidationFailedError {
  constructor(readonly refused: { column: string; reason: string; part?: string; feature?: string }) {
    super('Some values were refused.', { fields: { [refused.column]: { code: refused.reason, ...(refused.part === undefined ? {} : { part: refused.part }), ...(refused.feature === undefined ? {} : { feature: refused.feature }) } } });
  }
}

/**
 * The refusal a save meets for a line whose design does not stand. To staff
 * and to the system: 409 `CHECK_REFUSED`, on the line's design link. To a
 * customer: {@link DesignRefused}.
 */
function refusalOf(context: Pick<WriteContext, 'origin'>, column: string, told: string, refusal: Refusal, at: CheckedAt): Error {
  const extra = {
    ...(refusal.part === undefined ? {} : { part: refusal.part }),
    ...(refusal.feature === undefined ? {} : { feature: refusal.feature }),
  };
  const error = isPublic(context)
    ? new DesignRefused({ column: told, reason: refusal.reason, ...extra })
    : new CheckRefusedError(checkWords(refusal.reason), { column, reason: refusal.reason, ...extra, ...(refusal.refusals === undefined || refusal.refusals.length < 2 ? {} : { refusals: refusal.refusals }) });
  Object.defineProperty(error, 'checkAt', { value: at, enumerable: false });
  return error;
}

const empty = (value: unknown): boolean => value === null || value === undefined || value === '';

/** A line whose reads pass the cap: refused by name, never asked on a part of its design. */
class TooLarge extends Error {
  override readonly name = 'TooLarge';
}

/** The ids a file column holds: one, or a list kept as JSON. */
function fileIds(value: unknown): string[] {
  if (empty(value)) return [];
  if (Array.isArray(value)) return value.filter((id): id is string => typeof id === 'string');
  if (typeof value === 'string' && value.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
    } catch {
      return [];
    }
  }
  return typeof value === 'string' ? [value] : [];
}

export function createDesignCheck(kit: CheckKit) {
  /** Whether a table's rule runs now. A server with no add-on runtime cannot ask anyone: every design is refused. */
  const stateOf = (target: WriteTarget): CheckerState => {
    if (target.table.table?.check === undefined) return { state: 'idle' };
    return kit.ledgers?.checker?.(target.view, target.table) ?? { state: 'unavailable', addOn: target.table.table.check.by.addOn, cause: 'no-runtime' };
  };

  /** The rows of one table whose column holds one of these values, at most `room` of them (one more says there were more). */
  const rowsWhere = async (db: Db, table: ResolvedChecker['design'], column: string, values: readonly unknown[], room: number): Promise<Row[]> => {
    if (values.length === 0) return [];
    let query = db.selectFrom(table.id as never).selectAll().where(sql.ref(column), 'in', values as never);
    for (const key of table.primaryKey) query = query.orderBy(sql.ref(key));
    return (await query.limit(room + 1).execute()) as Row[];
  };

  /** The design and what the add-on reads for it: at most the cap in all. */
  const readsFor = async (db: Db, checker: ResolvedChecker, design: Row): Promise<Record<string, ScalarRow[]>> => {
    const raw = new Map<string, Row[]>([['design', [design]]]);
    const out: Record<string, ScalarRow[]> = {};
    let left = CHECK_ROWS_MAX;
    for (const read of checker.reads) {
      const values = [...new Set((raw.get(read.from.read) ?? []).map((row) => row[read.from.column]).filter((value) => !empty(value)).map((value) => (typeof value === 'bigint' ? String(value) : value)))];
      const rows = await rowsWhere(db, read.table, read.column, values, left);
      if (rows.length > left) throw new TooLarge();
      left -= rows.length;
      raw.set(read.id, rows);
      const hints = checker.typesOf(read.table.id);
      out[read.id] = rows.map((row) => rowOut(read.table, row, hints));
    }
    return out;
  };

  /** What is known of each file the design holds, column by column. */
  const filesOf = async (checker: ResolvedChecker, design: Row): Promise<CheckFile[]> => {
    const named: { column: string; id: string }[] = [];
    for (const column of checker.design.columns.values()) {
      if (column.file === undefined) continue;
      for (const id of fileIds(design[column.name])) named.push({ column: column.name, id });
    }
    if (named.length === 0) return [];
    if (named.length > CHECK_FILES_MAX) throw new TooLarge();
    const facts = (await kit.fileFacts?.([...new Set(named.map((one) => one.id))])) ?? new Map<string, FileFact>();
    return named.map(({ column, id }) => {
      const fact = facts.get(id);
      return { column, kind: fact?.kind ?? '', size: fact?.size ?? 0 };
    });
  };

  return {
    /** Reads what is installed again when it moved: asked before a save opens its transaction, never inside one. */
    async refresh(): Promise<void> {
      await kit.ledgers?.refresh?.();
    },

    /** The add-ons a save of these tables may ask: entered as a reader of each one's update gate, so its code never changes half way. */
    addOnsOf(targets: readonly WriteTarget[]): string[] {
      const keys = new Set<string>();
      for (const target of targets) {
        const own = target.table.table?.check?.by.addOn;
        if (own !== undefined) keys.add(own);
        for (const parent of kit.rulesOf(target)?.checkParents ?? []) {
          try {
            const line = target.view.table(parent.line);
            const by = line.table?.check?.by.addOn;
            if (by !== undefined) keys.add(by);
          } catch {
            // A line table this reader cannot see asks nothing of it here.
          }
        }
      }
      return [...keys].sort();
    },

    /** Whether a change of these columns of a table's row asks a design question: a line's design link, or a paid feature's line or feature. */
    asksOn(target: WriteTarget, changed: readonly string[]): boolean {
      const rules = kit.rulesOf(target);
      if (rules?.check !== undefined && changed.includes(rules.check.design)) return true;
      return (rules?.checkParents ?? []).some((parent) => changed.includes(parent.via) || changed.includes(parent.feature));
    },

    /**
     * The lines a written row asks about: itself, when its table's lines may
     * name a design and `changed` touches its design link (a create touches
     * everything); the line it is a paid feature of, when `changed` touches
     * its link to the line or its feature (old and new lines both, on a move).
     */
    linesOf(target: WriteTarget, after: Row | null, before: Row | null, changed: readonly string[] | 'all'): LineAsked[] {
      const rules = kit.rulesOf(target);
      const out: LineAsked[] = [];
      const touches = (columns: readonly string[]): boolean => changed === 'all' || columns.some((column) => changed.includes(column));
      const check = rules?.check;
      if (check !== undefined && after !== null && touches([check.design])) out.push({ target, key: after[check.key] });
      for (const parent of rules?.checkParents ?? []) {
        if (!touches([parent.via, parent.feature])) continue;
        let line: WriteTarget['table'];
        try {
          line = target.view.table(parent.line);
        } catch {
          continue;
        }
        const keys = new Set<string>();
        for (const row of [after, before]) {
          const key = row?.[parent.via];
          if (empty(key) || keys.has(String(key))) continue;
          keys.add(String(key));
          out.push({ target: { ...target, table: line }, key });
        }
      }
      return out;
    },

    /**
     * Asks about each line, as it now stands on `db`, and refuses the save at
     * the first line whose design does not stand. Lines are asked one table
     * at a time, all of a table's lines in one question.
     */
    async run(db: Db, asked: readonly LineAsked[], opts: { mode: 'save' | 'dry'; context: Pick<WriteContext, 'origin'> }): Promise<void> {
      const byTable = new Map<string, { target: WriteTarget; keys: Map<string, unknown> }>();
      for (const one of asked) {
        if (empty(one.key)) continue;
        const group = byTable.get(one.target.table.id) ?? { target: one.target, keys: new Map<string, unknown>() };
        group.keys.set(String(one.key), one.key);
        byTable.set(one.target.table.id, group);
      }
      for (const { target, keys } of byTable.values()) {
        const check: CompiledCheck | undefined = kit.rulesOf(target)?.check;
        if (check === undefined) continue;
        const line = target.table;
        // Each line as it stands, held in a save on an engine that can: its features are read after it, by one save at a time.
        let query = db.selectFrom(line.id as never).selectAll().where(sql.ref(check.key), 'in', [...keys.values()] as never);
        if (opts.mode === 'save' && target.dialect !== 'sqlite') query = query.forUpdate();
        const rows = ((await query.execute()) as Row[]).filter((row) => !empty(row[check.design]));
        if (rows.length === 0) continue;
        const at = (row: Row): CheckedAt => ({ table: line.id, key: String(row[check.key]) });
        // A guest is told on the column they typed the design's code into, when a lookup fills the link from one.
        const told = line.table?.columns.find((column) => column.name === check.design)?.lookup?.from ?? check.design;
        const refuse = (row: Row, refusal: Refusal): never => {
          throw refusalOf(opts.context, check.design, told, refusal, at(row));
        };
        const state = stateOf(target);
        if (state.state === 'idle') continue;
        if (state.state === 'unavailable') refuse(rows[0]!, { reason: 'check-unavailable' });
        const { checker, decider } = state as Extract<CheckerState, { state: 'live' }>;
        if (rows.length > CHECK_LINES_MAX) refuse(rows[CHECK_LINES_MAX]!, { reason: 'design-too-large' });

        const lines: CheckLine[] = [];
        const linesRows = new Map<string, Row>();
        for (const row of rows) {
          // The features the line pays for, each code once: one paid twice is refused before anybody is asked.
          const paid: string[] = [];
          if (check.paid !== undefined) {
            const table = target.view.table(check.paid.table);
            const found = (await db
              .selectFrom(table.id as never)
              .select(sql.ref(check.paid.feature).as('feature') as never)
              .where(sql.ref(check.paid.via), '=', row[check.key] as never)
              .limit(CHECK_FEATURES_MAX + 1)
              .execute()) as { feature: unknown }[];
            if (found.length > CHECK_FEATURES_MAX) refuse(row, { reason: 'design-too-large' });
            for (const { feature } of found) {
              if (empty(feature)) continue;
              const code = String(feature);
              if (paid.includes(code)) refuse(row, { reason: 'feature-paid-twice', feature: code });
              paid.push(code);
            }
            paid.sort();
          }
          const designKey = checker.design.primaryKey[0];
          const design = designKey === undefined ? undefined : ((await db.selectFrom(checker.design.id as never).selectAll().where(sql.ref(designKey), '=', row[check.design] as never).executeTakeFirst()) as Row | undefined);
          if (design === undefined) refuse(row, { reason: 'design-unknown' });
          let reads: Record<string, ScalarRow[]>;
          let files: CheckFile[];
          try {
            reads = await readsFor(db, checker, design!);
            files = await filesOf(checker, design!);
          } catch (error) {
            if (error instanceof TooLarge) refuse(row, { reason: 'design-too-large' });
            throw error;
          }
          const key = String(row[check.key]);
          linesRows.set(key, row);
          lines.push({ key, design: rowOut(checker.design, design!, checker.typesOf(checker.design.id)), rows: reads, paid, files });
        }

        const input: CheckInput = { contract: 'design-check@1', mode: opts.mode, lines, settings: await ledgerSettings(checker, db), version: checker.version };
        let answer: CheckOutput;
        try {
          answer = callDecider('check', decider, input, { shape: checkOutputSchema }) as CheckOutput;
        } catch (error) {
          if (error instanceof DeciderFailed) refuse(rows[0]!, { reason: 'check-failed' });
          throw error;
        }
        // Nothing of the answer is taken on trust: a line missing, invented or answered twice, a verdict that contradicts its refusals.
        if (checkAnswerIssues(input, answer).length > 0) refuse(rows[0]!, { reason: 'check-failed' });
        for (const one of lines) {
          const said = answer.lines.find((candidate) => candidate.key === one.key)!;
          const row = linesRows.get(one.key)!;
          const first = said.refusals[0];
          if (first !== undefined) refuse(row, { reason: first.reason, part: first.part, refusals: said.refusals.map((refusal) => ({ ...(refusal.part === undefined ? {} : { part: refusal.part }), reason: refusal.reason })) });
          const unpaid = featureRefusals(one.paid, said.used)[0];
          if (unpaid !== undefined) refuse(row, { reason: unpaid.reason, feature: unpaid.feature });
        }
      }
    },
  };
}

export type DesignCheck = ReturnType<typeof createDesignCheck>;
