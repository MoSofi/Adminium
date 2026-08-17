// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `toggle-switch-list` (annex §10) — a card of rows: label + description
 * (+ optional tone-tinted icon tile) + a switch bound to a `boolean-map`;
 * instant-persist or dirty-tracking. Evidence: Settings, Profile Settings,
 * Workspace Settings, Notification Settings, Survey Builder, Integrations.
 *
 * Binds the §3 `boolean-map` shape (annex §10: "boolean-map keyed by setting id
 * + row metadata") — the VALUES come from the payload, the row LABELS from
 * config, joined on the setting id.
 *
 * WRITE MODEL (04 §2.1): `optimistic` emits an `update` intent per toggle and
 * rolls the switch back if the host rejects it; `save-bar` batches into one
 * intent behind an explicit Save. Either way the widget never persists.
 */

import { Button, EmptyState, IconTile, Switch, cn } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';
import { useState } from 'react';

import { formIcon } from './forms-icons.js';
import { booleanEntriesOf, uiToneOf } from './forms-lib.js';
import { bindingTargetOf } from './forms-state.js';
import { DEFAULT_TOGGLE_ROWS, toggleSwitchListConfigSchema, toggleSwitchListDemoData } from './forms-config.js';
import type { ToggleSwitchListConfig } from './forms-config.js';
import type { WidgetProps } from '../../registry/types.js';

export { toggleSwitchListConfigSchema, toggleSwitchListDemoData, DEFAULT_TOGGLE_ROWS };
export type { ToggleSwitchListConfig };

export function ToggleSwitchListWidget({ config, data, instanceId, onEvent }: WidgetProps<ToggleSwitchListConfig>) {
  const t = useMaybeT();
  const bound = booleanEntriesOf(data);
  const rows = config.rows ?? DEFAULT_TOGGLE_ROWS;
  const [entries, setEntries] = useState<Record<string, boolean>>(bound);
  /**
   * The last state the SERVER acknowledged. Rollback targets this rather than
   * "the value before this toggle": in `save-bar` mode a rejected save must undo
   * the whole batch, and using the pre-toggle value would only undo the last one.
   */
  const [saved, setSaved] = useState<Record<string, boolean>>(bound);
  const [dirty, setDirty] = useState(false);
  const target = bindingTargetOf(config.binding);

  if (rows.length === 0) {
    return (
      <EmptyState
        compact
        preset="no-data"
        title={config.emptyTitle ?? t('ui:widgets.forms.toggleSwitchList.emptyTitle', 'No settings')}
        body={config.emptyBody ?? t('ui:widgets.forms.toggleSwitchList.emptyBody', 'Settings appear here once they are configured.')}
      />
    );
  }

  const commit = async (next: Record<string, boolean>) => {
    // Unbound (demo/story/palette): keep the local state, emit nothing.
    if (target === null) {
      setSaved(next);
      setDirty(false);
      return;
    }
    try {
      await onEvent({
        type: 'mutate',
        intent: 'update',
        connectionId: target.connectionId,
        table: target.table,
        values: next,
      });
      setSaved(next);
      setDirty(false);
    } catch {
      // The host rejected the write — roll back to the last acknowledged state
      // so the UI never claims a setting is on when the server says otherwise.
      setEntries(saved);
      setDirty(false);
    }
  };

  const toggle = (key: string, checked: boolean) => {
    const next = { ...entries, [key]: checked };
    setEntries(next);
    if (config.persistMode === 'optimistic') void commit(next);
    else setDirty(true);
  };

  return (
    <div
      data-widget="toggle-switch-list"
      data-persist-mode={config.persistMode}
      data-testid={config.testId}
      className="flex h-full flex-col gap-2 overflow-auto px-[var(--widget-pad)] pb-[var(--widget-pad)]"
    >
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {rows.map((row) => {
          const id = `${instanceId}-${row.key}`;
          const checked = entries[row.key] === true;
          const icon = config.iconTiles ? formIcon(row.icon) : undefined;
          return (
            <li
              key={row.key}
              data-part="toggle-row"
              data-key={row.key}
              className="flex items-start gap-3 rounded-lg px-2.5 py-3 hover:bg-surface-2"
            >
              {icon !== undefined && <IconTile size="md" tone={uiToneOf(row.tone, 'accent')} icon={icon} />}
              <div className="min-w-0 flex-1">
                {/*
                  A real <label htmlFor> (not an aria-label): it makes the whole
                  text a click target for the switch, which is the affordance the
                  comps show and what pointer users expect from a settings row.
                */}
                <label htmlFor={id} className="block cursor-pointer text-body-sm font-bold text-fg">
                  {row.label ?? row.key}
                </label>
                {row.description !== undefined && (
                  <p className={cn('text-caption text-fg-muted')}>{row.description}</p>
                )}
              </div>
              <Switch id={id} checked={checked} onCheckedChange={(next) => toggle(row.key, next)} className="mt-0.5 shrink-0" />
            </li>
          );
        })}
      </ul>

      {config.persistMode === 'save-bar' && dirty && (
        <div data-part="save-bar" className="flex items-center justify-between gap-3 rounded-lg bg-surface-2 px-3 py-2">
          <span className="text-caption text-fg-muted">
            {config.dirtyLabel ?? t('ui:widgets.forms.toggleSwitchList.dirty', 'You have unsaved changes')}
          </span>
          <Button size="sm" data-part="save-button" onClick={() => void commit(entries)}>
            {config.saveLabel ?? t('ui:widgets.forms.toggleSwitchList.save', 'Save')}
          </Button>
        </div>
      )}
    </div>
  );
}
