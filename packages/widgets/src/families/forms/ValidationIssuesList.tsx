/**
 * `validation-issues-list` (annex §10) — severity-toned issue rows: an icon
 * tile, the title, the resolution description, and an outcome count pill.
 * Evidence: Import Wizard (the annex's import page always composes
 * `upload-dropzone` + `column-mapping-table` + this + `progress-bar`).
 *
 * Composed from @adminium/ui's `IconTile` + `Badge`. Rows are ordered by
 * SEVERITY, not by payload order — the reason is in `sortIssues` below.
 */

import { Badge, EmptyState, IconTile } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';

import { severityIcon } from './forms-icons.js';
import { DEFAULT_SEVERITY_TONE, formatCount, numberField, oneOf, recordRowsOf, stringField } from './forms-lib.js';
import type { FormTone, IssueSeverity } from './forms-lib.js';
import { ISSUE_SEVERITIES, validationIssuesListConfigSchema, validationIssuesListDemoData } from './forms-config.js';
import type { ValidationIssuesListConfig } from './forms-config.js';
import type { WidgetProps } from '../../registry/types.js';

export { validationIssuesListConfigSchema, validationIssuesListDemoData };
export type { ValidationIssuesListConfig };

export interface ValidationIssue {
  key: string;
  severity: IssueSeverity;
  title: string;
  desc?: string | undefined;
  count?: number | undefined;
}

/** Project the §3 `record-list` payload onto issues. */
export function issuesOf(data: unknown, config: ValidationIssuesListConfig): ValidationIssue[] {
  const rows = recordRowsOf(data);
  const out: ValidationIssue[] = [];
  for (const [index, row] of rows.entries()) {
    const title = stringField(row, config.titleField);
    if (title === undefined) continue;
    out.push({
      key: `${title}-${index}`,
      // An unrecognised severity degrades to `info` rather than dropping the
      // row: an unclassifiable issue is still an issue the user must see.
      severity: oneOf(row[config.severityField], ISSUE_SEVERITIES, 'info'),
      title,
      desc: stringField(row, config.descField),
      count: numberField(row, config.countField),
    });
  }
  return sortIssues(out);
}

const SEVERITY_RANK: Record<IssueSeverity, number> = { error: 0, warn: 1, info: 2 };

/**
 * Order errors → warnings → info, stably within each severity.
 *
 * The list is a triage surface: an import blocked by 12 invalid emails must not
 * be reported below "Dates normalised to ISO" merely because the server happened
 * to emit the notice first. Ties keep payload order, so the result stays
 * deterministic for the same payload (04 §7.7).
 */
export function sortIssues(issues: readonly ValidationIssue[]): ValidationIssue[] {
  return [...issues].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

/** Config `severityMap` overrides the default severity→tone map (annex §10). */
function toneOf(severity: IssueSeverity, map: Record<string, FormTone> | undefined): FormTone {
  return map?.[severity] ?? DEFAULT_SEVERITY_TONE[severity];
}

export function ValidationIssuesListWidget({ config, data }: WidgetProps<ValidationIssuesListConfig>) {
  const t = useMaybeT();
  const issues = issuesOf(data, config);
  const locale = config.format?.locale;

  if (issues.length === 0) {
    return (
      <EmptyState
        compact
        preset="all-caught-up"
        title={config.emptyTitle ?? t('ui:widgets.forms.validationIssuesList.emptyTitle', 'No issues found')}
        body={config.emptyBody ?? t('ui:widgets.forms.validationIssuesList.emptyBody', 'Everything checks out — you are good to import.')}
      />
    );
  }

  return (
    <ul
      data-widget="validation-issues-list"
      data-testid={config.testId}
      className="m-0 flex h-full list-none flex-col gap-0.5 overflow-auto p-2"
    >
      {issues.map((issue) => {
        const tone = toneOf(issue.severity, config.severityMap);
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
