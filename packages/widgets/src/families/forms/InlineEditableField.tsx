/**
 * `inline-editable-field` (annex §10) — a text/number/select span rendered as a
 * transparent input inside documents and canvases: click (or Enter/Space) to
 * edit, Enter/blur to commit, Escape to cancel.
 * Evidence: Invoice Builder, Email Templates, Report Builder, See It In Action.
 *
 * Binds §3 `record` — "a bound field path on a doc object" is one row plus a
 * column name, which is exactly that shape.
 *
 * COMMIT, NOT DEBOUNCE. The annex describes "debounced dirty tracking", and this
 * widget deliberately commits on an explicit action instead. A debounce timer
 * would emit `mutate` intents the user never confirmed — each one an audited,
 * undoable write — for text they were still in the middle of typing, and would
 * make the widget's own tests depend on wall-clock time (04 §7.7 wants neither).
 * Escape restoring the original value is only meaningful if nothing was written
 * on the way there.
 */

import { Input, Select, Textarea, cn } from '@adminium/ui';
import { useState } from 'react';

import { inlineEditableFieldConfigSchema, inlineEditableFieldDemoData } from './forms-config.js';
import type { InlineEditableFieldConfig } from './forms-config.js';
import { recordRowOf, stringField } from './forms-lib.js';
import { bindingTargetOf } from './forms-state.js';
import type { WidgetProps } from '../../registry/types.js';

export { inlineEditableFieldConfigSchema, inlineEditableFieldDemoData };
export type { InlineEditableFieldConfig };

/** The bound field's current value as display text (`''` when absent). */
export function boundValueOf(data: unknown, config: InlineEditableFieldConfig): string {
  const row = recordRowOf(data);
  if (row === null) return '';
  return stringField(row, config.field) ?? '';
}

/** The record id a `mutate` intent targets, or `null` when the row has none. */
export function boundRecordIdOf(data: unknown, config: InlineEditableFieldConfig): string | null {
  const row = recordRowOf(data);
  if (row === null) return null;
  return stringField(row, config.idField) ?? null;
}

/** The display label for a `select` value — its option label, else the raw value. */
function displayValue(value: string, config: InlineEditableFieldConfig): string {
  if (config.format !== 'select') return value;
  return config.options?.find((option) => option.value === value)?.label ?? value;
}

export function InlineEditableFieldWidget({ config, data, instanceId, onEvent }: WidgetProps<InlineEditableFieldConfig>) {
  const bound = boundValueOf(data, config);
  /** The last COMMITTED value — what Escape restores and what dirty compares to. */
  const [committed, setCommitted] = useState(bound);
  const [draft, setDraft] = useState(bound);
  const [editing, setEditing] = useState(false);

  /*
    RESYNC ON A NEW BOUND VALUE. `useState(bound)` seeds the initial render and
    is ignored by React on every render after it, so without this the field
    displays whatever the row said when it first mounted — forever. Two real
    breaks: a master-detail page reuses ONE instance across row selections, so
    the display would show the previous record's text while `boundRecordIdOf`
    already resolves the new id (an edit then writes the new record with the old
    record's value); and a refetch (`refreshInterval`, or another user's edit)
    would never surface.

    A render-phase reset rather than an effect: React's own "adjusting state when
    props change" pattern — it re-renders before committing to the DOM, so the
    stale value is never painted (an effect would flash it first).
  */
  const [lastBound, setLastBound] = useState(bound);
  if (bound !== lastBound) {
    setLastBound(bound);
    setCommitted(bound);
    setDraft(bound);
    // The incoming value is authoritative; keeping an open editor over a record
    // that just changed underneath would commit the draft to the WRONG row.
    setEditing(false);
  }

  const target = bindingTargetOf(config.binding);
  const recordId = boundRecordIdOf(data, config);
  const controlId = `${instanceId}-inline-field`;

  const commit = () => {
    setEditing(false);
    // Nothing changed — no intent. An unchanged commit would still cost the host
    // an audit entry and an undo slot for a write that changes nothing.
    if (draft === committed) return;
    setCommitted(draft);
    if (target === null) return; // unbound (demo/story/palette)
    onEvent({
      type: 'mutate',
      intent: 'update',
      connectionId: target.connectionId,
      table: target.table,
      ...(recordId === null ? {} : { recordId }),
      values: { [config.field]: draft },
    });
  };

  const cancel = () => {
    setDraft(committed);
    setEditing(false);
  };

  const onKeyDown = (event: { key: string; preventDefault: () => void }) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
      return;
    }
    // Enter commits — except in a textarea, where it is a newline the user meant.
    if (event.key === 'Enter' && !(config.format === 'text' && config.multiline)) {
      event.preventDefault();
      commit();
    }
  };

  if (!editing) {
    const text = displayValue(committed, config);
    const empty = text.trim() === '';
    return (
      <div className="flex h-full items-center px-4 pb-4" data-widget="inline-editable-field" data-testid={config.testId}>
        <button
          type="button"
          data-part="inline-display"
          data-empty={empty}
          aria-label={config.editLabel ?? config.label ?? config.title ?? 'Edit'}
          onClick={() => setEditing(true)}
          className={cn(
            'w-full truncate rounded-md px-1.5 py-0.5 text-start text-body-sm transition-colors duration-150',
            'hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
            empty ? 'text-fg-subtle italic' : 'text-fg',
          )}
        >
          {/* An empty value would be a zero-width click target — the placeholder
              copy is what keeps the field reachable at all. */}
          {empty ? (config.emptyValueLabel ?? 'Empty') : text}
        </button>
      </div>
    );
  }

  const shared = {
    id: controlId,
    autoFocus: true,
    'aria-label': config.label ?? config.title ?? 'Value',
    'data-part': 'inline-input',
    onBlur: commit,
    onKeyDown,
  } as const;

  return (
    <div className="flex h-full items-center px-4 pb-4" data-widget="inline-editable-field" data-editing data-testid={config.testId}>
      {config.format === 'select' ? (
        <Select
          {...shared}
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
        >
          <option value="" />
          {(config.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label ?? option.value}
            </option>
          ))}
        </Select>
      ) : config.format === 'text' && config.multiline ? (
        <Textarea
          {...shared}
          autoResize
          value={draft}
          placeholder={config.placeholder ?? ''}
          onChange={(event) => setDraft(event.currentTarget.value)}
        />
      ) : (
        <Input
          {...shared}
          {...(config.format === 'number' ? { mono: true, inputMode: 'decimal' as const } : {})}
          value={draft}
          placeholder={config.placeholder ?? ''}
          // The RAW string stays in state even for `number` — coercing per
          // keystroke makes "1." and a lone "-" impossible to type. The host
          // coerces on commit (same note as `FormFields`).
          onChange={(event) => setDraft(event.currentTarget.value)}
        />
      )}
    </div>
  );
}
