// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT LETS A MONEY CODE BE PRINTED ONCE.
 *
 * Two kinds of thing, both random bytes that name nothing, both good for one
 * use, both kept in this process only:
 *
 *  - a PRINT TOKEN is handed to whoever made a row that carries a money
 *    code, with the code, in the reply of the save that made it: for ten
 *    minutes it lets that one person draw that one row's document, whatever
 *    their role reads;
 *  - a PRINT TICKET is what a draw is handed in place of bytes: an address
 *    that answers the document once, to the same person, within a minute.
 *
 * Per process, like the public limiter: a token is known to the process that
 * minted it, so it is spent at most once; after a restart, or on another
 * replica, it is spent not at all (the code was shown on the screen; a
 * manager prints it again).
 */
import { randomBytes } from 'node:crypto';

export const PRINT_TOKEN_MS = 10 * 60_000;
export const PRINT_TICKET_MS = 60_000;
/** The most of each kept at once: the oldest go first. */
export const PRINT_KEPT_MAX = 5_000;

export interface PrintTicket {
  userId: string;
  profileId: string;
  pk: Readonly<Record<string, unknown>>;
  paper?: string | undefined;
  locale?: string | undefined;
  values?: Readonly<Record<string, string | number | boolean>> | undefined;
  /** Drawn on a maker's token, not on what the caller's role reads. */
  once: boolean;
}

export interface PrintStore {
  /** `row`: the database, the table and the row's key, as one text — a token is that row's alone. */
  mintToken(userId: string, row: string): string;
  /** Whether the token is this user's, for this row, and live — asked without spending it. */
  holdsToken(token: string, userId: string, row: string): boolean;
  /** Spends the token when it is this user's, for this row, and live. */
  takeToken(token: string, userId: string, row: string): boolean;
  mintTicket(ticket: PrintTicket): string;
  /** Spends the ticket and answers what it stands for, when it is this user's and live. */
  takeTicket(ticket: string, userId: string): PrintTicket | null;
}

const random = (): string => randomBytes(32).toString('base64url');

export function createPrintStore(now: () => number = Date.now, max = PRINT_KEPT_MAX): PrintStore {
  const tokens = new Map<string, { userId: string; row: string; until: number }>();
  const tickets = new Map<string, { ticket: PrintTicket; until: number }>();
  const keep = <T extends { until: number }>(kept: Map<string, T>, value: T): string => {
    const at = now();
    for (const [name, one] of kept) if (one.until <= at) kept.delete(name);
    for (const name of kept.keys()) {
      if (kept.size < max) break;
      kept.delete(name);
    }
    const name = random();
    kept.set(name, value);
    return name;
  };
  return {
    mintToken: (userId, row) => keep(tokens, { userId, row, until: now() + PRINT_TOKEN_MS }),
    holdsToken(token, userId, row) {
      const held = tokens.get(token);
      return held !== undefined && held.userId === userId && held.row === row && held.until > now();
    },
    takeToken(token, userId, row) {
      const held = tokens.get(token);
      // Another's, another row's or a dead one: left as it is, and answered as nothing.
      if (held === undefined || held.userId !== userId || held.row !== row) return false;
      tokens.delete(token);
      return held.until > now();
    },
    mintTicket: (ticket) => keep(tickets, { ticket, until: now() + PRINT_TICKET_MS }),
    takeTicket(ticket, userId) {
      const held = tickets.get(ticket);
      if (held === undefined || held.ticket.userId !== userId) return null;
      // Gone before anything is drawn: a draw that fails cannot be tried again with it.
      tickets.delete(ticket);
      return held.until > now() ? held.ticket : null;
    },
  };
}

/** The row a print token is for: its database, its table, its key. */
export const printRow = (connectionId: string, tableId: string, key: unknown): string => JSON.stringify([connectionId, tableId, String(key)]);

/** This process's own: a token minted by a save is spent by the draw that follows it, wherever each is mounted. */
export const printStore: PrintStore = createPrintStore();
