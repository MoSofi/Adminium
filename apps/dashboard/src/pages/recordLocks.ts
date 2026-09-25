// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a record page may offer on a document's row, from its table's states.
 *
 * A table with states (an invoice: draft → sent → void) locks its row once it
 * is in a locked state — every field but the state and the listed exceptions
 * — never deletes a numbered row or one in a no-delete state, and ties child
 * tables to it: a sent invoice's lines take no change, a payment only while
 * its invoice is sent. The server refuses all of it (409 `RECORD_LOCKED`,
 * `DELETE_REFUSED`, `STATE_MOVE_REFUSED`) and stays the authority; this is the
 * same fact drawn BEFORE the click, so a person is not offered an edit that
 * can only be refused.
 *
 * The facts come from the connection's schema reply, which carries each
 * table's `states`, the rows of other tables that lock it (`lockedBy`, which
 * would need another read and is left to the server) and the parents it is
 * tied to (`stateParents`).
 */
import { queryOptions } from '@tanstack/react-query';

import { api } from '../app/api.js';

export interface StatesRule {
  column: string;
  initial: string;
  lock?: { when: string[]; except?: string[] };
  noDelete?: { when: 'numbered' | string[] };
}

export interface StateParentFact {
  /** The parent table's id. */
  table: string;
  key: string;
  /** This table's foreign key to the parent. */
  via: string;
  /** The parent's state column, and the states it is locked in. */
  column: string;
  lockedIn: string[];
  lock?: true;
  parentIn?: string[];
}

/** One table's state facts, as the record page reads them. */
export interface TableStateFacts {
  id: string;
  name: string;
  states?: StatesRule | undefined;
  stateParents: StateParentFact[];
  /** The columns numbered without gaps: a row with one of them set is "numbered". */
  gapless: string[];
}

type Row = Readonly<Record<string, unknown>>;

/** The row's state, or its first state when it names none. */
export function stateOf(table: Pick<TableStateFacts, 'states'>, row: Row): string | null {
  const states = table.states;
  if (states === undefined) return null;
  const value = row[states.column];
  return value === null || value === undefined || value === '' ? states.initial : String(value);
}

/**
 * The state the row is locked in, or null when it is not. A locked row's
 * fields are read-only but for the state itself and `lock.except`.
 */
export function lockedIn(table: Pick<TableStateFacts, 'states'>, row: Row): string | null {
  const state = stateOf(table, row);
  return state !== null && (table.states?.lock?.when ?? []).includes(state) ? state : null;
}

/** Whether each field of the row is locked, or null when nothing is. */
export function lockedFields(table: Pick<TableStateFacts, 'states'>, row: Row): ((column: string) => boolean) | null {
  const states = table.states;
  if (states === undefined || lockedIn(table, row) === null) return null;
  const open = new Set([states.column, ...(states.lock?.except ?? [])]);
  return (column) => !open.has(column);
}

/**
 * Whether the server would refuse to delete the row: numbered (a gapless
 * number is set, where the table never deletes a numbered row), in a
 * no-delete state, or locked.
 */
export function deleteRefused(table: TableStateFacts, row: Row): boolean {
  const states = table.states;
  if (states === undefined) return false;
  const when = states.noDelete?.when;
  const state = stateOf(table, row);
  const numbered = when === 'numbered' && table.gapless.some((column) => row[column] !== null && row[column] !== undefined);
  return numbered || (Array.isArray(when) && state !== null && when.includes(state)) || lockedIn(table, row) !== null;
}

/**
 * Whether a child row may change while its parent is in `parentState`: not
 * while a parent that locks its children is locked, and — for a table tied to
 * some of the parent's states (payments to a sent invoice) — only in those.
 */
export function childWritable(parent: StateParentFact, parentState: string | null): boolean {
  if (parent.lock === true && parentState !== null && parent.lockedIn.includes(parentState)) return false;
  if (parent.parentIn !== undefined && (parentState === null || !parent.parentIn.includes(parentState))) return false;
  return true;
}

interface SchemaTable {
  id: string;
  name: string;
  states?: StatesRule;
  stateParents?: StateParentFact[];
  columns: { name: string; sequence?: { gapless?: boolean } }[];
}

/**
 * The connection's tables that keep states or are tied to one, by id and by
 * name. Every other table is left out: nothing about it changes on the page.
 */
export function stateFactsQuery(connectionId: string) {
  return queryOptions({
    queryKey: ['record-locks', connectionId] as const,
    staleTime: 60_000,
    queryFn: async (): Promise<ReadonlyMap<string, TableStateFacts>> => {
      const reply = await api.get<{ model: { tables: SchemaTable[] } }>(`/api/v1/connections/${encodeURIComponent(connectionId)}/schema`);
      const out = new Map<string, TableStateFacts>();
      for (const table of reply.model.tables) {
        if (table.states === undefined && (table.stateParents ?? []).length === 0) continue;
        const facts: TableStateFacts = {
          id: table.id,
          name: table.name,
          states: table.states,
          stateParents: table.stateParents ?? [],
          gapless: table.columns.filter((column) => column.sequence?.gapless === true).map((column) => column.name),
        };
        out.set(table.id, facts);
        out.set(table.name, facts);
      }
      return out;
    },
  });
}
