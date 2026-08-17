// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `page-calendar` binding (09-generated-app.md §4.1, §7.6): projects the page
 * envelope onto the real `PageCalendar` template from `@adminium/widgets`.
 *
 * Data flow: `usePlanningStates` runs the page's ONE widget-data batch. The
 * engine persists `calendar-events`-shaped descriptors; planningData rewrites
 * them to `record-list` (the compiler's supported set) and the template maps
 * rows → events via the stored `startColumn`/`titleColumn` vocabulary. The
 * toolbar date-range picker publishes `dateRange.*` params, which re-window
 * the batch through the late-bound filters `withDateWindow` appended to the
 * calendar item's descriptor (04 §5.1).
 *
 * Events re-enter the host sink: the agenda composer → insert intent (undo
 * toast from the host), agenda/upcoming row click → `record-open` →
 * `/p/$slug/r/$id` → the shared planning record drawer.
 */
import { useMemo, useState } from 'react';
import { PageCalendar } from '@adminium/widgets';

import type { WidgetDataParams } from '../api/widgetData.js';
import { t } from '../i18n/t.js';
import { PlanningRecordDrawer } from './planning/PlanningRecordDrawer.js';
import { planningWindowTargetOf, usePlanningStates } from './planning/planningData.js';
import type { PageTemplateProps } from './template-types.js';

export function PageCalendarBinding({ page, adapters, recordId }: PageTemplateProps) {
  const [params, setParams] = useState<WidgetDataParams>({});
  const window = useMemo(
    () => planningWindowTargetOf(page, ['calendar-month'], ['startColumn', 'dateColumn']),
    [page],
  );
  const states = usePlanningStates(page, params, window);

  return (
    <>
      <PageCalendar
        config={page.config}
        states={states}
        labels={{
          dateRange: t('calendar.dateRange', 'Date range'),
          composePlaceholder: t('calendar.compose.placeholder', 'Event title…'),
          composeAdd: t('calendar.compose.add', 'Add'),
          composeCancel: t('calendar.compose.cancel', 'Cancel'),
          composeOpen: t('calendar.compose.open', 'Add event'),
          agendaEmptyTitle: t('calendar.agenda.empty', 'Nothing scheduled'),
        }}
        onEvent={(_instanceId, event) => adapters.onEvent(event)}
        onParamsChange={setParams}
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
