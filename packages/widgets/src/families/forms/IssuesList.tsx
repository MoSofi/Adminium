// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A list of what a check found: errors first, then warnings, then notices,
 * each with its count.
 *
 * The component alone. As the registry places it (a `record-list` payload
 * and a config, whose schema is zod's) it is `ValidationIssuesList.tsx`. The
 * import wizard draws this one, on the dashboard and on an app's own screen,
 * and hands it plain issues.
 */
import { Badge, EmptyState, IconTile } from '@adminium/ui';

import { useWidgetHeadingId } from '../../frame/WidgetHeadingContext.js';
import { useMaybeT } from '../../lib/i18n.js';
import { useScrollRegion } from '../../lib/useScrollRegion.js';

import { severityIcon } from './severity-icons.js';
import { DEFAULT_SEVERITY_TONE, formatCount } from './forms-lib.js';
import type { FormTone, IssueSeverity } from './forms-lib.js';

export interface ValidationIssue {
  key: string;
  severity: IssueSeverity;
  title: string;
  desc?: string | undefined;
  count?: number | undefined;
}

const SEVERITY_RANK: Record<IssueSeverity, number> = { error: 0, warn: 1, info: 2 };

/**
 * Order errors → warnings → info, stably within each severity.
 *
 * The list is a triage surface: an import blocked by 12 invalid emails must not
 * be reported below "Dates normalised to ISO" merely because the server happened
 * to emit the notice first. Ties keep payload order, so the result stays
 * deterministic for the same payload.
 */
export function sortIssues(issues: readonly ValidationIssue[]): ValidationIssue[] {
  return [...issues].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

/** Config `severityMap` overrides the default severity→tone map (annex). */
function toneOf(severity: IssueSeverity, map: Record<string, FormTone> | undefined): FormTone {
  return map?.[severity] ?? DEFAULT_SEVERITY_TONE[severity];
}

export interface IssuesListProps {
  /** In any order: the list sorts them, errors first. */
  issues: readonly ValidationIssue[];
  /** Overrides the default tone of a severity. */
  severityMap?: Record<string, FormTone> | undefined;
  locale?: string | undefined;
  emptyTitle?: string | undefined;
  emptyBody?: string | undefined;
  testId?: string | undefined;
}

export function IssuesList({ issues: given, severityMap, locale, emptyTitle, emptyBody, testId }: IssuesListProps) {
  const t = useMaybeT();
  const issues = sortIssues(given);

  // ABOVE the empty-state early return, not below it. Hooks must run in the same
  // order on every render, and the empty branch returns before this point — so
  // calling them after it threw "Rendered fewer hooks than expected" the moment a
  // populated list went empty. Deliberately NO role on the list: an explicit one
  // would override the <ul>'s implicit `role="list"` and destroy the
  // "list, N items" announcement. The tab stop appears only while it overflows.
  const headingId = useWidgetHeadingId();
  const scroll = useScrollRegion({ labelledBy: headingId ?? undefined });

  if (issues.length === 0) {
    return (
      <EmptyState
        compact
        preset="all-caught-up"
        title={emptyTitle ?? t('ui:widgets.forms.validationIssuesList.emptyTitle', 'No issues found')}
        body={emptyBody ?? t('ui:widgets.forms.validationIssuesList.emptyBody', 'Everything checks out — you are good to import.')}
      />
    );
  }

  return (
    <ul
      data-widget="validation-issues-list"
      data-testid={testId}
      {...scroll}
      className={`m-0 flex h-full list-none flex-col gap-0.5 overflow-auto p-2 ${scroll.className}`}
    >
      {issues.map((issue) => {
        const tone = toneOf(issue.severity, severityMap);
        const count = formatCount(issue.count, locale);
        return (
          <li
            key={issue.key}
            data-part="issue-row"
            data-severity={issue.severity}
            data-tone={tone}
            className="flex items-start gap-3 rounded-lg px-2.5 py-2.5 hover:bg-surface-2"
          >
            <IconTile size="md" tone={tone} icon={severityIcon(issue.severity)} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-body-sm font-bold text-fg">{issue.title}</p>
              {issue.desc !== undefined && <p className="text-caption text-fg-muted">{issue.desc}</p>}
            </div>
            {count !== undefined && (
              <Badge data-part="issue-count" tone={tone} className="shrink-0">
                {count}
              </Badge>
            )}
          </li>
        );
      })}
    </ul>
  );
}
