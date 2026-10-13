// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The board, mounted on an app's own screen.
 *
 * It is the dashboard's own board (`KanbanBoard`): drag with a pointer, or
 * with the keyboard (Enter or space picks a card up, the arrows move it,
 * Enter drops it, Escape puts it back), each step said to a screen reader.
 * The columns keep their width and scroll sideways inside the board's own
 * box, so the page never does.
 *
 * The app owns the rows. It gives columns and cards as plain data, and saves
 * a move in `onMove`. A save that is refused (`{ refused }`, or a rejection)
 * puts the card back, and the board says why above its columns and aloud.
 *
 * The board keeps a move that held: the card stays in its new column whether
 * or not the app hands new cards back. Counts and totals are the app's, so a
 * screen that shows them reads them again after a move and calls `update`.
 */
import { InlineComposeCard, KanbanBoard, type BoardAddRefusal, type BoardCardData, type ColumnDef } from '@adminium/widgets/kit-board';
import { useMemo, useRef, useState, type ReactNode } from 'react';

import type { BoardProps, KitMounted } from '../contract.js';
import { mountReact } from '../root.js';
import { followed, reasonOf } from '../saves.js';

import './board.css';

function Board({ props, patch }: { props: BoardProps; patch: (change: Partial<BoardProps>) => void }): ReactNode {
  // What the app last gave, for the answers that arrive later.
  const latest = useRef(props);
  latest.current = props;
  const [notAdded, setNotAdded] = useState<BoardAddRefusal | null>(null);

  const columns = useMemo<ColumnDef[]>(
    () =>
      props.columns.map((column) => ({
        id: column.id,
        label: column.label,
        tone: column.tone ?? 'neutral',
        ...(column.limit === undefined ? {} : { wip: column.limit }),
        ...(column.count === undefined ? {} : { count: column.count }),
        ...(column.total === undefined ? {} : { total: column.total }),
      })),
    [props.columns],
  );
  const cards = useMemo<BoardCardData[]>(
    () =>
      props.cards.map((card) => {
        const lines = [...(card.meta ?? []).map((value) => ({ value })), ...(card.lines ?? [])];
        return {
          id: card.id,
          title: card.title,
          column: card.columnId,
          foot: card.reference ?? '',
          ...(card.tag === undefined ? {} : { tag: card.tag }),
          ...(card.tagTone === undefined ? {} : { tagTone: card.tagTone }),
          ...(card.owner === undefined ? {} : { owner: card.owner }),
          ...(card.due === undefined ? {} : { due: card.due }),
          ...(card.subtitle === undefined ? {} : { client: card.subtitle }),
          ...(card.amount === undefined ? {} : { budget: card.amount }),
          ...(card.progress === undefined ? {} : { pct: card.progress }),
          ...(lines.length === 0 ? {} : { lines }),
        };
      }),
    [props.cards],
  );

  const busy = props.busy === true;
  const canMoveCard = (cardId: string): boolean => {
    const now = latest.current;
    if (now.onMove === undefined || now.busy === true || now.canMove === false) return false;
    return typeof now.canMove === 'function' ? now.canMove(cardId) : true;
  };

  const move = (cardId: string, from: string, to: string): Promise<void> | undefined => {
    const save = latest.current.onMove;
    if (save === undefined) return undefined;
    // The move held: the card is kept in its new column, unless the app has said where it is since.
    const keep = (): void => {
      const now = latest.current.cards;
      if (now.find((card) => card.id === cardId)?.columnId !== from) return;
      patch({ cards: now.map((card) => (card.id === cardId ? { ...card, columnId: to } : card)) });
    };
    const answer = followed(() => save(cardId, to, from));
    if (answer === undefined) {
      keep();
      return undefined;
    }
    return answer.then(keep);
  };

  const add = (columnId: string, title: string): Promise<void> | undefined => {
    const save = latest.current.onAdd;
    if (save === undefined) return undefined;
    setNotAdded(null);
    return followed(() => save(columnId, title))?.catch((error: unknown) => {
      // Said on the board; the rejection goes on to the composer, which keeps the title.
      setNotAdded({ title, reason: reasonOf(error) });
      throw error;
    });
  };

  return (
    <div
      className="adm-kit-board"
      data-part="kit-board"
      aria-busy={busy || undefined}
      {...(props.onOpen === undefined ? {} : { 'data-openable': '' })}
      {...(props.ariaLabel === undefined ? {} : { role: 'group', 'aria-label': props.ariaLabel })}
    >
      {props.emptyLabel !== undefined && columns.length > 0 && cards.length === 0 ? (
        <p className="adm-kit-board-empty" data-part="board-empty">
          {props.emptyLabel}
        </p>
      ) : null}
      <KanbanBoard
        columns={columns}
        cards={cards}
        dir={props.dir}
        locale={props.locale}
        canMoveCard={canMoveCard}
        onCardMove={move}
        addRefusal={notAdded}
        onDismissAddRefusal={() => setNotAdded(null)}
        {...(props.onOpen === undefined ? {} : { onCardOpen: props.onOpen })}
        {...(props.emptyLabel === undefined ? {} : { labels: { emptyTitle: props.emptyLabel, emptyBody: '' } })}
        {...(props.onAdd === undefined ? {} : { columnFooter: (column: ColumnDef) => <InlineComposeCard disabled={busy} onAdd={(title) => add(column.id, title)} /> })}
      />
    </div>
  );
}

export default function mountBoard(element: Element, props: BoardProps): Promise<KitMounted<BoardProps>> {
  return mountReact<BoardProps>('board', element, props, (now, patch) => <Board props={now} patch={patch} />);
}
