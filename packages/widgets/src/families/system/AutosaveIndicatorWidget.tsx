/**
 * `autosave-indicator` (annex §12) — header pill cycling warn-dot "Unsaved
 * changes" → spinner "Saving…" → green check "All changes saved", stamping the
 * updated time. Bound to the host document's `{dirty, saving, savedAt}` state
 * (Invoice Builder, Report Builder, Notification Settings).
 *
 * Wraps @adminium/ui's `AutosaveIndicator` (which owns the pill, the fade
 * transition, and the polite live region). The widget is PURELY a projection of
 * bound state — it never debounces or saves; `config.debounceMs` only documents
 * the host's window for the info popover (04 §4).
 */

import { AutosaveIndicator, MonoText } from '@adminium/ui';

import { booleanField, formatStamp, numberField, recordRowOf } from './system-lib.js';
import type { AutosaveStatus } from './system-lib.js';
import { autosaveIndicatorConfigSchema, autosaveIndicatorDemoData } from './system-config.js';
import type { AutosaveIndicatorConfig } from './system-config.js';
import type { WidgetProps } from '../../registry/types.js';

export { autosaveIndicatorConfigSchema, autosaveIndicatorDemoData };
export type { AutosaveIndicatorConfig };

/**
 * Collapse the bound `{dirty, saving, error, savedAt}` flags into one phase.
 * Precedence is deliberate and matches the annex's cycle: an in-flight save wins
 * over dirtiness (the host sets `dirty` false only on commit), and a failure
 * wins over everything so a silent data-loss state is impossible.
 */
export function autosaveStatusOf(input: {
  dirty?: boolean | undefined;
  saving?: boolean | undefined;
  error?: boolean | undefined;
  savedAt?: number | undefined;
}): AutosaveStatus {
  if (input.error === true) return 'error';
  if (input.saving === true) return 'saving';
  if (input.dirty === true) return 'dirty';
  if (input.savedAt !== undefined) return 'saved';
  return 'idle';
}

export interface AutosaveIndicatorViewProps {
  status: AutosaveStatus;
  savedAt?: number | undefined;
  showStamp?: boolean | undefined;
  locale?: string | undefined;
  dirtyLabel?: string | undefined;
  savingLabel?: string | undefined;
  savedLabel?: string | undefined;
  errorLabel?: string | undefined;
  testId?: string | undefined;
}

export function AutosaveIndicatorView({
  status,
  savedAt,
  showStamp = true,
  locale,
  dirtyLabel,
  savingLabel,
  savedLabel,
  errorLabel,
  testId,
}: AutosaveIndicatorViewProps) {
  const stamp = showStamp && status === 'saved' ? formatStamp(savedAt, locale) : undefined;

  return (
    <div className="flex h-full items-center gap-2 px-4 pb-4" data-widget="autosave-indicator" data-testid={testId}>
      <AutosaveIndicator
        status={status}
        dirtyLabel={dirtyLabel ?? 'Unsaved changes'}
        savingLabel={savingLabel ?? 'Saving…'}
        savedLabel={savedLabel ?? 'All changes saved'}
        errorLabel={errorLabel ?? "Couldn't save"}
      />
      {stamp !== undefined && <MonoText className="text-caption text-fg-subtle">{stamp}</MonoText>}
    </div>
  );
}

export function AutosaveIndicatorWidget({ config, data }: WidgetProps<AutosaveIndicatorConfig>) {
  const row = recordRowOf(data);
  const savedAt = row === null ? undefined : numberField(row, config.savedAtField);
  const status =
    row === null
      ? 'idle'
      : autosaveStatusOf({
          dirty: booleanField(row, config.dirtyField),
          saving: booleanField(row, config.savingField),
          error: booleanField(row, config.errorField),
          savedAt,
        });

  return (
    <AutosaveIndicatorView
      status={status}
      savedAt={savedAt}
      showStamp={config.showStamp}
      locale={config.format?.locale}
      dirtyLabel={config.dirtyLabel}
      savingLabel={config.savingLabel}
      savedLabel={config.savedLabel}
      errorLabel={config.errorLabel}
      testId={config.testId}
    />
  );
}
