// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `page-board` binding: projects the page envelope onto the real
 * `PageBoard` template from `@adminium/widgets`.
 *
 * Data flow: archetype pages are `kind: 'page'`, so the dashboard batch hook
 * never sees them — `usePlanningStates` extracts the layout's descriptors,
 * runs the ONE deduped `POST /api/v1/widget-data/batch`, and hands the
 * per-instance states to the template (unbound items keep deterministic demo
 * data). The page is read again after a save of its own (`PageRenderer`), and
 * when a frame says its cards' table — or the table its columns are the rows
 * of — changed (`planning/boardLive.ts`): a colleague's move, a stage added.
 * The read after a save is what lets go of the board's optimistic card moves.
 *
 * A board that names its columns (an app's `config.board`) reads them from the
 * server too — the rows of a table, or an enum's values, each with the count
 * and the totals of the cards its reader reaches (`planning/boardColumns.ts`).
 *
 * A board with a toolbar (`config.board.toolbar`) shows the server's total of
 * every card the reader reaches, and filters by a person: the choice is held
 * here, and the cards, the columns' figures and the total are read again of
 * that person's cards (`withPerson`).
 *
 * Events re-enter the host sink: drops → `mutate` update (status, or
 * lane+status) with the CRUD promise returned for rollback; card click →
 * `record-open` → `/p/$slug/r/$id`, where this binding mounts the shared
 * planning record drawer (the page-crud detail pattern).
 */
import { useTheme } from '@adminium/ui';
import { PageBoard } from '@adminium/widgets';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { getI18nInstance, t } from '../i18n/t.js';
import { EmptyLayoutNotice, layoutIsEmpty } from './planning/EmptyLayoutNotice.js';
import { amountWriter, boardReadOf, useBoardColumns, useBoardTotalsWriter, withPerson } from './planning/boardColumns.js';
import { useBoardLive } from './planning/boardLive.js';
import { PlanningRecordDrawer } from './planning/PlanningRecordDrawer.js';
import { usePlanningStates } from './planning/planningData.js';
import { LinkFilterBar, LinkNarrowingGate, useLinkNarrowing, useNarrowedPage } from './linkNarrowing.js';
import type { PageTemplateProps } from './template-types.js';

export function PageBoardBinding({ page, adapters, recordId, columnFacts, currency, formColumns, tableLabelSingular, tableLabelPlural }: PageTemplateProps) {
  // A link may open this list narrowed (`?f.<column>=<op>:<value>`): see linkNarrowing.tsx.
  const narrowing = useLinkNarrowing(page, adapters.crud?.table);
  const view = useNarrowedPage(page, narrowing);
  // The toolbar's person (`toolbar.person`), or everyone: held for this page, let go when another opens.
  const [person, setPerson] = useState<string | null>(null);
  useEffect(() => setPerson(null), [page.id]);
  const shown = useMemo(() => withPerson(view.page, person), [view.page, person]);
  const states = usePlanningStates(shown, {}, undefined, person === null ? view.key : `${view.key ?? ''}|person:${person}`);
  // The board's columns as the server answers them, for a board that names them; undefined for any other.
  // Under a link's narrowing the cards are some of the table's, and a count of all of them would head the wrong list.
  const boardColumns = useBoardColumns(page, { states, formColumns, currency, locale: getI18nInstance()?.language ?? 'en-US', narrowed: view.key !== undefined, person });
  const personColumn = useMemo(() => boardReadOf(page)?.person, [page]);
  const personLabel = useMemo(() => {
    const spec = formColumns?.find((column) => column.spec.name === personColumn)?.spec as { label?: unknown } | undefined;
    return typeof spec?.label === 'string' && spec.label !== '' ? spec.label : undefined;
  }, [formColumns, personColumn]);
  // A colleague's change to the cards' table or the columns' table reads the page again, once for a burst.
  useBoardLive(page);
  // The page's direction, as the shell resolved it for the person's language: the board lays its columns out by it
  // (the first one at the start side) and its arrow keys read it. Unsaid, a board is left to right on any page.
  const { dir } = useTheme();
  // A card's amount as its column is kept: money in the column's own currency, else the connection's; any other number plainly.
  const language = getI18nInstance()?.language ?? 'en-US';
  const formatAmount = useCallback((column: string, amount: number) => amountWriter(column, formColumns, currency, language)(amount), [formColumns, currency, language]);
  // The toolbar's totals, written as each column's header writes them.
  const formatTotals = useBoardTotalsWriter(page, formColumns, currency, language);

  // An empty layout renders an empty grid — nothing at all. A page created
  // without a table is the way in; the notice names the missing binding.
  // AFTER the hooks above, never before: this component keeps its instance
  // when a page is bound and refetched, and a guard that skipped `useState`
  // on one render would change the hook count on the next.
  if (layoutIsEmpty(page.config)) {
    return <EmptyLayoutNotice pageId={page.id} template="board" />;
  }
  if (view.blocked) return <LinkNarrowingGate narrowing={narrowing} cannotCarry={view.cannotCarry} />;

  return (
    <>
      <LinkFilterBar narrowing={narrowing} columns={formColumns} facts={columnFacts} />
      <PageBoard
        // The connection's currency: a money card that names none reads in it.
        {...(currency === undefined ? {} : { currency })}
        // As read: narrowed to the toolbar's person, when one is chosen.
        config={shown.config}
        person={person}
        onPersonChange={setPerson}
        formatTotals={formatTotals}
        {...(tableLabelSingular === null || tableLabelSingular === undefined || tableLabelPlural === null || tableLabelPlural === undefined ? {} : { entityLabels: { one: tableLabelSingular, other: tableLabelPlural } })}
        {...(personLabel === undefined ? {} : { personLabel })}
        states={states}
        dir={dir}
        formatAmount={formatAmount}
        {...(boardColumns === undefined ? {} : { boardColumns })}
        labels={{
          addLabel: t('board.addCard', 'Add card'),
          composePlaceholder: t('board.compose.placeholder', 'Card title…'),
          composeAdd: t('board.compose.add', 'Add'),
          composeCancel: t('board.compose.cancel', 'Cancel'),
          emptyTitle: t('board.empty.title', 'No board columns'),
          emptyBody: t('board.empty.body', 'Add a status field to group cards into columns.'),
          noRowsTitle: t('board.empty.noRowsTitle', 'No cards yet'),
          noRowsBody: t('board.empty.noRowsBody', 'Cards appear here as soon as the table has rows.'),
        }}
        // Forward the host's result so the optimistic boards get the mutate
        // promise and can roll back a rejected move (PageRenderer.onEvent).
        onEvent={(_instanceId, event) => adapters.onEvent(event)}
      />
      {recordId !== undefined && adapters.crud !== null && (
        <PlanningRecordDrawer
          crud={adapters.crud}
          recordId={recordId}
          onClose={() => adapters.openRecord(null)}
          facts={columnFacts}
        />
      )}
    </>
  );
}
