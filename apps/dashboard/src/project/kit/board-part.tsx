// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The kit's `Board`, as code of its own: the dashboard's kanban board, with
 * the kit's plainer card. Drag with a pointer, or with the keyboard (space to
 * pick a card up, arrows to move it, enter to drop, escape to put it back).
 *
 * On a narrow screen the columns keep their width and the board scrolls
 * sideways inside its own box, so the page itself never does.
 *
 * A move whose save the page's `onMove` rejects puts the card back, and the
 * board says why above its columns (and aloud), in the rejection's words.
 */

import { useMemo, type ReactNode } from 'react';
import { KanbanBoard, type BoardCardData, type ColumnDef } from '@adminium/widgets/kit-board';
import type { BoardProps } from '@adminium/server/ui';

export default function BoardPart({ columns, cards, onMove, onOpen, emptyTitle, emptyDescription }: BoardProps): ReactNode {
  const columnDefs = useMemo<ColumnDef[]>(
    () =>
      columns.map((column) => ({
        id: column.id,
        label: column.label,
        tone: column.tone ?? 'neutral',
        ...(column.limit === undefined ? {} : { wip: column.limit }),
        ...(column.count === undefined ? {} : { count: column.count }),
        ...(column.total === undefined ? {} : { total: column.total }),
      })),
    [columns],
  );
  const cardData = useMemo<BoardCardData[]>(
    () =>
      cards.map((card) => ({
        id: card.id,
        title: card.title,
        column: card.column,
        ...(card.tag === undefined ? {} : { tag: card.tag }),
        ...(card.tagTone === undefined ? {} : { tagTone: card.tagTone }),
        ...(card.owner === undefined ? {} : { owner: card.owner }),
        ...(card.due === undefined ? {} : { due: card.due }),
        ...(card.detail === undefined ? {} : { client: card.detail }),
        ...(card.figure === undefined ? {} : { budget: card.figure }),
      })),
    [cards],
  );
  return (
    <div className="max-w-full overflow-x-auto" data-part="kit-board">
      <KanbanBoard
        columns={columnDefs}
        cards={cardData}
        dir={typeof document !== 'undefined' && document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr'}
        {...(onMove === undefined ? {} : { onCardMove: (cardId: string, from: string, to: string) => onMove(cardId, from, to) })}
        {...(onOpen === undefined ? {} : { onCardOpen: onOpen })}
        labels={{ ...(emptyTitle === undefined ? {} : { emptyTitle }), ...(emptyDescription === undefined ? {} : { emptyBody: emptyDescription }) }}
      />
    </div>
  );
}
