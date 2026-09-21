// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a board, calendar or scheduler page shows instead of NOTHING.
 *
 * Those three templates render their whole body through `DashboardGrid`, which
 * is `items.map(...)`. A page created from the New page screen without a table
 * stores `layout: { version: 1, items: [] }` (`routes/pages/envelope.ts`), so
 * the map produced no elements, the toolbar was gated on a `toolbar: []` that
 * was also empty, and the template's own `parsed.invalid` branch never fired —
 * the body is well-formed, it is merely empty. The result was a page with a
 * header and a blank rectangle under it, with nothing on screen naming the one
 * field that was missing.
 *
 * The other seven table-bound templates never had this: they render a fixed
 * pane shell and already handle a missing slot with an `EmptyState`
 * (`PageLogViewer`'s `log === null` branch is the pattern). This is those three
 * catching up, in the bindings rather than in `@adminium/widgets`, for two
 * reasons the widgets package cannot serve: the envelope's `source` — which
 * says whether a table is bound at all — is projected away before the template
 * sees its config, and the way OUT of the state is a route (`/studio/pages/$id`)
 * that a package with no router must not know about.
 *
 * The action is offered only to someone who can act on it. Editors and viewers
 * get the same explanation ending in "ask an administrator" instead of a button
 * that would land them on the Studio guard's `forbidden` state.
 */
import { useSuspenseQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Button, EmptyState } from '@adminium/ui';

import { bootstrapQuery } from '../../app/bootstrap.js';
import { t } from '../../i18n/t.js';
import { hasStudioAccess } from '../../studio/studioAccess.js';

/** The three templates whose renderer is nothing but a grid. */
export type EmptyLayoutTemplate = 'board' | 'calendar' | 'scheduler';

/**
 * Does this stored body hold a valid, EMPTY layout?
 *
 * Deliberately narrower than "the template found no widgets": a malformed
 * `layout` returns false so the template's own `parsed.invalid` alert still
 * reaches the screen. "Regenerate the page" and "bind a table" are different
 * instructions and the wrong one wastes the reader's time.
 */
export function layoutIsEmpty(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return false;
  const layout = (body as Record<string, unknown>)['layout'];
  if (typeof layout !== 'object' || layout === null) return false;
  const items = (layout as Record<string, unknown>)['items'];
  return Array.isArray(items) && items.length === 0;
}

/**
 * The sentence naming what this template needs from a table.
 *
 * Three literal `t()` calls rather than one interpolated key: the i18n
 * key-coverage sweep (`packages/i18n/src/key-coverage.test.ts`) resolves
 * literals, and a key assembled at runtime is a key no gate can prove exists.
 */
const NEED: Record<EmptyLayoutTemplate, () => string> = {
  board: () =>
    t(
      'page.emptyLayout.board',
      'Bind it to a table with a status column, and its rows become cards grouped into columns.',
    ),
  calendar: () =>
    t(
      'page.emptyLayout.calendar',
      'Bind it to a table with a date column, and its rows become events on the month grid.',
    ),
  scheduler: () =>
    t(
      'page.emptyLayout.scheduler',
      'Bind it to a table with a date column and a person to schedule, and its rows become shifts on a timeline.',
    ),
};

export function EmptyLayoutNotice({
  pageId,
  template,
}: {
  pageId: string;
  template: EmptyLayoutTemplate;
}) {
  const navigate = useNavigate();
  const { data: bootstrap } = useSuspenseQuery(bootstrapQuery());
  const canManage = hasStudioAccess(bootstrap.roles);

  const need = NEED[template]();

  return (
    <EmptyState
      preset="no-data"
      data-testid="page-empty-layout"
      title={t('page.emptyLayout.title', 'This page has nothing to show yet')}
      body={
        canManage
          ? need
          : `${need} ${t('page.emptyLayout.askAdmin', 'Ask an administrator to finish setting it up.')}`
      }
      actions={
        canManage ? (
          <Button
            size="sm"
            variant="secondary"
            data-testid="page-empty-layout-settings"
            onClick={() => void navigate({ to: '/studio/pages/$pageId', params: { pageId } })}
          >
            {t('page.emptyLayout.action', 'Open page settings')}
          </Button>
        ) : undefined
      }
    />
  );
}
