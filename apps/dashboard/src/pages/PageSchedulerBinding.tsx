// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `page-scheduler` binding: projects the page envelope onto the real
 * `PageScheduler` template from `@adminium/widgets`.
 *
 * Data flow: `usePlanningStates` runs the page's ONE widget-data batch over
 * the stored record-list descriptors; the template maps shift rows through
 * `personColumn`/`dateColumn`/`typeColumn` into the interactive ShiftMatrix.
 * The template's week nav publishes the visible window as `dateRange.*`
 * params, re-windowing the batch through the late-bound filters appended to
 * the schedule item's descriptor.
 *
 * Writes: click-to-cycle → update/delete intents, empty-slot add → insert —
 * all through the host sink (CRUD + undo toast + widget-data invalidation,
 * which reconciles the matrix's optimistic overrides). Row click on a shift
 * opens nothing (cells cycle instead); the record drawer mounts for
 * `/p/$slug/r/$id` navigations from sibling widgets.
 */
import { useMemo, useState } from 'react';
import { PageScheduler } from '@adminium/widgets';

import type { WidgetDataParams } from '../api/widgetData.js';
import { t } from '../i18n/t.js';
import { EmptyLayoutNotice, layoutIsEmpty } from './planning/EmptyLayoutNotice.js';
import { PlanningRecordDrawer } from './planning/PlanningRecordDrawer.js';
import { planningWindowTargetOf, usePlanningStates } from './planning/planningData.js';
import type { PageTemplateProps } from './template-types.js';

export function PageSchedulerBinding({ page, adapters, recordId, columnFacts, currency }: PageTemplateProps) {
  const [params, setParams] = useState<WidgetDataParams>({});
  const window = useMemo(
    () => planningWindowTargetOf(page, ['schedule-matrix'], ['dateColumn', 'startColumn']),
    [page],
  );
  const states = usePlanningStates(page, params, window);

  // An empty layout renders an empty grid — nothing at all. A page created
  // without a table is the way in; the notice names the missing binding.
  // AFTER the hooks above, never before: this component keeps its instance
  // when a page is bound and refetched, and a guard that skipped `useState`
  // on one render would change the hook count on the next.
  if (layoutIsEmpty(page.config)) {
    return <EmptyLayoutNotice pageId={page.id} template="scheduler" />;
  }

  return (
    <>
      <PageScheduler
        // The connection's currency: a money card that names none reads in it.
        {...(currency === undefined ? {} : { currency })}
        config={page.config}
        states={states}
        labels={{
          previousWeek: t('scheduler.prevWeek', 'Previous week'),
          nextWeek: t('scheduler.nextWeek', 'Next week'),
          week: t('scheduler.week', 'Week'),
          month: t('scheduler.month', 'Month'),
          resource: t('scheduler.resource', 'Resource'),
          coverage: t('scheduler.coverage', 'Coverage'),
          addShift: t('scheduler.addShift', 'Add shift'),
          // `{n}` is substituted by the template, not by ICU interpolation.
          shiftCount: t('scheduler.shiftCount', '{n} shifts'),
        }}
        onEvent={(_instanceId, event) => adapters.onEvent(event)}
        onParamsChange={setParams}
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
