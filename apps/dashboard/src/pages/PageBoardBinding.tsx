/**
 * `page-board` binding (09-generated-app.md §4.1, §7.5): projects the page
 * envelope onto the real `PageBoard` template from `@adminium/widgets`.
 *
 * Data flow: archetype pages are `kind: 'page'`, so the dashboard batch hook
 * never sees them — `usePlanningStates` extracts the layout's descriptors,
 * runs the ONE deduped `POST /api/v1/widget-data/batch`, and hands the
 * per-instance states to the template (unbound items keep deterministic demo
 * data, 04 §5.3). WS `widget-data:*`/`table:*` invalidations refetch — which
 * is what confirms (or unwinds) the board's optimistic card moves.
 *
 * Events re-enter the host sink: drops → `mutate` update (status, or
 * lane+status) with the CRUD promise returned for rollback; card click →
 * `record-open` → `/p/$slug/r/$id`, where this binding mounts the shared
 * planning record drawer (the page-crud detail pattern).
 */
import { PageBoard } from '@adminium/widgets';

import { t } from '../i18n/t.js';
import { PlanningRecordDrawer } from './planning/PlanningRecordDrawer.js';
import { usePlanningStates } from './planning/planningData.js';
import type { PageTemplateProps } from './template-types.js';

export function PageBoardBinding({ page, adapters, recordId }: PageTemplateProps) {
  const states = usePlanningStates(page);

  return (
    <>
      <PageBoard
        config={page.config}
        states={states}
        labels={{
          addLabel: t('board.addCard', 'Add card'),
          composePlaceholder: t('board.compose.placeholder', 'Card title…'),
          composeAdd: t('board.compose.add', 'Add'),
          composeCancel: t('board.compose.cancel', 'Cancel'),
          emptyTitle: t('board.empty.title', 'No board columns'),
          emptyBody: t('board.empty.body', 'Add a status field to group cards into columns.'),
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
        />
      )}
    </>
  );
}
