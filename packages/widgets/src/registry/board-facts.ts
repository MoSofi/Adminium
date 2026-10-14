// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a named board says of its headings, its cards and itself beyond its
 * columns (an app's `config.board`: `columnsFrom.badge`, `card`, `note`).
 *
 * Kept apart from the candidate rules so the board page reads these shapes
 * without loading the rules that compose pages.
 */

/** A column of the columns' table shown beside each heading, and how it is written. */
export interface BoardBadge {
  column: string;
  as?: 'text' | 'number' | 'percent' | undefined;
}

/** What a card of a named board shows under its title. */
export interface BoardCardFacts {
  /** `<link column>.<column of the row it points at>`: the company's name. */
  link?: string | undefined;
  /** A staff column, shown as the person's name. */
  person?: string | undefined;
  /** A number or money column. */
  amount?: string | undefined;
  /** Days from a date or time column to today; amber from `warnFrom` days, red from `alertFrom`. */
  daysSince?: { column: string; warnFrom?: number | undefined; alertFrom?: number | undefined } | undefined;
  /** A date or time column, shown as a day. */
  date?: string | undefined;
}

/** A sentence above a board, by language, with the address it opens. */
export interface BoardNote {
  text: string;
  texts?: Readonly<Record<string, string>> | undefined;
  href?: string | undefined;
}

/** The names a board's cards are answered their facts under: a looked-up name, and the days counted. */
export const BOARD_CARD_LINK_ALIAS = 'adm_card_link';
export const BOARD_CARD_DAYS_ALIAS = 'adm_card_days';
