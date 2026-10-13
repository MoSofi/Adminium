// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `validation-issues-list` (annex) — severity-toned issue rows: an icon
 * tile, the title, the resolution description, and an outcome count pill.
 * Evidence: Import Wizard (the annex's import page always composes
 * `upload-dropzone` + `column-mapping-table` + this + `progress-bar`).
 *
 * Composed from @adminium/ui's `IconTile` + `Badge`. Rows are ordered by
 * SEVERITY, not by payload order — the reason is in `sortIssues` below.
 */

import { IssuesList, sortIssues, type ValidationIssue } from './IssuesList.js';
import { numberField, oneOf, recordRowsOf, stringField } from './forms-lib.js';
import { ISSUE_SEVERITIES, validationIssuesListConfigSchema, validationIssuesListDemoData } from './forms-config.js';
import type { ValidationIssuesListConfig } from './forms-config.js';
import type { WidgetProps } from '../../registry/types.js';

export { validationIssuesListConfigSchema, validationIssuesListDemoData };
export type { ValidationIssuesListConfig };

export type { ValidationIssue };
export { sortIssues };

/** Project the `record-list` payload onto issues. */
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

export function ValidationIssuesListWidget({ config, data }: WidgetProps<ValidationIssuesListConfig>) {
  return (
    <IssuesList
      issues={issuesOf(data, config)}
      {...(config.severityMap === undefined ? {} : { severityMap: config.severityMap })}
      {...(config.format?.locale === undefined ? {} : { locale: config.format.locale })}
      {...(config.emptyTitle === undefined ? {} : { emptyTitle: config.emptyTitle })}
      {...(config.emptyBody === undefined ? {} : { emptyBody: config.emptyBody })}
      {...(config.testId === undefined ? {} : { testId: config.testId })}
    />
  );
}
