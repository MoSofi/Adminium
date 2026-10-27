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
  /** A second number or money column, under the first, with a short label before it by language ("w €12,000"). */
  secondAmount?: { column: string; label?: string | undefined; labels?: Readonly<Record<string, string>> | undefined } | undefined;
  /**
   * Days from a date or time column to today; amber from `warnFrom` days, red from `alertFrom`. `label`: what the days
   * are, after the figure, by language ("12 days in stage").
   */
  daysSince?:
    | { column: string; warnFrom?: number | undefined; alertFrom?: number | undefined; label?: string | undefined; labels?: Readonly<Record<string, string>> | undefined }
    | undefined;
  /** A date or time column, shown as a day. */
  date?: string | undefined;
  /**
   * The card's person read through a link, not a staff column: one or two
   * `<link column>.<column>` paths whose values make the name (a first and a
   * last name). Drawn as the avatar at the card's foot.
   */
  owner?: readonly string[] | undefined;
  /** A choice column of the card's own, drawn as its priority pill in the column's words and tones. */
  priority?: string | undefined;
  /** A choice column of the card's own, drawn as its tag (a roadmap's theme) in the column's words and tones; its tone colours the card's bar. */
  tag?: string | undefined;
  /**
   * What a lane is called when the lanes are a link (`<link column>.<column>`
   * paths, one or two), so a lane of people reads "Ana Ferreira", not "5".
   * `owner`: the lane's link is the owner's, and its name is the owner's.
   */
  laneName?: readonly string[] | 'owner' | undefined;
}

/**
 * A figure above a board (the comp's summary cards): the cards there are,
 * those in one column, a money column's sum, or the people on them. Each is
 * asked as its own query (`statBindings`); `figure` and `delta` are indexes
 * into that list.
 */
export interface BoardStat {
  kind: 'total' | 'column' | 'amount' | 'people';
  /** The stored words under the figure ("Total projects"); a `column` stat is called by the column's own label. */
  label?: string | undefined;
  /** `column`: the status value counted. */
  value?: string | undefined;
  /** `amount`: the money column summed, written as the cards write it. */
  column?: string | undefined;
  figure: number;
  /** The figure's share of the total, as a pill ("38%"). */
  share?: true | undefined;
  /** A second figure drawn as "+N" in the pill: the cards added lately. */
  delta?: number | undefined;
}

/**
 * A board's toolbar: `total` — how many cards the board holds and each of its totals over all of them, the server's
 * figures over every card the reader reaches; `person` — a staff column the cards can be narrowed by, one person or
 * everyone.
 */
export interface BoardToolbar {
  total?: boolean | undefined;
  person?: string | undefined;
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
/** The aliases a card's owner and its lane's name are read under: `adm_card_owner_0`, `adm_card_owner_1`, … */
export const BOARD_CARD_OWNER_ALIAS = 'adm_card_owner';
export const BOARD_CARD_LANE_ALIAS = 'adm_card_lane';
