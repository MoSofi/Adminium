// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "These rows are here, they just are not on the grid yet."
 *
 * A planning page drops every row it cannot place: a calendar skips a row with
 * no date, a board a card with no status, a schedule a row missing its person,
 * day or shift type. That is right for one bad row and wrong for all of them,
 * because the page then looks exactly like a broken one. The case that makes
 * it common is a repair: a date column added to a table that already has rows
 * gives every row a NULL, and the next thing the operator sees is an empty
 * month — so they conclude the repair failed.
 *
 * The explanation lives HERE, on the page, not in the dialog that ran the
 * repair: by the time someone meets the empty grid, that dialog is three
 * clicks behind them. And it is computed from numbers the template already
 * holds — rows received, rows placed — so it costs no extra query.
 *
 * Shown only when rows arrived and NONE could be placed. A few undated rows
 * among many dated ones is a table with gaps, not a page that looks broken,
 * and a hint on every such calendar would be noise. It never names a count,
 * which also keeps it free of per-locale plural rules.
 */

export interface UnplacedRowsNoticeProps {
  message: string;
  testId?: string | undefined;
}

export function UnplacedRowsNotice({ message, testId }: UnplacedRowsNoticeProps) {
  return (
    <p
      role="status"
      data-part="unplaced-rows"
      data-testid={testId ?? 'unplaced-rows'}
      className="mx-2 mb-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-body-sm text-fg-muted"
    >
      {message}
    </p>
  );
}

/** Rows arrived and none of them could be placed on the page's grid. */
export function nothingPlaced(received: number, placed: number): boolean {
  return received > 0 && placed === 0;
}
