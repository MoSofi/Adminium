// SPDX-License-Identifier: AGPL-3.0-only
import { useMaybeT } from '@adminium/i18n/react';
import { BulkActionBar, BulkActionButton } from '@adminium/ui';
import type { ReactNode } from 'react';

/**
 * `bulk-action-toolbar` (annex §3) — selection-aware toolbar wired to the
 * host grid's selection set: "N selected" + configured actions
 * (Export/Delete/Clear per CRUD Admin). Renders nothing while the selection
 * is empty; the page toolbar "morphs" by conditionally rendering this
 * instead of search/filter controls (09 §7.1).
 */

export interface BulkAction {
  key: string;
  label: string;
  icon?: ReactNode | undefined;
  /** Danger styling (Delete). */
  danger?: boolean | undefined;
  /** Role id gating this action — host filters before passing when needed. */
  permission?: string | undefined;
  disabled?: boolean | undefined;
}

export interface BulkActionToolbarProps {
  /** Selected row ids from the host grid (annex data contract). */
  selectedIds: readonly string[];
  actions: readonly BulkAction[];
  onAction: (key: string, selectedIds: readonly string[]) => void;
  onClear: () => void;
  /** Docked inside the page (default) vs floating bottom-center. */
  floating?: boolean | undefined;
  labels?:
    | {
        selected?: string | undefined;
        clear?: string | undefined;
        toolbar?: string | undefined;
      }
    | undefined;
  testId?: string | undefined;
}

export function BulkActionToolbar({
  selectedIds,
  actions,
  onAction,
  onClear,
  floating = false,
  labels,
  testId,
}: BulkActionToolbarProps) {
  const t = useMaybeT();
  if (selectedIds.length === 0) return null;
  return (
    <BulkActionBar
      data-testid={testId}
      count={selectedIds.length}
      countLabel={labels?.selected ?? t('ui:widgets.tables.bulkActionToolbar.selectedLabel', 'selected')}
      onClear={onClear}
      clearLabel={labels?.clear ?? t('ui:widgets.tables.bulkActionToolbar.clearLabel', 'Clear selection')}
      label={labels?.toolbar ?? t('ui:widgets.tables.bulkActionToolbar.toolbarLabel', 'Bulk actions')}
      floating={floating}
    >
      {actions.map((action) => (
        <BulkActionButton
          key={action.key}
          icon={action.icon}
          destructive={action.danger === true}
          disabled={action.disabled === true}
          onClick={() => onAction(action.key, selectedIds)}
        >
          {action.label}
        </BulkActionButton>
      ))}
    </BulkActionBar>
  );
}
